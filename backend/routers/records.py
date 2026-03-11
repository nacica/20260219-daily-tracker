"""
行動記録 CRUD エンドポイント
POST   /api/v1/records
GET    /api/v1/records
GET    /api/v1/records/{date}
PUT    /api/v1/records/{date}
DELETE /api/v1/records/{date}
"""

from fastapi import APIRouter, HTTPException, Query, Response
from typing import Optional

from models.schemas import RecordCreate, RecordUpdate, DailyRecord, Tasks, RestDayRequest
from services import firestore_service, claude_service
from utils.helpers import now_jst

router = APIRouter()


@router.post("/records", response_model=DailyRecord, status_code=201)
async def create_record(body: RecordCreate):
    """
    行動記録を作成する。
    Claude API で生テキストを構造化（行動リスト化）してから保存する。
    """
    date = body.date

    # 既存レコードの確認
    existing = firestore_service.get_record(date)
    if existing:
        raise HTTPException(status_code=409, detail=f"{date} の記録はすでに存在します。PUT で更新してください。")

    # Claude API で行動を構造化
    try:
        parsed_activities = claude_service.parse_activities(body.raw_input, date)
    except Exception as e:
        # 構造化に失敗しても空リストで続行
        parsed_activities = []

    now = now_jst()
    tasks = Tasks(
        planned=body.tasks_planned,
        completed=body.tasks_completed,
        backlog=body.tasks_backlog,
        completion_rate=len(body.tasks_completed) / len(body.tasks_planned) if body.tasks_planned else 0.0,
    )

    record_data = {
        "id": date,
        "date": date,
        "raw_input": body.raw_input,
        "parsed_activities": [a if isinstance(a, dict) else a.dict() for a in parsed_activities],
        "screen_time": None,
        "tasks": tasks.dict(),
        "created_at": now,
        "updated_at": now,
    }

    saved = firestore_service.create_record(date, record_data)
    return DailyRecord(**saved)


@router.get("/records", response_model=list[DailyRecord])
async def list_records(
    start_date: Optional[str] = Query(None, description="開始日 (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="終了日 (YYYY-MM-DD)"),
):
    """行動記録一覧を取得する"""
    records = firestore_service.list_records(start_date=start_date, end_date=end_date)
    return [DailyRecord(**r) for r in records]


@router.get("/records/{date}", response_model=DailyRecord)
async def get_record(date: str):
    """指定日の行動記録を取得する"""
    record = firestore_service.get_record(date)
    if not record:
        return Response(status_code=204)
    # parsed_activities のデシリアライズ失敗に備え、不正なエントリを除外
    if "parsed_activities" in record and isinstance(record["parsed_activities"], list):
        safe_activities = []
        for a in record["parsed_activities"]:
            if isinstance(a, dict) and "activity" in a and "start_time" in a:
                safe_activities.append(a)
        record["parsed_activities"] = safe_activities
    return DailyRecord(**record)


@router.put("/records/{date}", response_model=DailyRecord)
async def update_record(date: str, body: RecordUpdate):
    """行動記録を更新する"""
    existing = firestore_service.get_record(date)
    if not existing:
        raise HTTPException(status_code=404, detail=f"{date} の記録が見つかりません")

    update_data: dict = {"updated_at": now_jst()}

    if body.raw_input is not None:
        update_data["raw_input"] = body.raw_input
        # raw_input が実際に変更された場合のみ再構造化（Claude API 呼び出しは重いため）
        if body.raw_input != existing.get("raw_input", ""):
            try:
                parsed = claude_service.parse_activities(body.raw_input, date)
                update_data["parsed_activities"] = parsed
            except Exception:
                pass

    if body.rest_day is not None:
        update_data["rest_day"] = body.rest_day
    if body.rest_reason is not None:
        update_data["rest_reason"] = body.rest_reason
    if body.available_hours is not None:
        update_data["available_hours"] = body.available_hours

    if body.tasks_planned is not None or body.tasks_completed is not None or body.tasks_backlog is not None:
        planned = body.tasks_planned if body.tasks_planned is not None else existing.get("tasks", {}).get("planned", [])
        completed = body.tasks_completed if body.tasks_completed is not None else existing.get("tasks", {}).get("completed", [])
        backlog = body.tasks_backlog if body.tasks_backlog is not None else existing.get("tasks", {}).get("backlog", [])
        completion_rate = len(completed) / len(planned) if planned else 0.0
        update_data["tasks"] = {
            "planned": planned,
            "completed": completed,
            "backlog": backlog,
            "completion_rate": completion_rate,
        }

    updated = firestore_service.update_record(date, update_data)
    return DailyRecord(**updated)


@router.put("/records/{date}/rest-day", response_model=DailyRecord)
async def toggle_rest_day(date: str, body: RestDayRequest):
    """おやすみモードを切り替える。レコードが存在しない場合は空レコードを作成する。"""
    now = now_jst()
    existing = firestore_service.get_record(date)

    if existing:
        update_data = {
            "rest_day": body.rest_day,
            "rest_reason": body.rest_reason,
            "updated_at": now,
        }
        updated = firestore_service.update_record(date, update_data)
        return DailyRecord(**updated)
    else:
        # レコードが無い場合は最小限のレコードを作成
        record_data = {
            "id": date,
            "date": date,
            "raw_input": "",
            "parsed_activities": [],
            "screen_time": None,
            "tasks": Tasks().dict(),
            "rest_day": body.rest_day,
            "rest_reason": body.rest_reason,
            "created_at": now,
            "updated_at": now,
        }
        saved = firestore_service.create_record(date, record_data)
        return DailyRecord(**saved)


@router.delete("/records/{date}", status_code=204)
async def delete_record(date: str):
    """行動記録を削除する"""
    deleted = firestore_service.delete_record(date)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"{date} の記録が見つかりません")
