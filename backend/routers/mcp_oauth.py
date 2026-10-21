"""
MCP 連携用 OAuth 2.1 認可サーバーのエンドポイント

GET  /.well-known/oauth-authorization-server        認可サーバーメタデータ（RFC 8414）
GET  /.well-known/oauth-protected-resource[/mcp]     保護リソースメタデータ（RFC 9728）
POST /oauth/register                                  動的クライアント登録（RFC 7591）
GET  /oauth/authorize                                 ログイン画面（パスワード 1 項目）
POST /oauth/authorize                                 パスワード検証 → 認可コード発行 → redirect_uri へ
POST /oauth/token                                     authorization_code / refresh_token グラント

ロジックとデータ層は services/mcp_auth_service.py。ここは HTTP の入出力だけを担当する。
"""

from __future__ import annotations

import base64
import html
import logging
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from services import mcp_auth_service as auth

logger = logging.getLogger(__name__)
router = APIRouter()

NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


# ---- メタデータ ----

@router.get("/.well-known/oauth-authorization-server")
async def authorization_server_metadata():
    base = auth.issuer_url()
    return JSONResponse({
        "issuer": base,
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "registration_endpoint": f"{base}/oauth/register",
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
        "scopes_supported": auth.SCOPES_SUPPORTED,
        "service_documentation": f"{base}/docs",
    })


def _protected_resource_metadata() -> dict:
    return {
        "resource": auth.resource_url(),
        "authorization_servers": [auth.issuer_url()],
        "scopes_supported": auth.SCOPES_SUPPORTED,
        "bearer_methods_supported": ["header"],
        "resource_name": "PIS（日次行動分析AI）",
    }


@router.get("/.well-known/oauth-protected-resource")
async def protected_resource_metadata_root():
    return JSONResponse(_protected_resource_metadata())


@router.get("/.well-known/oauth-protected-resource/mcp")
async def protected_resource_metadata_mcp():
    return JSONResponse(_protected_resource_metadata())


# ---- 動的クライアント登録 ----

@router.post("/oauth/register")
async def register_client(request: Request):
    if not auth.token_secret():
        return JSONResponse({"error": "server_error", "error_description": "MCP_TOKEN_SECRET が未設定です"},
                            status_code=503, headers=NO_STORE)
    try:
        meta = await request.json()
        if not isinstance(meta, dict):
            raise ValueError
    except Exception:
        return JSONResponse({"error": "invalid_client_metadata", "error_description": "JSON 本文が不正です"},
                            status_code=400, headers=NO_STORE)
    try:
        resp = auth.register_client(meta)
    except auth.RegistrationError as e:
        return JSONResponse({"error": e.error, "error_description": e.description}, status_code=400, headers=NO_STORE)
    logger.info("MCP OAuth クライアント登録: %s (%s)", resp["client_id"], resp.get("client_name"))
    return JSONResponse(resp, status_code=201, headers=NO_STORE)


# ---- 認可（ログイン画面） ----

def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _error_page(title: str, message: str, status: int = 400) -> HTMLResponse:
    body = f"""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{html.escape(title)}</title>
<style>{_CSS}</style></head><body><main class="card">
<h1>{html.escape(title)}</h1><p class="err">{html.escape(message)}</p>
<p class="muted">この画面を閉じて、Claude 側から接続をやり直してください。</p></main></body></html>"""
    return HTMLResponse(body, status_code=status, headers=NO_STORE)


