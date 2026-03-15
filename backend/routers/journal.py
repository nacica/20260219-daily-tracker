"""
ジャーナル（フリー日記）CRUD + AI 分析エンドポイント
1日に複数エントリを作成可能（entry_id = YYYY-MM-DD#N）

POST   /api/v1/journal                               - ジャーナル作成（自動採番）
GET    /api/v1/journal                               - ジャーナル一覧
GET    /api/v1/journal/by-date/{date}                - 指定日の全エントリ取得
GET    /api/v1/journal/entry/{entry_id}              - 単一エントリ取得
PUT    /api/v1/journal/entry/{entry_id}              - エントリ更新
DELETE /api/v1/journal/entry/{entry_id}              - エントリ削除
POST   /api/v1/journal/entry/{entry_id}/analyze      - AI分析を実行
POST   /api/v1/journal/entry/{entry_id}/summarize    - MD要約を生成
GET    /api/v1/journal/digest/{week_id}              - 週次ダイジェスト取得
POST   /api/v1/journal/digest/{week_id}/generate     - 週次ダイジェスト生成

後方互換:
GET    /api/v1/journal/{date}                        - 旧API互換（by-date と同等）
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
    """ジャーナルを作成する（1日に複数作成可能）"""
    date = body.date

    # エントリ番号の決定
    entry_number = body.entry_number
    if entry_number is None:
        entry_number = firestore_service.get_next_entry_number(date)

    entry_id = f"{date}#{entry_number}"

    # 同一IDが既に存在する場合は409
    existing = firestore_service.get_journal(entry_id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"{entry_id} のジャーナルはすでに存在します。",
        )

    now = now_jst()
    data = {
        "id": entry_id,
        "date": date,
        "entry_number": entry_number,
        "content": body.content,
        "ai_analysis": None,
        "is_analyzed": False,
        "md_summary": None,
        "created_at": now,
        "updated_at": now,
    }

    saved = firestore_service.create_journal(entry_id, data)
    return JournalEntry(**saved)


@router.get("/journal", response_model=list[JournalEntry])
async def list_journals(
    start_date: Optional[str] = Query(None, description="開始日 (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="終了日 (YYYY-MM-DD)"),
):
    """ジャーナル一覧を取得する"""
    journals = firestore_service.list_journals(start_date=start_date, end_date=end_date)
    return [JournalEntry(**j) for j in journals]


# ---- 週次ダイジェスト（/journal/digest/* は /journal/{date} より先に定義） ----

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
    try:
        year = int(week_id[:4])
        week_num = int(week_id[6:])
        monday = datetime.strptime(f"{year}-W{week_num:02d}-1", "%Y-W%W-%w")
        if week_num == 1 and monday.month == 12:
            monday = datetime(year, 1, 1)
        week_start = monday.strftime("%Y-%m-%d")
        week_end = (monday + timedelta(days=6)).strftime("%Y-%m-%d")
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="week_id は YYYY-Www 形式で指定してください")

    journal_entries = firestore_service.list_journals(
        start_date=week_start, end_date=week_end,
    )
    if not journal_entries:
        raise HTTPException(
            status_code=404,
            detail=f"{week_id} にジャーナルエントリがありません",
        )

    daily_analyses = firestore_service.list_analyses(
        start_date=week_start, end_date=week_end,
    )

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


# ---- 日付指定で全エントリ取得 ----

@router.get("/journal/by-date/{date}", response_model=list[JournalEntry])
async def get_journals_by_date(date: str):
    """指定日の全ジャーナルエントリを取得する"""
    entries = firestore_service.list_journals_for_date(date)
    return [JournalEntry(**e) for e in entries]


# ---- 単一エントリ操作（entry_id ベース） ----

@router.get("/journal/entry/{entry_id:path}", response_model=JournalEntry)
async def get_journal_entry(entry_id: str):
    """単一ジャーナルエントリを取得する"""
    journal = firestore_service.get_journal(entry_id)
    if not journal:
        return Response(status_code=204)
    return JournalEntry(**journal)


@router.put("/journal/entry/{entry_id:path}", response_model=JournalEntry)
async def update_journal_entry(entry_id: str, body: JournalUpdate):
    """ジャーナルエントリを更新する"""
    existing = firestore_service.get_journal(entry_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"{entry_id} のジャーナルが見つかりません")

    update_data: dict = {"updated_at": now_jst()}

    if body.content is not None:
        update_data["content"] = body.content
        if body.content != existing.get("content", ""):
            update_data["is_analyzed"] = False
            update_data["ai_analysis"] = None
            update_data["md_summary"] = None

    updated = firestore_service.update_journal(entry_id, update_data)
    return JournalEntry(**updated)


@router.delete("/journal/entry/{entry_id:path}", status_code=204)
async def delete_journal_entry(entry_id: str):
    """ジャーナルエントリを削除する"""
    deleted = firestore_service.delete_journal(entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"{entry_id} のジャーナルが見つかりません")


@router.post("/journal/entry/{entry_id:path}/analyze", response_model=JournalEntry)
async def analyze_journal_entry(entry_id: str):
    """ジャーナルエントリのAI分析を実行する"""
    journal = firestore_service.get_journal(entry_id)
    if not journal:
        raise HTTPException(status_code=404, detail=f"{entry_id} のジャーナルが見つかりません")

    date = journal["date"]
    daily_record = firestore_service.get_record(date)
    daily_analysis = firestore_service.get_analysis(date)

    try:
        analysis_result = claude_service.analyze_journal_entry(
            content=journal["content"],
            date=date,
            daily_record=daily_record,
            daily_analysis=daily_analysis,
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"AI分析でエラーが発生しました: {str(e)[:200]}",
        )

    update_data = {
        "ai_analysis": analysis_result,
        "is_analyzed": True,
        "updated_at": now_jst(),
    }

    updated = firestore_service.update_journal(entry_id, update_data)
    return JournalEntry(**updated)


@router.post("/journal/entry/{entry_id:path}/summarize", response_model=JournalEntry)
async def summarize_journal_entry(entry_id: str):
    """ジャーナルエントリをマークダウン形式で要約し保存する"""
    journal = firestore_service.get_journal(entry_id)
    if not journal:
        raise HTTPException(status_code=404, detail=f"{entry_id} のジャーナルが見つかりません")

    markdown = claude_service.summarize_journal_as_markdown(journal["content"])

    update_data = {
        "md_summary": markdown,
        "updated_at": now_jst(),
    }
    updated = firestore_service.update_journal(entry_id, update_data)
    return JournalEntry(**updated)


# ---- 後方互換: GET /journal/{date} → 日付の全エントリをリストで返す ----

@router.get("/journal/{date}", response_model=list[JournalEntry])
async def get_journal_legacy(date: str):
    """指定日のジャーナルを取得する（後方互換 - リストを返す）"""
    entries = firestore_service.list_journals_for_date(date)
    if not entries:
        return Response(status_code=204)
    return [JournalEntry(**e) for e in entries]
