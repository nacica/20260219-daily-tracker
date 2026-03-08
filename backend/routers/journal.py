"""
ジャーナル（フリー日記）CRUD + AI 分析エンドポイント
POST   /api/v1/journal                           - ジャーナル作成
GET    /api/v1/journal                           - ジャーナル一覧
GET    /api/v1/journal/{date}                    - 指定日のジャーナル取得
PUT    /api/v1/journal/{date}                    - ジャーナル更新
DELETE /api/v1/journal/{date}                    - ジャーナル削除
POST   /api/v1/journal/{date}/analyze            - AI分析を実行
GET    /api/v1/journal/digest/{week_id}          - 週次ダイジェスト取得
POST   /api/v1/journal/digest/{week_id}/generate - 週次ダイジェスト生成
"""

from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query, Response
from typing import Optional

from models.journal_schemas import (
    JournalCreate, JournalUpdate, JournalEntry,
    WeeklyJournalDigest,
)
from services import firestore_service, claude_service
from utils.helpers import now_jst

router = APIRouter()


# ---- CRUD ----

@router.post("/journal", response_model=JournalEntry, status_code=201)
async def create_journal(body: JournalCreate):
    """ジャーナルを作成する"""
    date = body.date

    existing = firestore_service.get_journal(date)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"{date} のジャーナルはすでに存在します。PUT で更新してください。",
        )

    now = now_jst()
    data = {
        "id": date,
        "date": date,
        "content": body.content,
        "ai_analysis": None,
        "is_analyzed": False,
        "created_at": now,
        "updated_at": now,
    }

    saved = firestore_service.create_journal(date, data)
    return JournalEntry(**saved)


@router.get("/journal", response_model=list[JournalEntry])
async def list_journals(
    start_date: Optional[str] = Query(None, description="開始日 (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="終了日 (YYYY-MM-DD)"),
):
    """ジャーナル一覧を取得する"""
    journals = firestore_service.list_journals(start_date=start_date, end_date=end_date)
    return [JournalEntry(**j) for j in journals]


@router.get("/journal/digest/{week_id}", response_model=WeeklyJournalDigest)
async def get_journal_digest(week_id: str):
    """週次ジャーナルダイジェストを取得する"""
    digest = firestore_service.get_journal_digest(week_id)
    if not digest:
        raise HTTPException(
            status_code=404,
            detail=f"{week_id} のダイジェストが見つかりません",
        )
    return WeeklyJournalDigest(**digest)


@router.post("/journal/digest/{week_id}/generate", response_model=WeeklyJournalDigest)
async def generate_journal_digest(week_id: str):
    """週次ジャーナルダイジェストを生成する"""
    # week_id (YYYY-Www) から日付範囲を計算
    try:
        year = int(week_id[:4])
        week_num = int(week_id[6:])
        # ISO 週の月曜日を取得
        monday = datetime.strptime(f"{year}-W{week_num:02d}-1", "%Y-W%W-%w")
        if week_num == 1 and monday.month == 12:
            monday = datetime(year, 1, 1)
        week_start = monday.strftime("%Y-%m-%d")
        week_end = (monday + timedelta(days=6)).strftime("%Y-%m-%d")
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="week_id は YYYY-Www 形式で指定してください")

    # ジャーナルエントリを取得
    journal_entries = firestore_service.list_journals(
        start_date=week_start, end_date=week_end,
    )
    if not journal_entries:
        raise HTTPException(
            status_code=404,
            detail=f"{week_id} にジャーナルエントリがありません",
        )

    # 日次分析を取得（参考データ）
    daily_analyses = firestore_service.list_analyses(
        start_date=week_start, end_date=week_end,
    )

    # AI ダイジェスト生成
    digest_data = claude_service.generate_weekly_journal_digest(
        week_id=week_id,
        journal_entries=journal_entries,
        daily_analyses=daily_analyses,
    )

    now = now_jst()
    result = {
        "id": week_id,
        "week_id": week_id,
        "week_start": week_start,
        "week_end": week_end,
        "emotion_trends": digest_data.get("emotion_trends", []),
        "top_blockers": digest_data.get("top_blockers", []),
        "weekly_insights": digest_data.get("weekly_insights", []),
        "hidden_patterns": digest_data.get("hidden_patterns", []),
        "mood_trajectory": digest_data.get("mood_trajectory", {}),
        "action_recommendations": digest_data.get("action_recommendations", []),
        "created_at": now,
    }

    saved = firestore_service.save_journal_digest(week_id, result)
    return WeeklyJournalDigest(**saved)


@router.get("/journal/{date}", response_model=JournalEntry)
async def get_journal(date: str):
    """指定日のジャーナルを取得する"""
    journal = firestore_service.get_journal(date)
    if not journal:
        return Response(status_code=204)
    return JournalEntry(**journal)


@router.put("/journal/{date}", response_model=JournalEntry)
async def update_journal(date: str, body: JournalUpdate):
    """ジャーナルを更新する"""
    existing = firestore_service.get_journal(date)
    if not existing:
        raise HTTPException(status_code=404, detail=f"{date} のジャーナルが見つかりません")

    update_data: dict = {"updated_at": now_jst()}

    if body.content is not None:
        update_data["content"] = body.content
        # 内容が変更された場合は分析をリセット
        if body.content != existing.get("content", ""):
            update_data["is_analyzed"] = False
            update_data["ai_analysis"] = None

    updated = firestore_service.update_journal(date, update_data)
    return JournalEntry(**updated)


@router.delete("/journal/{date}", status_code=204)
async def delete_journal(date: str):
    """ジャーナルを削除する"""
    deleted = firestore_service.delete_journal(date)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"{date} のジャーナルが見つかりません")


@router.post("/journal/{date}/analyze", response_model=JournalEntry)
async def analyze_journal(date: str):
    """ジャーナルのAI分析を実行する"""
    journal = firestore_service.get_journal(date)
    if not journal:
        raise HTTPException(status_code=404, detail=f"{date} のジャーナルが見つかりません")

    # 同日の行動記録・分析を参考データとして取得
    daily_record = firestore_service.get_record(date)
    daily_analysis = firestore_service.get_analysis(date)

    # AI 分析実行
    analysis_result = claude_service.analyze_journal_entry(
        content=journal["content"],
        date=date,
        daily_record=daily_record,
        daily_analysis=daily_analysis,
    )

    # 結果を保存
    update_data = {
        "ai_analysis": analysis_result,
        "is_analyzed": True,
        "updated_at": now_jst(),
    }

    updated = firestore_service.update_journal(date, update_data)
    return JournalEntry(**updated)
