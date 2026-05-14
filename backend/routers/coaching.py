"""
コーチング エンドポイント
POST /api/v1/coach/chat               - コーチングチャット
"""

from fastapi import APIRouter, HTTPException

from models.schemas import CoachChatRequest, CoachChatResponse
from services.coaching_service import generate_coaching_reply

router = APIRouter()


@router.post("/coach/chat", response_model=CoachChatResponse)
async def coach_chat(body: CoachChatRequest):
    """
    パーソナルコーチとチャットする。
    直近の分析データと月次サマリーを基に、文脈に応じた返答を生成する。
    """
    try:
        result = await generate_coaching_reply(
            user_message=body.message,
            conversation_history=body.conversation_history,
        )
        return CoachChatResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"コーチングエラー: {type(e).__name__}: {str(e)}")
