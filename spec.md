# spec.md — 日次行動分析AI 仕様書

## 概要

毎日の行動記録をAIが分析し、改善提案を行うPWAアプリケーション。
単一ユーザー（自分専用）で認証なし。
日記・ブレインダンプ・単語帳・コーチングなど多機能な自己改善ツール。

---

## 技術スタック

| レイヤー | 技術 | バージョン |
|---------|------|-----------|
| フロントエンド | HTML + CSS + Vanilla JS (PWA) | ES Modules |
| バックエンド | Python FastAPI | 0.115.6 |
| AI分析 | Claude API | claude-sonnet-4-6 |
| データベース | Firestore | default database |
| 画像保存 | Firebase Cloud Storage | GCS bucket |
| OCR | Claude Vision API | — |
| フロントホスティング | Firebase Hosting | — |
| バックホスティング | Cloud Run | asia-northeast1 |
| CI/CD | GitHub Actions | main push トリガー |

---

## ディレクトリ構成

```
project_root/
├── frontend/
│   ├── index.html                  # メインページ（SPA）
│   ├── manifest.json               # PWA設定
│   ├── sw.js                       # Service Worker
│   ├── css/style.css               # サイバーパンク UIスタイル
│   ├── js/
│   │   ├── app.js                  # メインロジック・ルーティング設定・ホーム画面
│   │   ├── api.js                  # API通信（fetch ラッパー）
│   │   ├── router.js               # SPA ルーティング
│   │   ├── swipe-nav.js            # スワイプナビゲーション
│   │   └── components/
│   │       ├── input-form.js       # 行動記録入力フォーム
│   │       ├── analysis-view.js    # 日次分析結果表示
│   │       ├── history-list.js     # 履歴一覧（カレンダー＆リスト）
│   │       ├── weekly-report.js    # 週次分析レポート
│   │       ├── monthly-report.js   # 月次分析レポート
│   │       ├── screenshot-upload.js# スクショアップロード
│   │       ├── suggestions.js      # 改善提案アーカイブ
│   │       ├── coaching-chat.js    # パーソナルコーチング
│   │       ├── knowledge-graph.js  # 知識グラフ可視化
│   │       ├── journal.js          # 日記（複数エントリ/日）
│   │       ├── braindump.js        # ブレインダンプ（メモ・画像）
│   │       ├── task-stats.js       # タスク統計
│   │       ├── flashcard-list.js   # 単語帳一覧（2ペイン）
│   │       └── flashcard-study.js  # 単語帳学習モード
│   └── icons/                      # PWA アイコン群
│
├── backend/
│   ├── main.py                     # FastAPI エントリポイント
│   ├── requirements.txt            # Python 依存パッケージ
│   ├── Dockerfile                  # Cloud Run 用
│   ├── models/schemas.py           # Pydantic スキーマ
│   ├── routers/
│   │   ├── records.py              # 行動記録 CRUD
│   │   ├── analysis.py             # AI 日次分析
│   │   ├── weekly.py               # 週次分析
│   │   ├── summaries.py            # 月次サマリー
│   │   ├── screenshots.py          # スクショ＆OCR
│   │   ├── dialogue.py             # ソクラテス式対話
│   │   ├── morning_dialogue.py     # 朝のタスク計画対話
│   │   ├── diary_dialogue.py       # 日記対話（AI質問→記録合成）
│   │   ├── journal.py              # 日記エントリ CRUD
│   │   ├── braindump.py            # ブレインダンプ CRUD
│   │   ├── flashcards.py           # 単語帳 CRUD
│   │   ├── coaching.py             # コーチング＆知識グラフ
│   │   ├── categories.py           # タスクカテゴリ管理
│   │   └── reminders.py            # リマインダー（付箋）
│   ├── services/
│   │   ├── claude_service.py       # Claude API 連携
│   │   ├── coaching_service.py     # コーチング応答生成
│   │   ├── knowledge_graph_service.py # 知識グラフ管理
│   │   ├── firestore_service.py    # Firestore CRUD
│   │   ├── ocr_service.py          # Claude Vision OCR
│   │   └── storage_service.py      # Cloud Storage 管理
│   ├── prompts/
│   │   ├── daily_analysis.py       # 日次分析プロンプト
│   │   ├── weekly_analysis.py      # 週次分析プロンプト
│   │   ├── monthly_summary.py      # 月次サマリープロンプト
│   │   ├── socratic_dialogue.py    # ソクラテス式対話プロンプト
│   │   ├── morning_planning.py     # 朝の計画プロンプト
│   │   ├── diary_dialogue.py       # 日記対話プロンプト
│   │   ├── journal_analysis.py     # 日記分析プロンプト
│   │   ├── coaching.py             # コーチングプロンプト
│   │   ├── knowledge_graph.py      # 知識グラフ抽出プロンプト
│   │   └── ocr_extraction.py       # OCR プロンプト
│   └── utils/helpers.py            # 日時・フォーマット処理
│
├── .github/workflows/deploy.yml    # 自動デプロイ
├── firebase.json                   # Firebase Hosting 設定
├── .firebaserc                     # Firebase プロジェクト指定
└── CLAUDE.md                       # プロジェクト規約
```

