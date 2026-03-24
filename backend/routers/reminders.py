"""
リマインダー（今日意識すること）エンドポイント
GET  /api/v1/reminders       — 全件取得
PUT  /api/v1/reminders       — 全件上書き保存
"""

from fastapi import APIRouter
from pydantic import BaseModel

from services import firestore_service

router = APIRouter()


class ReminderItem(BaseModel):
    id: str
    text: str
    createdAt: int  # Unix ms


class RemindersSaveRequest(BaseModel):
    items: list[ReminderItem]


class RemindersResponse(BaseModel):
    items: list[dict]


@router.get("/reminders", response_model=RemindersResponse)
async def get_reminders():
    """リマインダー一覧を取得"""
    items = firestore_service.get_reminders()
    return {"items": items}


@router.put("/reminders", response_model=RemindersResponse)
async def save_reminders(body: RemindersSaveRequest):
    """リマインダー一覧を保存（全件上書き）"""
    items = [item.model_dump() for item in body.items]
    saved = firestore_service.save_reminders(items)
    return {"items": saved}
