"""
ソクラテス式対話エンドポイント
POST /api/v1/dialogue/{date}/start       - 対話を開始（または再開）
POST /api/v1/dialogue/{date}/reply       - ユーザー返答を送信しAI応答を取得
POST /api/v1/dialogue/{date}/synthesize  - 対話から分析を生成
GET  /api/v1/dialogue/{date}             - 保存済み対話を取得
DELETE /api/v1/dialogue/{date}           - 対話を削除
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks, Response

from models.schemas import AnalysisDialogue, DialogueReplyRequest, DialogueMessage
from services import firestore_service, claude_service
from services.knowledge_graph_service import update_knowledge_graph
from utils.helpers import now_jst

router = APIRouter()


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


@router.post("/dialogue/{date}/start", response_model=AnalysisDialogue)
async def start_dialogue(date: str):
    """
    ソクラテス式対話を開始する。
    既に in_progress の対話がある場合はそのまま返す（再開）。
    """
    try:
        # 既存の対話を確認
        existing = firestore_service.get_dialogue(date)
        if existing and existing.get("status") == "in_progress":
            return _build_dialogue_response(existing)

        # 行動記録の存在確認
        record = firestore_service.get_record(date)
        if not record:
            raise HTTPException(
                status_code=404,
                detail=f"{date} の行動記録が見つかりません。",
            )

        # 過去データの取得
        past_records = firestore_service.get_past_records(date, days=7)
        past_analyses = firestore_service.get_past_analyses(date, days=7)

        # ソクラテス式質問を生成
        try:
            ai_text = claude_service.generate_socratic_questions(
                record=record,
                past_records=past_records,
                past_analyses=past_analyses,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Claude API エラー: {str(e)}")

        # 対話ドキュメントを作成
        now = now_jst()
        doc = {
            "id": date,
            "date": date,
            "status": "in_progress",
            "messages": [
                {"role": "ai", "content": ai_text, "timestamp": now},
            ],
            "turn_count": 0,
            "max_turns": 5,
            "created_at": now,
            "updated_at": now,
        }
        firestore_service.save_dialogue(date, doc)

        return _build_dialogue_response(doc)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"サーバーエラー: {type(e).__name__}: {str(e)}")


@router.post("/dialogue/{date}/reply", response_model=AnalysisDialogue)
async def reply_dialogue(date: str, body: DialogueReplyRequest):
    """
    ユーザーの返答を送信し、AIのフォローアップ応答を取得する。
    """
    try:
        dialogue = firestore_service.get_dialogue(date)
        if not dialogue:
            raise HTTPException(status_code=404, detail=f"{date} の対話が見つかりません。")
        if dialogue.get("status") != "in_progress":
            raise HTTPException(status_code=409, detail="この対話は既に完了しています。")

        turn_count = dialogue.get("turn_count", 0)
        max_turns = dialogue.get("max_turns", 5)
        if turn_count >= max_turns:
            raise HTTPException(status_code=409, detail="対話のターン上限に達しています。「分析をまとめる」を実行してください。")

        # ユーザーメッセージを追加
        now = now_jst()
        messages = dialogue.get("messages", [])
        messages.append({"role": "user", "content": body.message, "timestamp": now})
        turn_count += 1

        # 行動記録の取得（フォローアップ生成に必要）
        record = firestore_service.get_record(date)
        if not record:
            raise HTTPException(status_code=404, detail=f"{date} の行動記録が見つかりません。")

        # AIフォローアップ応答を生成
        try:
            ai_text = claude_service.generate_socratic_followup(
                record=record,
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
        firestore_service.save_dialogue(date, dialogue)

        return _build_dialogue_response(dialogue)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"サーバーエラー: {type(e).__name__}: {str(e)}")


@router.post("/dialogue/{date}/synthesize")
async def synthesize_dialogue(date: str, background_tasks: BackgroundTasks):
    """
    対話からの共創分析を生成する。
    DailyAnalysis を daily_analyses に保存し、対話を completed にする。
    """
    try:
        dialogue = firestore_service.get_dialogue(date)
        if not dialogue:
            raise HTTPException(status_code=404, detail=f"{date} の対話が見つかりません。")
        if dialogue.get("turn_count", 0) < 1:
            raise HTTPException(status_code=400, detail="最低1回はやり取りしてから分析をまとめてください。")

        record = firestore_service.get_record(date)
        if not record:
            raise HTTPException(status_code=404, detail=f"{date} の行動記録が見つかりません。")

        past_records = firestore_service.get_past_records(date, days=7)
        past_analyses = firestore_service.get_past_analyses(date, days=7)

        messages = dialogue.get("messages", [])

        # 共創分析を生成
        try:
            analysis_data = claude_service.generate_dialogue_synthesis(
                record=record,
                messages=messages,
                past_records=past_records,
                past_analyses=past_analyses,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Claude API エラー: {str(e)}")

        # daily_analyses に保存（既存の一括分析と同じスキーマ）
        now = now_jst()
        analysis_doc = {
            "id": date,
            "date": date,
            "summary": analysis_data.get("summary", {}),
            "analysis": analysis_data.get("analysis", {}),
            "created_at": now,
        }
        firestore_service.save_analysis(date, analysis_doc)

        # 対話を completed に更新
        dialogue["status"] = "completed"
        dialogue["updated_at"] = now
        firestore_service.save_dialogue(date, dialogue)

        # バックグラウンドでナレッジグラフ更新
        background_tasks.add_task(update_knowledge_graph, record, analysis_doc)

        # 分析 + 対話をまとめて返却
        from routers.analysis import _build_response
        return {
            "dialogue": _build_dialogue_response(dialogue).model_dump(),
            "analysis": _build_response(analysis_doc).model_dump(),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"サーバーエラー: {type(e).__name__}: {str(e)}")


@router.get("/dialogue/{date}", response_model=AnalysisDialogue)
async def get_dialogue(date: str):
    """保存済みの対話を取得する"""
    dialogue = firestore_service.get_dialogue(date)
    if not dialogue:
        return Response(status_code=204)
    return _build_dialogue_response(dialogue)


@router.delete("/dialogue/{date}", status_code=204)
async def delete_dialogue(date: str):
    """対話を削除する"""
    deleted = firestore_service.delete_dialogue(date)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"{date} の対話が見つかりません。")
