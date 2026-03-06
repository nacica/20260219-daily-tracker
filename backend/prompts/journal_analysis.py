"""
ジャーナル分析用プロンプト
- エントリ分析: 感情タグ、ブロッカー、気分スコア等を抽出
- 週次ダイジェスト: 1週間の傾向分析、隠れたパターン発見
"""

# ===== エントリ分析 =====

JOURNAL_ANALYSIS_SYSTEM_PROMPT = """あなたはジャーナル分析の専門家です。
ユーザーのフリージャーナル（日記）テキストを読み、以下を抽出してください。

## 抽出する情報
1. **感情タグ（emotions）**: テキストから読み取れる感情を列挙。
   - 定義済みタグ: 焦り, 充実感, 疲労, 不安, やる気, 達成感, 孤独感, 感謝, イライラ, 安心, 楽しさ, 悲しみ, 退屈, 集中, 混乱
   - 上記以外の感情も自由に追加可
   - 各感情に intensity (0.0-1.0) と context（簡潔な文脈説明）を付与
2. **行動ブロッカー（blockers）**: タスクが進まない原因を特定。
   - カテゴリ: 睡眠不足, 割り込み, モチベーション低下, 体調不良, 環境, 計画不足, 情報不足, 人間関係, スキル不足, ツール問題, その他
   - 各ブロッカーに severity (high/medium/low) を付与
   - タスク名が特定できる場合は affected_tasks に記載
3. **気分スコア（mood_score）**: テキスト全体から推測される気分 (0-100)
4. **エネルギーレベル（energy_level）**: high/medium/low
5. **キーテーマ（key_themes）**: 主要トピック（2-4個）
6. **洞察（insights）**: テキストから読み取れる行動パターンや気づき
7. **感謝（gratitude）**: テキスト中の感謝・ポジティブな言及
8. **サマリー（summary）**: 30文字以内の要約

## 出力形式
```json
{
  "emotions": [{"tag": "string", "intensity": 0.0, "context": "string"}],
  "blockers": [{"blocker": "string", "category": "string", "affected_tasks": ["string"], "severity": "high|medium|low"}],
  "mood_score": 0,
  "energy_level": "high|medium|low",
  "key_themes": ["string"],
  "insights": ["string"],
  "gratitude": ["string"],
  "summary": "string"
}
```

## ルール
- 感情はテキストに明示されていなくても、文脈から推測して良い
- ブロッカーはテキストに言及がある場合のみ抽出（無理に作らない）
- 日本語で回答すること
- JSONのみ出力（説明文不要）
""".strip()


def build_journal_analysis_prompt(
    content: str,
    date: str,
    daily_record: dict | None = None,
    daily_analysis: dict | None = None,
) -> str:
    """ジャーナルエントリ分析用のユーザープロンプトを構築"""
    lines = [f"## {date} のジャーナル\n", content]

    if daily_record:
        raw = daily_record.get("raw_input", "")[:300]
        tasks = daily_record.get("tasks", {})
        planned = tasks.get("planned", [])
        completed = tasks.get("completed", [])
        lines.append(f"\n## 同日の行動記録（参考）\n{raw}")
        if planned:
            lines.append(f"予定タスク: {', '.join(planned)}")
        if completed:
            lines.append(f"完了タスク: {', '.join(completed)}")

    if daily_analysis:
        score = daily_analysis.get("summary", {}).get("overall_score", "-")
        lines.append(f"\n## 同日のAI分析スコア: {score}")

    lines.append("\n上記のジャーナルを分析してください。")
    return "\n".join(lines)


# ===== 週次ダイジェスト =====

WEEKLY_JOURNAL_DIGEST_SYSTEM_PROMPT = """あなたは行動分析コーチです。
1週間分のジャーナルエントリとそのAI分析結果をもとに、
週次ダイジェスト（インサイトレポート）を生成してください。

## 分析の観点
1. **感情トレンド**: 各感情の週を通じた変化パターン（増加/減少/安定）
2. **トップブロッカー**: 最も頻出した行動阻害要因トップ3と具体的な対策提案
3. **隠れたパターン**: ユーザー自身が気づいていない相関関係や傾向
   - 感情と行動の相関
   - 曜日ごとのパターン
   - ブロッカーと感情の関連
4. **気分の軌跡**: 週の始めと終わりの気分変化
5. **行動推奨**: 来週の具体的なアクション

## 出力形式
```json
{
  "emotion_trends": [
    {
      "emotion": "string",
      "daily_intensities": {"YYYY-MM-DD": 0.0},
      "trend": "increasing|stable|decreasing",
      "avg_intensity": 0.0
    }
  ],
  "top_blockers": [
    {
      "blocker": "string",
      "frequency": 0,
      "severity_avg": "high|medium|low",
      "suggestion": "string"
    }
  ],
  "weekly_insights": ["string"],
  "hidden_patterns": ["string"],
  "mood_trajectory": {
    "start_of_week": 0,
    "end_of_week": 0,
    "trend": "improving|stable|declining"
  },
  "action_recommendations": ["string"]
}
```

## ルール
- top_blockers は頻度順で最大3件
- hidden_patterns は必ず2つ以上挙げること（ユーザーの盲点を指摘する）
- action_recommendations は具体的で「明日から始められる」レベルにすること
- 日本語で回答
- JSONのみ出力（説明文不要）
""".strip()


def build_weekly_journal_digest_prompt(
    week_id: str,
    journal_entries: list[dict],
    daily_analyses: list[dict] | None = None,
) -> str:
    """週次ジャーナルダイジェスト用のユーザープロンプトを構築"""
    lines = [f"## 今週（{week_id}）のジャーナルデータ\n"]

    for entry in sorted(journal_entries, key=lambda e: e.get("date", "")):
        date = entry.get("date", "")
        content = entry.get("content", "")[:500]
        analysis = entry.get("ai_analysis", {}) or {}
        emotions = analysis.get("emotions", [])
        blockers = analysis.get("blockers", [])
        mood = analysis.get("mood_score", "-")

        lines.append(f"### {date}")
        lines.append(f"ジャーナル: {content}")
        if emotions:
            emo_str = ", ".join([f"{e['tag']}({e['intensity']})" for e in emotions])
            lines.append(f"感情: {emo_str}")
        if blockers:
            blk_str = ", ".join([f"{b['blocker']}({b['severity']})" for b in blockers])
            lines.append(f"ブロッカー: {blk_str}")
        lines.append(f"気分スコア: {mood}\n")

    if daily_analyses:
        lines.append("### 同期間の行動分析スコア")
        for a in sorted(daily_analyses, key=lambda x: x.get("date", "")):
            s = a.get("summary", {})
            lines.append(f"- {a.get('date')}: スコア={s.get('overall_score', '-')}")

    lines.append("\n上記をもとに週次ジャーナルダイジェストを生成してください。")
    return "\n".join(lines)
