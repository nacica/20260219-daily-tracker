# Claude Code 指示文：Memory MCP思想のパーソナルコーチ機能追加

## 概要

既存の日次行動分析アプリ（FastAPI + Firestore + Claude API + PWA）に、
Memory MCPのナレッジグラフ思想をFirestoreで再現した「パーソナルコーチ」機能を追加してください。

**重要な設計思想：**
Memory MCPは「エンティティ（人物・概念・習慣）」と「リレーション（関係性）」をJSONに保存するだけの仕組みです。
これをFirestoreで再現し、さらにMemory MCPにはできない「検索・フィルタ・時系列分析・UI表示」を実現します。

---

## Phase 1：ナレッジグラフ用Firestoreコレクション追加

### 1-1. `user_entities` コレクション（Memory MCPのentitiesに相当）

```
Firestore: users/{userId}/user_entities/{entityId}
```

```json
{
  "name": "ストレス食い",
  "entityType": "behavior_pattern",  // 下記の分類参照
  "observations": [
    {
      "content": "夜22時以降にコンビニでお菓子を買う傾向",
      "source_date": "2026-02-20",
      "confidence": 0.85
    },
    {
      "content": "仕事のプレッシャーが高い日に発生しやすい",
      "source_date": "2026-02-22",
      "confidence": 0.9
    }
  ],
  "first_observed": "2026-02-15",
  "last_observed": "2026-02-25",
  "observation_count": 8,
  "status": "active",  // active | resolved | monitoring
  "created_at": Timestamp,
  "updated_at": Timestamp
}
```

**entityType の分類：**

| entityType | 説明 | 例 |
|---|---|---|
| `goal` | 目標 | 「Udemy講座2月末リリース」「体重70kg」 |
| `behavior_pattern` | 行動パターン | 「ストレス食い」「朝型生活」 |
| `trigger` | トリガー・きっかけ | 「夜更かし」「締切プレッシャー」 |
| `strength` | 強み・成功パターン | 「集中力のゾーン」「コード書くの速い」 |
| `weakness` | 弱み・課題 | 「完璧主義」「先延ばし癖」 |
| `habit` | 習慣（良い/悪い） | 「毎朝の散歩」「深夜のYouTube」 |
| `value` | 価値観・信念 | 「自由な働き方」「経済的自立」 |
| `emotion_pattern` | 感情パターン | 「月曜日の憂鬱」「達成後の高揚」 |
| `life_context` | 生活の文脈情報 | 「フリーランス」「在宅勤務メイン」 |

### 1-2. `entity_relations` コレクション（Memory MCPのrelationsに相当）

```
Firestore: users/{userId}/entity_relations/{relationId}
```

```json
{
  "from_entity": "夜更かし",
  "from_entity_id": "entity_xxx",
  "to_entity": "ストレス食い",
  "to_entity_id": "entity_yyy",
  "relation_type": "triggers",  // 下記の分類参照
  "strength": 0.8,              // 関係の強さ 0.0〜1.0
  "evidence_count": 5,          // この関係が観測された回数
  "evidence_dates": ["2026-02-15", "2026-02-18", "2026-02-20", "2026-02-22", "2026-02-25"],
  "description": "夜更かしした翌日にストレス食いが発生する確率が高い",
  "created_at": Timestamp,
  "updated_at": Timestamp
}
```

**relation_type の分類：**

| relation_type | 意味 | 例 |
|---|---|---|
| `triggers` | AがBを引き起こす | 夜更かし → ストレス食い |
| `prevents` | AがBを防ぐ | 朝の運動 → 午後のダラけ |
| `supports` | AがBを助ける | タスク分解 → 集中力維持 |
| `conflicts_with` | AとBは両立しにくい | 完璧主義 → 素早い着手 |
| `correlates_with` | AとBは同時に起きやすい | 睡眠不足 → 低パフォーマンス |
| `part_of` | AはBの一部 | 毎朝の散歩 → 朝型生活 |
| `leads_to` | AがBに発展する | 小さな成功 → 自信の回復 |

### 1-3. `coaching_summaries` コレクション（月次圧縮・長期記憶）

```
Firestore: users/{userId}/coaching_summaries/{yearMonth}
```

```json
{
  "period": "2026-02",
  "top_patterns": [
    {
      "pattern": "夜更かし→ストレス食いの連鎖",
      "frequency": 8,
      "trend": "improving"  // improving | stable | worsening
    }
  ],
  "goals_progress": [
    {
      "goal": "Udemy講座リリース",
      "progress_percentage": 75,
      "blockers": ["完璧主義による遅延"],
      "achievements": ["4-5本のデモアプリ完成"]
    }
  ],
  "emotional_summary": {
    "average_score": 6.2,
    "best_day_pattern": "運動した日",
    "worst_day_pattern": "締切前日"
  },
  "key_insights": [
    "作業開始のハードルを下げると生産性が上がる",
    "22時以降のコンビニ行きがストレス食いの主原因"
  ],
  "coaching_effectiveness": {
    "advice_followed_rate": 0.4,
    "most_effective_advice": "タスクを15分単位に分解する",
    "least_effective_advice": "YouTubeのアプリを消す"
  },
  "created_at": Timestamp
}
```

