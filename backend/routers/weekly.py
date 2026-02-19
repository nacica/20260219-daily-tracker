"""
週次分析エンドポイント
POST /api/v1/weekly/{week_id}/generate  - 週次分析を生成
GET  /api/v1/weekly/{week_id}           - 保存済み週次分析を取得
GET  /api/v1/weekly                     - 週次分析一覧を取得
"""

import os
import json
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query
from services import firestore_service, claude_service
from utils.helpers import now_jst

router = APIRouter()


def _week_id_to_dates(week_id: str) -> tuple[str, str]:
    """
    'YYYY-Www' 形式の週 ID を (week_start, week_end) の日付ペアに変換する
    例: '2026-W08' → ('2026-02-16', '2026-02-22')
    """
    # ISO 8601 week: %G-W%V
    dt = datetime.strptime(f"{week_id}-1", "%G-W%V-%u")
    week_start = dt.strftime("%Y-%m-%d")
    week_end = (dt + timedelta(days=6)).strftime("%Y-%m-%d")
    return week_start, week_end


def _get_last_week_id(week_id: str) -> str:
    """指定週の前週の週 ID を返す"""
    week_start, _ = _week_id_to_dates(week_id)
    dt = datetime.strptime(week_start, "%Y-%m-%d")
    last_week_dt = dt - timedelta(days=7)
    return last_week_dt.strftime("%G-W%V")


@router.post("/weekly/{week_id}/generate")
async def generate_weekly_analysis(week_id: str):
    """
    指定週の全行動記録と日次分析を使って週次分析を生成し保存する。
    先週の週次分析も参照して進捗比較を行う。
    """
    week_start, week_end = _week_id_to_dates(week_id)

    # 今週のデータを取得
    daily_records = firestore_service.list_records(start_date=week_start, end_date=week_end)
    daily_analyses = firestore_service.list_analyses(start_date=week_start, end_date=week_end)

    if not daily_records:
        raise HTTPException(
            status_code=404,
            detail=f"{week_id}（{week_start}〜{week_end}）の行動記録がありません。",
        )

    # 先週の週次分析（比較用）
    last_week_id = _get_last_week_id(week_id)
    last_week_analysis = _get_weekly_from_db(last_week_id)

    # Claude API で週次分析を生成
    try:
        analysis_data = claude_service.generate_weekly_analysis(
            week_id=week_id,
            daily_records=daily_records,
            daily_analyses=daily_analyses,
            last_week_analysis=last_week_analysis,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Claude API エラー: {str(e)}")

    # Firestore に保存
    doc = {
        "id": week_id,
        "week_id": week_id,
        "week_start": week_start,
        "week_end": week_end,
        "weekly_summary": analysis_data.get("weekly_summary", {}),
        "deep_analysis": analysis_data.get("deep_analysis", {}),
        "created_at": now_jst(),
    }
    _save_weekly_to_db(week_id, doc)

    return doc


@router.get("/weekly/{week_id}")
async def get_weekly_analysis(week_id: str):
    """保存済みの週次分析を取得する"""
    doc = _get_weekly_from_db(week_id)
    if not doc:
        raise HTTPException(
            status_code=404,
            detail=f"{week_id} の週次分析が見つかりません。POST /weekly/{week_id}/generate で生成してください。",
        )
    return doc


@router.get("/weekly")
async def list_weekly_analyses(limit: int = Query(default=10, ge=1, le=52)):
    """週次分析の一覧を取得する（新しい順）"""
    from services.firestore_service import get_db
    db = get_db()
    docs = (
        db.collection("weekly_analyses")
        .order_by("week_start", direction="DESCENDING")
        .limit(limit)
        .stream()
    )
    return [doc.to_dict() for doc in docs]


# ---- Firestore ヘルパー（weekly_analyses コレクション） ----

def _get_weekly_from_db(week_id: str) -> dict | None:
    from services.firestore_service import get_db
    db = get_db()
    doc = db.collection("weekly_analyses").document(week_id).get()
    return doc.to_dict() if doc.exists else None


def _save_weekly_to_db(week_id: str, data: dict) -> dict:
    from services.firestore_service import get_db
    db = get_db()
    db.collection("weekly_analyses").document(week_id).set(data)
    return data
