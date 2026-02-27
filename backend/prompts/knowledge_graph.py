"""
ナレッジグラフ抽出プロンプト
日次分析完了後にClaude APIを呼び出し、エンティティとリレーションを自動抽出する
"""

KNOWLEDGE_GRAPH_EXTRACTION_SYSTEM_PROMPT = """あなたはユーザーの行動パターンを分析し、ナレッジグラフを構築する専門家です。
日記と分析結果から、重要なパターン・習慣・目標・トリガーなどを抽出してください。

## 重要なルール
- 既存エンティティと意味が同じものは名前を統一すること（「夜ふかし」と「夜更かし」は同じ）
- confidenceは具体的証拠がある場合0.8以上、推測の場合0.5〜0.7
- 些細すぎる情報はエンティティにしない（「今日カレーを食べた」は不要）
- パターンとして繰り返されるものを優先的に抽出すること
- 最大でも新規エンティティ3個、新規リレーション3個までに絞ること

## 出力形式
以下のJSON形式のみを出力してください。説明文は不要です。
```json
{
  "new_entities": [
    {
      "name": "string",
      "entityType": "goal|behavior_pattern|trigger|strength|weakness|habit|value|emotion_pattern|life_context",
      "observation": "string",
      "confidence": 0.0-1.0
    }
  ],
  "entity_updates": [
    {
      "entity_name": "既存エンティティ名",
      "new_observation": "新しい気づき",
      "confidence": 0.0-1.0
    }
  ],
  "new_relations": [
    {
      "from": "エンティティ名",
      "to": "エンティティ名",
      "relation_type": "triggers|prevents|supports|conflicts_with|correlates_with|part_of|leads_to",
      "description": "関係性の説明"
    }
  ],
  "relation_updates": [
    {
      "from": "エンティティ名",
      "to": "エンティティ名",
      "relation_type": "string"
    }
  ]
}
```"""


def build_knowledge_graph_extraction_prompt(
    existing_entities_summary: str,
    existing_relations_summary: str,
    today_record_and_analysis: str,
) -> str:
    """ナレッジグラフ抽出用のユーザープロンプトを構築"""
    return f"""## 既存のエンティティ一覧
{existing_entities_summary if existing_entities_summary else "（まだエンティティはありません）"}

## 既存のリレーション一覧
{existing_relations_summary if existing_relations_summary else "（まだリレーションはありません）"}

## 本日の行動記録と分析
{today_record_and_analysis}

上記の情報から、ナレッジグラフの更新内容をJSON形式で出力してください。"""
