# 日次行動分析AIツール - プロジェクト設計書

## 概要

毎日の行動記録をAIが分析し、改善提案を行うPWAアプリケーション。
ユーザーは1人（自分専用）。認証なし。

---

## 技術スタック

| レイヤー | 技術 | 理由 |
|---------|------|------|
| フロントエンド | HTML + CSS + JavaScript（Vanilla or React） | PWA対応が容易 |
| バックエンド | Python FastAPI | Claude API連携がPythonで容易 |
| AI分析 | Claude API（claude-sonnet-4-5-20250929） | 日次分析はSonnet、週次はOpusも可 |
| データベース | Firestore | Firebase統合、無料枠大きい |
| 画像保存 | Firebase Cloud Storage | スクリーンタイムのスクショ保存 |
| OCR | Claude API Vision | スクショからアプリ使用時間を抽出 |
| ホスティング（フロント） | Firebase Hosting | 無料、PWA対応◎ |
| ホスティング（バック） | Cloud Run | Dockerで動かす、無料枠あり |
| コード管理 | GitHub | Cloud Runと自動デプロイ連携 |

---

## ディレクトリ構成

```
daily-tracker/
├── frontend/                    # PWAフロントエンド
│   ├── index.html               # メインページ（SPA）
│   ├── manifest.json            # PWA設定
│   ├── sw.js                    # Service Worker
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── app.js               # メインロジック
│   │   ├── api.js               # バックエンドAPI通信
│   │   ├── router.js            # SPA ルーティング
│   │   └── components/          # UIコンポーネント
│   │       ├── input-form.js    # 行動記録入力フォーム
│   │       ├── analysis-view.js # 分析結果表示
│   │       ├── history-list.js  # 過去の記録一覧
│   │       ├── weekly-report.js # 週次レポート表示
│   │       └── screenshot-upload.js # スクショアップロード
│   ├── icons/                   # PWAアイコン
│   │   ├── icon-192.png
│   │   └── icon-512.png
│   └── firebase.json            # Firebase Hosting設定
│
├── backend/                     # FastAPI バックエンド
│   ├── main.py                  # FastAPIエントリポイント
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .env.example             # 環境変数テンプレート
│   ├── routers/
│   │   ├── records.py           # 行動記録CRUD
│   │   ├── analysis.py          # AI分析エンドポイント
│   │   ├── screenshots.py       # スクショアップロード＆OCR
│   │   └── weekly.py            # 週次分析エンドポイント
│   ├── services/
│   │   ├── claude_service.py    # Claude API連携
│   │   ├── ocr_service.py       # スクショOCR（Claude Vision）
│   │   ├── firestore_service.py # Firestore操作
│   │   └── storage_service.py   # Cloud Storage操作
│   ├── models/
│   │   └── schemas.py           # Pydanticスキーマ
│   ├── prompts/
│   │   ├── daily_analysis.py    # 日次分析プロンプト
│   │   ├── weekly_analysis.py   # 週次分析プロンプト
│   │   └── ocr_extraction.py   # スクショ解析プロンプト
│   └── utils/
│       └── helpers.py
│
├── .github/
│   └── workflows/
│       └── deploy.yml           # Cloud Run自動デプロイ
│
└── README.md
```

---

## データベース設計（Firestore）

### コレクション: `daily_records`

```json
{
  "id": "2025-02-19",              // ドキュメントID = 日付
  "date": "2025-02-19",
  "raw_input": "8:00 起床\n8:30-9:00 朝食...",  // ユーザーが入力した生テキスト
  "parsed_activities": [            // AIが構造化したデータ
    {
      "start_time": "08:00",
      "end_time": "08:30",
      "activity": "起床・準備",
      "category": "生活",          // 生活/仕事/勉強/娯楽/無駄時間/運動
      "is_productive": true
    },
    {
      "start_time": "10:00",
      "end_time": "12:00",
      "activity": "YouTube視聴",
      "category": "無駄時間",
      "is_productive": false
    }
  ],
  "screen_time": {                  // スクショOCRから抽出
    "raw_image_url": "gs://bucket/screenshots/2025-02-19.png",
    "apps": [
      { "name": "YouTube", "duration_minutes": 120 },
      { "name": "Twitter", "duration_minutes": 45 },
      { "name": "VSCode", "duration_minutes": 180 }
    ],
    "total_screen_time_minutes": 480
  },
  "tasks": {                       // その日のタスク
    "planned": ["企画書作成", "コードレビュー", "ジム"],
    "completed": ["コードレビュー"],
    "completion_rate": 0.33
  },
  "created_at": "2025-02-19T23:00:00+09:00",
  "updated_at": "2025-02-19T23:30:00+09:00"
}
```

### コレクション: `daily_analyses`

