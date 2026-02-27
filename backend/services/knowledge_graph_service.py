"""
ナレッジグラフサービス
日次分析完了後にエンティティ・リレーションを自動抽出し Firestore に保存する
"""

import os
import json
import uuid
import logging

from services import firestore_service
from services.claude_service import get_client, _call_claude_with_retry, _extract_json
from prompts.knowledge_graph import (
    KNOWLEDGE_GRAPH_EXTRACTION_SYSTEM_PROMPT,
    build_knowledge_graph_extraction_prompt,
)
from utils.helpers import now_jst

logger = logging.getLogger(__name__)

# Haiku でトークン節約（仕様指定）
KG_MODEL = "claude-haiku-4-5-20251001"


def _build_entities_summary(entities: list[dict]) -> str:
    """エンティティ一覧を「名前 (type)」形式のサマリーに変換"""
    if not entities:
        return ""
    lines = []
    for e in entities:
        lines.append(f"- {e.get('name')} ({e.get('entityType')})")
    return "\n".join(lines)


def _build_relations_summary(relations: list[dict]) -> str:
    """リレーション一覧を「from → to (type)」形式のサマリーに変換"""
    if not relations:
        return ""
    lines = []
    for r in relations:
        lines.append(f"- {r.get('from_entity')} → {r.get('to_entity')} ({r.get('relation_type')})")
    return "\n".join(lines)


def _build_record_and_analysis_text(record: dict, analysis: dict) -> str:
    """記録+分析をテキストに変換"""
    date = record.get("date", "不明")
    raw_input = record.get("raw_input", "")

    summary = analysis.get("summary", {})
    detail = analysis.get("analysis", {})

    parts = [
        f"日付: {date}",
        f"行動記録:\n{raw_input}",
        f"スコア: {summary.get('overall_score', '-')}/100",
        f"生産的時間: {summary.get('productive_hours', '-')}h",
        f"無駄時間: {summary.get('wasted_hours', '-')}h",
    ]

    good = detail.get("good_points", [])
    if good:
        parts.append(f"良い点: {', '.join(good)}")

    bad = detail.get("bad_points", [])
    if bad:
        parts.append(f"悪い点: {', '.join(bad)}")

    causes = detail.get("root_causes", [])
    if causes:
        parts.append(f"根本原因: {', '.join(causes)}")

    suggestions = detail.get("improvement_suggestions", [])
    if suggestions:
        s_texts = [s.get("suggestion", "") if isinstance(s, dict) else str(s) for s in suggestions]
        parts.append(f"改善提案: {', '.join(s_texts)}")

    return "\n".join(parts)


def update_knowledge_graph(record: dict, analysis: dict) -> dict:
    """
    日次分析完了後にナレッジグラフを更新する。
    失敗しても日次分析自体には影響しない（エラーはログに記録）。

    Returns:
        更新結果のサマリー dict
    """
    try:
        # 1. 既存エンティティ・リレーション取得（サマリーのみ渡す）
        entities = firestore_service.list_entities(status="active", limit=50)
        relations = firestore_service.list_relations(limit=50)

        entities_summary = _build_entities_summary(entities)
        relations_summary = _build_relations_summary(relations)
        record_analysis_text = _build_record_and_analysis_text(record, analysis)

        # 2. Claude API でナレッジグラフ抽出
        user_prompt = build_knowledge_graph_extraction_prompt(
            existing_entities_summary=entities_summary,
            existing_relations_summary=relations_summary,
            today_record_and_analysis=record_analysis_text,
        )

        client = get_client()
        response = _call_claude_with_retry(
            client,
            model=KG_MODEL,
            max_tokens=2048,
            system=KNOWLEDGE_GRAPH_EXTRACTION_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )

        raw_text = response.content[0].text
        kg_data = _extract_json(raw_text)

        # 3. Firestore に反映
        date = record.get("date", "")
        result = _apply_kg_updates(kg_data, date, entities)

        logger.info("ナレッジグラフ更新完了: %s", result)
        return result

    except Exception as e:
        logger.error("ナレッジグラフ更新エラー（日次分析は正常完了）: %s", e, exc_info=True)
        return {"error": str(e)}


