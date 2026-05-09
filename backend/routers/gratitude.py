"""
ありがたいノート CRUD エンドポイント

POST   /api/v1/gratitude              - エントリ作成
GET    /api/v1/gratitude              - エントリ一覧（新しい順）
GET    /api/v1/gratitude/recent       - 最新 N 件（ホーム表示用）
GET    /api/v1/gratitude/{entry_id}   - 単一取得
PUT    /api/v1/gratitude/{entry_id}   - 更新
DELETE /api/v1/gratitude/{entry_id}   - 削除
"""

import uuid

from fastapi import APIRouter, HTTPException, Response, Query

from models.gratitude_schemas import GratitudeCreate, GratitudeUpdate, GratitudeEntry
from services import firestore_service
from utils.helpers import now_jst

router = APIRouter()


@router.post("/gratitude", response_model=GratitudeEntry, status_code=201)
async def create_gratitude(body: GratitudeCreate):
    entry_id = f"gr-{uuid.uuid4().hex[:12]}"
    ts = now_jst()
    data = {
        "id": entry_id,
        "content": body.content,
        "created_at": ts,
        "updated_at": ts,
    }
    firestore_service.create_gratitude(entry_id, data)
    return data


@router.get("/gratitude", response_model=list[GratitudeEntry])
async def list_gratitude():
    return firestore_service.list_gratitude()


@router.get("/gratitude/recent", response_model=list[GratitudeEntry])
async def list_recent_gratitude(limit: int = Query(3, ge=1, le=20)):
    return firestore_service.list_gratitude(limit=limit)


@router.get("/gratitude/{entry_id}", response_model=GratitudeEntry)
async def get_gratitude(entry_id: str):
    item = firestore_service.get_gratitude(entry_id)
    if not item:
        raise HTTPException(status_code=404, detail="ありがたいノートが見つかりません")
    return item


@router.put("/gratitude/{entry_id}", response_model=GratitudeEntry)
async def update_gratitude(entry_id: str, body: GratitudeUpdate):
    update_data = {"content": body.content, "updated_at": now_jst()}
    result = firestore_service.update_gratitude(entry_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="ありがたいノートが見つかりません")
    return result


@router.delete("/gratitude/{entry_id}", status_code=204)
async def delete_gratitude(entry_id: str):
    if not firestore_service.delete_gratitude(entry_id):
        raise HTTPException(status_code=404, detail="ありがたいノートが見つかりません")
    return Response(status_code=204)
