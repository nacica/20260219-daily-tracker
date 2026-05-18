"""
Udemy コース制作 Tips CRUD エンドポイント

POST   /api/v1/udemy-tips                          - Tips 作成
GET    /api/v1/udemy-tips                          - Tips 一覧
GET    /api/v1/udemy-tips/by-date/{date}           - 指定日の全 Tips 取得
GET    /api/v1/udemy-tips/entry/{entry_id}         - 単一 Tips 取得
PUT    /api/v1/udemy-tips/entry/{entry_id}         - Tips 更新
DELETE /api/v1/udemy-tips/entry/{entry_id}         - Tips 削除
POST   /api/v1/udemy-tips/by-date/{date}/reorder   - 並び替え
GET    /api/v1/udemy-tips/labels                   - タグ一覧
POST   /api/v1/udemy-tips/labels/rename            - タグリネーム
DELETE /api/v1/udemy-tips/labels/{name}            - タグ削除
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from models.udemy_tips_schemas import (
    UdemyTipCreate, UdemyTipUpdate, UdemyTipEntry,
    UdemyTipReorderRequest, UdemyTipLabelRenameRequest,
    UdemyTipLabelCount, UdemyTipLabelListResponse,
)
from services import firestore_service
from utils.helpers import now_jst


def _normalize_labels(labels: Optional[list[str]]) -> list[str]:
    if not labels:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for lbl in labels:
        if not isinstance(lbl, str):
            continue
        name = lbl.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out


router = APIRouter()


# ---- CRUD ----

@router.post("/udemy-tips", response_model=UdemyTipEntry, status_code=201)
async def create_tip(body: UdemyTipCreate):
    date = body.date
    entry_number = firestore_service.get_next_udemy_tip_entry_number(date)
    entry_id = f"udemy-tip#{date}#{entry_number}"

    temp_title = body.content[:30].replace("\n", " ")
    if len(body.content) > 30:
        temp_title += "..."

    existing_today = firestore_service.list_udemy_tips_for_date(date)
    existing_max_order = 0.0
    for e in existing_today:
        order = e.get("sort_order")
        if order is None:
            order = float(e.get("entry_number", 1))
        existing_max_order = max(existing_max_order, float(order))
    sort_order = existing_max_order + 1.0

    now = now_jst()
    data = {
        "id": entry_id,
        "date": date,
        "entry_number": entry_number,
        "content": body.content,
        "title": temp_title,
        "labels": _normalize_labels(body.labels),
        "sort_order": sort_order,
        "created_at": now,
        "updated_at": now,
    }

    saved = firestore_service.create_udemy_tip(entry_id, data)
    return UdemyTipEntry(**saved)


@router.get("/udemy-tips", response_model=list[UdemyTipEntry])
async def list_tips(
    start_date: Optional[str] = Query(None, description="開始日 (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="終了日 (YYYY-MM-DD)"),
):
    entries = firestore_service.list_udemy_tips(start_date=start_date, end_date=end_date)
    return [UdemyTipEntry(**e) for e in entries]


@router.get("/udemy-tips/by-date/{date}", response_model=list[UdemyTipEntry])
async def get_tips_by_date(date: str):
    entries = firestore_service.list_udemy_tips_for_date(date)
    return [UdemyTipEntry(**e) for e in entries]


@router.post("/udemy-tips/by-date/{date}/reorder")
async def reorder_tips(date: str, body: UdemyTipReorderRequest):
    affected = firestore_service.reorder_udemy_tips_for_date(date, body.ordered_ids)
    return {"affected": affected}


@router.get("/udemy-tips/entry/{entry_id}", response_model=UdemyTipEntry)
async def get_tip_entry(entry_id: str):
    entry = firestore_service.get_udemy_tip(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"{entry_id} の Tips が見つかりません")
    return UdemyTipEntry(**entry)


@router.put("/udemy-tips/entry/{entry_id}", response_model=UdemyTipEntry)
async def update_tip_entry(entry_id: str, body: UdemyTipUpdate):
    existing = firestore_service.get_udemy_tip(entry_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"{entry_id} の Tips が見つかりません")

    update_data: dict = {"updated_at": now_jst()}

    if body.content is not None:
        update_data["content"] = body.content
        if body.content != existing.get("content", ""):
            temp_title = body.content[:30].replace("\n", " ")
            if len(body.content) > 30:
                temp_title += "..."
            update_data["title"] = temp_title

    if body.labels is not None:
        update_data["labels"] = _normalize_labels(body.labels)

    updated = firestore_service.update_udemy_tip(entry_id, update_data)
    return UdemyTipEntry(**updated)


@router.delete("/udemy-tips/entry/{entry_id}", status_code=204)
async def delete_tip_entry(entry_id: str):
    deleted = firestore_service.delete_udemy_tip(entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"{entry_id} の Tips が見つかりません")


# ---- タグ管理 ----

@router.get("/udemy-tips/labels", response_model=UdemyTipLabelListResponse)
async def list_tip_labels():
    items = firestore_service.aggregate_udemy_tip_labels()
    return UdemyTipLabelListResponse(labels=[UdemyTipLabelCount(**i) for i in items])


@router.post("/udemy-tips/labels/rename")
async def rename_tip_label(body: UdemyTipLabelRenameRequest):
    old = body.old_name.strip()
    new = body.new_name.strip()
    if not old or not new:
        raise HTTPException(status_code=400, detail="タグ名が空です")
    if old == new:
        return {"affected": 0}
    affected = firestore_service.rename_udemy_tip_label(old, new)
    return {"affected": affected}


@router.delete("/udemy-tips/labels/{name}")
async def delete_tip_label(name: str):
    target = (name or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="タグ名が空です")
    affected = firestore_service.delete_udemy_tip_label(target)
    return {"affected": affected}
