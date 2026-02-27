"""
コーチングサービス
ナレッジグラフとユーザーデータを活用したパーソナルコーチング
"""

import os
import logging

from services import firestore_service
from services.claude_service import get_client, _call_claude_with_retry, _extract_json
from prompts.coaching import COACHING_SYSTEM_PROMPT, build_coaching_user_prompt

logger = logging.getLogger(__name__)

# コーチングは Sonnet を使用（仕様指定）
COACHING_MODEL = "claude-sonnet-4-6"

# テーマ別キーワード
THEME_KEYWORDS = {
    "food": ["食事", "食べ", "ダイエット", "体重", "カロリー", "間食", "ストレス食い"],
    "work": ["仕事", "タスク", "生産性", "集中", "副業", "作業", "締切", "プロジェクト"],
    "mental": ["メンタル", "気分", "不安", "ストレス", "疲れ", "憂鬱", "モチベーション"],
    "sleep": ["睡眠", "夜更かし", "起床", "朝型", "夜型", "眠れない"],
    "exercise": ["運動", "ジム", "散歩", "ウォーキング", "筋トレ"],
}


def _contains_keywords(text: str, keywords: list[str]) -> bool:
    """テキストにキーワードが含まれるか"""
    return any(kw in text for kw in keywords)


def _format_entities(entities: list[dict]) -> str:
    """エンティティ一覧をテキストに変換"""
    if not entities:
        return "（まだデータがありません）"
    lines = []
    for e in entities:
        obs = e.get("observations", [])
        latest_obs = obs[-1].get("content", "") if obs else ""
        count = e.get("observation_count", 0)
        lines.append(
            f"- **{e.get('name')}** [{e.get('entityType')}] "
            f"(観測{count}回, 最終: {e.get('last_observed', '不明')}) "
            f"— {latest_obs}"
        )
    return "\n".join(lines)


def _format_relations(relations: list[dict]) -> str:
    """リレーション一覧をテキストに変換"""
    if not relations:
        return "（まだデータがありません）"
    lines = []
    for r in relations:
        lines.append(
            f"- {r.get('from_entity')} → {r.get('to_entity')} "
            f"[{r.get('relation_type')}] "
            f"(強度: {r.get('strength', 0):.1f}, 証拠: {r.get('evidence_count', 0)}回) "
            f"— {r.get('description', '')}"
        )
    return "\n".join(lines)


def _format_recent_week(analyses: list[dict]) -> str:
    """直近1週間の分析サマリーをテキストに変換"""
    if not analyses:
        return "（直近の分析データがありません）"
    lines = []
    for a in sorted(analyses, key=lambda x: x.get("date", "")):
        s = a.get("summary", {})
        lines.append(
            f"- {a.get('date')}: スコア={s.get('overall_score', '-')}, "
            f"生産的={s.get('productive_hours', '-')}h, "
            f"無駄={s.get('wasted_hours', '-')}h"
        )
    return "\n".join(lines)


def _format_monthly_summary(summary: dict) -> str:
    """月次サマリーをテキストに変換"""
    if not summary:
        return "（月次サマリーはまだありません）"
    parts = [f"期間: {summary.get('period', '不明')}"]

    patterns = summary.get("top_patterns", [])
    if patterns:
        for p in patterns:
            parts.append(f"- パターン: {p.get('pattern')} (頻度{p.get('frequency')}回, 傾向: {p.get('trend')})")

    insights = summary.get("key_insights", [])
    if insights:
        parts.append("主な気づき:")
        for i in insights:
            parts.append(f"  - {i}")

    return "\n".join(parts)


async def build_coaching_context(user_message: str) -> dict:
    """
    ユーザーの質問/相談内容に応じて、最適なコンテキストを構築する。
    """
    context = {}

    # 1. 直近7日の日次分析サマリー
    from utils.helpers import today_jst
    today = today_jst()
    context["recent_week"] = firestore_service.get_past_analyses(today, days=7)

    # 2. アクティブなエンティティ上位20件
    context["active_entities"] = firestore_service.list_entities(status="active", limit=20)

    # 3. 強い関係性（strength >= 0.6）上位10件
    context["strong_relations"] = firestore_service.list_relations(min_strength=0.6, limit=10)

    # 4. 最新の月次サマリー
    context["latest_monthly"] = firestore_service.get_latest_coaching_summary()

    # 5. テーマ別の追加データ
    theme_entities = []
    if _contains_keywords(user_message, THEME_KEYWORDS["food"]):
        theme_entities += firestore_service.list_entities(entity_type="behavior_pattern", limit=10)
        theme_entities += firestore_service.list_entities(entity_type="habit", limit=10)
    if _contains_keywords(user_message, THEME_KEYWORDS["work"]):
        theme_entities += firestore_service.list_entities(entity_type="goal", limit=10)
        theme_entities += firestore_service.list_entities(entity_type="strength", limit=10)
        theme_entities += firestore_service.list_entities(entity_type="weakness", limit=10)
    if _contains_keywords(user_message, THEME_KEYWORDS["mental"]):
        theme_entities += firestore_service.list_entities(entity_type="emotion_pattern", limit=10)
        theme_entities += firestore_service.list_entities(entity_type="trigger", limit=10)

    if theme_entities:
        # 重複排除
        seen = set()
        unique = []
        for e in theme_entities:
            eid = e.get("id", "")
            if eid not in seen:
                seen.add(eid)
                unique.append(e)
        context["theme_entities"] = unique

    return context


async def generate_coaching_reply(
    user_message: str,
    conversation_history: list[dict],
) -> dict:
    """
    コーチングチャットの返答を生成する。

    Returns:
        {"reply": str, "referenced_patterns": list, "suggested_action": str}
    """
    # コンテキスト構築
    context = await build_coaching_context(user_message)

    # システムプロンプトにデータ注入
    all_entities = context.get("active_entities", [])
    theme_entities = context.get("theme_entities", [])
    if theme_entities:
        # テーマ別エンティティを優先表示
        seen_ids = {e.get("id") for e in theme_entities}
        for e in all_entities:
            if e.get("id") not in seen_ids:
                theme_entities.append(e)
        all_entities = theme_entities

    system_prompt = COACHING_SYSTEM_PROMPT.format(
        active_entities_formatted=_format_entities(all_entities[:20]),
        strong_relations_formatted=_format_relations(context.get("strong_relations", [])),
        recent_week_formatted=_format_recent_week(context.get("recent_week", [])),
        latest_monthly_formatted=_format_monthly_summary(context.get("latest_monthly")),
    )

    user_prompt = build_coaching_user_prompt(user_message, conversation_history)

    client = get_client()
    response = _call_claude_with_retry(
        client,
        model=COACHING_MODEL,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw_text = response.content[0].text

    try:
        result = _extract_json(raw_text)
        return {
            "reply": result.get("reply", raw_text),
            "referenced_patterns": result.get("referenced_patterns", []),
            "suggested_action": result.get("suggested_action", ""),
        }
    except Exception:
        # JSONパースに失敗した場合はテキストをそのまま返す
        return {
            "reply": raw_text,
            "referenced_patterns": [],
            "suggested_action": "",
        }
