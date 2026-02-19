"""
Claude API サービス
行動記録の分析・構造化に Claude API を使用する
"""

import os
import json
import anthropic
from prompts.daily_analysis import DAILY_ANALYSIS_SYSTEM_PROMPT, build_daily_analysis_prompt
from prompts.weekly_analysis import WEEKLY_ANALYSIS_SYSTEM_PROMPT, build_weekly_analysis_prompt


def get_client() -> anthropic.Anthropic:
    """Anthropic クライアントを返す"""
    return anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def generate_daily_analysis(
    record: dict,
    past_records: list[dict] = None,
    past_analyses: list[dict] = None,
) -> dict:
    """
    日次分析を生成する
    Claude API を呼び出し、構造化された分析結果を返す

    Args:
        record: 当日の行動記録
        past_records: 過去の行動記録リスト
        past_analyses: 過去の分析結果リスト

    Returns:
        分析結果の辞書
    """
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    screen_time = record.get("screen_time")
    user_prompt = build_daily_analysis_prompt(
        record=record,
        screen_time=screen_time,
        past_records=past_records or [],
        past_analyses=past_analyses or [],
    )

    # ストリーミングで呼び出し（タイムアウト対策）
    with client.messages.stream(
        model=model,
        max_tokens=4096,
        system=DAILY_ANALYSIS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    ) as stream:
        response = stream.get_final_message()

    raw_text = response.content[0].text

    # JSON ブロックを抽出してパース
    analysis_data = _extract_json(raw_text)
    return analysis_data


def parse_activities(raw_input: str, date: str) -> list[dict]:
    """
    ユーザーの自由記述テキストから行動リストを構造化する

    Args:
        raw_input: ユーザーが入力した生テキスト
        date: 日付 (YYYY-MM-DD)

    Returns:
        構造化された行動リスト
    """
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    system_prompt = """ユーザーの行動記録テキストを解析し、構造化されたJSONリストに変換してください。

出力形式（JSONリストのみ。説明文不要）:
[
  {
    "start_time": "HH:MM",
    "end_time": "HH:MM または null",
    "activity": "行動の簡潔な説明",
    "category": "生活|仕事|勉強|娯楽|無駄時間|運動",
    "is_productive": true または false
  }
]

カテゴリの定義:
- 生活: 食事・睡眠・入浴・家事など
- 仕事: 業務・メール・会議など
- 勉強: 学習・読書・スキルアップ
- 娯楽: 映画・ゲーム・趣味（適度なら可）
- 無駄時間: YouTube長時間視聴・SNSダラダラ・無目的なサーフィン
- 運動: ジム・ウォーキング・スポーツ

is_productive:
- 生活・仕事・勉強・運動 → true
- 娯楽（1時間以内）→ true
- 娯楽（1時間超）・無駄時間 → false"""

    with client.messages.stream(
        model=model,
        max_tokens=2048,
        system=system_prompt,
        messages=[
            {
                "role": "user",
                "content": f"以下の{date}の行動記録を構造化してください:\n\n{raw_input}",
            }
        ],
    ) as stream:
        response = stream.get_final_message()

    raw_text = response.content[0].text
    activities = _extract_json(raw_text)

    # リストが返ってこない場合は空リストを返す
    if not isinstance(activities, list):
        return []
    return activities


def generate_weekly_analysis(
    week_id: str,
    daily_records: list[dict],
    daily_analyses: list[dict],
    last_week_analysis: dict | None = None,
) -> dict:
    """
    週次分析を生成する

    Args:
        week_id: 週 ID (YYYY-Www)
        daily_records: 今週の行動記録リスト
        daily_analyses: 今週の日次分析リスト
        last_week_analysis: 先週の週次分析（任意）

    Returns:
        週次分析結果の辞書
    """
    client = get_client()
    model = os.getenv("WEEKLY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    user_prompt = build_weekly_analysis_prompt(
        week_id=week_id,
        daily_records=daily_records,
        daily_analyses=daily_analyses,
        last_week_analysis=last_week_analysis,
    )

    with client.messages.stream(
        model=model,
        max_tokens=6144,
        system=WEEKLY_ANALYSIS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    ) as stream:
        response = stream.get_final_message()

    raw_text = response.content[0].text
    return _extract_json(raw_text)


def _extract_json(text: str) -> dict | list:
    """
    テキストから JSON を抽出してパースする
    コードブロック（```json ... ```）も対応
    """
    # ```json ... ``` ブロックを優先して抽出
    if "```json" in text:
        start = text.index("```json") + 7
        end = text.index("```", start)
        text = text[start:end].strip()
    elif "```" in text:
        start = text.index("```") + 3
        end = text.index("```", start)
        text = text[start:end].strip()

    # JSON 部分だけ抽出（{ または [ から始まる部分）
    for i, ch in enumerate(text):
        if ch in ("{", "["):
            text = text[i:]
            break

    return json.loads(text)