---

## API エンドポイント

ベースパス: `/api/v1`

### 行動記録 (Records)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/records` | 日次記録を作成（Claude APIでパース） |
| GET | `/records` | 記録一覧（start_date, end_date で絞込可） |
| GET | `/records/{date}` | 特定日の記録取得 |
| PUT | `/records/{date}` | 記録更新 |
| DELETE | `/records/{date}` | 記録削除 |
| PUT | `/records/{date}/rest-day` | 休息日トグル |

### AI分析 (Analysis)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/analysis/{date}/generate` | 日次分析を生成（Claude API、過去7日比較付き） |
| GET | `/analysis/{date}` | 保存済み分析を取得 |
| GET | `/analysis` | 分析一覧（start_date, end_date で絞込可） |

### 週次分析 (Weekly)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/weekly/{week_id}/generate` | 週次分析を生成（week_id: YYYY-Www） |
| GET | `/weekly/{week_id}` | 保存済み週次分析を取得 |
| GET | `/weekly` | 週次分析一覧 |

### 月次サマリー (Summaries)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/summaries/generate/{yearMonth}` | 月次サマリーを生成 |
| GET | `/summaries/{yearMonth}` | 保存済み月次サマリーを取得 |
| GET | `/summaries` | 月次サマリー一覧 |

### ソクラテス式対話 (Dialogue)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/dialogue/{date}/start` | 対話を開始 |
| POST | `/dialogue/{date}/reply` | ユーザー返答を送信 |
| POST | `/dialogue/{date}/synthesize` | 対話を総括 |
| GET | `/dialogue/{date}` | 対話履歴を取得 |
| DELETE | `/dialogue/{date}` | 対話を削除 |

### 朝の計画対話 (Morning Dialogue)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/morning/{date}/start` | 朝対話を開始 |
| POST | `/morning/{date}/reply` | ユーザー返答を送信 |
| POST | `/morning/{date}/synthesize` | 計画を総括 |
| GET | `/morning/{date}` | 対話履歴を取得 |
| DELETE | `/morning/{date}` | 対話を削除 |

### 日記対話 (Diary Dialogue)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/diary-dialogue/{date}/start` | AI質問で日記対話を開始 |
| POST | `/diary-dialogue/{date}/reply` | ユーザー返答を送信 |
| POST | `/diary-dialogue/{date}/synthesize` | 記録を合成 |
| GET | `/diary-dialogue/{date}` | 対話履歴を取得 |
| DELETE | `/diary-dialogue/{date}` | 対話を削除 |

### 日記 (Journal)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/journal` | 日記エントリを作成（自動採番、1日複数可） |
| GET | `/journal` | エントリ一覧（start_date, end_date で絞込可） |
| GET | `/journal/by-date/{date}` | 特定日のエントリ一覧 |
| GET | `/journal/entry/{entry_id}` | 特定エントリを取得 |
| PUT | `/journal/entry/{entry_id}` | エントリを更新 |
| DELETE | `/journal/entry/{entry_id}` | エントリを削除 |
| POST | `/journal/entry/{entry_id}/analyze` | AIで分析 |
| POST | `/journal/entry/{entry_id}/summarize` | Markdownサマリー生成 |
| GET | `/journal/digest/{week_id}` | 週次ダイジェストを取得 |
| POST | `/journal/digest/{week_id}/generate` | 週次ダイジェストを生成 |