```json
{
  "id": "2025-02-19",
  "date": "2025-02-19",
  "summary": {
    "productive_hours": 4.5,
    "wasted_hours": 3.0,
    "youtube_hours": 2.0,
    "task_completion_rate": 0.33,
    "overall_score": 45            // 0-100のスコア
  },
  "analysis": {
    "good_points": [
      "コードレビューを午前中に終わらせた点は良い"
    ],
    "bad_points": [
      "YouTubeを2時間視聴（予定外）",
      "企画書作成に手をつけられなかった"
    ],
    "root_causes": [
      "午前中にYouTubeを開いたことがトリガーになり、連続視聴に陥った",
      "企画書作成のタスクが大きすぎて着手への心理的ハードルが高い"
    ],
    "thinking_weaknesses": [
      "「ちょっとだけ」と思ってYouTubeを開く楽観バイアス",
      "大きいタスクを分割せずに先延ばしする傾向"
    ],
    "behavior_weaknesses": [
      "午前中の集中時間をSNS/動画で消費するパターン",
      "タスク間の切り替え時に無意識にスマホを触る"
    ],
    "improvement_suggestions": [
      {
        "suggestion": "企画書を「見出しだけ書く」「1セクションだけ書く」に分割する",
        "priority": "high",
        "category": "タスク管理"
      },
      {
        "suggestion": "午前中はYouTubeアプリをスクリーンタイムでブロック設定する",
        "priority": "high",
        "category": "環境設計"
      },
      {
        "suggestion": "作業開始時にスマホを別の部屋に置く",
        "priority": "medium",
        "category": "環境設計"
      }
    ],
    "comparison_with_past": {
      "recurring_patterns": [
        "3日連続でYouTube2時間超え",
        "企画書系のタスクを5回連続で先延ばし"
      ],
      "improvements_from_last_week": [
        "起床時間が30分早くなった"
      ]
    }
  },
  "created_at": "2025-02-19T23:30:00+09:00"
}
```

### コレクション: `weekly_analyses`

```json
{
  "id": "2025-W08",                // 年-週番号
  "week_start": "2025-02-17",
  "week_end": "2025-02-23",
  "weekly_summary": {
    "avg_productive_hours": 4.2,
    "avg_wasted_hours": 2.8,
    "avg_task_completion_rate": 0.45,
    "total_youtube_hours": 14.5,
    "avg_overall_score": 52,
    "score_trend": "improving"     // improving / declining / stable
  },
  "deep_analysis": {
    "weekly_pattern": "月火は集中力が高いが、水曜以降にダレる傾向",
    "biggest_time_wasters": [
      { "activity": "YouTube", "total_hours": 14.5, "trigger": "食後・タスク切り替え時" },
      { "activity": "Twitter", "total_hours": 5.2, "trigger": "通知" }
    ],
    "cognitive_patterns": [
      "完璧主義：タスクが大きいと「完璧にやらなきゃ」と思い着手できない",
      "即時報酬バイアス：長期的な成果より目の前の快楽（動画）を選ぶ傾向"
    ],
    "improvement_plan": {
      "next_week_goals": [
        "YouTube視聴を1日1時間以内にする",
        "毎日最低1つの大きいタスクに着手する"
      ],
      "concrete_actions": [
        "朝一番にその日の最重要タスクに30分だけ取り組む（2分ルール応用）",
        "YouTubeは昼食時と夜のみに限定する",
        "タスクを30分以内の単位に分割してから作業を始める"
      ],
      "habit_building": [
        "朝のルーティン：起床→水→最重要タスク30分→朝食（YouTube禁止）"
      ]
    },
    "progress_vs_last_week": {
      "improved": ["起床時間の安定化", "運動頻度の増加"],
      "declined": ["YouTube視聴時間が2時間増加"],
      "unchanged": ["タスク完了率は横ばい"]
    }
  },
  "created_at": "2025-02-23T23:00:00+09:00"
}
```

---

## API設計

### ベースURL: `https://[cloud-run-url]/api/v1`

### エンドポイント一覧

#### 行動記録

```
POST   /records
  Body: { "date": "2025-02-19", "raw_input": "8:00 起床...", "tasks_planned": ["企画書", "ジム"] }
  Response: { "id": "2025-02-19", "parsed_activities": [...] }

GET    /records
  Query: ?start_date=2025-02-01&end_date=2025-02-19
  Response: [{ "id": "2025-02-19", ... }, ...]

GET    /records/{date}
  Response: { "id": "2025-02-19", "raw_input": "...", "parsed_activities": [...] }

PUT    /records/{date}
  Body: { "raw_input": "更新されたテキスト", "tasks_completed": ["コードレビュー"] }

DELETE /records/{date}
```

#### スクリーンタイム（スクショ）