---

## Phase 2：ナレッジグラフ自動更新サービス

### 2-1. `services/knowledge_graph_service.py` を新規作成

日記保存・日次分析時にClaude APIを呼び出して、ナレッジグラフを自動更新する。

**処理フロー：**

```
日次分析完了
  ↓
Claude API呼び出し（ナレッジグラフ抽出プロンプト）
  - 入力：今日の日記 + 分析結果 + 既存エンティティ一覧（名前とtypeのみ）
  - 出力：JSON（新規エンティティ、更新するobservation、新規リレーション）
  ↓
Firestoreに反映
  - 既存エンティティ → observationsに追記、last_observed更新
  - 新規エンティティ → ドキュメント作成
  - リレーション → evidence_count++、strength再計算
```

### 2-2. ナレッジグラフ抽出プロンプト

```python
KNOWLEDGE_GRAPH_EXTRACTION_PROMPT = """
あなたはユーザーの行動パターンを分析し、ナレッジグラフを構築する専門家です。

## 既存のエンティティ一覧
{existing_entities_summary}

## 既存のリレーション一覧
{existing_relations_summary}

## 本日の行動記録と分析
{today_record_and_analysis}

## タスク
上記の情報から以下をJSON形式で出力してください：

1. **new_entities**: 新しく発見されたエンティティ（既存と重複しないもの）
2. **entity_updates**: 既存エンティティに追加すべき新しいobservation
3. **new_relations**: 新しく発見された関係性
4. **relation_updates**: 既存リレーションの強化（再観測されたもの）

## 重要なルール
- 既存エンティティと意味が同じものは名前を統一すること（「夜ふかし」と「夜更かし」は同じ）
- confidenceは具体的証拠がある場合0.8以上、推測の場合0.5〜0.7
- 些細すぎる情報はエンティティにしない（「今日カレーを食べた」は不要）
- パターンとして繰り返されるものを優先的に抽出すること
- 最大でも新規エンティティ3個、新規リレーション3個までに絞ること

## 出力形式
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
```
"""
```

### 2-3. トークン節約のための工夫

- 既存エンティティは「名前 + type」の一覧だけ渡す（observations全文は渡さない）
- 既存リレーションも「from → to (type)」の一行サマリーだけ渡す
- 抽出は1日1回、日次分析と同時に実行（追加API呼び出し1回分のみ）
- Claude Haikuでも十分な精度が出るのでHaikuを使用

---

## Phase 3：コーチング機能の強化

### 3-1. `services/coaching_service.py` を新規作成

コーチング呼び出し時に、テーマに応じてFirestoreから関連データを取得し、
Claude APIに渡す。

**コーチング用のデータ取得ロジック：**

```python
async def build_coaching_context(user_id: str, user_message: str) -> dict:
    """
    ユーザーの質問/相談内容に応じて、最適なコンテキストを構築する。
    Memory MCPと違い、必要なデータだけ選択的に取得する（トークン節約）。
    """
    context = {}

    # 1. 常に含める：直近7日の日次分析サマリー（スコアとキーポイントのみ）
    context["recent_week"] = await get_recent_analyses_summary(user_id, days=7)

    # 2. 常に含める：アクティブなエンティティ（status=active）上位20件
    context["active_entities"] = await get_active_entities(user_id, limit=20)

    # 3. 常に含める：強い関係性（strength >= 0.6）上位10件
    context["strong_relations"] = await get_strong_relations(user_id, min_strength=0.6, limit=10)

    # 4. 最新の月次サマリー
    context["latest_monthly"] = await get_latest_coaching_summary(user_id)

    # 5. テーマ別の追加データ（Claudeで判定 or キーワードマッチ）
    if contains_keywords(user_message, ["食事", "食べ", "ダイエット", "体重", "カロリー"]):
        context["theme_entities"] = await get_entities_by_type(user_id, ["behavior_pattern", "habit"], keyword="食")

    if contains_keywords(user_message, ["仕事", "タスク", "生産性", "集中", "副業"]):
        context["theme_entities"] = await get_entities_by_type(user_id, ["goal", "strength", "weakness"])

    if contains_keywords(user_message, ["メンタル", "気分", "不安", "ストレス", "疲れ"]):
        context["theme_entities"] = await get_entities_by_type(user_id, ["emotion_pattern", "trigger"])

    return context
```

### 3-2. コーチングシステムプロンプト

```python
COACHING_SYSTEM_PROMPT = """
あなたは{user_name}の専属パーソナルコーチです。
以下のナレッジグラフはこれまでの対話と日記から蓄積されたものです。

## あなたが知っている{user_name}について

### 行動パターン・習慣
{active_entities_formatted}

### パターン間の関係性
{strong_relations_formatted}

### 直近1週間の状況
{recent_week_formatted}

### 今月の全体傾向
{latest_monthly_formatted}

## コーチングの原則

1. **過去のパターンを根拠にする**
   - 「以前も同じパターンがありましたね」と具体的に指摘
   - 関係性グラフから因果関係を示す