_CSS = """
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Hiragino Sans","Noto Sans JP",sans-serif;
background:#0b1020;color:#e6edf3}
.card{width:min(92vw,420px);background:#111a2e;border:1px solid #223;border-radius:14px;padding:28px 24px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
h1{font-size:1.25rem;margin:0 0 6px}
.sub{color:#8fa3bf;font-size:.9rem;margin:0 0 18px}
.perm{background:#0e2a3a;border:1px solid #1e4a60;border-radius:10px;padding:12px 14px;font-size:.92rem;line-height:1.6;margin:0 0 18px}
label{display:block;font-size:.85rem;color:#8fa3bf;margin-bottom:6px}
input[type=password]{width:100%;box-sizing:border-box;font-size:1.05rem;padding:12px;border-radius:10px;border:1px solid #2b3a55;background:#0b1326;color:#e6edf3}
button{width:100%;margin-top:14px;padding:12px;font-size:1rem;font-weight:700;border:0;border-radius:10px;background:#00b4d8;color:#04121a;cursor:pointer}
button:hover{background:#19c6ea}
.err{color:#ff6b81;font-size:.9rem;margin:10px 0 0}
.muted{color:#8fa3bf;font-size:.8rem;margin-top:16px}
"""


def _login_page(fields: dict, client_name: str, error: Optional[str] = None, status: int = 200) -> HTMLResponse:
    hidden = "\n".join(
        f'<input type="hidden" name="{html.escape(k)}" value="{html.escape(v)}">'
        for k, v in fields.items() if v is not None
    )
    err_html = f'<p class="err">{html.escape(error)}</p>' if error else ""
    body = f"""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>PIS に接続</title>
<style>{_CSS}</style></head><body><main class="card">
<h1>PIS（日次行動分析AI）に接続</h1>
<p class="sub">接続元: {html.escape(client_name or "不明なクライアント")}</p>
<div class="perm">Claude が PIS の記録（行動ログ・日記・自由帳・トレードメモなど）を読み取り、自由帳にメモを書き込むことを許可します。</div>
<form method="post" action="/oauth/authorize" autocomplete="on">
{hidden}
<label for="password">オーナーのパスワード</label>
<input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
{err_html}
<button type="submit">許可して接続する</button>
</form>
<p class="muted">このページは PIS のサーバーが表示しています。パスワードは Claude には渡りません。</p>
</main></body></html>"""
    return HTMLResponse(body, status_code=status, headers=NO_STORE)


def _validate_auth_params(p: dict):
    """認可リクエストの検証。戻り値: (client, error_response)"""
    client = auth.get_client(p.get("client_id") or "")
    if not client:
        return None, _error_page("接続エラー", "client_id が登録されていません")
    redirect_uri = p.get("redirect_uri") or ""
    if redirect_uri not in client.get("redirect_uris", []) or not auth.is_redirect_uri_allowed(redirect_uri):
        return None, _error_page("接続エラー", "redirect_uri が登録内容と一致しません")

    def redirect_error(error: str, desc: str):
        q = {"error": error, "error_description": desc}
        if p.get("state"):
            q["state"] = p["state"]
        return RedirectResponse(f"{redirect_uri}?{urlencode(q)}", status_code=302, headers=NO_STORE)

    if p.get("response_type") != "code":
        return None, redirect_error("unsupported_response_type", "response_type は code のみ対応です")
    if not p.get("code_challenge"):
        return None, redirect_error("invalid_request", "PKCE の code_challenge が必要です")
    if (p.get("code_challenge_method") or "plain") != "S256":
        return None, redirect_error("invalid_request", "code_challenge_method は S256 のみ対応です")
    resource = p.get("resource")
    if resource and resource.rstrip("/") != auth.resource_url():
        return None, redirect_error("invalid_target", "resource がこのサーバーの MCP URL と一致しません")
    return client, None


_AUTH_FIELDS = ("response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method",
                "state", "scope", "resource")


@router.get("/oauth/authorize")
async def authorize_get(request: Request):
    if not auth.is_configured():
        return _error_page("未設定", "サーバーに MCP_OWNER_PASSWORD_HASH / MCP_TOKEN_SECRET が設定されていません", 503)
    p = {k: request.query_params.get(k) for k in _AUTH_FIELDS}
    client, err = _validate_auth_params(p)
    if err:
        return err
    locked = auth.login_locked_until(_client_ip(request))
    if locked:
        return _error_page("ロック中", "ログイン失敗が続いたため一時的にロックしています。しばらく待ってからやり直してください", 429)
    return _login_page(p, client.get("client_name", ""))


