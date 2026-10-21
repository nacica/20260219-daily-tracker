# PIS × Claude 連携（リモート MCP サーバー）実装指示書

作成日: 2026-10-21
対象リポジトリ: PIS（日次行動分析AI）。既存仕様は `spec.md` を参照。

---

## 0. このタスクの目的

PIS に蓄積した記録（行動ログ・日記・自由帳・トレードメモ等）を、claude.ai / Claude アプリ（スマホ含む）から
**カスタムコネクタ（リモート MCP サーバー）** 経由で参照できるようにする。

- Claude は質問を受けたとき、PIS から関連記録を検索して読み、ユーザー固有の文脈を踏まえて回答する
- 「自分の取扱説明書（プロフィール）」を PIS 内で生成・編集し、Claude が最初に読む前提資料にする
- Claude からの書き込みは **自由帳へのメモ追記のみ** 許可する

### 確定した設計方針

| 項目 | 決定 |
|------|------|
| 認証 | OAuth 2.1（認可コード + PKCE）。単一ユーザーのパスワードログイン |
| 配置 | 既存 FastAPI（Cloud Run）に `/mcp` として同居 |
| 公開範囲 | 全データ（行動ログ・タスク・分析・日記・自由帳・トレードメモ・その他すべて） |
| 書き込み | 自由帳への追記のみ。他は読み取り専用 |
| 非公開の除外 | 「非公開」ラベル / `is_private` フラグの付いた記録は MCP から一切返さない |
| プロフィール | AI 自動生成 → PIS の新画面で手直しして保存 |
| 検索 | 第1段階はキーワード検索。意味検索（ベクトル）は将来の第2段階 |

### 守るべき既存ルール

- フロントエンドは **HTML + CSS + Vanilla JS（ES Modules）のみ**。React・TypeScript・UI フレームワーク・ビルドツールは使わない
- バックエンドは既存の Python FastAPI 構成に従う（`routers/` `services/` `prompts/`）
- フロント変更時は CLAUDE.md の運用ルール（`sw.js` の `CACHE_NAME` +1、`?v=` 一括更新、`no-cache` ヘッダー維持）を必ず守る
- 既存の REST API（`/api/v1`）の挙動は変えない

---

## 1. 全体構成

```
claude.ai / Claude アプリ
   │  (Anthropic のクラウドから接続。Streamable HTTP)
   ▼
Cloud Run: FastAPI
   ├── /api/v1/...                       既存 REST API（変更なし）
   ├── /mcp                              MCP エンドポイント（Bearer トークン必須）
   ├── /.well-known/oauth-protected-resource
   ├── /.well-known/oauth-authorization-server
   ├── /oauth/register                   動的クライアント登録（DCR）
   ├── /oauth/authorize                  ログイン画面 → 認可コード発行
   ├── /oauth/token                      アクセストークン / リフレッシュトークン発行
   └── /api/v1/profile/...               取扱説明書の生成・編集用 REST（PIS 画面用）
   ▼
Firestore（既存コレクション + 新規コレクション）
```

---

## 2. OAuth 実装（最重要・セキュリティ）

### 要件

- MCP 仕様の認可フロー（OAuth 2.1）に準拠する。実装前に **最新の MCP 仕様（Authorization）と Claude ヘルプセンターの「Building custom connectors via remote MCP servers」を必ず確認** すること
- 単一ユーザー専用。ユーザー登録機能は作らない
- Claude の OAuth コールバック URL を許可リストに入れる
  - `https://claude.ai/api/mcp/auth_callback`
  - `https://claude.com/api/mcp/auth_callback`（将来変更予定とされているため両方）
- 動的クライアント登録（DCR）を実装する。ただし登録できる `redirect_uri` は上記許可リストのみに制限する
- PKCE（S256）必須。`state` 検証必須
- トークン有効期限とリフレッシュに対応する（アクセストークン 1 時間、リフレッシュトークン 90 日。リフレッシュ時はローテーション）

### エンドポイント

1. `GET /.well-known/oauth-protected-resource`
   - `resource`（MCP の URL）と `authorization_servers` を返す
2. `GET /.well-known/oauth-authorization-server`
   - `issuer` / `authorization_endpoint` / `token_endpoint` / `registration_endpoint` / `code_challenge_methods_supported: ["S256"]` / `grant_types_supported: ["authorization_code","refresh_token"]` 等
