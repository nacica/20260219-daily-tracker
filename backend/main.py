"""
日次行動分析AIツール - FastAPI バックエンド
エントリポイント
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

# 環境変数の読み込み（mcp_server は import 時に MCP_PUBLIC_URL を読むので、routers より前に行う）
load_dotenv()

from routers import records, analysis, weekly, dialogue, summaries, journal, diary_dialogue, braindump, reminders, categories, flashcards, wishlist, gratitude, udemy_tips, task_meta, nav_order
from routers import mcp_oauth, profile
from mcp_server import mcp, build_mcp_app


@asynccontextmanager
async def lifespan(app: FastAPI):
    """起動時の移行・掃除と、MCP セッションマネージャーの起動"""
    import logging
    logger = logging.getLogger(__name__)
    try:
        from services import firestore_service
        n = firestore_service.reset_braindump_updated_at_to_created()
        if n:
            logger.info("braindump updated_at リセット移行を実行: %d 件", n)
    except Exception as e:
        logger.warning("起動時移行に失敗（処理は継続）: %s", e)
    try:
        from services import mcp_auth_service
        n = mcp_auth_service.cleanup_expired()
        if n:
            logger.info("MCP の期限切れデータを掃除: %d 件", n)
    except Exception as e:
        logger.warning("MCP 期限切れデータの掃除に失敗（処理は継続）: %s", e)
    # Streamable HTTP のセッションマネージャー（マウント時は sub-app の lifespan が走らないのでここで起動する）
    async with mcp.session_manager.run():
        yield


app = FastAPI(
    title="日次行動分析AI API",
    description="毎日の行動記録をAIが分析し改善提案を行うAPI",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS設定（フロントエンドからのアクセスを許可）
allowed_origins_str = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
allowed_origins = [o.strip() for o in allowed_origins_str.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーターの登録
app.include_router(records.router,     prefix="/api/v1", tags=["records"])
app.include_router(analysis.router,    prefix="/api/v1", tags=["analysis"])
app.include_router(weekly.router,      prefix="/api/v1", tags=["weekly"])
app.include_router(dialogue.router,    prefix="/api/v1", tags=["dialogue"])
app.include_router(summaries.router,   prefix="/api/v1", tags=["summaries"])
app.include_router(journal.router,          prefix="/api/v1", tags=["journal"])
app.include_router(diary_dialogue.router,  prefix="/api/v1", tags=["diary-dialogue"])
app.include_router(braindump.router,       prefix="/api/v1", tags=["braindump"])
app.include_router(reminders.router,      prefix="/api/v1", tags=["reminders"])
app.include_router(categories.router,    prefix="/api/v1", tags=["categories"])
app.include_router(flashcards.router,    prefix="/api/v1", tags=["flashcards"])
app.include_router(wishlist.router,      prefix="/api/v1", tags=["wishlist"])
app.include_router(gratitude.router,     prefix="/api/v1", tags=["gratitude"])
app.include_router(udemy_tips.router,    prefix="/api/v1", tags=["udemy-tips"])
app.include_router(task_meta.router,     prefix="/api/v1", tags=["task-meta"])
app.include_router(nav_order.router,     prefix="/api/v1", tags=["nav-order"])

app.include_router(profile.router,       prefix="/api/v1", tags=["profile"])

# MCP 連携用 OAuth（/.well-known/*, /oauth/*）
app.include_router(mcp_oauth.router, tags=["mcp-oauth"])


@app.get("/")
async def root():
    return {"message": "日次行動分析AI API", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}


# MCP サーバー（/mcp）。Mount("/") は残りの全パスを受けるため、必ず最後に登録する
app.mount("/", build_mcp_app())