2. **ソクラテス式で気づきを促す**
   - 答えを直接言わず、質問で考えさせる
   - 「なぜそうなったと思いますか？」「前回うまくいった時と何が違いますか？」

3. **実行可能な提案のみ**
   - 過去に「実行されなかった」アドバイスは別の角度から提案
   - 過去に「効果があった」アドバイスは強化

4. **感情に寄り添いつつ前進させる**
   - 共感 → 分析 → 小さな次のステップ の流れ

5. **短く簡潔に**
   - 1回の返答は200文字以内を目安
   - 長い分析が必要な場合のみ例外

## 禁止事項
- 同じアドバイスの繰り返し（過去の対話を確認すること）
- 抽象的な精神論（「頑張りましょう」等）
- ユーザーのデータにない推測
"""
```

### 3-3. 新規APIエンドポイント

```
POST /api/v1/coach/chat
  Body: {
    "message": "最近またストレス食いしちゃった...",
    "conversation_history": [...]  // 直近の対話履歴（最大10ターン）
  }
  処理:
    1. build_coaching_context() でFirestoreから関連データ取得
    2. COACHING_SYSTEM_PROMPT にデータを注入
    3. Claude API呼び出し
    4. 返答を返す + 必要に応じてナレッジグラフ更新
  Response: {
    "reply": "コーチの返答",
    "referenced_patterns": ["ストレス食い", "夜更かし"],  // 参照したエンティティ
    "suggested_action": "今日は22時前に就寝してみましょう"
  }
```

---

## Phase 4：月次サマリー自動生成

### 4-1. 月初に前月のcoaching_summariesを自動生成

```
POST /api/v1/summaries/generate/{yearMonth}
  処理:
    1. 該当月のdaily_analyses全件取得
    2. user_entities + entity_relationsの該当月の変化を取得
    3. Claude APIで月次サマリー生成
    4. coaching_summariesに保存
    5. 古いentity（3ヶ月以上観測されていない）のstatusをmonitoringに変更
```

### 4-2. 古いデータの圧縮ルール

- **3ヶ月以上更新なし**のエンティティ → status: "monitoring"に変更
- **6ヶ月以上更新なし**のエンティティ → coaching_summariesに記録して削除
- **evidence_count が 1** かつ **3ヶ月以上前**のリレーション → 削除
- daily_analysesの生データは残すが、コーチングのコンテキストには月次サマリーだけ使う

---

## Phase 5：フロントエンドUI追加

### 5-1. コーチングチャット画面（/coach）

- チャットUI（吹き出し形式）
- 入力エリア + 送信ボタン
- コーチの返答にはreferenced_patternsをタグ表示
- 「ナレッジグラフを見る」ボタン

### 5-2. ナレッジグラフ可視化画面（/knowledge）

- エンティティ一覧（typeでフィルタ可能）
- 各エンティティのobservations履歴
- リレーションの一覧（強さでソート）
- **簡易グラフ表示**（エンティティをノード、リレーションをエッジ）
  - ライブラリ：vis.js network または D3.js force layout
  - ノードの色はentityTypeで分類
  - エッジの太さはstrengthで表現
  - タップで詳細表示

### 5-3. 月次レポート画面（/monthly/{yearMonth}）

- coaching_summariesの内容を見やすく表示
- 目標進捗のプログレスバー
- パターンのトレンド表示（improving/stable/worseningをアイコンで）
- 前月との比較

---

## 実装順序

| 順番 | 内容 | 目安 |
|------|------|------|
| 1 | Firestoreコレクション設計（user_entities, entity_relations, coaching_summaries） | スキーマ確認 |
| 2 | knowledge_graph_service.py 作成 + 抽出プロンプト | バックエンド |
| 3 | 日次分析完了時にナレッジグラフ更新を組み込む（既存の分析フローに追加） | 既存コード修正 |
| 4 | coaching_service.py + コーチングAPIエンドポイント | バックエンド |
| 5 | コーチングチャットUI | フロントエンド |
| 6 | 月次サマリー生成 | バックエンド |
| 7 | ナレッジグラフ可視化UI | フロントエンド |
| 8 | 月次レポートUI | フロントエンド |

---

## 実装の注意事項

1. **既存のコードを壊さない** — 日次分析・週次分析・ソクラテス式対話は現状のまま動くこと
2. **ナレッジグラフ更新は非同期** — 日記保存のレスポンスを遅くしない。バックグラウンドで更新
3. **Claude API呼び出しはHaikuモデル** — ナレッジグラフ抽出はHaikuで十分。コーチングチャットはSonnetを使用
4. **エンティティ名の正規化** — 「夜ふかし」「夜更かし」「夜遅くまで起きる」を同一エンティティとして扱う。Claude APIに既存一覧を渡して統一させる
5. **Firestoreのインデックス** — `user_entities`のentityType + status、`entity_relations`のstrengthにcomposite indexを作成
6. **フロントエンドはVanilla JS** — 既存と同じくフレームワークなし、ダークテーマ、モバイルファースト
7. **エラーハンドリング** — ナレッジグラフ更新が失敗しても日次分析自体は成功させること
