"""
朝のタスク整理プロンプト
ソクラテス式問答で、昨日の記憶を引き出し、今日やるべきことを整理する
"""


# ---- 1. 初期質問プロンプト ----

MORNING_QUESTION_SYSTEM_PROMPT = """
あなたは朝のプランニングコーチです。ユーザーが今日一日を始める前に、
ソクラテス式の問いかけで「昨日の続き」と「今日やるべきこと」を一緒に整理します。

## 役割
- 答えを一方的に教えるのではなく、ユーザー自身に思い出させる・考えさせる
- 昨日のデータを持っているが、最初から全部見せない。ユーザーの記憶を先に聞く
- 思い出せない部分には、ヒントを出して誘導する
- 温かく、朝にふさわしいポジティブなトーンで

## 出力形式
自然な日本語でメッセージを書いてください（JSON不要）。以下の構造で：
1. 朝の挨拶（1文、短く）
2. 昨日の概要への軽い言及（「昨日は〇〇な一日だったようですね」程度）
3. 2-3個の質問（番号付き）

## 質問の方針
- 「昨日何をやっていたか覚えていますか？」（記憶の確認）
- 「やり残したことは何だと思いますか？」（未完了の自覚）
- 「今日一番取り組みたいことは何ですか？」（意思の確認）

## 制約
- 300文字以内に収める
- 丁寧語（です・ます調）で
- 質問の前に番号を振る（1. 2. 3.）
""".strip()


def build_morning_question_prompt(
    yesterday_record: dict | None,
    yesterday_analysis: dict | None,
    incomplete_tasks: list[str],
    active_goals: list[dict],
) -> str:
    prompt = ""

    if yesterday_record:
        date = yesterday_record.get("date", "不明")
        raw_input = yesterday_record.get("raw_input", "")
        tasks = yesterday_record.get("tasks", {})
        tasks_planned = tasks.get("planned", [])
        tasks_completed = tasks.get("completed", [])

        prompt += f"""## 昨日の行動記録（{date}）

### ユーザー入力
{raw_input}

### 予定タスク
{', '.join(tasks_planned) if tasks_planned else 'なし'}

### 完了タスク
{', '.join(tasks_completed) if tasks_completed else 'なし'}
"""
    else:
        prompt += "## 昨日の行動記録\nデータなし（昨日は記録がありません）\n"

    if yesterday_analysis:
        summary = yesterday_analysis.get("summary", {})
        analysis = yesterday_analysis.get("analysis", {})
        prompt += f"""
## 昨日の分析結果
- スコア: {summary.get('overall_score', '-')}/100
- 生産的時間: {summary.get('productive_hours', '-')}h
- 無駄時間: {summary.get('wasted_hours', '-')}h
- タスク完了率: {int(summary.get('task_completion_rate', 0) * 100)}%
- 良かった点: {', '.join(analysis.get('good_points', [])[:2])}
- 改善点: {', '.join(analysis.get('bad_points', [])[:2])}
"""

    if incomplete_tasks:
        prompt += f"""
## 直近の未完了タスク
{chr(10).join('- ' + t for t in incomplete_tasks)}
"""

    if active_goals:
        goal_names = [g.get("name", "") for g in active_goals[:5]]
        prompt += f"""
## アクティブな目標
{chr(10).join('- ' + g for g in goal_names if g)}
"""

    prompt += "\n上記のデータを参考に（ただし最初から全部見せず）、朝の問いかけを生成してください。"
    return prompt


# ---- 2. フォローアッププロンプト ----

MORNING_FOLLOWUP_SYSTEM_PROMPT = """
あなたは朝のプランニングコーチです。ユーザーとの朝の対話を続けています。

## 役割
- ユーザーが思い出せた部分を肯定し、言語化を助ける
- 思い出せなかった部分について、データからヒントを出す（「実は昨日〇〇もやっていましたよ」）
- 今日のタスクの優先順位について問いかける
- 残りターン数が少ない場合は、具体的な今日のプランに向けた質問をする

## 出力形式
自然な日本語でメッセージを書いてください（JSON不要）。以下の構造で：
1. ユーザーの回答への共感的な応答（1-2文）
2. 必要に応じてデータからの補足（「ちなみに昨日は〇〇もありましたね」）
3. 次の質問（1-2個）

## 制約
- 250文字以内に収める
- 回答を否定せず、受け止めてから問いを投げる
- 残りターン数が少ない場合は「では、今日のタスクをまとめましょうか」と誘導する
- 丁寧語（です・ます調）で
""".strip()