### ブレインダンプ (Braindump)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/braindump` | メモを作成 |
| GET | `/braindump` | メモ一覧（start_date, end_date で絞込可） |
| GET | `/braindump/by-date/{date}` | 特定日のメモ一覧 |
| GET | `/braindump/dates-with-entries` | エントリのある日付一覧 |
| GET | `/braindump/entry/{entry_id}` | 特定メモを取得 |
| PUT | `/braindump/entry/{entry_id}` | メモを更新 |
| DELETE | `/braindump/entry/{entry_id}` | メモを削除 |
| POST | `/braindump/entry/{entry_id}/generate-title` | AIでタイトル自動生成 |
| POST | `/braindump/upload-image` | 画像をアップロード |

### 単語帳 (Flashcards)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/flashcards` | カードを作成（表面/裏面） |
| GET | `/flashcards` | カード一覧 |
| GET | `/flashcards/{card_id}` | 特定カードを取得 |
| PUT | `/flashcards/{card_id}` | カードを更新 |
| DELETE | `/flashcards/{card_id}` | カードを削除 |
| PUT | `/flashcards/{card_id}/mark` | 覚えた/未チェック切替 |

### コーチング＆知識グラフ (Coaching / Knowledge Graph)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/coach/chat` | コーチング会話（会話履歴付き） |
| GET | `/knowledge/entities` | エンティティ一覧（type, status, limit） |
| GET | `/knowledge/entities/{id}` | 特定エンティティを取得 |
| DELETE | `/knowledge/entities/{id}` | エンティティを削除 |
| GET | `/knowledge/relations` | リレーション一覧（min_strength, limit） |
| DELETE | `/knowledge/relations/{id}` | リレーションを削除 |
| GET | `/knowledge/summary` | 知識グラフのサマリー |

### スクリーンショット (Screenshots)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/screenshots/{date}` | スクショをアップロード＆OCR |
| GET | `/screenshots/{date}/url` | 署名付きURLを取得 |

### カテゴリ (Categories)

| Method | Path | 説明 |
|--------|------|------|
| GET | `/categories` | カテゴリ一覧を取得 |
| PUT | `/categories` | カテゴリを更新 |

### リマインダー (Reminders)

| Method | Path | 説明 |
|--------|------|------|
| GET | `/reminders` | リマインダー（付箋）を取得 |
| PUT | `/reminders` | リマインダーを更新 |

### ヘルスチェック

| Method | Path | 説明 |
|--------|------|------|
| GET | `/` | ルート |
| GET | `/health` | ヘルスチェック |

---

## Firestore コレクション

### `daily_records` — 日次記録

ドキュメントID: `YYYY-MM-DD`

```json
{
  "id": "2026-02-19",
  "date": "2026-02-19",
  "raw_input": "8:00 起床\n8:30-9:00 朝食...",
  "parsed_activities": [
    {
      "start_time": "08:00",
      "end_time": "09:00",
      "activity": "起床・準備",
      "category": "生活|仕事|勉強|娯楽|無駄時間|運動",
      "is_productive": true
    }
  ],
  "screen_time": {
    "raw_image_url": "gs://bucket/screenshots/2026-02-19.png",
    "apps": [
      { "name": "YouTube", "duration_minutes": 120 }
    ],
    "total_screen_time_minutes": 480,
    "extraction_confidence": "high|medium|low"
  },
  "tasks": {
    "planned": ["企画書作成", "コードレビュー"],
    "completed": ["コードレビュー"],
    "completion_rate": 0.5
  },
  "rest_day": false,
  "rest_reason": "",
  "created_at": "2026-02-19T23:00:00+09:00",
  "updated_at": "2026-02-19T23:30:00+09:00"
}
```

### `daily_analyses` — 日次分析結果

ドキュメントID: `YYYY-MM-DD`

