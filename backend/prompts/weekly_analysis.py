"""
週次分析プロンプト
1週間分のデータをもとに深い分析と来週の改善プランを生成する
"""

WEEKLY_ANALYSIS_SYSTEM_PROMPT = """
あなたは行動改善コーチです。1週間分の行動データと日次分析をもとに、
深い分析と来週の具体的な改善プランを提案してください。

## 分析の深さ
日次分析よりも深く掘り下げてください：
1. **週全体のパターン**: 曜日ごとの傾向、エネルギーレベルの変動
2. **最大の時間泥棒**: 何に最も時間を奪われたか、そのトリガーは何か
3. **認知パターン分析**: 繰り返し現れる思考の癖（完璧主義、先延ばし、自己正当化など）
4. **改善提案の実行状況**: 先週の提案を実行できたか、できなかった理由は何か
5. **来週の行動プラン**: 具体的で達成可能なアクション
6. **習慣形成**: 定着させるべきルーティン提案

## 出力形式
以下の JSON 形式で出力してください。コードブロック（```json）で囲むこと。

```json
{
  "weekly_summary": {
    "avg_productive_hours": <number>,
    "avg_wasted_hours": <number>,
    "avg_task_completion_rate": <0.0-1.0>,
    "total_youtube_hours": <number>,
    "avg_overall_score": <0-100>,
    "score_trend": "improving|declining|stable"
  },
  "deep_analysis": {
    "weekly_pattern": "string（週全体のパターン説明）",
    "biggest_time_wasters": [
      { "activity": "string", "total_hours": <number>, "trigger": "string" }
    ],
    "cognitive_patterns": ["string"],
    "improvement_plan": {
      "next_week_goals": ["string"],
      "concrete_actions": ["string"],
      "habit_building": ["string"]
    },
    "progress_vs_last_week": {
      "improved": ["string"],
      "declined": ["string"],
      "unchanged": ["string"]
    }
  }
}
```

## 重要なルール
- 日次分析より深く、週単位の視点で根本原因を掘り下げること
- 認知パターンは心理学的観点から具体的に説明すること
- 来週の目標は3つ以内に絞り、必ず達成可能なものにすること
- concrete_actions は「今夜から始められる」レベルの具体性にすること
- 過去データがない場合でも、今週のデータだけで最善の分析を行うこと
""".strip()


def build_weekly_analysis_prompt(
    week_id: str,
    daily_records: list[dict],
    daily_analyses: list[dict],
    last_week_analysis: dict | None = None,
) -> str:
    """
    週次分析のユーザープロンプトを構築する

    Args:
        week_id: 週 ID (YYYY-Www)
        daily_records: 今週の行動記録リスト
        daily_analyses: 今週の日次分析リスト
        last_week_analysis: 先週の週次分析（任意）

    Returns:
        ユーザープロンプト文字列
    """
    lines = [f"## 今週（{week_id}）のデータ\n"]

    # 日別サマリー
    lines.append("### 日別スコアと概要")
    for record in sorted(daily_records, key=lambda r: r.get("date", "")):
        date = record.get("date", "")
        analysis = next(
            (a for a in daily_analyses if a.get("date") == date), None
        )
        if analysis:
            s = analysis.get("summary", {})
            score = s.get("overall_score", "-")
            productive = s.get("productive_hours", 0)
            wasted = s.get("wasted_hours", 0)
            youtube = s.get("youtube_hours", 0)
            task_rate = int((s.get("task_completion_rate") or 0) * 100)
            lines.append(
                f"- {date}: スコア={score}, 生産的={productive}h, "
                f"無駄={wasted}h, YouTube={youtube}h, タスク完了={task_rate}%"
            )
            # 悪かった点を追加
            bad = analysis.get("analysis", {}).get("bad_points", [])
            if bad:
                lines.append(f"  → 問題点: {', '.join(bad[:2])}")
        else:
            raw = record.get("raw_input", "")[:100]
            lines.append(f"- {date}: 分析なし（行動記録: {raw}...）")

    # スクリーンタイムデータ
    all_apps: dict[str, int] = {}
    for record in daily_records:
        st = record.get("screen_time") or {}
        for app in st.get("apps", []):
            name = app.get("name", "")
            mins = app.get("duration_minutes", 0)
            all_apps[name] = all_apps.get(name, 0) + mins

    if all_apps:
        lines.append("\n### 週間スクリーンタイム（アプリ別合計）")
        for app_name, total_mins in sorted(all_apps.items(), key=lambda x: -x[1]):
            h = total_mins // 60
            m = total_mins % 60
            lines.append(f"- {app_name}: {h}時間{m}分")

    # 先週の週次分析（比較用）
    if last_week_analysis:
        lines.append("\n### 先週（参考）")
        s = last_week_analysis.get("weekly_summary", {})
        lines.append(
            f"- 平均スコア: {s.get('avg_overall_score', '-')}, "
            f"スコアトレンド: {s.get('score_trend', '-')}"
        )
        plan = last_week_analysis.get("deep_analysis", {}).get("improvement_plan", {})
        goals = plan.get("next_week_goals", [])
        if goals:
            lines.append(f"- 先週立てた目標: {', '.join(goals)}")

    lines.append("\n上記のデータをもとに深い週次分析を行ってください。")
    return "\n".join(lines)