```
POST   /screenshots/{date}
  Body: multipart/form-data (image file)
  Response: { "apps": [{ "name": "YouTube", "duration_minutes": 120 }, ...] }
  処理: Cloud Storageに保存 → Claude Vision APIでOCR → 結果をrecordに紐付け
```

#### AI分析

```
POST   /analysis/{date}/generate
  処理: その日のrecord + screen_time + 過去7日間のデータを使ってClaude APIで分析
  Response: { "analysis": { "good_points": [...], "bad_points": [...], ... } }

GET    /analysis/{date}
  Response: 保存済みの分析結果

GET    /analysis
  Query: ?start_date=2025-02-01&end_date=2025-02-19
  Response: 期間内の分析結果一覧（改善提案の振り返り用）
```

#### 週次分析

```
POST   /weekly/{week_id}/generate
  例: /weekly/2025-W08/generate
  処理: その週の全daily_records + daily_analyses + 前週のweekly_analysisを使って深い分析
  Response: { "deep_analysis": { ... } }

GET    /weekly/{week_id}
  Response: 保存済みの週次分析

GET    /weekly
  Query: ?limit=10
  Response: 直近の週次分析一覧
```

---

## Claude APIプロンプト設計

### 日次分析プロンプト（`prompts/daily_analysis.py`）

```python
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
以下のJSON形式で出力してください。日本語で記述すること。
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

## 重要なルール
- 抽象的なアドバイスではなく、具体的で明日から実行できる提案をすること
- ダメ出しだけでなく、良かった点も必ず挙げること
- 過去データがある場合、繰り返しパターンを必ず指摘すること
- スクリーンタイムデータがある場合、アプリ別の使用時間を分析に含めること
- 改善提案は優先度付きで3〜5個に絞ること
"""

def build_daily_analysis_prompt(record, screen_time, past_records, past_analyses):
    """日次分析のユーザープロンプトを構築"""
    prompt = f"""
## 本日の行動記録（{record['date']}）

### ユーザー入力
{record['raw_input']}

### 予定タスク
{', '.join(record.get('tasks_planned', []))}

### 完了タスク
{', '.join(record.get('tasks_completed', []))}
"""

    if screen_time:
        prompt += f"""
### スクリーンタイム（iPhone）
{format_screen_time(screen_time)}
"""

    if past_records:
        prompt += f"""
## 過去7日間のデータ
{format_past_data(past_records, past_analyses)}
"""

    return prompt
```

### 週次分析プロンプト（`prompts/weekly_analysis.py`）

```python
WEEKLY_ANALYSIS_SYSTEM_PROMPT = """
あなたは行動改善コーチです。1週間分の行動データと日次分析をもとに、
深い分析と来週の具体的な改善プランを提案してください。

## 分析の深さ
日次分析よりも深く掘り下げてください：
1. **週全体のパターン**: 曜日ごとの傾向、エネルギーレベルの変動
2. **最大の時間泥棒**: 何に最も時間を奪われたか、そのトリガーは何か
3. **認知パターン分析**: 繰り返し現れる思考の癖（完璧主義、先延ばし、自己正当化など）
4. **改善提案の実行状況**: 先週の提案を実行できたか、できなかった理由は何か
5. **来週の行動プラン**: 具体的な日ごとのアクションプラン
6. **習慣形成**: 定着させるべきルーティン提案

## 出力形式
JSONで出力（weekly_analysesスキーマに準拠）
"""
```

### スクショOCRプロンプト（`prompts/ocr_extraction.py`）

```python
OCR_SYSTEM_PROMPT = """
iPhoneのスクリーンタイム画面のスクリーンショットからアプリ使用時間を抽出してください。

## 出力形式
以下のJSON形式で出力してください：
{
  "apps": [
    { "name": "アプリ名", "duration_minutes": <分数> },
  ],
  "total_screen_time_minutes": <合計分数>,
  "extraction_confidence": "high|medium|low"
}

## ルール
- アプリ名は英語表記で統一（例：YouTube, Twitter/X, Instagram）
- 時間は分に変換（1時間30分 → 90）
- 読み取れない部分がある場合はconfidenceをmedium/lowにする
- カテゴリ（SNS、エンタメ等）がスクショに含まれていればそれも抽出
"""
```

---

## PWA設定

### manifest.json

