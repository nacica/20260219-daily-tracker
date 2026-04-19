"""
単語帳カード CRUD エンドポイント

POST   /api/v1/flashcards                    - カード作成
GET    /api/v1/flashcards                    - カード一覧（作成日降順）
GET    /api/v1/flashcards/{card_id}          - 単一カード取得
PUT    /api/v1/flashcards/{card_id}          - カード更新
DELETE /api/v1/flashcards/{card_id}          - カード削除
PUT    /api/v1/flashcards/{card_id}/mark     - 覚えた/まだ マーク
"""

import os
import uuid

from fastapi import APIRouter, HTTPException, Response, UploadFile, File

from models.flashcard_schemas import (
    FlashcardCreate, FlashcardUpdate, FlashcardMark, FlashcardEntry,
)
from services import firestore_service, storage_service
from utils.helpers import now_jst

router = APIRouter()

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/flashcards/upload-image")
async def upload_flashcard_image(file: UploadFile = File(...)):
    """単語帳カードに貼り付けた画像をアップロードする"""
    if not os.getenv("CLOUD_STORAGE_BUCKET"):
        raise HTTPException(status_code=503, detail="Cloud Storage が設定されていません")

    content_type = file.content_type or "image/png"
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"サポートされていない画像形式です: {content_type}",
        )

    image_bytes = await file.read()
    if len(image_bytes) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="ファイルサイズが大きすぎます（上限 10MB）")

    try:
        url = storage_service.upload_flashcard_image(image_bytes, content_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"画像のアップロードに失敗しました: {str(e)[:200]}")

    return {"url": url}


@router.post("/flashcards", response_model=FlashcardEntry, status_code=201)
async def create_flashcard(body: FlashcardCreate):
    """単語帳カードを作成する"""
    card_id = f"fc-{uuid.uuid4().hex[:12]}"
    ts = now_jst()

    data = {
        "id": card_id,
        "front": body.front,
        "back": body.back,
        "remembered": False,
        "created_at": ts,
        "updated_at": ts,
    }

    firestore_service.create_flashcard(card_id, data)
    return data


@router.get("/flashcards", response_model=list[FlashcardEntry])
async def list_flashcards():
    """全カードを作成日降順で取得"""
    return firestore_service.list_flashcards()


@router.get("/flashcards/{card_id}", response_model=FlashcardEntry)
async def get_flashcard(card_id: str):
    """指定IDのカードを取得"""
    card = firestore_service.get_flashcard(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="カードが見つかりません")
    return card


@router.put("/flashcards/{card_id}", response_model=FlashcardEntry)
async def update_flashcard(card_id: str, body: FlashcardUpdate):
    """カードの表面・裏面を更新"""
    update_data = {"updated_at": now_jst()}
    if body.front is not None:
        update_data["front"] = body.front
    if body.back is not None:
        update_data["back"] = body.back

    result = firestore_service.update_flashcard(card_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="カードが見つかりません")
    return result


@router.delete("/flashcards/{card_id}", status_code=204)
async def delete_flashcard(card_id: str):
    """カードを削除"""
    if not firestore_service.delete_flashcard(card_id):
        raise HTTPException(status_code=404, detail="カードが見つかりません")
    return Response(status_code=204)


@router.put("/flashcards/{card_id}/mark", response_model=FlashcardEntry)
async def mark_flashcard(card_id: str, body: FlashcardMark):
    """覚えた/まだ をマークする"""
    update_data = {
        "remembered": body.remembered,
        "updated_at": now_jst(),
    }
    result = firestore_service.update_flashcard(card_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="カードが見つかりません")
    return result