```json
{
  "id": "2026-02-19",
  "date": "2026-02-19",
  "summary": {
    "productive_hours": 4.5,
    "wasted_hours": 3.0,
    "youtube_hours": 2.0,
    "task_completion_rate": 0.5,
    "overall_score": 65
  },
  "analysis": {
    "good_points": ["午前中に集中できた"],
    "bad_points": ["YouTube視聴が長かった"],
    "root_causes": ["タスク切り替え時の無意識"],
    "thinking_weaknesses": ["楽観バイアス"],
    "behavior_weaknesses": ["環境設計の不足"],
    "improvement_suggestions": [
      {
        "suggestion": "朝一番にYouTubeをブロック",
        "priority": "high|medium|low",
        "category": "環境設計"
      }
    ],
    "comparison_with_past": {
      "recurring_patterns": ["週3回以上のYouTube2時間超"],
      "improvements_from_last_week": ["起床時間が30分早くなった"]
    }
  },
  "created_at": "2026-02-19T23:30:00+09:00"
}
```

### `weekly_analyses` — 週次分析結果

ドキュメントID: `YYYY-Www`

```json
{
  "id": "2026-W08",
  "week_id": "2026-W08",
  "week_start": "2026-02-16",
  "week_end": "2026-02-22",
  "weekly_summary": {
    "avg_productive_hours": 4.2,
    "avg_wasted_hours": 2.8,
    "avg_task_completion_rate": 0.45,
    "total_youtube_hours": 14.5,
    "avg_overall_score": 52,
    "score_trend": "improving|declining|stable"
  },
  "deep_analysis": {
    "weekly_pattern": "月火は集中力が高いが水曜以降にダレる傾向",
    "biggest_time_wasters": [
      { "activity": "YouTube", "total_hours": 14.5, "trigger": "食後・タスク切り替え時" }
    ],
    "cognitive_patterns": ["完璧主義", "即時報酬バイアス"],
    "improvement_plan": {
      "next_week_goals": ["YouTube視聴を1日1時間以内"],
      "concrete_actions": ["朝一番に最重要タスク30分"],
      "habit_building": ["朝のルーティン化"]
    },
    "progress_vs_last_week": {
      "improved": ["起床時間の安定化"],
      "declined": ["YouTube視聴時間が2時間増加"],
      "unchanged": ["タスク完了率は横ばい"]
    }
  },
  "created_at": "2026-02-23T23:00:00+09:00"
}
```

### `dialogue` — ソクラテス式対話

ドキュメントID: `YYYY-MM-DD`

```json
{
  "date": "2026-02-19",
  "messages": [
    { "role": "assistant", "content": "今日の行動で一番気になった点は？" },
    { "role": "user", "content": "YouTube見すぎた" }
  ],
  "status": "active|synthesized",
  "created_at": "...",
  "updated_at": "..."
}
```

### `morning_dialogue` — 朝の計画対話

ドキュメントID: `YYYY-MM-DD`（dialogue と同構造）

### `diary_dialogue` — 日記対話

ドキュメントID: `YYYY-MM-DD`（dialogue と同構造、AI質問→記録合成）

### `journal_entries` — 日記エントリ

ドキュメントID: `YYYY-MM-DD#N`（1日複数エントリ可）

```json
{
  "entry_id": "2026-02-19#1",
  "date": "2026-02-19",
  "content": "今日は新しいプロジェクトに着手した...",
  "analysis": { "..." },
  "summary_md": "...",
  "created_at": "...",
  "updated_at": "..."
}
```

### `braindump_entries` — ブレインダンプ

ドキュメントID: `braindump#YYYY-MM-DD#N`

```json
{
  "entry_id": "braindump#2026-02-19#1",
  "date": "2026-02-19",
  "title": "AIが自動生成したタイトル",
  "content": "思いついたこと...",
  "images": ["gs://bucket/braindump/..."],
  "created_at": "...",
  "updated_at": "..."
}
```

### `flashcards` — 単語帳カード

ドキュメントID: `fc-{uuid}`

```json
{
  "id": "fc-abc123",
  "front": "表面テキスト",
  "back": "裏面テキスト",
  "remembered": false,
  "created_at": "...",
  "updated_at": "..."
}
```

