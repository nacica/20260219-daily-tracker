"""
PIS の MCP サーバー（claude.ai カスタムコネクタ向け）

- 公式 Python MCP SDK（mcp 2.x）の MCPServer を Streamable HTTP で /mcp にマウントする
- 認証は OAuth 2.1 のリソースサーバーとして動く: Bearer トークンを services/mcp_auth_service で検証し、
  無効なら SDK が 401 + WWW-Authenticate（resource_metadata 付き）を返す
- Cloud Run（min-instances 0・複数インスタンス）で動かすため stateless_http + json_response にする
  （セッション状態を持たない。1 リクエスト = 1 レスポンス）
- ツールは段階的に追加する。フェーズ 1 は get_profile のダミーのみ

main.py 側の責務:
  app.mount("/", build_mcp_app())  を全ルーター登録の後に行い、
  lifespan で mcp.session_manager.run() を起動する。
"""

from __future__ import annotations

import logging
from urllib.parse import urlparse

from pydantic import AnyHttpUrl
from mcp.server import MCPServer
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

from services import mcp_auth_service as auth

logger = logging.getLogger(__name__)


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
        "PIS はユーザー自身の記録アプリ（行動ログ・タスク・AI 分析・日記・自由帳・トレードメモなど）です。"
        "ユーザー個人に関わる質問では、最初に get_profile でユーザーの取扱説明書を読んでから回答してください。"
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


@mcp.tool(
    title="自分の取扱説明書を読む",
    annotations=ToolAnnotations(read_only_hint=True, open_world_hint=False, idempotent_hint=True),
)
def get_profile() -> str:
    """ユーザーの「取扱説明書」（目標・強み・失敗パターン・判断基準・望む回答スタイル）を返す。
    ユーザー個人に関わる質問（仕事・投資・学習・生活習慣・目標・判断の相談など）では、
    最初にこのツールを呼んでから回答すること。"""
    # フェーズ 1 はダミー。フェーズ 3 で user_profile コレクションの本実装に差し替える
    text = (
        "# 取扱説明書（未作成）\n\n"
        "PIS との接続は成功しています。取扱説明書はまだ作成されていません。\n"
        "PIS の「取扱説明書」画面で AI 下書きを生成して保存すると、ここに内容が表示されます。"
    )
    auth.log_access("get_profile", "", 1, _client_id())
    return text


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
