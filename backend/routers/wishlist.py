"""
やりたいことリスト CRUD エンドポイント

POST   /api/v1/wishlist                   - 項目作成
GET    /api/v1/wishlist                   - 項目一覧(?completed=true/false でフィルタ)
GET    /api/v1/wishlist/{item_id}         - 単一取得
PUT    /api/v1/wishlist/{item_id}         - 更新
DELETE /api/v1/wishlist/{item_id}         - 削除
PUT    /api/v1/wishlist/{item_id}/complete - 達成/未達成 マーク
"""

import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Response, Query

from models.wishlist_schemas import (
    WishlistCreate, WishlistUpdate, WishlistComplete, WishlistEntry,
)
from services import firestore_service
from utils.helpers import now_jst

router = APIRouter()


@router.post("/wishlist", response_model=WishlistEntry, status_code=201)
async def create_wishlist(body: WishlistCreate):
    """やりたいことを作成する"""
    item_id = f"wl-{uuid.uuid4().hex[:12]}"
    ts = now_jst()

    data = {
        "id": item_id,
        "title": body.title,
        "estimated_cost": body.estimated_cost,
        "category": body.category,
        "priority": body.priority,
        "target_period": body.target_period,
        "notes": body.notes,
        "image_url": body.image_url,
        "reference_url": body.reference_url,
        "completed": False,
        "completed_at": None,
        "created_at": ts,
        "updated_at": ts,
    }

    firestore_service.create_wishlist_item(item_id, data)
    return data


@router.get("/wishlist", response_model=list[WishlistEntry])
async def list_wishlist(
    completed: Optional[bool] = Query(None, description="true=達成済み, false=未達成のみ, 省略=全件"),
):
    """やりたいこと一覧を優先度高い順で取得"""
    return firestore_service.list_wishlist(completed=completed)


@router.get("/wishlist/{item_id}", response_model=WishlistEntry)
async def get_wishlist(item_id: str):
    """指定IDの項目を取得"""
    item = firestore_service.get_wishlist_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="やりたいことが見つかりません")
    return item


@router.put("/wishlist/{item_id}", response_model=WishlistEntry)
async def update_wishlist(item_id: str, body: WishlistUpdate):
    """項目を更新"""
    update_data = {"updated_at": now_jst()}
    for field in ("title", "estimated_cost", "category", "priority",
                  "target_period", "notes", "image_url", "reference_url"):
        value = getattr(body, field)
        if value is not None:
            update_data[field] = value

    result = firestore_service.update_wishlist_item(item_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="やりたいことが見つかりません")
    return result


@router.delete("/wishlist/{item_id}", status_code=204)
async def delete_wishlist(item_id: str):
    """項目を削除"""
    if not firestore_service.delete_wishlist_item(item_id):
        raise HTTPException(status_code=404, detail="やりたいことが見つかりません")
    return Response(status_code=204)


@router.put("/wishlist/{item_id}/complete", response_model=WishlistEntry)
async def mark_wishlist(item_id: str, body: WishlistComplete):
    """達成/未達成 をマークする(達成日も自動セット/解除)"""
    ts = now_jst()
    update_data = {
        "completed": body.completed,
        "completed_at": ts if body.completed else None,
        "updated_at": ts,
    }
    result = firestore_service.update_wishlist_item(item_id, update_data)
    if not result:
        raise HTTPException(status_code=404, detail="やりたいことが見つかりません")
    return result
