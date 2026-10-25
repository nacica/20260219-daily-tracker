"""
PIS の MCP サーバー（claude.ai カスタムコネクタ向け）

- 公式 Python MCP SDK（mcp 2.x）の MCPServer を Streamable HTTP で /mcp にマウントする
- 認証は OAuth 2.1 のリソースサーバーとして動く: Bearer トークンを services/mcp_auth_service で検証し、
  無効なら SDK が 401 + WWW-Authenticate（resource_metadata 付き）を返す
- Cloud Run（min-instances 0・複数インスタンス）で動かすため stateless_http + json_response にする
  （セッション状態を持たない。1 リクエスト = 1 レスポンス）
- 記録の取得・非公開除外・整形・文字数制限は services/pis_context_service に集約し、
  キーワード検索は services/pis_search_service に分離している（将来の意味検索はそこで差し替える）

ツール:
  get_profile          取扱説明書（user_profile の確定版 content）
  get_recent_context   直近 N 日の要約（分析・週次・未完了タスク・道しるべ・自由帳タイトル）
  search_pis           キーワード検索（AND、種類・期間・ボードで絞り込み）
  get_entry            1 件の全文
  get_day              1 日のまとめ

main.py 側の責務:
  app.mount("/", build_mcp_app())  を全ルーター登録の後に行い、
  lifespan で mcp.session_manager.run() を起動する。
"""

from __future__ import annotations

import logging
import re
from typing import Optional
from urllib.parse import urlparse

from pydantic import AnyHttpUrl
from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

from services import mcp_auth_service as auth
from services import pis_context_service as ctx
from services import pis_search_service as srch

logger = logging.getLogger(__name__)

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False, idempotent_hint=True)


class PisTokenVerifier(TokenVerifier):
    """services.mcp_auth_service が発行したアクセストークンを検証する"""

    async def verify_token(self, token: str) -> AccessToken | None:
        info = auth.verify_access_token(token)
        if not info:
            return None
        return AccessToken(
            token=token,
            client_id=info["client_id"],
            scopes=info["scopes"],
            expires_at=info["expires_at"],
            resource=info["resource"],
        )


mcp = MCPServer(
    name="PIS",
    title="PIS（日次行動分析AI）",
    instructions=(
        "PIS はユーザー自身の記録アプリ（行動ログ・タスク・AI 分析・日記・自由帳・トレードメモ・道しるべ・"
        "やりたいこと・ありがたいノート・Udemy Tips・単語帳）です。"
        "ユーザー個人に関わる質問では、最初に get_profile でユーザーの取扱説明書を読み、"
        "必要に応じて get_recent_context や search_pis で関連記録を探してから回答してください。"
        "記録を根拠にした部分は、どの日付の記録か（種類と日付）を示してください。"
        "単語帳（flashcards）にはユーザーが学んで自分の言葉で記録した知識が入っています。"
        "用語の意味・仕組み・学習内容・健康や集中力など、ユーザーが学んできた分野の質問では、"
        "一般知識だけで答える前に必ず search_pis(sources=[\"flashcards\"]) で該当カードを探し、"
        "見つかればその内容を踏まえ、どのカードを参照したかを示して回答してください。"
    ),
    token_verifier=PisTokenVerifier(),
    auth=AuthSettings(
        issuer_url=AnyHttpUrl(auth.issuer_url()),
        resource_server_url=AnyHttpUrl(auth.resource_url()),
        required_scopes=auth.REQUIRED_SCOPES,
        validate_token_resource=True,
    ),
)


def _client_id() -> str:
    tok = get_access_token()
    return tok.client_id if tok else ""


def _log(tool: str, args: str, count: int) -> None:
    auth.log_access(tool, args, count, _client_id())


