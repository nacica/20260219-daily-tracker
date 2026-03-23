"""
日記入力ソクラテス式対話エンドポイント
AIの質問に答える形で一日の行動を記録する

POST   /api/v1/diary-dialogue/{date}/start       - 対話を開始（または再開）
POST   /api/v1/diary-dialogue/{date}/reply        - ユーザー返答を送信しAI応答を取得
POST   /api/v1/diary-dialogue/{date}/synthesize   - 対話から行動ログを生成しレコード保存
GET    /api/v1/diary-dialogue/{date}              - 保存済み対話を取得
DELETE /api/v1/diary-dialogue/{date}              - 対話を削除
"""

import anthropic
from fastapi import APIRouter, HTTPException, Response

from models.schemas import AnalysisDialogue, DialogueReplyRequest, DialogueMessage
from services import firestore_service, claude_service
from utils.helpers import now_jst

router = APIRouter()


def _build_response(data: dict) -> AnalysisDialogue:
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


@router.post("/diary-dialogue/{date}/start", response_model=AnalysisDialogue)
async def start_diary_dialogue(date: str):
    """日記入力対話を開始する。既に in_progress の対話がある場合はそのまま返す。"""
    try:
        existing = firestore_service.get_diary_dialogue(date)
        if existing and existing.get("status") == "in_progress":
            return _build_response(existing)

        # 初期質問を生成
        try:
            ai_text = claude_service.generate_diary_questions(date=date)
        except anthropic.APIStatusError as e:
            if e.status_code == 529:
                raise HTTPException(status_code=503, detail="AIサーバーが混み合っています。しばらく待ってからもう一度お試しください。")
            if e.status_code == 429:
                raise HTTPException(status_code=503, detail="APIリクエストの上限に達しました。しばらく待ってからもう一度お試しください。")
            raise HTTPException(status_code=500, detail=f"AI応答の生成に失敗しました。しばらく待ってから再度お試しください。")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"AI応答の生成に失敗しました。しばらく待ってから再度お試しください。")

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
        firestore_service.save_diary_dialogue(date, doc)

        return _build_response(doc)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"サーバーエラー: {type(e).__name__}: {str(e)}")


@router.post("/diary-dialogue/{date}/reply", response_model=AnalysisDialogue)
async def reply_diary_dialogue(date: str, body: DialogueReplyRequest):
    """ユーザーの返答を送信し、AIのフォローアップ質問を取得する。"""
    try:
        dialogue = firestore_service.get_diary_dialogue(date)
        if not dialogue:
            raise HTTPException(status_code=404, detail=f"{date} の日記対話が見つかりません。")
        if dialogue.get("status") != "in_progress":
            raise HTTPException(status_code=409, detail="この対話は既に完了しています。")

        turn_count = dialogue.get("turn_count", 0)
        max_turns = dialogue.get("max_turns", 5)
        if turn_count >= max_turns:
            raise HTTPException(status_code=409, detail="対話のターン上限に達しています。「記録をまとめる」を実行してください。")

        now = now_jst()
        messages = dialogue.get("messages", [])
        messages.append({"role": "user", "content": body.message, "timestamp": now})
        turn_count += 1

        try:
            ai_text = claude_service.generate_diary_followup(
                date=date,
                messages=messages,
                turn_count=turn_count,
                max_turns=max_turns,
            )
        except anthropic.APIStatusError as e:
            if e.status_code == 529:
                raise HTTPException(status_code=503, detail="AIサーバーが混み合っています。しばらく待ってからもう一度お試しください。")
            if e.status_code == 429:
                raise HTTPException(status_code=503, detail="APIリクエストの上限に達しました。しばらく待ってからもう一度お試しください。")
            raise HTTPException(status_code=500, detail=f"AI応答の生成に失敗しました。しばらく待ってから再度お試しください。")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"AI応答の生成に失敗しました。しばらく待ってから再度お試しください。")

        now2 = now_jst()
        messages.append({"role": "ai", "content": ai_text, "timestamp": now2})

        dialogue["messages"] = messages
        dialogue["turn_count"] = turn_count
        dialogue["updated_at"] = now2
        firestore_service.save_diary_dialogue(date, dialogue)

        return _build_response(dialogue)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"サーバーエラー: {type(e).__name__}: {str(e)}")


@router.post("/diary-dialogue/{date}/synthesize")
async def synthesize_diary_dialogue(date: str):
    """
    対話から日記テキストを生成する。
    テキストはレスポンスで返し、フロントエンドが日記テキストエリアに反映する。
    """
    try:
        dialogue = firestore_service.get_diary_dialogue(date)
        if not dialogue:
            raise HTTPException(status_code=404, detail=f"{date} の日記対話が見つかりません。")
        if dialogue.get("turn_count", 0) < 1:
            raise HTTPException(status_code=400, detail="最低1回はやり取りしてから記録をまとめてください。")

        messages = dialogue.get("messages", [])

        # 日記テキストを生成
        try:
            result = claude_service.generate_diary_synthesis(
                date=date,
                messages=messages,
            )
        except anthropic.APIStatusError as e:
            if e.status_code == 529:
                raise HTTPException(status_code=503, detail="AIサーバーが混み合っています。しばらく待ってからもう一度お試しください。")
            if e.status_code == 429:
                raise HTTPException(status_code=503, detail="APIリクエストの上限に達しました。しばらく待ってからもう一度お試しください。")
            raise HTTPException(status_code=500, detail=f"AI応答の生成に失敗しました。しばらく待ってから再度お試しください。")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"AI応答の生成に失敗しました。しばらく待ってから再度お試しください。")

        raw_input = result.get("raw_input", "")
        if not raw_input:
            raise HTTPException(status_code=500, detail="日記テキストの生成に失敗しました。")

        # 対話を completed に更新
        now = now_jst()
        dialogue["status"] = "completed"
        dialogue["updated_at"] = now
        dialogue["raw_input"] = raw_input
        firestore_service.save_diary_dialogue(date, dialogue)

        return {
            "dialogue": _build_response(dialogue).model_dump(),
            "raw_input": raw_input,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"サーバーエラー: {type(e).__name__}: {str(e)}")


@router.get("/diary-dialogue/{date}", response_model=AnalysisDialogue)
async def get_diary_dialogue(date: str):
    """保存済みの日記対話を取得する"""
    dialogue = firestore_service.get_diary_dialogue(date)
    if not dialogue:
        return Response(status_code=204)
    return _build_response(dialogue)


@router.delete("/diary-dialogue/{date}", status_code=204)
async def delete_diary_dialogue(date: str):
    """日記対話を削除する"""
    deleted = firestore_service.delete_diary_dialogue(date)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"{date} の日記対話が見つかりません。")
