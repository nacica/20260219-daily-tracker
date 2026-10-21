# 日次行動分析AI

毎日の行動記録をAIが分析し、改善提案を行うPWAアプリケーション。

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | HTML + CSS + Vanilla JavaScript（PWA） |
| バックエンド | Python FastAPI |
| AI分析 | Claude API（claude-sonnet-4-6） |
| データベース | Firestore |
| ホスティング（フロント） | Firebase Hosting |
| ホスティング（バック） | Cloud Run |

---

## セットアップ手順

### 前提条件

- Python 3.12+
- Firebase プロジェクト（Firestore が有効）
- Anthropic API キー

### 1. リポジトリの準備

```bash
git clone https://github.com/nacica/20260219-daily-tracker.git
cd 20260219-daily-tracker
```

### 2. バックエンドのセットアップ

```bash
cd backend

# 環境変数の設定
cp .env.example .env
# .env を開いて各値を設定する

# 依存パッケージのインストール
pip install -r requirements.txt

# 開発サーバーの起動
uvicorn main:app --reload --port 8000
```

`.env` に設定する値：

```env
ANTHROPIC_API_KEY=sk-ant-xxxxx          # Anthropic コンソールで取得
GOOGLE_CLOUD_PROJECT=your-project-id   # Firebase プロジェクト ID
FIRESTORE_DATABASE=(default)
CLOUD_STORAGE_BUCKET=your-bucket       # Phase 2 以降で使用
DAILY_ANALYSIS_MODEL=claude-sonnet-4-6
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5500
```

### 3. Firebase の設定

```bash
# Firebase CLI のインストール（未インストールの場合）
npm install -g firebase-tools

# ログイン
firebase login

# プロジェクトの初期化（daily-tracker ルートで実行）
firebase use your-project-id
```

Application Default Credentials の設定（ローカル開発時）：

```bash
gcloud auth application-default login
```

### 4. フロントエンドの起動

フロントエンドは静的ファイルのため、任意の HTTP サーバーで起動できます：

```bash
# VS Code の Live Server 拡張機能を使う場合
# frontend/index.html を右クリック → "Open with Live Server"

# Python の場合
cd frontend
python -m http.server 3000

# npx serve の場合
cd frontend
npx serve -p 3000
```

`frontend/index.html` の `window.API_BASE_URL` をバックエンドの URL に合わせてください：

```html
<script>
  window.API_BASE_URL = "http://localhost:8000/api/v1";
</script>
```

---

## 機能概要・API・画面一覧

機能の詳細、画面（ルート）一覧、API エンドポイント、Firestore コレクションは **[spec.md](spec.md)** にまとめている。
バックエンド起動後は `http://localhost:8000/docs` で Swagger UI も確認できる。

---

## 使い方（基本の流れ）

1. **タスク**（トップ）でその日の予定タスクをカテゴリ別に登録し、終わったらチェックする
2. **行動ログ**で行動をタイムライン形式で記録する（自動保存）。帰宅後の活動可能時間も入力する
3. **履歴**から日付を選び「AI で分析する」で日次分析を生成し、必要ならソクラテス式対話で深掘りする
4. 週末に**週次レポート**、月末に**月次レポート**を生成して振り返る
5. 日記・自由帳・トレードメモ・道しるべ・単語帳などは必要に応じて使う

---

## ディレクトリ構成

```
daily-tracker/
├── frontend/          # PWAフロントエンド（静的ファイル）
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js          # Service Worker
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js     # メインロジック・ルーティング
│   │   ├── api.js     # バックエンド通信
│   │   ├── router.js  # SPAルーター
│   │   └── components/
│   │       ├── input-form.js     # 記録入力フォーム
│   │       └── analysis-view.js  # 分析結果表示
│   └── firebase.json
│
├── backend/           # FastAPI バックエンド
│   ├── main.py
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .env.example
│   ├── models/schemas.py
│   ├── routers/
│   │   ├── records.py   # 行動記録 CRUD
│   │   └── analysis.py  # AI 分析エンドポイント
│   ├── services/
│   │   ├── claude_service.py    # Claude API 連携
│   │   └── firestore_service.py # Firestore 操作
│   ├── prompts/
│   │   └── daily_analysis.py   # 分析プロンプト
│   └── utils/helpers.py
│
└── README.md
```

---

## 複数台 PC で開発する

このリポジトリは GitHub (`nacica/20260219-daily-tracker`) で同期しているため、
コードは git で共有し、**秘密情報・ローカル設定だけは各 PC で個別に作成** する運用にする。

### git で同期されるもの / されないもの

| 対象 | git で同期 | 備考 |
|------|:--------:|------|
| `frontend/` `backend/` のソース | ✅ | コードは常に push/pull で同期 |
| `README.md` `CLAUDE.md` `firebase.json` 等 | ✅ | プロジェクト全体の設定 |
| `backend/.env.example` | ✅ | テンプレートのみ。実値は含めない |
| `backend/.env` | ❌ | API キー等を含むため `.gitignore` で除外 |
| `__pycache__/` `venv/` | ❌ | Python のキャッシュ・仮想環境 |
| `.claude/settings.local.json` | ❌ | Claude Code のローカル許可設定 |
| `.vscode/` `.idea/` | ❌ | エディタごとの個人設定 |
| GCP/Firebase 認証ファイル (`*-key.json`) | ❌ | 漏洩防止のため絶対にコミットしない |

### 新しい PC で開発を始める手順

```bash
# 1. リポジトリを clone
git clone https://github.com/nacica/20260219-daily-tracker.git
cd 20260219-daily-tracker

# 2. git の名前を設定（未設定の場合）
git config user.name  "nacica"
git config user.email "mikio.yokohama@gmail.com"

# 3. backend の環境変数を作成（テンプレートからコピーして実値を埋める）
cp backend/.env.example backend/.env
#    → backend/.env を開いて ANTHROPIC_API_KEY, GOOGLE_CLOUD_PROJECT などを設定

# 4. Python 依存をインストール
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate
pip install -r requirements.txt

# 5. Google Cloud 認証（ローカル開発で Firestore を触る場合）
gcloud auth application-default login

# 6. フロント / バックを起動して動作確認
uvicorn main:app --reload --port 8000     # backend で実行
python -m http.server 3000                # frontend ディレクトリで実行
```

### 日々の開発フロー（複数台運用の基本）

```bash
# ★ 作業を始める前に必ず pull
git pull origin main

# ... コードを編集 ...

# 作業が一段落したら add → commit → push
git add <変更ファイル>
git commit -m "feat: ..."
git push origin main
```

**ポイント:**
- 作業開始時の `git pull origin main` を絶対忘れない（忘れるとコンフリクトの原因）
- 別 PC で作業を続ける前に、前の PC で `git push` を済ませる
- PC を切り替えたら、まず `git pull` → そのあとコード編集を始める

### コンフリクトが起きたら

```bash
# 1. 現在の差分を確認
git status

# 2. コンフリクトしたファイルを開いて <<<<<<< ======= >>>>>>> を解決

# 3. 解決したら add → commit
git add <解決したファイル>
git commit
git push origin main
```

判断に迷ったら、片方の PC を「正」とみなして他方を上書きするのが安全。

### 秘密情報の取り扱い（重要）

- **`backend/.env` は絶対にコミットしない** — `.gitignore` で除外済みだが、`git status` で見えていないか毎回確認すること
- **GCP のサービスアカウントキー** (`*-key.json` 等) は git に入れず、`gcloud auth application-default login` でローカル認証する
- 万一 push してしまったら、即座に Anthropic / GCP コンソールでキーをローテーションする

