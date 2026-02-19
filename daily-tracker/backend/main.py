"""
日次行動分析AIツール - FastAPI バックエンド
エントリポイント
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

from routers import records, analysis, screenshots, weekly

# 環境変数の読み込み
load_dotenv()

app = FastAPI(
    title="日次行動分析AI API",
    description="毎日の行動記録をAIが分析し改善提案を行うAPI",
    version="1.0.0",
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
app.include_router(screenshots.router, prefix="/api/v1", tags=["screenshots"])
app.include_router(weekly.router,      prefix="/api/v1", tags=["weekly"])


@app.get("/")
async def root():
    return {"message": "日次行動分析AI API", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "ok"}
