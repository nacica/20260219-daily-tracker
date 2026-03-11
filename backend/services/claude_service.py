"""
Claude API サービス
行動記録の分析・構造化に Claude API を使用する
"""

import os
import json
import time
import logging
import anthropic
from prompts.daily_analysis import DAILY_ANALYSIS_SYSTEM_PROMPT, build_daily_analysis_prompt
from prompts.weekly_analysis import WEEKLY_ANALYSIS_SYSTEM_PROMPT, build_weekly_analysis_prompt
from prompts.socratic_dialogue import (
    SOCRATIC_QUESTION_SYSTEM_PROMPT, build_socratic_question_prompt,
    SOCRATIC_FOLLOWUP_SYSTEM_PROMPT, build_socratic_followup_prompt,
    SOCRATIC_SYNTHESIS_SYSTEM_PROMPT, build_socratic_synthesis_prompt,
)
from prompts.morning_planning import (
    MORNING_QUESTION_SYSTEM_PROMPT, build_morning_question_prompt,
    MORNING_FOLLOWUP_SYSTEM_PROMPT, build_morning_followup_prompt,
    MORNING_SYNTHESIS_SYSTEM_PROMPT, build_morning_synthesis_prompt,
)
from prompts.diary_dialogue import (
    DIARY_QUESTION_SYSTEM_PROMPT, build_diary_question_prompt,
    DIARY_FOLLOWUP_SYSTEM_PROMPT, build_diary_followup_prompt,
    DIARY_SYNTHESIS_SYSTEM_PROMPT, build_diary_synthesis_prompt,
)
from prompts.journal_analysis import (
    JOURNAL_ANALYSIS_SYSTEM_PROMPT, build_journal_analysis_prompt,
    WEEKLY_JOURNAL_DIGEST_SYSTEM_PROMPT, build_weekly_journal_digest_prompt,
)

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
INITIAL_BACKOFF = 2  # seconds


def get_client() -> anthropic.Anthropic:
    """Anthropic クライアントを返す"""
    return anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 529}


def _call_claude_with_retry(client, **kwargs):
    """
    Claude API をリトライ付きで呼び出す。
    overloaded(529) / rate_limit(429) / 5xx エラー時に指数バックオフでリトライ。
    """
    for attempt in range(MAX_RETRIES):
        try:
            with client.messages.stream(**kwargs) as stream:
                return stream.get_final_message()
        except anthropic.APIConnectionError as e:
            if attempt == MAX_RETRIES - 1:
                raise
            wait = INITIAL_BACKOFF * (2 ** attempt)
            logger.warning(
                "Claude API 接続エラー (attempt %d/%d): %s. %d秒後にリトライ...",
                attempt + 1, MAX_RETRIES, e, wait,
            )
            time.sleep(wait)
        except anthropic.APIStatusError as e:
            if e.status_code not in RETRYABLE_STATUS_CODES:
                raise
            if attempt == MAX_RETRIES - 1:
                raise
            wait = INITIAL_BACKOFF * (2 ** attempt)
            logger.warning(
                "Claude API HTTP %d エラー (attempt %d/%d): %s. %d秒後にリトライ...",
                e.status_code, attempt + 1, MAX_RETRIES, e, wait,
            )
            time.sleep(wait)


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

    # リトライ付きで呼び出し（overloaded / rate_limit 対策）
    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=4096,
        system=DAILY_ANALYSIS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

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

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=2048,
        system=system_prompt,
        messages=[
            {
                "role": "user",
                "content": f"以下の{date}の行動記録を構造化してください:\n\n{raw_input}",
            }
        ],
    )

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

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=6144,
        system=WEEKLY_ANALYSIS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw_text = response.content[0].text
    return _extract_json(raw_text)


