"""
コーチングサービス
直近の分析データと月次サマリーを活用したパーソナルコーチング
"""

import logging

from services import firestore_service
from services.claude_service import get_client, _call_claude_with_retry, _extract_json
from prompts.coaching import COACHING_SYSTEM_PROMPT, build_coaching_user_prompt

logger = logging.getLogger(__name__)

# コーチングは Sonnet を使用（仕様指定）
COACHING_MODEL = "claude-sonnet-4-6"


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
    ユーザーの質問/相談内容に応じて、コンテキストを構築する。
    """
    context = {}

    # 直近7日の日次分析サマリー
    from utils.helpers import today_jst
    today = today_jst()
    context["recent_week"] = firestore_service.get_past_analyses(today, days=7)

    # 最新の月次サマリー
    context["latest_monthly"] = firestore_service.get_latest_coaching_summary()

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
    context = await build_coaching_context(user_message)

    system_prompt = COACHING_SYSTEM_PROMPT.format(
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