def _valid_date(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    return s if _DATE_RE.match(s) else None


# ---- ツール ----

@mcp.tool(title="自分の取扱説明書を読む", annotations=_READ_ONLY)
def get_profile() -> str:
    """ユーザーの「取扱説明書」（目標・強み・失敗パターン・判断基準・望む回答スタイル）を返す。
    ユーザー個人に関わる質問（仕事・投資・学習・生活習慣・目標・判断の相談など）では、
    最初にこのツールを呼んでから回答すること。"""
    text = ctx.profile_text()
    _log("get_profile", "", 0 if "未作成" in text[:40] else 1)
    return text


@mcp.tool(title="直近の状況をまとめて読む", annotations=_READ_ONLY)
def get_recent_context(days: int = 7) -> str:
    """直近 days 日（既定 7、最大 30）の状況を要約して返す:
    日次分析のスコアと要点、直近の週次分析の要点、未完了タスク、道しるべ（今日意識すること）、
    直近の自由帳・トレードメモのタイトル一覧。「最近どう？」「今週の傾向は？」のような質問で使う。"""
    days = max(1, min(int(days or 7), 30))
    text = ctx.recent_context_text(days)
    _log("get_recent_context", f"days={days}", 1)
    return text


@mcp.tool(title="PIS の記録を検索する", annotations=_READ_ONLY)
def search_pis(
    query: str,
    sources: Optional[list[str]] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    board: Optional[str] = None,
    limit: int = 20,
) -> str:
    """キーワードで記録を検索する（スペース区切りで AND）。
    用語・仕組み・学習内容に関する質問では、まず sources=["flashcards"]（単語帳 = ユーザーが学んだ知識）で
    検索し、ヒットがあればその内容を踏まえて回答すること。
    sources: 省略時は全部。activity_log（行動ログ） tasks（タスク） analysis（日次分析） journal（日記）
    braindump（自由帳） trade（トレードメモ） michishirube（道しるべ） wishlist（やりたいこと）
    gratitude（ありがたいノート） udemy_tips flashcards（単語帳）。
    start_date / end_date: YYYY-MM-DD。省略時は直近 365 日。
    board: トレードメモのボード（stocks, cfd-silver, sumco, breakout, crude-oil, natural-gas）。
    limit: 既定 20、最大 50。結果は一致数の多い順 → 新しい順。各件に type / id / date が付くので、
    全文は get_entry(type, id) で取得する。"""
    q = (query or "").strip()
    if not q:
        return "query を指定してください。"
    if sources is not None:
        bad = [s for s in sources if s not in ctx.SOURCES]
        if bad:
            return f"sources に不明な値があります: {', '.join(bad)}。指定できる値: {', '.join(ctx.SOURCES)}"
    if board is not None and board not in ctx.BOARDS:
        return f"board に不明な値があります: {board}。指定できる値: {', '.join(ctx.BOARDS)}"
    sd, ed = _valid_date(start_date), _valid_date(end_date)
    if (start_date and not sd) or (end_date and not ed):
        return "start_date / end_date は YYYY-MM-DD 形式で指定してください。"
    if board and sources is None:
        sources = ["trade"]
    hits = srch.search(q, sources, sd, ed, board, limit)
    _log("search_pis", f"q={q[:60]} sources={sources} range={sd}..{ed} board={board}", len(hits))
    return srch.format_hits(hits, q)


@mcp.tool(title="記録を 1 件、全文で読む", annotations=_READ_ONLY)
def get_entry(type: str, id: str) -> str:
    """検索結果の 1 件を全文で返す。type は search_pis の結果に付いている type、id はその id。
    行動ログ・タスク・分析の id は日付（YYYY-MM-DD）。"""
    text = ctx.get_entry_text((type or "").strip(), (id or "").strip())
    _log("get_entry", f"type={type} id={id}", 0 if "該当する記録はありません" in text else 1)
    return text


@mcp.tool(title="ある日の記録をまとめて読む", annotations=_READ_ONLY)
def get_day(date: str) -> str:
    """date（YYYY-MM-DD）の行動ログ・タスク・日次分析・日記・自由帳・トレードメモをまとめて返す。"""
    d = _valid_date(date)
    if not d:
        return "date は YYYY-MM-DD 形式で指定してください。"
    text = ctx.get_day_text(d)
    _log("get_day", f"date={d}", 1)
    return text


@mcp.tool(
    title="自由帳にメモを追記する",
    annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False),
)
def add_braindump_note(
    body: str,
    title: Optional[str] = None,
    labels: Optional[list[str]] = None,
    board: Optional[str] = None,
) -> str:
    """PIS の自由帳に新しいメモを 1 件追加する（唯一の書き込みツール。更新・削除はできない）。
    ユーザーが「PIS に保存して」「メモしておいて」と明示したときだけ使う。それ以外で勝手に書き込まない。
    body: 本文（必須）。title: 省略時は AI が自動生成。labels: 任意（`from-claude` は自動で付く）。
    board: トレードメモに入れたいときのボード（stocks, cfd-silver, sumco, breakout, crude-oil, natural-gas）。
    保存先は今日（日本時間）の日付。"""
    tok = get_access_token()
    if tok and "pis:write" not in (tok.scopes or []):
        return "このトークンには書き込み権限（pis:write）がありません。コネクタを再接続してください。"
    try:
        saved = ctx.create_claude_note(body, title, labels, board)
    except ValueError as e:
        return str(e)
    except Exception as e:
        logger.exception("自由帳への追記に失敗")
        return f"保存に失敗しました: {e}"
    _log("add_braindump_note", f"title={saved.get('title', '')[:40]} labels={saved.get('labels')} board={board}", 1)
    where = f"トレードメモ（{ctx.BOARDS.get(board)}）" if board else "自由帳"
    return (f"{where}に保存しました。\n"
            f"- 日付: {saved['date']}\n- タイトル: {saved.get('title')}\n- ラベル: {', '.join(saved.get('labels', []))}\n"
            f"- id: {saved['id']}（type: {'trade' if board else 'braindump'}）")


# ---- アプリ構築 ----

def _allowed_hosts() -> list[str]:
    """DNS リバインディング保護で受け付ける Host ヘッダー（公開 URL のホストとローカル開発用）"""
    hosts = ["localhost", "localhost:*", "127.0.0.1", "127.0.0.1:*"]
    host = urlparse(auth.public_url()).netloc
    if host and host not in hosts:
        hosts.append(host)
    return hosts


def build_mcp_app():
    """FastAPI にマウントする Starlette アプリ（/mcp と /.well-known/oauth-protected-resource/mcp を含む）"""
    return mcp.streamable_http_app(
        streamable_http_path="/mcp",
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=_allowed_hosts(),
            # Claude はサーバー間通信で Origin を送らない。送られた場合は公開 URL のみ許可
            allowed_origins=[auth.public_url()],
        ),
    )