def generate_socratic_questions(
    record: dict,
    past_records: list[dict] = None,
    past_analyses: list[dict] = None,
) -> str:
    """ソクラテス式の振り返り質問を生成する（テキスト返却）"""
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    screen_time = record.get("screen_time")
    user_prompt = build_socratic_question_prompt(
        record=record,
        screen_time=screen_time,
        past_records=past_records or [],
        past_analyses=past_analyses or [],
    )

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=1024,
        system=SOCRATIC_QUESTION_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    return response.content[0].text


def generate_socratic_followup(
    record: dict,
    messages: list[dict],
    turn_count: int,
    max_turns: int,
) -> str:
    """ソクラテス式対話のフォローアップ応答を生成する（テキスト返却）"""
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    user_prompt = build_socratic_followup_prompt(
        record=record,
        messages=messages,
        turn_count=turn_count,
        max_turns=max_turns,
    )

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=1024,
        system=SOCRATIC_FOLLOWUP_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    return response.content[0].text


def generate_dialogue_synthesis(
    record: dict,
    messages: list[dict],
    past_records: list[dict] = None,
    past_analyses: list[dict] = None,
) -> dict:
    """対話＋データから共創された分析を生成する（JSON返却）"""
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    screen_time = record.get("screen_time")
    user_prompt = build_socratic_synthesis_prompt(
        record=record,
        messages=messages,
        screen_time=screen_time,
        past_records=past_records or [],
        past_analyses=past_analyses or [],
    )

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=4096,
        system=SOCRATIC_SYNTHESIS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw_text = response.content[0].text
    return _extract_json(raw_text)


def generate_morning_questions(
    yesterday_record: dict | None,
    yesterday_analysis: dict | None,
    incomplete_tasks: list[str] = None,
    active_goals: list[dict] = None,
    backlog_tasks: list[str] = None,
) -> str:
    """朝のプランニング問答の初期質問を生成する（テキスト返却）"""
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    user_prompt = build_morning_question_prompt(
        yesterday_record=yesterday_record,
        yesterday_analysis=yesterday_analysis,
        incomplete_tasks=incomplete_tasks or [],
        active_goals=active_goals or [],
        backlog_tasks=backlog_tasks or [],
    )

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=1024,
        system=MORNING_QUESTION_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    return response.content[0].text


def generate_morning_followup(
    yesterday_record: dict | None,
    yesterday_analysis: dict | None,
    incomplete_tasks: list[str],
    messages: list[dict],
    turn_count: int,
    max_turns: int,
) -> str:
    """朝問答のフォローアップ応答を生成する（テキスト返却）"""
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    user_prompt = build_morning_followup_prompt(
        yesterday_record=yesterday_record,
        yesterday_analysis=yesterday_analysis,
        incomplete_tasks=incomplete_tasks,
        messages=messages,
        turn_count=turn_count,
        max_turns=max_turns,
    )

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=1024,
        system=MORNING_FOLLOWUP_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    return response.content[0].text


def generate_morning_synthesis(
    yesterday_record: dict | None,
    yesterday_analysis: dict | None,
    incomplete_tasks: list[str],
    messages: list[dict],
) -> dict:
    """朝問答から今日のプランを生成する（JSON返却）"""
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    user_prompt = build_morning_synthesis_prompt(
        yesterday_record=yesterday_record,
        yesterday_analysis=yesterday_analysis,
        incomplete_tasks=incomplete_tasks,
        messages=messages,
    )

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=4096,
        system=MORNING_SYNTHESIS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw_text = response.content[0].text
    return _extract_json(raw_text)


def generate_diary_questions(date: str) -> str:
    """日記入力用の初期質問を生成する（テキスト返却）"""
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    user_prompt = build_diary_question_prompt(date=date)

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=1024,
        system=DIARY_QUESTION_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    return response.content[0].text


def generate_diary_followup(
    date: str,
    messages: list[dict],
    turn_count: int,
    max_turns: int,
) -> str:
    """日記入力対話のフォローアップ応答を生成する（テキスト返却）"""
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    user_prompt = build_diary_followup_prompt(
        date=date,
        messages=messages,
        turn_count=turn_count,
        max_turns=max_turns,
    )

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=1024,
        system=DIARY_FOLLOWUP_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    return response.content[0].text


