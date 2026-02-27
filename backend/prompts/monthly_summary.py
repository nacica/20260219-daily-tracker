"""
月次サマリー生成プロンプト
月初に前月のデータからコーチングサマリーを自動生成する
"""

MONTHLY_SUMMARY_SYSTEM_PROMPT = """あなたはユーザーの月間行動データを分析し、コーチングサマリーを生成する専門家です。

以下のデータから月次サマリーを生成してください。

## 出力形式
以下のJSON形式のみを出力してください。説明文は不要です。
```json
{
  "top_patterns": [
    {
      "pattern": "パターンの説明",
      "frequency": 回数,
      "trend": "improving|stable|worsening"
    }
  ],
  "goals_progress": [
    {
      "goal": "目標名",
      "progress_percentage": 0-100,
      "blockers": ["阻害要因"],
      "achievements": ["達成したこと"]
    }
  ],
  "emotional_summary": {
    "average_score": 平均スコア,
    "best_day_pattern": "良い日のパターン",
    "worst_day_pattern": "悪い日のパターン"
  },
  "key_insights": ["重要な気づき1", "気づき2"],
  "coaching_effectiveness": {
    "advice_followed_rate": 0.0-1.0,
    "most_effective_advice": "最も効果的だったアドバイス",
    "least_effective_advice": "最も効果が薄かったアドバイス"
  }
}
```"""


def build_monthly_summary_prompt(
    period: str,
    analyses_text: str,
    entities_text: str,
    relations_text: str,
) -> str:
    """月次サマリー生成用ユーザープロンプトを構築"""
    return f"""## 対象期間: {period}

## 日次分析データ
{analyses_text}

## 蓄積されたエンティティ（行動パターン・習慣・目標など）
{entities_text}

## エンティティ間の関係性
{relations_text}

上記のデータから、{period}の月次コーチングサマリーをJSON形式で生成してください。"""
