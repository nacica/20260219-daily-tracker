"""
朝のタスク整理エンドポイント
POST /api/v1/morning/{date}/start       - 朝問答を開始（または再開）
POST /api/v1/morning/{date}/reply       - ユーザー返答を送信しAI応答を取得
POST /api/v1/morning/{date}/synthesize  - 対話から今日のプランを生成
GET  /api/v1/morning/{date}             - 保存済み朝問答を取得
DELETE /api/v1/morning/{date}           - 朝問答を削除
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Response

from models.schemas import AnalysisDialogue, DialogueReplyRequest, DialogueMessage
from services import firestore_service, claude_service
from utils.helpers import now_jst

router = APIRouter()


def _yesterday(date: str) -> str:
    """日付文字列から前日を返す"""
    dt = datetime.strptime(date, "%Y-%m-%d")
    return (dt - timedelta(days=1)).strftime("%Y-%m-%d")


def _collect_incomplete_tasks(date: str, days: int = 7) -> list[str]:
    """直近N日間の未完了タスクを収集する"""
    past_records = firestore_service.get_past_records(date, days=days)
    incomplete = []
    seen = set()
    for record in past_records:
        tasks = record.get("tasks", {})
        planned = tasks.get("planned", [])
        completed = tasks.get("completed", [])
        for task in planned:
            if task not in completed and task not in seen:
                incomplete.append(task)
                seen.add(task)
    return incomplete


def _collect_backlog_tasks(date: str, days: int = 7) -> list[str]:
    """直近N日間の近日中タスクを収集する（最新のレコードのbacklogを優先）"""
    past_records = firestore_service.get_past_records(date, days=days)
    backlog = []
    seen = set()
    for record in past_records:
        tasks = record.get("tasks", {})
        for task in tasks.get("backlog", []):
            if task not in seen:
                backlog.append(task)
                seen.add(task)
    return backlog


def _build_dialogue_response(data: dict) -> AnalysisDialogue:
    """Firestore のデータから AnalysisDialogue レスポンスを構築"""
    messages = [
        DialogueMessage(**m) if isinstance(m, dict) else m
        for m in data.get("messages", [])
    ]
    return AnalysisDialogue(
        id=data.get("id", data.get("date", "")),
        date=data.get("date", ""),
        status=data.get("status", "in_progress"),
        messages=messages,
        turn_count=data.get("turn_count", 0),
        max_turns=data.get("max_turns", 5),
        created_at=data.get("created_at"),
        updated_at=data.get("updated_at"),
    )


@router.post("/morning/{date}/start", response_model=AnalysisDialogue)
async def start_morning_dialogue(date: str):
    """
    朝のタスク整理対話を開始する。
    既に in_progress の対話がある場合はそのまま返す（再開）。
    """
    try:
        # 既存の対話を確認
        existing = firestore_service.get_morning_dialogue(date)
        if existing and existing.get("status") == "in_progress":
            return _build_dialogue_response(existing)

        # 昨日のデータを取得
        yesterday = _yesterday(date)
        yesterday_record = firestore_service.get_record(yesterday)
        yesterday_analysis = firestore_service.get_analysis(yesterday)

        # 直近の未完了タスクと近日中タスクを収集
        incomplete_tasks = _collect_incomplete_tasks(date)
        backlog_tasks = _collect_backlog_tasks(date)

        # アクティブな目標を取得
        active_goals = firestore_service.list_entities(
            entity_type="goal", status="active", limit=5,
        )

        # 朝の問いかけを生成
        try:
            ai_text = claude_service.generate_morning_questions(
                yesterday_record=yesterday_record,
                yesterday_analysis=yesterday_analysis,
                incomplete_tasks=incomplete_tasks,
                active_goals=active_goals,
                backlog_tasks=backlog_tasks,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Claude API エラー: {str(e)}")

        # 対話ドキュメントを作成
        now = now_jst()
        doc = {
            "id": f"morning-{date}",
            "date": date,
            "status": "in_progress",
            "messages": [
                {"role": "ai", "content": ai_text, "timestamp": now},
            ],
            "turn_count": 0,
            "max_turns": 5,
            "context": {
                "yesterday_date": yesterday,
                "has_yesterday_record": yesterday_record is not None,
                "incomplete_tasks": incomplete_tasks,
                "backlog_tasks": backlog_tasks,
            },
            "created_at": now,
            "updated_at": now,
        }
        firestore_service.save_morning_dialogue(date, doc)

        return _build_dialogue_response(doc)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"サーバーエラー: {type(e).__name__}: {str(e)}")


@router.post("/morning/{date}/reply", response_model=AnalysisDialogue)
async def reply_morning_dialogue(date: str, body: DialogueReplyRequest):
    """
    ユーザーの返答を送信し、AIのフォローアップ応答を取得する。
    """
    try:
        dialogue = firestore_service.get_morning_dialogue(date)
        if not dialogue:
            raise HTTPException(status_code=404, detail=f"{date} の朝問答が見つかりません。")
        if dialogue.get("status") != "in_progress":
            raise HTTPException(status_code=409, detail="この対話は既に完了しています。")

        turn_count = dialogue.get("turn_count", 0)
        max_turns = dialogue.get("max_turns", 5)
        if turn_count >= max_turns:
            raise HTTPException(status_code=409, detail="対話のターン上限に達しています。「プランをまとめる」を実行してください。")

        # ユーザーメッセージを追加
        now = now_jst()
        messages = dialogue.get("messages", [])
        messages.append({"role": "user", "content": body.message, "timestamp": now})
        turn_count += 1

        # 昨日のデータを再取得
        yesterday = _yesterday(date)
        yesterday_record = firestore_service.get_record(yesterday)
        yesterday_analysis = firestore_service.get_analysis(yesterday)
        incomplete_tasks = _collect_incomplete_tasks(date)

        # AIフォローアップ応答を生成
        try:
            ai_text = claude_service.generate_morning_followup(
                yesterday_record=yesterday_record,
                yesterday_analysis=yesterday_analysis,
                incomplete_tasks=incomplete_tasks,
                messages=messages,
                turn_count=turn_count,
                max_turns=max_turns,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Claude API エラー: {str(e)}")

        now2 = now_jst()
        messages.append({"role": "ai", "content": ai_text, "timestamp": now2})

        # 対話を更新
        dialogue["messages"] = messages
        dialogue["turn_count"] = turn_count
        dialogue["updated_at"] = now2
        firestore_service.save_morning_dialogue(date, dialogue)

        return _build_dialogue_response(dialogue)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"サーバーエラー: {type(e).__name__}: {str(e)}")


@router.post("/morning/{date}/synthesize")
async def synthesize_morning_dialogue(date: str):
    """
    朝問答から今日のプランを生成する。
    MorningPlan JSON を返し、対話を completed にする。
    """
    try:
        dialogue = firestore_service.get_morning_dialogue(date)
        if not dialogue:
            raise HTTPException(status_code=404, detail=f"{date} の朝問答が見つかりません。")
        if dialogue.get("turn_count", 0) < 1:
            raise HTTPException(status_code=400, detail="最低1回はやり取りしてからプランをまとめてください。")

        # 昨日のデータを取得
        yesterday = _yesterday(date)
        yesterday_record = firestore_service.get_record(yesterday)
        yesterday_analysis = firestore_service.get_analysis(yesterday)
        incomplete_tasks = _collect_incomplete_tasks(date)
        messages = dialogue.get("messages", [])

        # 今日のプランを生成
        try:
            plan_data = claude_service.generate_morning_synthesis(
                yesterday_record=yesterday_record,
                yesterday_analysis=yesterday_analysis,
                incomplete_tasks=incomplete_tasks,
                messages=messages,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Claude API エラー: {str(e)}")

        # 対話を completed に更新、プランも保存
        now = now_jst()
        dialogue["status"] = "completed"
        dialogue["plan"] = plan_data
        dialogue["updated_at"] = now
        firestore_service.save_morning_dialogue(date, dialogue)

        return {
            "dialogue": _build_dialogue_response(dialogue).model_dump(),
            "plan": plan_data,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"サーバーエラー: {type(e).__name__}: {str(e)}")


@router.get("/morning/{date}", response_model=AnalysisDialogue)
async def get_morning_dialogue(date: str):
    """保存済みの朝問答を取得する"""
    dialogue = firestore_service.get_morning_dialogue(date)
    if not dialogue:
        return Response(status_code=204)
    return _build_dialogue_response(dialogue)


@router.delete("/morning/{date}", status_code=204)
async def delete_morning_dialogue(date: str):
    """朝問答を削除する"""
    deleted = firestore_service.delete_morning_dialogue(date)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"{date} の朝問答が見つかりません。")
