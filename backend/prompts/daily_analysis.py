"""
日次分析プロンプト
Claude API に渡すシステムプロンプトとユーザープロンプトのビルダー
"""

from utils.helpers import format_screen_time, format_past_data


DAILY_ANALYSIS_SYSTEM_PROMPT = """
あなたは行動分析の専門家です。ユーザーの1日の行動記録を分析し、
具体的で実行可能な改善提案を行ってください。

## 分析の観点
1. **時間の使い方**: 生産的な時間 vs 非生産的な時間の比率
2. **タスク完了度**: 予定していたタスクの達成率
3. **無駄時間の特定**: YouTube、SNS、ダラダラした時間の詳細
4. **行動パターン**: いつ、何がトリガーで非生産的な行動に陥ったか
5. **思考の弱み**: 先延ばし、完璧主義、楽観バイアスなどの認知パターン
6. **行動の弱み**: 環境設計の問題、習慣の問題
7. **過去との比較**: 提供された過去データとの比較（改善点・悪化点）

## 出力形式
以下の JSON 形式で出力してください。日本語で記述すること。
コードブロック（```json）で囲むこと。

```json
{
  "summary": {
    "productive_hours": <number>,
    "wasted_hours": <number>,
    "youtube_hours": <number>,
    "task_completion_rate": <0.0-1.0>,
    "overall_score": <0-100>
  },
  "analysis": {
    "good_points": ["string"],
    "bad_points": ["string"],
    "root_causes": ["string"],
    "thinking_weaknesses": ["string"],
    "behavior_weaknesses": ["string"],
    "improvement_suggestions": [
      {
        "suggestion": "string",
        "priority": "high|medium|low",
        "category": "タスク管理|環境設計|習慣形成|メンタル|その他"
      }
    ],
    "comparison_with_past": {
      "recurring_patterns": ["string"],
      "improvements_from_last_week": ["string"]
    }
  }
}
```

## 重要なルール
- 抽象的なアドバイスではなく、具体的で明日から実行できる提案をすること
- ダメ出しだけでなく、良かった点も必ず挙げること
- 過去データがある場合、繰り返しパターンを必ず指摘すること
- スクリーンタイムデータがある場合、アプリ別の使用時間を分析に含めること
- 改善提案は優先度付きで3〜5個に絞ること
- overall_score の基準: 70以上=良い日、40-69=普通、39以下=改善が必要
- **活動可能時間が申告されている場合**: その時間を前提に生産性を評価すること。
  例えば残業で帰宅が遅く可処分時間が2時間しかない日に1.5時間勉強できていれば、
  絶対時間は短くても高評価（75%活用）とすること。フルに時間がある日と同じ基準で
  減点してはならない。
""".strip()


def build_daily_analysis_prompt(
    record: dict,
    screen_time: dict | None,
    past_records: list[dict],
    past_analyses: list[dict],
) -> str:
    """
    日次分析のユーザープロンプトを構築する

    Args:
        record: 当日の行動記録
        screen_time: スクリーンタイムデータ（任意）
        past_records: 過去の行動記録リスト
        past_analyses: 過去の分析結果リスト

    Returns:
        ユーザープロンプト文字列
    """
    date = record.get("date", "不明")
    raw_input = record.get("raw_input", "")
    tasks = record.get("tasks", {})
    tasks_planned = tasks.get("planned", [])
    tasks_completed = tasks.get("completed", [])

    available_hours = record.get("available_hours")

    prompt = f"""## 本日の行動記録（{date}）
{f"""
### 活動可能時間
{available_hours}時間（ユーザー申告。この時間を前提に生産性を評価してください）
""" if available_hours is not None else ""}
### ユーザー入力
{raw_input}

### 予定タスク
{', '.join(tasks_planned) if tasks_planned else 'なし'}

### 完了タスク
{', '.join(tasks_completed) if tasks_completed else 'なし'}
"""

    if screen_time and screen_time.get("apps"):
        prompt += f"""
### スクリーンタイム（iPhone）
{format_screen_time(screen_time)}
"""

    if past_records:
        prompt += f"""
## 過去データ（参考）
{format_past_data(past_records, past_analyses)}
"""

    prompt += "\n上記のデータをもとに分析してください。"
    return prompt
