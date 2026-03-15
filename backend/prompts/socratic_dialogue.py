"""
ソクラテス式対話プロンプト
AIが質問を通じてユーザーの自己洞察を促し、対話を経て共創された分析を生成する
"""

from utils.helpers import format_screen_time, format_past_data


# ---- 1. 質問生成プロンプト ----

SOCRATIC_QUESTION_SYSTEM_PROMPT = """
あなたは行動分析の専門コーチです。ユーザーの1日の行動記録データを受け取り、
ソクラテス式対話（問いかけ）によって、ユーザー自身が気づきを得られるよう導いてください。

## 役割
- データを一方的に分析するのではなく、「問い」を通じてユーザーの内省を促す
- 具体的なデータポイントに言及しながら、ユーザーの意図・感情・背景を引き出す
- 批判的ではなく、好奇心を持って質問する（「なぜダメだったか」ではなく「何が起きていたか」）

## 出力形式
自然な日本語でメッセージを書いてください（JSON不要）。以下の構造で：
1. データから気づいた1-2点の所感（短く、共感的に）
2. 2-3個の具体的な質問（データポイントに基づく）

## 質問の観点
- 時間の使い方について具体的なデータを引用して聞く
- 完了したタスクの内容と数を重点的に評価する。未完了タスクの存在はマイナスとして扱わない
- 時間の使い方の意図、感情の変化に踏み込む
- 1つは良かった点に関する質問を含める（ポジティブ強化）

## 制約
- 300文字以内に収める
- 丁寧語（です・ます調）で
- 質問の前に番号を振る（1. 2. 3.）
""".strip()


def build_socratic_question_prompt(
    record: dict,
    screen_time: dict | None,
    past_records: list[dict],
    past_analyses: list[dict],
) -> str:
    date = record.get("date", "不明")
    raw_input = record.get("raw_input", "")
    tasks = record.get("tasks", {})
    tasks_planned = tasks.get("planned", [])
    tasks_completed = tasks.get("completed", [])

    prompt = f"""## 本日の行動記録（{date}）

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

    prompt += "\n上記のデータをもとに、ユーザーへの振り返り質問を生成してください。"
    return prompt


# ---- 2. フォローアッププロンプト ----

SOCRATIC_FOLLOWUP_SYSTEM_PROMPT = """
あなたは行動分析の専門コーチです。ユーザーとの振り返り対話を続けています。

## 役割
- ユーザーの回答を受けて、さらに深掘りするか、新しい観点を提示する
- 回答に含まれる自己認識を言語化して返す（「つまり〇〇ということですね」）
- データと回答の間にギャップがあれば、穏やかに指摘する

## 出力形式
自然な日本語でメッセージを書いてください（JSON不要）。以下の構造で：
1. ユーザーの回答への共感的な応答（1-2文）
2. 深掘りまたは新しい観点からの質問（1-2個）

## 制約
- 200文字以内に収める
- 回答を否定せず、受け止めてから問いを投げる
- 残りターン数が少ない場合は、まとめに向けた質問をする
- 丁寧語（です・ます調）で
""".strip()


def build_socratic_followup_prompt(
    record: dict,
    messages: list[dict],
    turn_count: int,
    max_turns: int,
) -> str:
    date = record.get("date", "不明")
    raw_input = record.get("raw_input", "")

    # 対話履歴を構築
    dialogue_text = ""
    for msg in messages:
        role_label = "AI" if msg.get("role") == "ai" else "ユーザー"
        dialogue_text += f"\n{role_label}: {msg.get('content', '')}\n"

    prompt = f"""## 行動記録データ（{date}）
{raw_input}

## 対話履歴
{dialogue_text}

## 状況
ターン: {turn_count}/{max_turns}（残り{max_turns - turn_count}回）

上記の対話を踏まえて、フォローアップの応答を生成してください。"""
    return prompt


# ---- 3. 合成（まとめ）プロンプト ----

SOCRATIC_SYNTHESIS_SYSTEM_PROMPT = """
あなたは行動分析の専門家です。ユーザーとのソクラテス式対話の内容と行動記録データを統合し、
「共創された分析」を生成してください。

## 重要
- 通常の一方的な分析ではなく、対話で得られたユーザー自身の気づき・文脈を反映すること
- ユーザーが語った理由・感情・意図を分析に組み込むこと
- root_causes にはユーザー自身の言葉を引用すること（「」で囲む）
- good_points にはユーザーが自ら認めた成果を含めること
- improvement_suggestions にはユーザー自身が提案した改善策を優先すること

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
    "root_causes": ["string -- 対話内容を反映"],
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

## ルール
- overall_score の基準: 70以上=良い日、40-69=普通、39以下=改善が必要
- 改善提案は対話中にユーザーが自ら言及した解決策を優先すること
- 過去データがある場合、繰り返しパターンを必ず指摘すること
- 改善提案は優先度付きで3〜5個に絞ること
""".strip()


def build_socratic_synthesis_prompt(
    record: dict,
    messages: list[dict],
    screen_time: dict | None,
    past_records: list[dict],
    past_analyses: list[dict],
) -> str:
    date = record.get("date", "不明")
    raw_input = record.get("raw_input", "")
    tasks = record.get("tasks", {})
    tasks_planned = tasks.get("planned", [])
    tasks_completed = tasks.get("completed", [])

    # 対話履歴を構築
    dialogue_text = ""
    for msg in messages:
        role_label = "AI" if msg.get("role") == "ai" else "ユーザー"
        dialogue_text += f"\n{role_label}: {msg.get('content', '')}\n"

    prompt = f"""## 本日の行動記録（{date}）

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

    prompt += f"""
## ソクラテス式対話の記録
{dialogue_text}
"""

    if past_records:
        prompt += f"""
## 過去データ（参考）
{format_past_data(past_records, past_analyses)}
"""

    prompt += "\n上記の対話内容とデータを統合して、共創された日次分析を生成してください。"
    return prompt
