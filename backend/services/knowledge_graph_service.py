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


REWRITE_SYSTEM_PROMPT = """あなたは日本語のリライト専門家です。
行動分析ツールのナレッジグラフに保存されたエンティティ名・観測テキスト・関係性の説明を、
**高校生が読んでも一発でわかる具体的な日本語** に書き換えてください。

## 書き換えルール
1. エンティティ名: 短く具体的に（15文字以内目安）
   ❌「ネガティブ認知負荷の除去動機」→ ✅「嫌なことを避けたくなる癖」
   ❌「体系的なリカバリー習慣の欠如」→ ✅「疲れた後の休み方がわからない」
   ❌「中長期探索タスクの常時後回し傾向」→ ✅「難しいタスクをつい後回しにする」

2. 観測テキスト: 「何があって → どういう意味か」を1〜2文で具体的に
   ❌「認知負荷回避が行動選択に影響している」
   ✅「タスクが15個もあって全部は無理と感じ、簡単な作業だけで終わりにした」

3. 関係性の説明: 「AがBにどう影響するか」を具体的に
   ❌「認知負荷と行動選択の相関」
   ✅「やることが多すぎると、難しいタスクを避けて楽なものだけ選んでしまう」

## 出力形式（JSON のみ出力、説明不要）
```json
{
  "entities": [
    {"old_name": "元の名前", "new_name": "新しい名前", "observations": ["書き換え後の観測1", "書き換え後の観測2"]}
  ],
  "relations": [
    {"from": "元のfrom名", "to": "元のto名", "type": "relation_type", "new_from": "新しいfrom名", "new_to": "新しいto名", "new_description": "書き換え後の説明"}
  ]
}
```"""


def rewrite_kg_labels():
    """既存の全エンティティ名・観測・リレーション説明を平易な日本語に書き換える"""
    try:
        entities = firestore_service.list_entities(limit=200)
        relations = firestore_service.list_relations(limit=200)

        if not entities:
            logger.info("書き換え対象のエンティティなし")
            return

        # 現データをサマリーにしてClaudeに渡す
        entity_lines = []
        for e in entities:
            obs_texts = [o.get("content", "") for o in e.get("observations", [])]
            entity_lines.append(f"- 名前: {e.get('name')} (type: {e.get('entityType')})\n  観測: {' / '.join(obs_texts)}")

        rel_lines = []
        for r in relations:
            rel_lines.append(f"- {r.get('from_entity')} → {r.get('to_entity')} ({r.get('relation_type')}): {r.get('description', '')}")

        user_prompt = f"""以下の全エンティティと全リレーションを書き換えてください。

## エンティティ一覧（{len(entities)}件）
{chr(10).join(entity_lines)}

## リレーション一覧（{len(relations)}件）
{chr(10).join(rel_lines)}

すべてのエンティティとリレーションを書き換えて、JSON形式で出力してください。"""

        client = get_client()
        response = _call_claude_with_retry(
            client,
            model="claude-sonnet-4-6-20250514",
            max_tokens=8192,
            system=REWRITE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )

        raw_text = response.content[0].text
        rewrite_data = _extract_json(raw_text)
        now = now_jst()

        # エンティティ書き換え適用
        name_to_entity = {e.get("name"): e for e in entities}
        old_to_new_name = {}

        for re_ent in rewrite_data.get("entities", []):
            old_name = re_ent.get("old_name", "")
            new_name = re_ent.get("new_name", old_name)
            new_obs_texts = re_ent.get("observations", [])
            entity = name_to_entity.get(old_name)
            if not entity:
                continue

            old_to_new_name[old_name] = new_name

            # 観測テキストを書き換え（件数は保持）
            existing_obs = entity.get("observations", [])
            for i, obs in enumerate(existing_obs):
                if i < len(new_obs_texts):
                    obs["content"] = new_obs_texts[i]

            update_data = {
                "name": new_name,
                "observations": existing_obs,
                "updated_at": now,
            }
            firestore_service.update_entity(entity.get("id"), update_data)

        # リレーション書き換え適用
        for re_rel in rewrite_data.get("relations", []):
            old_from = re_rel.get("from", "")
            old_to = re_rel.get("to", "")
            rel_type = re_rel.get("type", "")
            new_from = re_rel.get("new_from", old_to_new_name.get(old_from, old_from))
            new_to = re_rel.get("new_to", old_to_new_name.get(old_to, old_to))
            new_desc = re_rel.get("new_description", "")

            existing_rel = firestore_service.find_relation(old_from, old_to, rel_type)
            if not existing_rel:
                continue

            update_data = {
                "from_entity": new_from,
                "to_entity": new_to,
                "description": new_desc,
                "updated_at": now,
            }
            firestore_service.update_relation(existing_rel.get("id"), update_data)

        logger.info("KGラベル書き換え完了: %d entities, %d relations",
                     len(rewrite_data.get("entities", [])),
                     len(rewrite_data.get("relations", [])))

    except Exception as e:
        logger.error("KGラベル書き換えエラー: %s", e, exc_info=True)


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
