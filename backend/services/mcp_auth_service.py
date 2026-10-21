"""
MCP 連携用 OAuth 2.1 認可サーバー / リソースサーバーのデータ層とロジック

PIS を claude.ai のカスタムコネクタ（リモート MCP サーバー）として公開するための認証基盤。
単一ユーザー（オーナー）専用で、ユーザー登録は無い。

- クライアント: 動的クライアント登録（RFC 7591）。redirect_uri は許可リストのみ
- 認可コード: 5 分・1 回限り。PKCE（S256）必須
- トークン: 不透明なランダム文字列。Firestore には HMAC-SHA256 のハッシュだけを保存し、生の値は保存しない
  アクセストークン 1 時間、リフレッシュトークン 90 日（ローテーション。再利用を検知したら家族ごと失効）
- ログイン失敗: IP 単位で 5 回失敗すると 15 分ロック
- アクセスログ: ツール名・引数の要約・返却件数のみ（本文は記録しない）。90 日で削除

環境変数:
  MCP_PUBLIC_URL               このサーバーの公開 URL（例: https://xxx.a.run.app）。issuer / resource の基点
  MCP_OWNER_PASSWORD_HASH      ログインパスワードの bcrypt ハッシュ（scripts/make_password_hash.py で作る）
  MCP_TOKEN_SECRET             トークンのハッシュ鍵（32 文字以上のランダム文字列）
  MCP_ALLOWED_REDIRECT_URIS    許可する redirect_uri（カンマ区切り。既定は claude.ai / claude.com のコールバック）
  MCP_ALLOW_LOCALHOST_REDIRECT "1" で http://localhost / 127.0.0.1 の redirect_uri も許可（ローカル検証用）
  MCP_TEST_MEMORY_STORE        "1" で Firestore の代わりにメモリ上のストアを使う（テスト用）
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# ---- 定数 ----

ACCESS_TOKEN_TTL = timedelta(hours=1)
REFRESH_TOKEN_TTL = timedelta(days=90)
AUTH_CODE_TTL = timedelta(minutes=5)
LOGIN_MAX_FAILURES = 5
ACCESS_LOG_TTL = timedelta(days=90)

SCOPES_SUPPORTED = ["pis:read", "pis:write"]
REQUIRED_SCOPES = ["pis:read"]

DEFAULT_ALLOWED_REDIRECT_URIS = [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
]

COLL_CLIENTS = "mcp_oauth_clients"
COLL_CODES = "mcp_oauth_codes"
COLL_TOKENS = "mcp_oauth_tokens"
COLL_LOGIN_ATTEMPTS = "mcp_login_attempts"
COLL_ACCESS_LOGS = "mcp_access_logs"


# ---- 設定 ----

def public_url() -> str:
    """このサーバーの公開 URL（末尾スラッシュなし）"""
    return (os.getenv("MCP_PUBLIC_URL") or "http://localhost:8000").rstrip("/")


def issuer_url() -> str:
    return public_url()


def resource_url() -> str:
    """MCP エンドポイントの正規 URL（RFC 8707 の resource）"""
    return public_url() + "/mcp"


def token_secret() -> Optional[str]:
    s = os.getenv("MCP_TOKEN_SECRET", "").strip()
    return s or None


def owner_password_hash() -> Optional[str]:
    s = os.getenv("MCP_OWNER_PASSWORD_HASH", "").strip()
    return s or None


def is_configured() -> bool:
    """ログイン・トークン発行ができる状態か"""
    return bool(token_secret()) and bool(owner_password_hash())


def login_lock_seconds() -> int:
    return int(os.getenv("MCP_LOGIN_LOCK_SECONDS", "900"))


def allowed_redirect_uris() -> list[str]:
    raw = os.getenv("MCP_ALLOWED_REDIRECT_URIS", "").strip()
    uris = [u.strip() for u in raw.split(",") if u.strip()] if raw else list(DEFAULT_ALLOWED_REDIRECT_URIS)
    return uris


def is_redirect_uri_allowed(uri: str) -> bool:
    if uri in allowed_redirect_uris():
        return True
    if os.getenv("MCP_ALLOW_LOCALHOST_REDIRECT") == "1":
        p = urlparse(uri)
        if p.scheme == "http" and p.hostname in ("localhost", "127.0.0.1"):
            return True
    return False


# ---- ユーティリティ ----

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse(iso: Optional[str]) -> Optional[datetime]:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso)
    except ValueError:
        return None


def hash_secret(value: str) -> str:
    """トークン・認可コード・クライアントシークレットのハッシュ（HMAC-SHA256）。
    鍵（MCP_TOKEN_SECRET）を知らないと DB の内容から値を逆算も偽造もできない。"""
    key = token_secret()
    if not key:
        raise RuntimeError("MCP_TOKEN_SECRET が未設定です")
    return hmac.new(key.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def verify_password(password: str) -> bool:
    h = owner_password_hash()
    if not h:
        return False
    try:
        import bcrypt
        return bcrypt.checkpw(password.encode("utf-8"), h.encode("utf-8"))
    except Exception as e:  # ハッシュ形式が不正など
        logger.warning("パスワード検証に失敗: %s", e)
        return False


# ---- ストア（Firestore / メモリ） ----

class _MemoryStore:
    """テスト用のメモリストア。Firestore と同じ最小インターフェース"""

    def __init__(self) -> None:
        self.data: dict[str, dict[str, dict[str, Any]]] = {}

    def get(self, coll: str, doc_id: str) -> Optional[dict]:
        d = self.data.get(coll, {}).get(doc_id)
        return dict(d) if d else None

    def set(self, coll: str, doc_id: str, data: dict) -> None:
        self.data.setdefault(coll, {})[doc_id] = dict(data)

    def update(self, coll: str, doc_id: str, data: dict) -> None:
        self.data.setdefault(coll, {}).setdefault(doc_id, {}).update(data)

    def delete(self, coll: str, doc_id: str) -> None:
        self.data.get(coll, {}).pop(doc_id, None)

    def add(self, coll: str, data: dict) -> str:
        doc_id = secrets.token_hex(8)
        self.set(coll, doc_id, data)
        return doc_id

    def where(self, coll: str, field: str, value: Any, limit: int = 100) -> list[tuple[str, dict]]:
        out = [(k, dict(v)) for k, v in self.data.get(coll, {}).items() if v.get(field) == value]
        return out[:limit]

    def where_lt(self, coll: str, field: str, value: Any, limit: int = 100) -> list[tuple[str, dict]]:
        out = [(k, dict(v)) for k, v in self.data.get(coll, {}).items() if (v.get(field) or "") < value]
        return out[:limit]


class _FirestoreStore:
    def _db(self):
        from services.firestore_service import get_db
        return get_db()

    def get(self, coll: str, doc_id: str) -> Optional[dict]:
        doc = self._db().collection(coll).document(doc_id).get()
        return doc.to_dict() if doc.exists else None

    def set(self, coll: str, doc_id: str, data: dict) -> None:
        self._db().collection(coll).document(doc_id).set(data)

    def update(self, coll: str, doc_id: str, data: dict) -> None:
        self._db().collection(coll).document(doc_id).set(data, merge=True)

    def delete(self, coll: str, doc_id: str) -> None:
        self._db().collection(coll).document(doc_id).delete()

    def add(self, coll: str, data: dict) -> str:
        _, ref = self._db().collection(coll).add(data)
        return ref.id

    def where(self, coll: str, field: str, value: Any, limit: int = 100) -> list[tuple[str, dict]]:
        from google.cloud.firestore_v1.base_query import FieldFilter
        q = self._db().collection(coll).where(filter=FieldFilter(field, "==", value)).limit(limit)
        return [(d.id, d.to_dict()) for d in q.stream()]

    def where_lt(self, coll: str, field: str, value: Any, limit: int = 100) -> list[tuple[str, dict]]:
        from google.cloud.firestore_v1.base_query import FieldFilter
        q = self._db().collection(coll).where(filter=FieldFilter(field, "<", value)).limit(limit)
        return [(d.id, d.to_dict()) for d in q.stream()]


_store: Any = None


def store():
    global _store
    if _store is None:
        _store = _MemoryStore() if os.getenv("MCP_TEST_MEMORY_STORE") == "1" else _FirestoreStore()
    return _store


# ---- クライアント登録（RFC 7591） ----

class RegistrationError(ValueError):
    def __init__(self, error: str, description: str):
        super().__init__(description)
        self.error = error
        self.description = description


def register_client(meta: dict) -> dict:
    """動的クライアント登録。戻り値は RFC 7591 のレスポンス（client_secret は生の値を 1 回だけ返す）"""
    redirect_uris = meta.get("redirect_uris")
    if not isinstance(redirect_uris, list) or not redirect_uris or not all(isinstance(u, str) for u in redirect_uris):
        raise RegistrationError("invalid_redirect_uri", "redirect_uris は 1 件以上の文字列配列で指定してください")
    for u in redirect_uris:
        if not is_redirect_uri_allowed(u):
            raise RegistrationError("invalid_redirect_uri", f"許可されていない redirect_uri です: {u}")

    auth_method = meta.get("token_endpoint_auth_method") or "none"
    if auth_method not in ("none", "client_secret_post", "client_secret_basic"):
        raise RegistrationError("invalid_client_metadata", f"token_endpoint_auth_method '{auth_method}' は未対応です")

    grant_types = meta.get("grant_types") or ["authorization_code", "refresh_token"]
    if not set(grant_types) <= {"authorization_code", "refresh_token"}:
        raise RegistrationError("invalid_client_metadata", "grant_types は authorization_code / refresh_token のみ対応です")
    response_types = meta.get("response_types") or ["code"]
    if response_types != ["code"]:
        raise RegistrationError("invalid_client_metadata", "response_types は [\"code\"] のみ対応です")

    client_id = "pis-" + secrets.token_urlsafe(16)
    issued_at = int(time.time())
    client_secret = None
    record = {
        "client_id": client_id,
        "client_name": str(meta.get("client_name") or "")[:200],
        "client_uri": str(meta.get("client_uri") or "")[:500],
        "redirect_uris": redirect_uris,
        "token_endpoint_auth_method": auth_method,
        "grant_types": grant_types,
        "response_types": response_types,
        "scope": str(meta.get("scope") or " ".join(SCOPES_SUPPORTED))[:200],
        "client_id_issued_at": issued_at,
        "created_at": _iso(_now()),
    }
    if auth_method != "none":
        client_secret = secrets.token_urlsafe(32)
        record["client_secret_hash"] = hash_secret(client_secret)
    store().set(COLL_CLIENTS, client_id, record)

    resp = {k: v for k, v in record.items() if k not in ("client_secret_hash", "created_at")}
    if client_secret:
        resp["client_secret"] = client_secret
        resp["client_secret_expires_at"] = 0
    return resp


def get_client(client_id: str) -> Optional[dict]:
    if not client_id:
        return None
    return store().get(COLL_CLIENTS, client_id)


def authenticate_client(client: dict, client_secret: Optional[str]) -> bool:
    """トークンエンドポイントでのクライアント認証。公開クライアントはシークレット不要"""
    method = client.get("token_endpoint_auth_method", "none")
    if method == "none":
        return True
    if not client_secret or not client.get("client_secret_hash"):
        return False
    return hmac.compare_digest(hash_secret(client_secret), client["client_secret_hash"])


# ---- ログイン失敗ロック ----

def _attempt_id(ip: str) -> str:
    return hashlib.sha256(ip.encode("utf-8")).hexdigest()[:32]


def login_locked_until(ip: str) -> Optional[datetime]:
    rec = store().get(COLL_LOGIN_ATTEMPTS, _attempt_id(ip))
    if not rec:
        return None
    until = _parse(rec.get("locked_until"))
    if until and until > _now():
        return until
    return None


def record_login_failure(ip: str) -> Optional[datetime]:
    """失敗を記録し、ロックに達したら解除時刻を返す"""
    doc_id = _attempt_id(ip)
    rec = store().get(COLL_LOGIN_ATTEMPTS, doc_id) or {}
    window_start = _parse(rec.get("window_start"))
    count = int(rec.get("count") or 0)
    if not window_start or _now() - window_start > timedelta(seconds=login_lock_seconds()):
        window_start, count = _now(), 0
    count += 1
    data = {"count": count, "window_start": _iso(window_start), "updated_at": _iso(_now())}
    locked_until = None
    if count >= LOGIN_MAX_FAILURES:
        locked_until = _now() + timedelta(seconds=login_lock_seconds())
        data["locked_until"] = _iso(locked_until)
        data["count"] = 0
        data["window_start"] = _iso(_now())
    store().set(COLL_LOGIN_ATTEMPTS, doc_id, data)
    return locked_until


def clear_login_failures(ip: str) -> None:
    store().delete(COLL_LOGIN_ATTEMPTS, _attempt_id(ip))


# ---- 認可コード ----

@dataclass
class AuthRequest:
    client_id: str
    redirect_uri: str
    code_challenge: str
    scope: str
    resource: Optional[str]
    state: Optional[str]


def issue_auth_code(req: AuthRequest) -> str:
    code = "pis_ac_" + secrets.token_urlsafe(32)
    store().set(COLL_CODES, hash_secret(code), {
        "client_id": req.client_id,
        "redirect_uri": req.redirect_uri,
        "code_challenge": req.code_challenge,
        "scope": req.scope,
        "resource": req.resource,
        "expires_at": _iso(_now() + AUTH_CODE_TTL),
        "used": False,
        "created_at": _iso(_now()),
    })
    return code


class GrantError(ValueError):
    def __init__(self, error: str, description: str):
        super().__init__(description)
        self.error = error
        self.description = description


def normalize_scope(requested: Optional[str]) -> str:
    """要求スコープを対応スコープに絞る。未指定なら全部"""
    if not requested:
        return " ".join(SCOPES_SUPPORTED)
    asked = [s for s in requested.split() if s in SCOPES_SUPPORTED]
    return " ".join(asked) if asked else " ".join(SCOPES_SUPPORTED)


def _resource_matches(stored: Optional[str], given: Optional[str]) -> bool:
    if not given:
        return True
    return (stored or resource_url()).rstrip("/") == given.rstrip("/")


def exchange_auth_code(code: str, client_id: str, redirect_uri: Optional[str],
                       code_verifier: Optional[str], resource: Optional[str]) -> dict:
    """認可コード → トークン。失敗は GrantError"""
    doc_id = hash_secret(code)
    rec = store().get(COLL_CODES, doc_id)
    if not rec:
        raise GrantError("invalid_grant", "認可コードが無効です")
    if rec.get("used"):
        # 使用済みコードの再利用 = 漏洩の疑い。発行済みトークンを失効させる
        fam = rec.get("family")
        if fam:
            revoke_family(fam)
        raise GrantError("invalid_grant", "認可コードは使用済みです")
    exp = _parse(rec.get("expires_at"))
    if not exp or exp < _now():
        raise GrantError("invalid_grant", "認可コードの有効期限が切れています")
    if rec.get("client_id") != client_id:
        raise GrantError("invalid_grant", "client_id が一致しません")
    if redirect_uri and rec.get("redirect_uri") != redirect_uri:
        raise GrantError("invalid_grant", "redirect_uri が一致しません")
    if not code_verifier:
        raise GrantError("invalid_grant", "code_verifier が必要です")
    if not hmac.compare_digest(pkce_challenge(code_verifier), rec.get("code_challenge", "")):
        raise GrantError("invalid_grant", "PKCE の検証に失敗しました")
    if not _resource_matches(rec.get("resource"), resource):
        raise GrantError("invalid_target", "resource が一致しません")

    family = secrets.token_urlsafe(12)
    store().update(COLL_CODES, doc_id, {"used": True, "used_at": _iso(_now()), "family": family})
    return issue_token_pair(client_id, rec.get("scope") or normalize_scope(None), family)


# ---- トークン ----

def issue_token_pair(client_id: str, scope: str, family: str) -> dict:
    now = _now()
    access = "pis_at_" + secrets.token_urlsafe(32)
    refresh = "pis_rt_" + secrets.token_urlsafe(32)
    access_exp = now + ACCESS_TOKEN_TTL
    refresh_exp = now + REFRESH_TOKEN_TTL
    base = {"client_id": client_id, "scope": scope, "resource": resource_url(), "family": family,
            "revoked": False, "created_at": _iso(now)}
    store().set(COLL_TOKENS, hash_secret(access), {**base, "type": "access", "expires_at": _iso(access_exp)})
    store().set(COLL_TOKENS, hash_secret(refresh), {**base, "type": "refresh", "expires_at": _iso(refresh_exp)})
    return {
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": int(ACCESS_TOKEN_TTL.total_seconds()),
        "refresh_token": refresh,
        "scope": scope,
    }


def revoke_family(family: str) -> int:
    """同じ認可コードから派生したトークンをまとめて失効（コード / リフレッシュトークンの再利用検知時）"""
    n = 0
    for doc_id, rec in store().where(COLL_TOKENS, "family", family, limit=500):
        if not rec.get("revoked"):
            store().update(COLL_TOKENS, doc_id, {"revoked": True, "revoked_at": _iso(_now())})
            _verify_cache.pop(doc_id, None)
            n += 1
    return n


def refresh_tokens(refresh_token: str, client_id: str, scope: Optional[str], resource: Optional[str]) -> dict:
    """リフレッシュトークンのローテーション。失効済みの再利用は家族ごと失効"""
    doc_id = hash_secret(refresh_token)
    rec = store().get(COLL_TOKENS, doc_id)
    if not rec or rec.get("type") != "refresh":
        raise GrantError("invalid_grant", "リフレッシュトークンが無効です")
    if rec.get("revoked"):
        revoke_family(rec.get("family", ""))
        raise GrantError("invalid_grant", "リフレッシュトークンは失効しています")
    exp = _parse(rec.get("expires_at"))
    if not exp or exp < _now():
        raise GrantError("invalid_grant", "リフレッシュトークンの有効期限が切れています")
    if rec.get("client_id") != client_id:
        raise GrantError("invalid_grant", "client_id が一致しません")
    if not _resource_matches(rec.get("resource"), resource):
        raise GrantError("invalid_target", "resource が一致しません")
    granted = rec.get("scope") or ""
    if scope:
        asked = set(scope.split())
        if not asked <= set(granted.split()):
            raise GrantError("invalid_scope", "付与済みの範囲を超えるスコープは要求できません")
        granted = " ".join(s for s in granted.split() if s in asked)
    store().update(COLL_TOKENS, doc_id, {"revoked": True, "revoked_at": _iso(_now()), "rotated": True})
    return issue_token_pair(client_id, granted, rec.get("family") or secrets.token_urlsafe(12))


# 検証結果の短期キャッシュ（MCP の 1 リクエストごとの Firestore 読み取りを減らす）
# 失効の反映が最大 30 秒遅れる（同一インスタンス内の失効は revoke_family で即時反映）
_verify_cache: dict[str, tuple[float, dict]] = {}
_VERIFY_CACHE_TTL = 30.0


def verify_access_token(token: str) -> Optional[dict]:
    """アクセストークンを検証し、トークン情報（client_id, scope, resource, expires_at）を返す"""
    if not token or not token_secret():
        return None
    try:
        doc_id = hash_secret(token)
    except RuntimeError:
        return None
    cached = _verify_cache.get(doc_id)
    if cached and cached[0] > time.monotonic():
        rec = cached[1]
    else:
        rec = store().get(COLL_TOKENS, doc_id)
        if not rec:
            return None
        _verify_cache[doc_id] = (time.monotonic() + _VERIFY_CACHE_TTL, rec)
        if len(_verify_cache) > 1000:
            _verify_cache.clear()
    if rec.get("type") != "access" or rec.get("revoked"):
        return None
    exp = _parse(rec.get("expires_at"))
    if not exp or exp < _now():
        return None
    return {
        "client_id": rec.get("client_id", ""),
        "scopes": (rec.get("scope") or "").split(),
        "resource": rec.get("resource") or resource_url(),
        "expires_at": int(exp.timestamp()),
    }


# ---- アクセスログ ----

def log_access(tool: str, args_summary: str, result_count: int, client_id: str = "") -> None:
    """ツール呼び出しを記録（本文は記録しない）"""
    try:
        now = _now()
        store().add(COLL_ACCESS_LOGS, {
            "at": _iso(now),
            "tool": tool,
            "args": args_summary[:300],
            "result_count": int(result_count),
            "client_id": client_id,
            "expires_at": _iso(now + ACCESS_LOG_TTL),
        })
    except Exception as e:
        logger.warning("アクセスログの記録に失敗: %s", e)


def cleanup_expired(limit: int = 200) -> int:
    """期限切れのアクセスログ・認可コードを掃除（起動時に少しずつ）"""
    n = 0
    try:
        now_iso = _iso(_now())
        for coll in (COLL_ACCESS_LOGS, COLL_CODES):
            for doc_id, _ in store().where_lt(coll, "expires_at", now_iso, limit=limit):
                store().delete(coll, doc_id)
                n += 1
    except Exception as e:
        logger.warning("期限切れデータの掃除に失敗: %s", e)
    return n