### `knowledge_graph_entities` — 知識グラフエンティティ

行動パターン・課題・習慣などのエンティティ

```json
{
  "id": "...",
  "entity_type": "behavior|issue|habit|goal",
  "name": "YouTube長時間視聴",
  "status": "active|resolved",
  "metadata": { "..." },
  "created_at": "..."
}
```

### `knowledge_graph_relations` — 知識グラフリレーション

エンティティ間の関係性

```json
{
  "id": "...",
  "source_id": "...",
  "target_id": "...",
  "relation_type": "causes|correlates|improves",
  "strength": 0.8,
  "created_at": "..."
}
```

### `categories` — タスクカテゴリ

カラー付きタスクカテゴリの定義

### `reminders` — リマインダー（付箋）

「今日の気づき」として表示される付箋メモ

---

## フロントエンド画面

| ルート | コンポーネント | 内容 |
|--------|--------------|------|
| `/` | Home | 当日スコア・統計・気づきカルーセル・リマインダー・クイックアクション |
| `/input` `/input/:date` | Input Form | 日次記録の作成・編集（休息日モード、カテゴリ管理、タスク管理） |
| `/history` | History List | カレンダー＆リスト表示の履歴 |
| `/analysis/:date` | Analysis View | 分析結果の詳細表示 |
| `/weekly` `/weekly/:weekId` | Weekly Report | 週次トレンド＆改善計画 |
| `/monthly` `/monthly/:yearMonth` | Monthly Report | 月次サマリー |
| `/suggestions` | Suggestions | 過去の改善提案アーカイブ |
| `/coach` | Coaching Chat | パーソナルコーチング（知識グラフ文脈付き） |
| `/knowledge` | Knowledge Graph | エンティティ可視化・行動パターン |
| `/journal` `/journal/:date` | Journal | 自由形式の日記（1日複数エントリ、AI分析） |
| `/braindump` `/braindump/:date` | Brain Dump | クイックメモ（自動タイトル、画像添付） |
| `/task-stats` | Task Stats | タスク完了率の統計・可視化 |
| `/flashcards` | Flashcard List | 単語帳一覧（2ペインUI、15件ページネーション） |
| `/flashcards/study` | Flashcard Study | 学習モード（フリップ、順序選択、覚えたマーク） |

### UIデザイン