3. `POST /oauth/register`（DCR）
4. `GET /oauth/authorize`
   - サーバーレンダリングの最小 HTML ログイン画面（パスワード 1 項目）。素の HTML/CSS、外部ライブラリ不要
   - 画面に「Claude が PIS の記録を読み取り、自由帳に書き込むことを許可します」と明記
   - 認証成功で認可コード（有効 5 分・1 回限り）を発行し `redirect_uri` へリダイレクト
5. `POST /oauth/token`
   - `authorization_code` と `refresh_token` の両グラントに対応

### 秘密情報

- ログインパスワードは平文で持たない。**bcrypt / argon2 のハッシュ** を環境変数 `MCP_OWNER_PASSWORD_HASH` に入れる（Cloud Run では Secret Manager 経由）
- トークン署名鍵 `MCP_TOKEN_SECRET`（Secret Manager）
- トークンは Firestore にハッシュ化して保存し、生の値は保存しない
- 失敗ログイン 5 回で 15 分ロック（IP 単位）

### `/mcp` のアクセス制御

- `Authorization: Bearer <token>` がない / 無効 / 期限切れ → `401` と `WWW-Authenticate` ヘッダー（`resource_metadata` を含む）を返す
- 全リクエストを `mcp_access_logs` に記録（日時・ツール名・引数の要約・返却件数）。本文は記録しない

### 新規 Firestore コレクション

| コレクション | 内容 |
|------------|------|
| `mcp_oauth_clients` | DCR で登録されたクライアント |
| `mcp_oauth_codes` | 認可コード（期限付き・使い捨て） |
| `mcp_oauth_tokens` | アクセス / リフレッシュトークンのハッシュ、期限、失効フラグ |
| `mcp_access_logs` | アクセスログ（90 日で削除） |

### 既存 REST API について（注意喚起）

- 現状 `/api/v1` は認証なしで公開されている。本タスクの範囲外だが、MCP 側で非公開除外をしても REST 側から読める状態は残る
- 実装後、ユーザーに「REST API にも認証を付けるべき」旨を報告すること（実装はしない）

---

## 3. MCP サーバー実装

### 方針

- 公式 Python MCP SDK（`mcp` パッケージ）を使い、**Streamable HTTP** トランスポートで `/mcp` にマウントする。SSE は使わない
- SDK の API はバージョンで変わるため、最新ドキュメントを確認してから実装する
- 各ツールに `readOnlyHint` 等のアノテーションを付ける（書き込みツールのみ書き込み扱い）
- データ取得は既存の `services/firestore_service.py` を再利用し、新たに `services/pis_context_service.py` を作って **非公開除外・整形・文字数制限をここに集約** する
- 1 回のツール応答は最大 **約 8,000 文字**。超える場合は切り詰め、「続きは条件を絞って再検索してください」と末尾に付ける
- 返却テキストは Markdown。各記録に「種類 / 日付 / ID / ラベル」を付け、Claude が出典を示せるようにする

### ツール一覧

#### 1. `get_profile`（読み取り）

- 「自分の取扱説明書」を返す。Claude が会話の最初に読む前提資料
- ツール説明文に「ユーザー個人に関わる質問では、最初にこのツールを呼ぶこと」と書く
- 未作成時は「プロフィール未作成」と返す

#### 2. `get_recent_context`（読み取り）

- 引数: `days`（既定 7、最大 30）
- 直近の日次分析サマリー（スコア・要点）、直近の週次分析の要点、未完了タスク、道しるべ（アーカイブ除く）、直近の自由帳タイトル一覧を要約して返す

#### 3. `search_pis`（読み取り）

- 引数:
  - `query`（必須。スペース区切りで AND 検索）
  - `sources`（任意。`activity_log` `tasks` `analysis` `journal` `braindump` `trade` `michishirube` `wishlist` `gratitude` `udemy_tips` `flashcards` の配列。省略時は全部）
  - `start_date` / `end_date`（任意。省略時は直近 365 日）
  - `board`（任意。トレードメモのボード指定: `stocks` `cfd-silver` `sumco` `breakout` `crude-oil` `natural-gas`）
  - `limit`（既定 20、最大 50）
- 実装: Firestore に全文検索はないため、期間で絞って取得し Python 側で照合する（単一ユーザーなので件数的に問題ない）
  - 正規化: Unicode NFKC、英字小文字化、全角半角統一、カタカナ / ひらがな同一視
  - 照合対象: 本文・タイトル・ラベル・タスク文字列・分析の文章フィールド
  - 並び: 一致数の多い順 → 新しい順
  - 各ヒットはマッチ箇所前後 200 文字のスニペット + `type` + `id` + `date`
