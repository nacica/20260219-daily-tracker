"""
コーチング & ナレッジグラフ エンドポイント
POST /api/v1/coach/chat               - コーチングチャット
GET  /api/v1/knowledge/entities        - エンティティ一覧
GET  /api/v1/knowledge/entities/{id}   - エンティティ詳細
GET  /api/v1/knowledge/relations       - リレーション一覧
GET  /api/v1/knowledge/summary         - ナレッジグラフサマリー
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from models.schemas import (
    CoachChatRequest, CoachChatResponse,
    UserEntity, EntityRelation,
)
from services import firestore_service
from services.coaching_service import generate_coaching_reply

router = APIRouter()


# ---- コーチングチャット ----

@router.post("/coach/chat", response_model=CoachChatResponse)
async def coach_chat(body: CoachChatRequest):
    """
    パーソナルコーチとチャットする。
    ナレッジグラフと直近の分析データを基に、文脈に応じた返答を生成する。
    """
    try:
        result = await generate_coaching_reply(
            user_message=body.message,
            conversation_history=body.conversation_history,
        )
        return CoachChatResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"コーチングエラー: {type(e).__name__}: {str(e)}")


# ---- ナレッジグラフ参照 ----

@router.get("/knowledge/entities")
async def list_entities(
    entity_type: Optional[str] = Query(None, description="エンティティタイプでフィルタ"),
    status: Optional[str] = Query(None, description="ステータスでフィルタ (active|resolved|monitoring)"),
    limit: int = Query(50, ge=1, le=200),
):
    """エンティティ一覧を取得"""
    entities = firestore_service.list_entities(
        entity_type=entity_type,
        status=status,
        limit=limit,
    )
    return entities


@router.get("/knowledge/entities/{entity_id}")
async def get_entity(entity_id: str):
    """エンティティ詳細を取得"""
    entity = firestore_service.get_entity(entity_id)
    if not entity:
        raise HTTPException(status_code=404, detail="エンティティが見つかりません。")
    return entity


@router.delete("/knowledge/entities/{entity_id}", status_code=204)
async def delete_entity(entity_id: str):
    """エンティティを削除"""
    deleted = firestore_service.delete_entity(entity_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="エンティティが見つかりません。")


@router.get("/knowledge/relations")
async def list_relations(
    min_strength: Optional[float] = Query(None, ge=0.0, le=1.0, description="最低強度"),
    limit: int = Query(50, ge=1, le=200),
):
    """リレーション一覧を取得"""
    relations = firestore_service.list_relations(
        min_strength=min_strength,
        limit=limit,
    )
    return relations


@router.delete("/knowledge/relations/{relation_id}", status_code=204)
async def delete_relation(relation_id: str):
    """リレーションを削除"""
    deleted = firestore_service.delete_relation(relation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="リレーションが見つかりません。")


@router.get("/knowledge/summary")
async def get_knowledge_summary():
    """ナレッジグラフの統計サマリーを取得"""
    entities = firestore_service.list_entities(limit=200)
    relations = firestore_service.list_relations(limit=200)

    # タイプ別集計
    type_counts = {}
    for e in entities:
        t = e.get("entityType", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1

    # ステータス別集計
    status_counts = {}
    for e in entities:
        s = e.get("status", "unknown")
        status_counts[s] = status_counts.get(s, 0) + 1

    # リレーションタイプ別集計
    rel_type_counts = {}
    for r in relations:
        t = r.get("relation_type", "unknown")
        rel_type_counts[t] = rel_type_counts.get(t, 0) + 1

    return {
        "total_entities": len(entities),
        "total_relations": len(relations),
        "entities_by_type": type_counts,
        "entities_by_status": status_counts,
        "relations_by_type": rel_type_counts,
    }