@router.post("/oauth/authorize")
async def authorize_post(request: Request):
    if not auth.is_configured():
        return _error_page("未設定", "サーバーに MCP_OWNER_PASSWORD_HASH / MCP_TOKEN_SECRET が設定されていません", 503)
    form = await request.form()
    p = {k: (form.get(k) or None) for k in _AUTH_FIELDS}
    client, err = _validate_auth_params(p)
    if err:
        return err
    ip = _client_ip(request)
    locked = auth.login_locked_until(ip)
    if locked:
        return _error_page("ロック中", "ログイン失敗が続いたため一時的にロックしています。しばらく待ってからやり直してください", 429)

    password = str(form.get("password") or "")
    if not auth.verify_password(password):
        locked_until = auth.record_login_failure(ip)
        logger.warning("MCP OAuth ログイン失敗 ip=%s", ip)
        if locked_until:
            return _error_page("ロック中", "ログインに 5 回失敗したため 15 分間ロックします", 429)
        return _login_page(p, client.get("client_name", ""), "パスワードが違います", status=401)

    auth.clear_login_failures(ip)
    code = auth.issue_auth_code(auth.AuthRequest(
        client_id=p["client_id"],
        redirect_uri=p["redirect_uri"],
        code_challenge=p["code_challenge"],
        scope=auth.normalize_scope(p.get("scope")),
        resource=(p.get("resource") or None),
        state=p.get("state"),
    ))
    q = {"code": code}
    if p.get("state"):
        q["state"] = p["state"]
    logger.info("MCP OAuth 認可コード発行 client=%s", p["client_id"])
    return RedirectResponse(f"{p['redirect_uri']}?{urlencode(q)}", status_code=302, headers=NO_STORE)


# ---- トークン ----

def _basic_auth(request: Request) -> tuple[Optional[str], Optional[str]]:
    h = request.headers.get("authorization", "")
    if not h.lower().startswith("basic "):
        return None, None
    try:
        raw = base64.b64decode(h[6:]).decode("utf-8")
        cid, _, secret = raw.partition(":")
        return cid or None, secret or None
    except Exception:
        return None, None


def _token_error(error: str, desc: str, status: int = 400) -> JSONResponse:
    return JSONResponse({"error": error, "error_description": desc}, status_code=status, headers=NO_STORE)


@router.post("/oauth/token")
async def token_endpoint(request: Request):
    if not auth.token_secret():
        return _token_error("server_error", "MCP_TOKEN_SECRET が未設定です", 503)
    form = await request.form()
    grant_type = form.get("grant_type")
    basic_id, basic_secret = _basic_auth(request)
    client_id = (form.get("client_id") or basic_id or "").strip()
    client_secret = form.get("client_secret") or basic_secret

    client = auth.get_client(client_id)
    if not client:
        return _token_error("invalid_client", "client_id が登録されていません", 401)
    if not auth.authenticate_client(client, client_secret):
        return _token_error("invalid_client", "クライアント認証に失敗しました", 401)

    try:
        if grant_type == "authorization_code":
            tokens = auth.exchange_auth_code(
                code=str(form.get("code") or ""),
                client_id=client_id,
                redirect_uri=form.get("redirect_uri"),
                code_verifier=form.get("code_verifier"),
                resource=form.get("resource"),
            )
        elif grant_type == "refresh_token":
            tokens = auth.refresh_tokens(
                refresh_token=str(form.get("refresh_token") or ""),
                client_id=client_id,
                scope=form.get("scope"),
                resource=form.get("resource"),
            )
        else:
            return _token_error("unsupported_grant_type", "grant_type は authorization_code / refresh_token のみ対応です")
    except auth.GrantError as e:
        logger.warning("MCP OAuth トークン発行拒否 (%s): %s", e.error, e.description)
        return _token_error(e.error, e.description)

    return JSONResponse(tokens, headers=NO_STORE)