def _apply_kg_updates(kg_data: dict, date: str, existing_entities: list[dict]) -> dict:
    """Claude API の出力を Firestore に反映する"""
    now = now_jst()
    result = {
        "new_entities": 0,
        "entity_updates": 0,
        "new_relations": 0,
        "relation_updates": 0,
    }

    # 既存エンティティの名前→IDマップ
    name_to_id = {e.get("name"): e.get("id") for e in existing_entities}

    # ---- 新規エンティティ ----
    for ne in kg_data.get("new_entities", []):
        name = ne.get("name", "").strip()
        if not name or name in name_to_id:
            continue
        entity_id = f"entity_{uuid.uuid4().hex[:12]}"
        doc = {
            "id": entity_id,
            "name": name,
            "entityType": ne.get("entityType", "behavior_pattern"),
            "observations": [
                {
                    "content": ne.get("observation", ""),
                    "source_date": date,
                    "confidence": ne.get("confidence", 0.7),
                }
            ],
            "first_observed": date,
            "last_observed": date,
            "observation_count": 1,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
        firestore_service.save_entity(entity_id, doc)
        name_to_id[name] = entity_id
        result["new_entities"] += 1

    # ---- エンティティ更新 ----
    for eu in kg_data.get("entity_updates", []):
        ename = eu.get("entity_name", "").strip()
        eid = name_to_id.get(ename)
        if not eid:
            continue
        existing = firestore_service.get_entity(eid)
        if not existing:
            continue

        observations = existing.get("observations", [])
        observations.append({
            "content": eu.get("new_observation", ""),
            "source_date": date,
            "confidence": eu.get("confidence", 0.7),
        })

        firestore_service.update_entity(eid, {
            "observations": observations,
            "last_observed": date,
            "observation_count": existing.get("observation_count", 0) + 1,
            "updated_at": now,
        })
        result["entity_updates"] += 1

    # ---- 新規リレーション ----
    for nr in kg_data.get("new_relations", []):
        from_name = nr.get("from", "").strip()
        to_name = nr.get("to", "").strip()
        rel_type = nr.get("relation_type", "correlates_with")
        if not from_name or not to_name:
            continue

        # 既存リレーションチェック
        existing_rel = firestore_service.find_relation(from_name, to_name, rel_type)
        if existing_rel:
            continue

        rel_id = f"rel_{uuid.uuid4().hex[:12]}"
        doc = {
            "id": rel_id,
            "from_entity": from_name,
            "from_entity_id": name_to_id.get(from_name, ""),
            "to_entity": to_name,
            "to_entity_id": name_to_id.get(to_name, ""),
            "relation_type": rel_type,
            "strength": 0.5,
            "evidence_count": 1,
            "evidence_dates": [date],
            "description": nr.get("description", ""),
            "created_at": now,
            "updated_at": now,
        }
        firestore_service.save_relation(rel_id, doc)
        result["new_relations"] += 1

    # ---- リレーション更新 ----
    for ru in kg_data.get("relation_updates", []):
        from_name = ru.get("from", "").strip()
        to_name = ru.get("to", "").strip()
        rel_type = ru.get("relation_type", "")
        if not from_name or not to_name or not rel_type:
            continue

        existing_rel = firestore_service.find_relation(from_name, to_name, rel_type)
        if not existing_rel:
            continue

        rel_id = existing_rel.get("id", "")
        evidence_dates = existing_rel.get("evidence_dates", [])
        if date not in evidence_dates:
            evidence_dates.append(date)
        evidence_count = len(evidence_dates)
        # strength を evidence_count に基づいて再計算（最大 1.0）
        strength = min(1.0, 0.3 + (evidence_count * 0.1))

        firestore_service.update_relation(rel_id, {
            "evidence_count": evidence_count,
            "evidence_dates": evidence_dates,
            "strength": strength,
            "updated_at": now,
        })
        result["relation_updates"] += 1

    return result