def build_morning_followup_prompt(
    yesterday_record: dict | None,
    yesterday_analysis: dict | None,
    incomplete_tasks: list[str],
    messages: list[dict],
    turn_count: int,
    max_turns: int,
) -> str:
    # 対話履歴を構築
    dialogue_text = ""
    for msg in messages:
        role_label = "AI" if msg.get("role") == "ai" else "ユーザー"
        dialogue_text += f"\n{role_label}: {msg.get('content', '')}\n"

    prompt = ""

    if yesterday_record:
        date = yesterday_record.get("date", "不明")
        raw_input = yesterday_record.get("raw_input", "")
        tasks = yesterday_record.get("tasks", {})
        tasks_planned = tasks.get("planned", [])
        tasks_completed = tasks.get("completed", [])
        incomplete = [t for t in tasks_planned if t not in tasks_completed]

        prompt += f"""## 昨日の行動記録（{date}）
{raw_input}

### 昨日の予定タスク: {', '.join(tasks_planned) if tasks_planned else 'なし'}
### 昨日の完了タスク: {', '.join(tasks_completed) if tasks_completed else 'なし'}
### 昨日の未完了タスク: {', '.join(incomplete) if incomplete else 'なし'}
"""

    if incomplete_tasks:
        prompt += f"""
## 直近の未完了タスク（過去7日）
{chr(10).join('- ' + t for t in incomplete_tasks)}
"""

    prompt += f"""
## 対話履歴
{dialogue_text}

## 状況
ターン: {turn_count}/{max_turns}（残り{max_turns - turn_count}回）

上記の対話を踏まえて、フォローアップの応答を生成してください。"""
    return prompt


# ---- 3. 合成（まとめ）プロンプト ----

MORNING_SYNTHESIS_SYSTEM_PROMPT = """
あなたは朝のプランニングコーチです。ユーザーとの対話内容と昨日のデータを統合し、
「今日のプラン」を生成してください。

## 重要
- 対話でユーザー自身が言及したタスク・優先順位を最優先にすること
- ユーザーが思い出せなかった未完了タスクも含めること
- carried_over にはユーザーが認識している持ち越しタスクを入れること
- focus_message はユーザーの言葉を反映した、前向きな一言にすること

## 出力形式
以下の JSON 形式で出力してください。日本語で記述すること。
コードブロック（```json）で囲むこと。

```json
{
  "tasks_today": [
    {
      "task": "タスク名",
      "priority": "high|medium|low",
      "reason": "なぜ今日やるべきか（1文）"
    }
  ],
  "carried_over": ["昨日からの持ち越しタスク"],
  "context_summary": "昨日の流れの要約（2-3文）",
  "focus_message": "今日の一言フォーカスメッセージ"
}
```

## ルール
- tasks_today は優先度順に並べること（high → medium → low）
- タスクは3〜7個に絞ること
- carried_over は昨日の未完了タスクのうち、今日も続けるべきものを入れること
- context_summary は昨日何をしていたかの簡潔な要約
- focus_message は対話で出たユーザーの意思を反映した一言（20文字以内推奨）
""".strip()


def build_morning_synthesis_prompt(
    yesterday_record: dict | None,
    yesterday_analysis: dict | None,
    incomplete_tasks: list[str],
    messages: list[dict],
) -> str:
    # 対話履歴を構築
    dialogue_text = ""
    for msg in messages:
        role_label = "AI" if msg.get("role") == "ai" else "ユーザー"
        dialogue_text += f"\n{role_label}: {msg.get('content', '')}\n"

    prompt = ""

    if yesterday_record:
        date = yesterday_record.get("date", "不明")
        raw_input = yesterday_record.get("raw_input", "")
        tasks = yesterday_record.get("tasks", {})
        tasks_planned = tasks.get("planned", [])
        tasks_completed = tasks.get("completed", [])

        prompt += f"""## 昨日の行動記録（{date}）

### ユーザー入力
{raw_input}

### 予定タスク
{', '.join(tasks_planned) if tasks_planned else 'なし'}

### 完了タスク
{', '.join(tasks_completed) if tasks_completed else 'なし'}
"""

    if yesterday_analysis:
        summary = yesterday_analysis.get("summary", {})
        prompt += f"""
## 昨日の分析サマリー
- スコア: {summary.get('overall_score', '-')}/100
- 生産的時間: {summary.get('productive_hours', '-')}h
- タスク完了率: {int(summary.get('task_completion_rate', 0) * 100)}%
"""

    if incomplete_tasks:
        prompt += f"""
## 直近の未完了タスク
{chr(10).join('- ' + t for t in incomplete_tasks)}
"""

    prompt += f"""
## 朝の対話記録
{dialogue_text}

上記の対話内容とデータを統合して、今日のプランを生成してください。"""
    return prompt
