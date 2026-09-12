"""
タスクメタ情報（追加日時・完了日時）エンドポイント

タスク本体は DailyRecord.tasks に「[カテゴリ] 名前」の文字列で保存されていて日時を持たない。
「追加してから何日目で達成したか」を出すために、タスク名（カテゴリを除いた本文）をキーに
追加日時・完了日時をここで別管理する。予定タスクは完了するまで毎日引き継がれ名前が変わらないので、
名前をキーにすれば日をまたいでも同じタスクとして追跡できる。

GET  /api/v1/task-meta          — 全件取得
POST /api/v1/task-meta          — 複数件を upsert（指定したフィールドだけマージ）
POST /api/v1/task-meta/delete   — 名前で削除
"""

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from services import firestore_service

router = APIRouter()


class TaskMetaItem(BaseModel):
    name: str
    created_at: Optional[str] = None     # ISO 8601
    completed_at: Optional[str] = None   # ISO 8601 / 未完了に戻したときは明示的に null を送る
    approx: Optional[bool] = None        # 過去の記録から推定した値（時刻は信用しない）


class TaskMetaUpsertRequest(BaseModel):
    items: list[TaskMetaItem]


class TaskMetaDeleteRequest(BaseModel):
    names: list[str]


class TaskMetaResponse(BaseModel):
    items: list[dict]


@router.get("/task-meta", response_model=TaskMetaResponse)
async def get_task_meta():
    """タスクメタ情報を全件取得"""
    return {"items": firestore_service.get_task_meta()}


@router.post("/task-meta", response_model=TaskMetaResponse)
async def upsert_task_meta(body: TaskMetaUpsertRequest):
    """タスクメタ情報を upsert。リクエストに含めたフィールドだけを上書きする（null も上書き）"""
    payload = [item.model_dump(exclude_unset=True) for item in body.items]
    return {"items": firestore_service.upsert_task_meta(payload)}


@router.post("/task-meta/delete", response_model=TaskMetaResponse)
async def delete_task_meta(body: TaskMetaDeleteRequest):
    """タスクメタ情報を名前で削除"""
    firestore_service.delete_task_meta(body.names)
    return {"items": firestore_service.get_task_meta()}
