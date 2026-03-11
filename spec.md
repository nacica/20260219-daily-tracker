# spec.md — 日次行動分析AI 仕様書

## 概要

毎日の行動記録をAIが分析し、改善提案を行うPWAアプリケーション。
単一ユーザー（自分専用）で認証なし。

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
│   │   ├── app.js                  # メインロジック・ユーティリティ
│   │   ├── api.js                  # API通信（fetch ラッパー）
│   │   ├── router.js               # SPA ルーティング
│   │   └── components/
│   │       ├── input-form.js       # 行動記録入力フォーム
│   │       ├── analysis-view.js    # 日次分析結果表示
│   │       ├── history-list.js     # 履歴一覧（カレンダー＆リスト）
│   │       ├── weekly-report.js    # 週次分析レポート
│   │       ├── screenshot-upload.js# スクショアップロード
│   │       └── suggestions.js      # 改善提案アーカイブ
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
│   │   └── screenshots.py          # スクショ＆OCR
│   ├── services/
│   │   ├── claude_service.py       # Claude API 連携
│   │   ├── firestore_service.py    # Firestore CRUD
│   │   ├── ocr_service.py          # Claude Vision OCR
│   │   └── storage_service.py      # Cloud Storage 管理
│   ├── prompts/
│   │   ├── daily_analysis.py       # 日次分析プロンプト
│   │   ├── weekly_analysis.py      # 週次分析プロンプト
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
| POST | `/records` | 日次記録を作成 |
| GET | `/records` | 記録一覧（start_date, end_date で絞込可） |
| GET | `/records/{date}` | 特定日の記録取得 |
| PUT | `/records/{date}` | 記録更新 |
| DELETE | `/records/{date}` | 記録削除 |

### AI分析 (Analysis)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/analysis/{date}/generate` | 日次分析を生成（Claude API） |
| GET | `/analysis/{date}` | 保存済み分析を取得 |
| GET | `/analysis` | 分析一覧 |

### 週次分析 (Weekly)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/weekly/{week_id}/generate` | 週次分析を生成（week_id: YYYY-Www） |
| GET | `/weekly/{week_id}` | 保存済み週次分析を取得 |
| GET | `/weekly` | 週次分析一覧 |

### スクリーンショット (Screenshots)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/screenshots/{date}` | スクショをアップロード＆OCR |
| GET | `/screenshots/{date}/url` | 署名付きURLを取得 |

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

---

## フロントエンド画面

| ルート | コンポーネント | 内容 |
|--------|--------------|------|
| `/` | Home | 当日サマリー＆クイックアクション |
| `/input` | Input Form | 日次記録の作成・編集 |
| `/history` | History List | カレンダー＆リスト表示の履歴 |
| `/analysis/{date}` | Analysis View | 分析結果の詳細表示 |
| `/weekly` | Weekly Report | 週次トレンド＆改善計画 |
| `/suggestions` | Suggestions | 過去の改善提案アーカイブ |

### UIデザイン

- **テーマ**: サイバーパンク / ダークモード
- **フォント**: Space Grotesk (Google Fonts)
- **プライマリカラー**: Cyan (#00d4ff) + ネオングロー
- **アクセント**: Violet (#a855f7), Blue (#3b82f6)
- **スコア表示**: 緑(70+) / 黄(40-69) / 赤(0-39)
- **レスポンシブ**: モバイルファースト、max-width 680px

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
2. **AI分析** — 生産性・時間浪費・タスク完了率の総合分析
3. **スクリーンタイムOCR** — iPhoneスクショからアプリ使用時間を自動抽出
4. **タスク管理** — 計画→完了のトラッキングと達成率算出
5. **週次レビュー** — パターン分析と来週の改善計画
6. **PWA対応** — スマホインストール可能、オフライン対応
7. **サイバーパンクUI** — ダークテーマ、ネオングロー、レスポンシブ