```json
{
  "name": "日次行動分析AI",
  "short_name": "行動分析",
  "description": "毎日の行動をAIが分析し改善提案するツール",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#16213e",
  "orientation": "portrait",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Service Worker（sw.js）

```javascript
// キャッシュ戦略: Network First（常に最新データを取得、オフライン時はキャッシュ）
// 静的アセットはCache First
```

---

## フロントエンド画面設計

### 画面一覧

#### 1. ホーム画面（/）
- 今日の日付表示
- 今日の記録が未入力なら入力フォームを表示
- 入力済みなら今日の分析サマリーを表示
- 全体スコアの推移グラフ（直近14日）

#### 2. 行動記録入力画面（/input）
- テキストエリア：自由記述で行動を入力
  - プレースホルダー例: "8:00 起床\n8:30 朝食\n9:00-12:00 仕事（企画書作成）\n..."
- タスク入力：予定タスクと完了タスクのチェックリスト
- スクショアップロードボタン（カメラアイコン）
- 「分析する」ボタン

#### 3. 分析結果画面（/analysis/{date}）
- 全体スコア（大きく表示）
- 時間の使い方（円グラフ or 棒グラフ）
  - 生産的 / 非生産的 / 娯楽 / 生活 の内訳
- タスク完了率
- 良かった点（緑）
- 悪かった点（赤）
- 根本原因の分析
- 思考の弱み
- 行動の弱み
- 改善提案（優先度付き）
- 過去との比較セクション

#### 4. 履歴一覧画面（/history）
- カレンダービュー（日ごとのスコアを色で表示）
- リストビュー（日付、スコア、一行サマリー）
- タップで分析結果画面に遷移

#### 5. 週次レポート画面（/weekly/{week_id}）
- 週のサマリー統計
- 曜日ごとの比較
- 最大の時間泥棒ランキング
- 認知パターン分析
- 来週の行動プラン
- 前週との比較

#### 6. 改善提案アーカイブ画面（/suggestions）
- 過去の全改善提案を新しい順に一覧表示
- カテゴリでフィルタ可能（タスク管理/環境設計/習慣形成/メンタル）
- 優先度でフィルタ可能
- 繰り返し出てくる提案をハイライト

### デザイン方針
- ダークテーマ（目に優しい、夜の振り返り時に最適）
- モバイルファースト（スマホ操作を最優先）
- 最小限のタップで記録完了できるUI
- スコアは数字＋色で直感的に（70以上=緑、40-69=黄、39以下=赤）

---

## デプロイ設定

### Firebase Hosting（フロントエンド）

```json
// firebase.json
{
  "hosting": {
    "public": "frontend",
    "ignore": ["firebase.json", "**/.*"],
    "rewrites": [
      { "source": "**", "destination": "/index.html" }
    ],
    "headers": [
      {
        "source": "/sw.js",
        "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
      }
    ]
  }
}
```

### Cloud Run（バックエンド）

```dockerfile
# backend/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

### GitHub Actions自動デプロイ

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      - uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: daily-tracker-api
          source: ./backend
          region: asia-northeast1

  deploy-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: ${{ secrets.GITHUB_TOKEN }}
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          channelId: live
```

---

## 環境変数

```env
# backend/.env
ANTHROPIC_API_KEY=sk-ant-xxxxx
GOOGLE_CLOUD_PROJECT=your-project-id
FIRESTORE_DATABASE=(default)
CLOUD_STORAGE_BUCKET=your-bucket-name

# 分析設定
DAILY_ANALYSIS_MODEL=claude-sonnet-4-5-20250929
WEEKLY_ANALYSIS_MODEL=claude-sonnet-4-5-20250929
OCR_MODEL=claude-sonnet-4-5-20250929
```

---

## 実装の優先順位

### Phase 1（MVP - まず動くものを作る）
1. FastAPIのセットアップ + 基本エンドポイント
2. Firestoreの接続 + CRUD
3. 行動記録の入力フォーム（フロントエンド）
4. Claude APIで日次分析を生成
5. 分析結果の表示画面
6. PWA化（manifest.json + Service Worker）

### Phase 2（スクショOCR + 履歴）
7. スクショアップロード機能
8. Claude VisionでOCR処理
9. 履歴一覧画面（カレンダー + リスト）
10. 過去データを含めた分析精度向上

### Phase 3（週次分析 + 改善追跡）
11. 週次分析の生成・表示
12. 改善提案アーカイブ画面
13. スコア推移グラフ

### Phase 4（デプロイ + 仕上げ）
14. Firebase Hosting + Cloud Runへデプロイ
15. GitHub Actions自動デプロイ
16. UIの仕上げ・レスポンシブ調整

---

## Claude Codeへの指示

この設計書に基づいてプロジェクトを構築してください。

- Phase 1から順番に実装してください
- フロントエンドはVanilla JS（フレームワークなし）でシンプルに作ってください
- CSSはダークテーマで、モバイルファーストのレスポンシブデザインにしてください
- バックエンドのエラーハンドリングは丁寧に行ってください
- Firestoreのセキュリティルールは不要（認証なしのため、Cloud Run経由のみアクセス）
- 環境変数は.env.exampleを用意し、README.mdにセットアップ手順を記載してください
- 各ファイルに適切なコメントを入れてください（日本語OK）