- 将来の意味検索に差し替えやすいよう、検索ロジックは `services/pis_search_service.py` に分離し、インターフェース（引数・返り値）を固定する

#### 4. `get_entry`（読み取り）

- 引数: `type`、`id`
- 検索結果の 1 件を全文で返す（日次記録なら raw_input と分析の要点、日記なら本文と要約、自由帳なら本文と画像 URL）

#### 5. `get_day`（読み取り）

- 引数: `date`（YYYY-MM-DD）
- その日の行動ログ・タスク・日次分析・日記・自由帳・トレードメモをまとめて返す

#### 6. `add_braindump_note`（書き込み・唯一）

- 引数: `body`（必須）、`title`（任意。省略時は既存のタイトル自動生成を使う）、`labels`（任意）、`board`（任意。トレードメモに入れたいとき）
- 保存先は既存の `braindump_entries`。日付は今日（Asia/Tokyo）
- ラベル `from-claude` を必ず自動付与（後から Claude 経由の追記だと分かるように）
- 削除・更新ツールは作らない

---

## 4. 非公開（Claude に渡さない記録）

### データ仕様

- 自由帳・トレードメモ・Udemy Tips: 既存のラベル機能で `非公開` ラベルが付いていれば除外
- その他のコレクション: 各ドキュメントに `is_private: bool`（既定 false）を追加
  - 対象: `journal_entries` `daily_records` `wishlist` `gratitude_entries` `flashcards`、`reminders` 内の各付箋
- 判定は `pis_context_service.is_private(doc)` 1 か所に集約し、**すべての MCP ツールとプロフィール生成で必ず通す**
- 既存ドキュメントにフィールドがない場合は false 扱い（マイグレーション不要）

### UI（Vanilla JS）

- 日記・やりたいこと・ありがたいノート・単語帳・道しるべの各エントリに 🔒 トグルを追加（押すと `is_private` を切替）
- 行動ログページには「この日を Claude に渡さない」トグル
- 非公開のエントリは一覧で 🔒 アイコンを表示
- 自由帳系はラベルで管理するので UI 変更不要。ラベル管理モーダルで `非公開` が分かるよう 🔒 を付けて表示

---

## 5. 自分の取扱説明書（プロフィール）

### 新規コレクション `user_profile`（ドキュメント ID: `global`）

```json
{
  "content": "Markdown 本文（確定版）",
  "draft": "AI 生成の下書き（未確定）",
  "generated_at": "...",
  "edited_at": "...",
  "source_range": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }
}
```

### 生成

- `POST /api/v1/profile/generate` → `draft` に保存（`content` は上書きしない）
- 入力: 直近 3 か月の月次サマリー、直近 12 週の週次分析、やりたいことリスト、道しるべ、トレードメモのラベル集計、現在の `content`（あれば差分更新させる）。**非公開は除外**
- `prompts/profile_generation.py` を新規作成。出力構成:
  1. 基本情報と現在の目標
  2. 強み・得意なやり方
  3. 繰り返し出る失敗パターン・思考の癖
  4. 集中できる条件 / できない条件
  5. 進行中のプロジェクト
  6. 判断の基準・大事にしていること
  7. Claude に回答してほしいスタイル
- 全体で 2,000〜3,000 文字以内
- モデルは既存の `DAILY_ANALYSIS_MODEL` を流用（`claude_service.py` に `generate_profile` を追加し、`_call_claude_with_retry` を通す）

### 画面 `#/profile`（新規 `profile.js`、Vanilla JS）

- 左（スマホでは上）: 確定版 `content` の編集エリア（既存の floating-toolbar を使える形で）
- 右（スマホでは下）: 下書き `draft` の表示と「AI で下書きを生成」ボタン
- 「下書きを採用」で `content` に反映 → 手直し → 自動保存（1.5 秒）
- サイドバー / ホームランチャーのナビ定義に「取扱説明書」を追加
- 月初に「取扱説明書を更新しませんか？」バナーを表示（前回 `generated_at` が 30 日以上前のとき）

