"""
自分の取扱説明書（プロフィール）エンドポイント

GET  /api/v1/profile            取得（content / draft / generated_at / edited_at / source_range）
PUT  /api/v1/profile            確定版 content を保存
POST /api/v1/profile/generate   AI で下書き（draft）を生成。content は上書きしない

生成の入力は services/pis_context_service.build_profile_inputs() が集める（非公開は除外済み）。
MCP の get_profile は content を返す（services/pis_context_service.profile_text）。
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services import firestore_service, claude_service, pis_context_service as ctx
from utils.helpers import now_jst

logger = logging.getLogger(__name__)
router = APIRouter()


class ProfileSaveRequest(BaseModel):
    content: str = Field("", max_length=20000)


class ProfileResponse(BaseModel):
    content: str = ""
    draft: str = ""
    generated_at: Optional[str] = None
    edited_at: Optional[str] = None
    source_range: Optional[dict] = None


def _resp(doc: Optional[dict]) -> ProfileResponse:
    d = doc or {}
    return ProfileResponse(
        content=d.get("content") or "",
        draft=d.get("draft") or "",
        generated_at=d.get("generated_at"),
        edited_at=d.get("edited_at"),
        source_range=d.get("source_range"),
    )


@router.get("/profile", response_model=ProfileResponse)
async def get_profile():
    return _resp(firestore_service.get_user_profile())


@router.put("/profile", response_model=ProfileResponse)
async def save_profile(body: ProfileSaveRequest):
    doc = firestore_service.update_user_profile({"content": body.content, "edited_at": now_jst()})
    return _resp(doc)


@router.post("/profile/generate", response_model=ProfileResponse)
async def generate_profile():
    """直近の記録から取扱説明書の下書きを生成して draft に保存する"""
    current = firestore_service.get_user_profile() or {}
    inputs = ctx.build_profile_inputs(current.get("content") or "")
    try:
        draft = claude_service.generate_profile(inputs)
    except Exception as e:
        logger.exception("取扱説明書の生成に失敗")
        raise HTTPException(status_code=502, detail=f"取扱説明書の生成に失敗しました: {e}")
    doc = firestore_service.update_user_profile({
        "draft": draft,
        "generated_at": now_jst(),
        "source_range": inputs["source_range"],
    })
    return _resp(doc)