- **テーマ**: サイバーパンク / ダークモード（ライトモード切替対応）
- **フォント**: Space Grotesk (Google Fonts)
- **プライマリカラー**: Cyan (#00d4ff) + ネオングロー
- **アクセント**: Violet (#a855f7), Blue (#3b82f6)
- **スコア表示**: 緑(70+) / 黄(40-69) / 赤(0-39)
- **レスポンシブ**: モバイルファースト、max-width 680px
- **ページ遷移**: スライド＆フェードアニメーション
- **スワイプナビ**: モバイルでのスワイプによるページ移動

### Service Worker

- API呼び出し: Network First
- 静的アセット: Cache First
- キャッシュバージョニングによるデプロイ時更新

---

## AI分析プロンプト

### 日次分析 (`prompts/daily_analysis.py`)

入力: 日付、行動テキスト、タスク計画/完了、スクリーンタイム、過去7日間データ

出力: summary (スコア・時間集計) + analysis (良い点・悪い点・根本原因・改善提案・過去比較)

### 週次分析 (`prompts/weekly_analysis.py`)

入力: 1週間分の日次記録・分析、前週の分析

出力: 週間パターン、最大時間浪費、認知パターン、来週の目標・アクション

### 月次サマリー (`prompts/monthly_summary.py`)

入力: 1ヶ月分の日次・週次データ

出力: 月間の傾向・成長・課題・次月の目標

### ソクラテス式対話 (`prompts/socratic_dialogue.py`)

入力: 日次記録・分析結果

出力: 気づきを促す質問、ユーザー返答への深掘り、対話の総括

### 朝の計画 (`prompts/morning_planning.py`)

入力: 前日の振り返り、今日の予定

出力: タスク優先順位の提案、計画の対話的整理

### 日記対話 (`prompts/diary_dialogue.py`)

入力: 日付、過去の文脈

出力: AI質問による日記エントリの引き出し、構造化された記録の合成

### 日記分析 (`prompts/journal_analysis.py`)

入力: 日記エントリの本文

出力: エントリごとのAI分析

### コーチング (`prompts/coaching.py`)

入力: 会話履歴、知識グラフ文脈、直近の分析データ

出力: パーソナライズされたコーチング応答

### 知識グラフ抽出 (`prompts/knowledge_graph.py`)

入力: 分析結果

出力: 行動パターン・課題・習慣のエンティティとリレーション

### OCR抽出 (`prompts/ocr_extraction.py`)

入力: iPhoneスクリーンタイムのスクリーンショット画像

出力: アプリ名（英語正規化）、使用時間(分)、合計時間、抽出信頼度

---

## 環境変数

```env
ANTHROPIC_API_KEY=sk-ant-xxxxx
GOOGLE_CLOUD_PROJECT=daily-tracker-487904
FIRESTORE_DATABASE=(default)
CLOUD_STORAGE_BUCKET=your-bucket-name
DAILY_ANALYSIS_MODEL=claude-sonnet-4-6
WEEKLY_ANALYSIS_MODEL=claude-sonnet-4-6
OCR_MODEL=claude-sonnet-4-6
ALLOWED_ORIGINS=http://localhost:3000,https://your-app.web.app
```

---

## デプロイ

### GitHub Actions (`deploy.yml`)

**トリガー**: `main` ブランチへの push

1. GCP 認証（Workload Identity）
2. Docker イメージビルド → Artifact Registry へ push
3. Cloud Run デプロイ（512Mi, 1 CPU, 0〜3 インスタンス, timeout 300s）
4. バックエンドURLをフロントエンドに注入
5. Firebase Hosting デプロイ

### 必要な GitHub Secrets

- `WIF_PROVIDER` — Workload Identity Provider
- `WIF_SERVICE_ACCOUNT` — GCP Service Account
- `ANTHROPIC_API_KEY` — Anthropic API Key
- `GCS_BUCKET` — Cloud Storage バケット名
- `ALLOWED_ORIGINS` — CORS オリジン
- `FIREBASE_TOKEN` — Firebase CLI トークン

---

## ローカル開発

```bash
# フロントエンド
cd frontend && python -m http.server 3000

# バックエンド
cd backend && uvicorn main:app --reload --port 8000

# Firestore 認証
gcloud auth application-default login

# Swagger UI
http://localhost:8000/docs
```

---

## 主要機能一覧

1. **日次行動記録** — フリーテキスト入力をClaude APIで構造化
2. **AI分析** — 生産性・時間浪費・タスク完了率の総合分析（スコア0-100）
3. **スクリーンタイムOCR** — iPhoneスクショからアプリ使用時間を自動抽出
4. **タスク管理** — 計画→完了のトラッキングと達成率算出（カテゴリ色分け対応）
5. **週次レビュー** — パターン分析と来週の改善計画
6. **月次サマリー** — 月間の傾向・成長・課題のコーチングサマリー
7. **ソクラテス式対話** — AI質問による深掘り振り返り
8. **朝の計画対話** — タスク優先順位の対話的整理
9. **日記対話** — AI質問で日記を引き出し、記録を合成
10. **日記 (Journal)** — 自由形式の日記（1日複数エントリ、AI分析、週次ダイジェスト）
11. **ブレインダンプ** — クイックメモ（AIタイトル自動生成、画像添付）
12. **単語帳** — 表裏カード学習（2ペインUI、学習モード、順序選択、一括登録）
13. **パーソナルコーチング** — 知識グラフ文脈を活用した対話型コーチ
14. **知識グラフ** — 行動パターン・課題・習慣のエンティティ可視化
15. **タスク統計** — 完了率の可視化・パフォーマンスカード
16. **リマインダー** — 「今日の気づき」付箋カルーセル
17. **休息日モード** — 休日・体調不良の記録
18. **PWA対応** — スマホインストール可能、オフライン対応
19. **ダーク/ライトテーマ** — テーマ切替対応、サイバーパンクUI
20. **スワイプナビ** — モバイルでのスワイプによるページ移動