def generate_diary_synthesis(
    date: str,
    messages: list[dict],
) -> dict:
    """対話から行動ログテキストを生成する（JSON返却）"""
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    user_prompt = build_diary_synthesis_prompt(
        date=date,
        messages=messages,
    )

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=4096,
        system=DIARY_SYNTHESIS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw_text = response.content[0].text
    return _extract_json(raw_text)


def analyze_journal_entry(
    content: str,
    date: str,
    daily_record: dict | None = None,
    daily_analysis: dict | None = None,
) -> dict:
    """
    ジャーナルエントリを分析し、感情タグ・ブロッカー等を返す
    """
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    user_prompt = build_journal_analysis_prompt(
        content=content,
        date=date,
        daily_record=daily_record,
        daily_analysis=daily_analysis,
    )

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=4096,
        system=JOURNAL_ANALYSIS_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    return _extract_json(response.content[0].text)


def summarize_journal_as_markdown(content: str) -> str:
    """
    ジャーナル内容をマークダウン形式で要約する
    """
    client = get_client()
    model = os.getenv("DAILY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    system_prompt = (
        "あなたは日記の要約を作成するアシスタントです。"
        "ユーザーの日記テキストを読み、内容をマークダウン形式で構造化して要約してください。"
        "見出し(##)、箇条書き(-)、太字(**)などを活用し、読みやすくまとめてください。"
        "要約は日本語で、元の内容の要点を漏らさず、簡潔にまとめてください。"
        "マークダウンのみを出力し、余計な前置きや説明は不要です。"
    )

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=2048,
        system=system_prompt,
        messages=[{"role": "user", "content": content}],
    )

    return response.content[0].text


def generate_weekly_journal_digest(
    week_id: str,
    journal_entries: list[dict],
    daily_analyses: list[dict] | None = None,
) -> dict:
    """
    週次ジャーナルダイジェストを生成する
    """
    client = get_client()
    model = os.getenv("WEEKLY_ANALYSIS_MODEL", "claude-sonnet-4-6")

    user_prompt = build_weekly_journal_digest_prompt(
        week_id=week_id,
        journal_entries=journal_entries,
        daily_analyses=daily_analyses,
    )

    response = _call_claude_with_retry(
        client,
        model=model,
        max_tokens=4096,
        system=WEEKLY_JOURNAL_DIGEST_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    return _extract_json(response.content[0].text)


def _extract_json(text: str) -> dict | list:
    """
    テキストから JSON を抽出してパースする
    コードブロック（```json ... ```）も対応
    閉じ ``` が無い場合でも末尾まで取得してパースを試みる
    """
    # ```json ... ``` ブロックを優先して抽出
    if "```json" in text:
        start = text.index("```json") + 7
        try:
            end = text.index("```", start)
            text = text[start:end].strip()
        except ValueError:
            # 閉じ ``` が無い場合は末尾まで取得
            text = text[start:].strip()
    elif "```" in text:
        start = text.index("```") + 3
        try:
            end = text.index("```", start)
            text = text[start:end].strip()
        except ValueError:
            text = text[start:].strip()

    # JSON 部分だけ抽出（{ または [ から始まる部分）
    for i, ch in enumerate(text):
        if ch in ("{", "["):
            text = text[i:]
            break

    # 末尾の不完全なテキストを除去（閉じ括弧で終わるようにする）
    # JSON が途中で切れている場合に対応
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # 末尾にゴミがある場合: 最後の } または ] を探す
        for j in range(len(text) - 1, -1, -1):
            if text[j] in ("}", "]"):
                try:
                    return json.loads(text[: j + 1])
                except json.JSONDecodeError:
                    continue
        raise ValueError(f"有効な JSON が見つかりません: {text[:200]}")