### REST

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/v1/profile` | 取得 |
| PUT | `/api/v1/profile` | `content` を保存 |
| POST | `/api/v1/profile/generate` | 下書き生成 |

---

## 6. 段階的な実装計画

各フェーズの終わりで動作確認し、ユーザーに報告してから次へ進むこと。

### フェーズ 1: OAuth + MCP の土台

- OAuth 一式（メタデータ・DCR・ログイン画面・トークン）
- `/mcp` に Streamable HTTP の MCP サーバーをマウント
- ダミーの `get_profile`（固定文を返す）だけ実装
- ゴール: claude.ai でコネクタ登録 → ログイン → ツールが呼べる

### フェーズ 2: 読み取りツール + 非公開除外

- `pis_context_service` / `pis_search_service` 作成
- `get_recent_context` `search_pis` `get_entry` `get_day` 実装
- `is_private` フィールドと 🔒 UI、`非公開` ラベル除外

### フェーズ 3: 取扱説明書

- `user_profile`、生成プロンプト、REST、`#/profile` 画面
- `get_profile` を本実装に差し替え

### フェーズ 4: 書き込み

- `add_braindump_note` 実装（`from-claude` ラベル自動付与）

### フェーズ 5（将来・今回は実装しない）

- 意味検索（Vertex AI Embeddings 等 + ベクトル検索）を `pis_search_service` の裏側に追加
- REST API `/api/v1` への認証追加

---

## 7. 動作確認チェックリスト

### 認証

- [ ] トークンなしで `/mcp` を叩くと 401 と `WWW-Authenticate` が返る
- [ ] 誤ったパスワードでログインできない。5 回失敗でロックされる
- [ ] 許可リスト外の `redirect_uri` で DCR / 認可が拒否される
- [ ] PKCE の `code_verifier` 不一致でトークン発行が拒否される
- [ ] 認可コードの 2 回目の使用が拒否される
- [ ] アクセストークン期限切れ後、リフレッシュで自動的に再接続できる
- [ ] Firestore にトークンの生の値が保存されていない

### claude.ai 連携

- [ ] 設定 → Connectors → 「Add custom connector」で `https://<Cloud Run URL>/mcp` を登録できる
- [ ] PC ブラウザ・スマホアプリの両方からツールが呼べる
- [ ] 「私の最近の傾向は？」で `get_profile` → `get_recent_context` が呼ばれる
- [ ] 「銀CFDで勝った日の共通点は？」で `search_pis`（board 指定）が呼ばれ、出典の日付付きで答える

### 非公開

- [ ] `非公開` ラベルの自由帳メモが `search_pis` `get_day` `get_entry` のどれにも出ない
- [ ] `is_private: true` の日記・行動ログが出ない
- [ ] 非公開記録がプロフィール生成の入力に含まれない
- [ ] 非公開記録の ID を `get_entry` に直接指定しても返らない

### 書き込み

- [ ] 「このアイデアを PIS に保存して」で今日の自由帳に追加され、`from-claude` ラベルが付く
- [ ] board 指定でトレードメモのボードに入る
- [ ] 他コレクションへの書き込み手段が存在しない

### 応答品質

- [ ] 1 回の応答が約 8,000 文字を超えない
- [ ] 各記録に種類・日付・ID が付いている

### デプロイ

- [ ] GitHub Actions で Cloud Run と Firebase Hosting が正常デプロイされる
- [ ] Secret Manager の値が Cloud Run に渡っている
- [ ] `CACHE_NAME` と `?v=` が更新され、スマホ PWA で新画面が表示される
- [ ] `spec.md` に MCP・プロフィール・非公開の仕様を追記した

---

## 8. 完了報告に含めること

- コネクタ登録用の URL
- 追加した環境変数・シークレットの一覧と設定方法（パスワードハッシュの作り方を含む）
- 既存 REST API が無認証である件の注意喚起
- 未実装事項（フェーズ 5）

---

## 付録: claude.ai の個人設定に貼る文

claude.ai の「設定 → プロフィール → 個人設定」に追記する。

```
【PIS参照ルール】
私には自作の記録アプリ「PIS」があり、コネクタで接続している。
・私個人に関わる質問（仕事・投資・トレード・学習・生活習慣・目標・アイデア・判断の相談など）では、回答前に必ずPISを参照する。
・最初にget_profileで私の取扱説明書を読み、必要に応じてsearch_pisやget_recent_contextで関連記録を探す。
・PISの記録を根拠にした部分は、どの日付の記録かを示す。
・一般知識だけで答えられる質問（用語の意味、一般的な手順など）ではPISを参照しなくてよい。
・私が「PISに保存して」と言ったときは、add_braindump_noteで自由帳に追記する。それ以外で勝手に書き込まない。
```
