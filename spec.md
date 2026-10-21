# spec.md — 日次行動分析AI 仕様書・機能概要

最終更新: 2026-10-21

## 概要

毎日の行動記録と予定タスクを入力し、AI（Claude）が生産性・時間の使い方・思考の癖を分析して改善提案を返す PWA アプリケーション。
単一ユーザー（自分専用）で認証なし。行動記録を軸に、日記・自由帳（メモ）・トレードメモ・単語帳・やりたいことリスト・ありがたいノート・道しるべ（付箋）など、自己改善のためのツール群を 1 つのアプリにまとめている。

- **URL**: Firebase Hosting（フロント） + Cloud Run（バックエンド API）
- **対象端末**: スマホ（PWA としてホーム画面に追加）と PC ブラウザの両方。画面幅 1024px を境にレイアウトが切り替わる
- **データ**: すべて Firestore に保存し、PC とスマホで同じ内容を見る。画像は Cloud Storage

---

## 技術スタック

| レイヤー | 技術 | 補足 |
|---------|------|------|
| フロントエンド | HTML + CSS + Vanilla JS（ES Modules） | フレームワーク・ビルドツール不使用。PWA（Service Worker + manifest） |
| バックエンド | Python FastAPI | `/api/v1` 配下に REST API |
| AI | Claude API（claude-sonnet-4-6） | 日次・週次・月次分析、対話、要約、タイトル生成、行動テキストの構造化 |
| データベース | Firestore（default） | コレクション一覧は後述 |
| 画像保存 | Cloud Storage | 自由帳・単語帳の画像 |
| フロントホスティング | Firebase Hosting | HTML/CSS/JS/sw.js は `no-cache` ヘッダー |
| バックホスティング | Cloud Run（asia-northeast1） | min-instances 0。起動時にフロントから `/health` を先行で叩いてコールドスタートを隠す |
| CI/CD | GitHub Actions | `main` への push で両方を自動デプロイ |

---

## 機能概要（詳細）

### 1. タスク（`#/`）

その日の「予定タスク」と「完了タスク」を管理するトップページ。常に今日のレコードを対象にする。

- **カテゴリ別カード**: 予定タスクはカテゴリ（例: 株式投資・仕事）ごとに独立したカードに分かれる。定義済みカテゴリはタスク 0 件でもカードを出し、カテゴリなしのタスクは「未分類」カードに入る。カテゴリ定義から消えたカテゴリのタスクも独立カードとして残る
- **追加**: 各カードの上と下に「タスクを追加」欄があり、どちらから追加してもリスト末尾に入る。追加ボタン押下でのみ登録（Enter では登録しない）
- **完了 / 編集 / 削除**: チェックで「完了タスク」カードへ移動（+1 のフローティングアニメーション）。チェックを外すと元のカテゴリカードへ戻る。✎ でインライン編集、✕ で削除
- **並べ替え**: ⠿ ハンドルのドラッグでリスト内の順序を変更（PC はマウス、スマホは長押し）。PC では別カテゴリのカードへドロップするとカテゴリが付け替わる
- **達成までの期間**: 完了タスクには「追加日 → 完了日（達成までの期間）」を表示。24 時間以内は「◯時間◯分で達成」、それ以上は 24 時間単位で「◯日目に達成」。追加日時・完了日時はサーバー（`task_meta`）に保存し、機能追加前のタスクは直近の記録から推定する
- **予定タスクの引き継ぎ**: 今日の記録がまだ無い初回表示時、直近の記録の未完了タスクを自動で予定リストに載せる（完了または削除するまで毎日残る）
- **カテゴリ管理カード**: カテゴリの追加・削除。追加するとカードがその場で増える。カテゴリはサーバー（`categories`）と localStorage の両方に保存
- **デスクトップのレイアウト**: 1〜4 列の切り替えボタンと、カードのドラッグ＆ドロップ配置（masonry）。列数と配置は localStorage に保存
- **保存**: 操作のたびに自動保存。タスク関連フィールド（`tasks_planned` / `tasks_completed`）だけを部分更新するので、行動ログページの内容を上書きしない

### 2. 行動ログ（`#/log`, `#/log/:date`）

その日の行動をタイムライン形式で記録するページ。ヘッダーの日付（カレンダー）から過去日の編集もここで行う。

- **タイムライン入力**: 「開始時刻 + 内容」の行を並べる。「+終了」で終了時刻を追加。Enter で次の行を作成（前の行の終了時刻を開始時刻に引き継ぎ）。時刻を空のまま内容だけ入力して確定すると現在時刻を自動補完し、一瞬光らせて知らせる。入力を終えた行は 1 行に折りたたまれ、クリックで再展開
- **行操作**: ▲▼ で上下移動、✕ で削除、「↕ 時刻順」で時刻順に並べ替え。上部「＋ 追加」（スマホ）は先頭に、下部「＋ 行動を追加」は末尾に行を足す
- **自由入力モード**: タイムラインと自由テキストを相互変換して切り替え。保存形式は `raw_input`（1 行 1 行動のテキスト）で共通
- **活動可能時間**: 帰宅後の自由時間を 2h/4h/6h/8h のプリセットまたは数値で入力。AI 分析がこの時間を前提に評価する
- **おやすみモード**: 「今日はおやすみ」でその日を分析対象外にする（理由: 残業・体調不良・出張・予定あり・その他）。解除も可能
- **自動保存**: 入力が止まって 1.5 秒後に自動保存。行動ログ関連フィールド（`raw_input` / `available_hours`）だけを部分更新する
- **保存の耐障害性**（通信失敗で入力を失わないための仕組み）:
  - 入力のたびに端末へ下書き（`log_draft`）を保存し、次回表示時にサーバー内容へマージして自動再送
  - 行単位の 3-way マージ（表示時点 / この端末 / サーバー最新）で、この端末の追加・削除だけを反映し、他端末で増えた行は残す
  - 表示時にサーバーへ繋がらない場合は手元の表示を消さず、保存前に最新を取り直してからマージ
  - 失敗時は 2→5→12 秒で再試行し、オンライン復帰・前面復帰時にも再送。バックグラウンドに回る直前は keepalive 付きで即時送信
- **楽観描画**: 前回表示時のキャッシュ（localStorage）で即描画し、API 応答後に最新で描き直す。保存成功時にもキャッシュを更新

### 3. AI 日次分析（`#/analysis/:date`）

- **分析生成**: 行動ログ・タスク・活動可能時間・過去 7 日の記録と分析を入力に、Claude が総合分析を生成。分析対象外（おやすみ）の日は生成しない
- **出力**: スコア（0〜100）、生産的時間 / 浪費時間、タスク完了率、良い点・悪い点、根本原因、思考の癖・行動の癖、優先度付き改善提案、過去との比較（繰り返しパターン・先週からの改善）
- **画面の 4 状態**: 分析済み / 対話中 / 記録あり未分析 / 記録なし。「記録を編集」から行動ログページへ
- **ソクラテス式対話**: 分析結果をもとに AI が気づきを促す質問を出し、返答への深掘りを繰り返す。最後に「総括」で対話内容を分析へ反映。対話は削除してやり直せる
- **行動テキストの構造化**: 記録作成時に `raw_input` を Claude が活動リスト（開始・終了・内容・カテゴリ・生産的か）へパースして保存

### 4. 履歴（`#/history`）

- **カレンダービュー**: 月ごとにスコアで色分け（緑 70 以上 / 黄 40〜69 / 赤 39 以下）。記録のある日を表示
- **リストビュー**: 日付ごとのスコアと概要。クリックで分析画面へ

### 5. 週次レポート（`#/weekly`, `#/weekly/:weekId`）

- 1 週間分の日次記録・分析と前週の分析から、週間パターン・最大の時間浪費（活動・時間・きっかけ）・認知パターン・来週の目標 / 具体行動 / 習慣化・前週比（改善・悪化・横ばい）を生成
- 「← 先週 / 今週 →」で週を移動。「🔄 再分析」で再生成

### 6. 月次レポート（`#/monthly`, `#/monthly/:yearMonth`）

- 1 か月分の日次・週次データから、月間の傾向・成長・課題・次月の目標をコーチング形式でまとめる（`coaching_summaries`）
- 前月 / 次月の移動、生成・再生成

### 7. 日記（フリージャーナル）（`#/journal`, `#/journal/:date`）

- **複数エントリ**: 1 日に複数の日記を作成。各エントリに独立した AI 分析と Markdown 要約
- **書式ツールバー**: 範囲選択で太字 / 赤文字 / 文字サイズ 5 段階（共通フローティングツールバー）
- **日記対話**: AI が質問を投げ、返答を重ねて最後に記録として合成する（`diary_dialogues`）
- **週次ダイジェスト**: 1 週間分の日記をまとめた要約を生成・閲覧

### 8. 自由帳（旧ブレインダンプ）（`#/braindump`）

- **メモ帳**: 1 日に複数メモ。自動保存。「＋ 新しいメモ」で日時ヘッダーを自動挿入
- **AI 支援**: タイトル自動生成、Markdown 要約
- **画像**: 貼り付け・📷 ボタンでアップロード（Cloud Storage）。スマホからの写真追加に対応
- **ラベル**: メモごとに複数ラベル、ラベルによる OR 検索、ラベル管理モーダル（改名・削除）
- **並べ替え**: 同じ日のメモの順序を変更
- **書式ツールバー**: 太字 / 赤文字 / 文字サイズ

### 9. トレードメモ（`#/stocks` `#/cfd-silver` `#/sumco` `#/breakout` `#/crude-oil` `#/natural-gas`）

- 自由帳と同じ仕様の専用ページ。株全般 / CFD銀 / sumcoデイトレ / 新高値ブレイク / 原油 / 天然ガス の 6 ボード
- データは自由帳と同じ保存先を共有し、`board` フィールドで絞り込む。自由帳本体は全メモを表示する

### 10. 道しるべ（今日意識すること）（`#/michishirube`）

- 付箋形式のリマインダー一覧。追加・編集・アーカイブ（「アーカイブ」タブで復元可）
- 詳細モーダルで 1 枚ずつ表示。前へ / 次へ、ランダム表示、文字スタイル（サイズ）設定
- Markdown 描画対応（Claude などから貼り付けた表・箇条書き・見出し・太字を整形）
- サーバー（`reminders`）と端末キャッシュを同期

### 11. Udemy 制作 Tips（`#/udemy-tips`）

- コース制作の小技をカード一覧で管理。「＋ 新しい Tip」で作成、クリックで中央モーダル編集（自動保存）
- タグ（複数）付与、タグフィルタ、タグ管理（改名・削除）
- ソート: タグ順 / 日付順 / 名前順。同日内の並べ替え
- 書式ツールバー・画像対応

### 12. やりたいことリスト（`#/wishlist`）

- 「やりたい」「達成済み」の 2 タブ。カード表示 / リスト表示を切り替え（設定は localStorage）
- 優先度 ★1〜5 の高い順（同順位は新しい順）
- チェックで達成済みへ移動し達成日を自動記録。達成済みから戻すことも可能。編集・削除

### 13. ありがたいノート（`#/gratitude`）

- 「今恵まれている点 / 感謝できる対象」をその都度書き残す。複数行入力 + 追加ボタン
- 新しい順のフラットリスト（日付バッジ付き）。各エントリは編集・削除可能

### 14. タスク実績（`#/task-stats`）

- 今日 / 今週 / 今月の完了数サマリーカード（前期間との比較）
- 日別 / 週別 / 月別タブの棒グラフ
- タスク完了時の +1 フローティングアニメーション（タスクページで使用）

### 15. 単語帳（`#/flashcards`, `#/flashcards/study`）

- **一覧**: 2 ペイン（左: 問題リスト、右: 回答）。キーボード ↑↓ またはタップで切り替え。追加・編集・削除、画像添付、太字 / 文字サイズ
- **一括追加**: Markdown 形式のテキストを貼り付けて複数カードを一度に登録（プレビュー付き）
- **学習モード**: タップで裏返し、スワイプまたはボタンで「覚えた / まだ」を評価。出題順はランダム / 古い順 / 新しい順。学習中にカード編集可能

### 16. ホーム画面・ナビゲーション

- **ホームランチャー（スマホ）**（`#/home`）: 起動時は必ずアイコン集の画面から始まり、バックグラウンドから 5 分以上経って戻った場合もホームへ戻る。タイルはサイドバーのナビ定義を複製して表示
- **メニューの並び替え**: サイドバー（PC）とホームのタイル（スマホ）をドラッグで並び替え。順番はサーバー（`nav-order`）に保存して PC とスマホで共有。初期順に戻すことも可能
- **スワイプナビ（スマホ）**: 左右スワイプでページ移動。順番はメニューの並び順に従う
- **ナビの折りたたみ（スマホ）**: ホームから各ページへ移動すると上部ナビは折りたたまれ、∧ で展開。状態は localStorage
- **デスクトップヘッダー**: ページタイトルとパンくず、現在日時（コロン点滅）。日時クリックでカレンダーを開き、日付を選ぶとその日の行動ログへ
- **サイドバー幅のリサイズ（PC）**: 境界線のドラッグで 100〜600px、ダブルクリックで初期値。localStorage に保存
- **テーマ**: ダーク（サイバーパンク調、シアンのネオン）/ ライト切り替え
- **旧 URL の互換**: `#/edit/:date` `#/input` `#/input/:date` は新 URL へリダイレクト

### 17. Claude 連携（リモート MCP サーバー）— フェーズ 1

claude.ai / Claude アプリのカスタムコネクタとして PIS に接続するための土台。詳細な計画は `PIS_MCP_指示書.md`。

- **エンドポイント**: 既存の Cloud Run（FastAPI）に同居。`/mcp`（Streamable HTTP、stateless + JSON 応答）
- **認証**: OAuth 2.1（認可コード + PKCE S256、`state`、`resource` 検証）。単一ユーザーのパスワードログイン
  - `GET /.well-known/oauth-authorization-server`（RFC 8414）/ `GET /.well-known/oauth-protected-resource[/mcp]`（RFC 9728）
  - `POST /oauth/register`（動的クライアント登録。redirect_uri は claude.ai / claude.com のコールバックのみ許可）
  - `GET/POST /oauth/authorize`（サーバー描画のログイン画面。認可コードは 5 分・1 回限り）
  - `POST /oauth/token`（`authorization_code` / `refresh_token`。アクセス 1 時間、リフレッシュ 90 日でローテーション。再利用検知で同系統を一括失効）
  - トークン・認可コード・クライアントシークレットは HMAC-SHA256 のハッシュだけを Firestore に保存
  - ログイン失敗は IP 単位で 5 回 → 15 分ロック
  - `/mcp` はトークン無し・無効で `401` + `WWW-Authenticate: Bearer resource_metadata=...`
- **ツール**（フェーズ 1）: `get_profile`（固定文のダミー。フェーズ 3 で本実装）。呼び出しは `mcp_access_logs` に記録（本文は記録しない、90 日で削除）
- **環境変数**: `MCP_PUBLIC_URL`（公開 URL）、`MCP_OWNER_PASSWORD_HASH`（bcrypt。`backend/scripts/make_password_hash.py`）、`MCP_TOKEN_SECRET`、`MCP_ALLOWED_REDIRECT_URIS`（任意）、`MCP_ALLOW_LOCALHOST_REDIRECT`（ローカル検証用）
- **Firestore**: `mcp_oauth_clients` / `mcp_oauth_codes` / `mcp_oauth_tokens` / `mcp_login_attempts` / `mcp_access_logs`
- **実装ファイル**: `backend/mcp_server.py`（MCP サーバーとツール）、`backend/routers/mcp_oauth.py`（OAuth エンドポイント）、`backend/services/mcp_auth_service.py`（検証・発行・ストア）
- 未実装（次フェーズ）: 読み取りツール群と非公開除外、取扱説明書、自由帳への書き込み、意味検索、REST API への認証

### 18. PWA・キャッシュ

- ホーム画面へのインストール、Service Worker によるオフライン表示
- 静的アセットは Stale-While-Revalidate、API と index.html / sw.js は Network First
- デプロイごとに SW の `CACHE_NAME` と `?v=` を更新して古いコードが残らないようにする（運用ルールは CLAUDE.md）

---

## 画面一覧（ルート）

| ルート | 画面 | コンポーネント |
|--------|------|--------------|
| `/` | タスク | input-form.js（renderTasksPage） |
| `/log` `/log/:date` | 行動ログ | input-form.js（renderActivityLog） |
| `/analysis/:date` | 日次分析（ソクラテス式対話含む） | analysis-view.js |
| `/history` | 履歴（カレンダー / リスト） | history-list.js |
| `/weekly` `/weekly/:weekId` | 週次レポート | weekly-report.js |
| `/monthly` `/monthly/:yearMonth` | 月次レポート | monthly-report.js |
| `/journal` `/journal/:date` | 日記（フリージャーナル） | journal.js |
| `/braindump` | 自由帳 | braindump.js |
| `/stocks` `/cfd-silver` `/sumco` `/breakout` `/crude-oil` `/natural-gas` | トレードメモ（ボード） | braindump.js（board 指定） |
| `/michishirube` | 道しるべ（付箋） | michishirube.js |
| `/udemy-tips` | Udemy 制作 Tips | udemy-tips.js |
| `/wishlist` | やりたいことリスト | wishlist.js |
| `/gratitude` | ありがたいノート | gratitude.js |
| `/task-stats` | タスク実績 | task-stats.js |
| `/flashcards` `/flashcards/study` | 単語帳（一覧 / 学習） | flashcard-list.js / flashcard-study.js |
| `/home` | ホームランチャー（スマホ） | home-launcher.js |
| `/edit/:date` `/input` `/input/:date` | 旧 URL（リダイレクト） | — |

### 共通モジュール

| ファイル | 役割 |
|---------|------|
| `js/app.js` | ルーティング設定、デスクトップヘッダー、日付ピッカー、ホーム制御、バックエンドのウォームアップ、トースト |
| `js/router.js` | ハッシュベースの SPA ルーター、ナビの active 表示 |
| `js/api.js` | fetch ラッパーと各 API クライアント |
| `js/nav-order.js` | メニューのドラッグ並び替えとサーバー同期 |
| `js/swipe-nav.js` | スワイプによるページ移動 |
| `js/sidebar-resize.js` | サイドバー幅のドラッグリサイズ |
| `js/floating-toolbar.js` | 共通の書式ツールバー（太字 / 赤文字 / 文字サイズ / 📷）と Markdown ⇔ DOM 変換 |

---

## API エンドポイント

ベースパス: `/api/v1`。バックエンド起動後 `http://localhost:8000/docs` で Swagger UI を確認できる。

### 行動記録 (Records)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/records` | 日次記録を作成（`raw_input` を Claude で構造化） |
| GET | `/records` | 記録一覧（start_date, end_date で絞込） |
| GET | `/records/{date}` | 特定日の記録 |
| PUT | `/records/{date}` | 記録の部分更新（raw_input / tasks_planned / tasks_completed / available_hours など送ったフィールドのみ） |
| PUT | `/records/{date}/rest-day` | おやすみモードの切替 |
| DELETE | `/records/{date}` | 記録削除 |

### AI 分析 (Analysis / Weekly / Summaries)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/analysis/{date}/generate` | 日次分析を生成（過去 7 日比較付き） |
| GET | `/analysis/{date}` | 保存済み日次分析 |
| GET | `/analysis` | 日次分析一覧 |
| POST | `/weekly/{week_id}/generate` | 週次分析を生成（week_id: YYYY-Www） |
| GET | `/weekly/{week_id}` | 保存済み週次分析 |
| GET | `/weekly` | 週次分析一覧 |
| POST | `/summaries/generate/{year_month}` | 月次サマリーを生成 |
| GET | `/summaries/{year_month}` | 保存済み月次サマリー |
| GET | `/summaries` | 月次サマリー一覧 |

### 対話 (Dialogue / Diary Dialogue)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/dialogue/{date}/start` | ソクラテス式対話を開始 |
| POST | `/dialogue/{date}/reply` | 返答を送信 |
| POST | `/dialogue/{date}/synthesize` | 対話を総括して分析へ反映 |
| GET / DELETE | `/dialogue/{date}` | 対話の取得 / 削除 |
| POST | `/diary-dialogue/{date}/start` | 日記対話を開始（AI 質問） |
| POST | `/diary-dialogue/{date}/reply` | 返答を送信 |
| POST | `/diary-dialogue/{date}/synthesize` | 記録を合成 |
| GET / DELETE | `/diary-dialogue/{date}` | 対話の取得 / 削除 |

### 日記 (Journal)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/journal` | エントリ作成（1 日複数可） |
| GET | `/journal` | 一覧（start_date, end_date） |
| GET | `/journal/by-date/{date}` `/journal/{date}` | 特定日の一覧 |
| GET / PUT / DELETE | `/journal/entry/{entry_id}` | エントリの取得 / 更新 / 削除 |
| POST | `/journal/entry/{entry_id}/analyze` | AI 分析 |
| POST | `/journal/entry/{entry_id}/summarize` | Markdown 要約 |
| GET | `/journal/digest/{week_id}` | 週次ダイジェスト取得 |
| POST | `/journal/digest/{week_id}/generate` | 週次ダイジェスト生成 |

### 自由帳 / トレードメモ (Braindump)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/braindump` | メモ作成（`board` 指定でトレードメモ） |
| GET | `/braindump` | 一覧（start_date, end_date, board） |
| GET | `/braindump/dates-with-entries` | メモのある日付一覧 |
| GET | `/braindump/by-date/{date}` | 特定日の一覧（board） |
| POST | `/braindump/by-date/{date}/reorder` | 同日内の並び替え |
| GET / PUT / DELETE | `/braindump/entry/{entry_id}` | メモの取得 / 更新 / 削除 |
| POST | `/braindump/entry/{entry_id}/generate-title` | AI タイトル生成 |
| POST | `/braindump/summarize` | AI Markdown 要約 |
| POST | `/braindump/upload-image` | 画像アップロード |
| GET | `/braindump/labels` | ラベル一覧（件数付き、board） |
| POST | `/braindump/labels/rename` | ラベル改名 |
| DELETE | `/braindump/labels/{name}` | ラベル削除 |

### Udemy Tips

| Method | Path | 説明 |
|--------|------|------|
| POST | `/udemy-tips` | Tip 作成 |
| GET | `/udemy-tips` | 一覧 |
| GET | `/udemy-tips/by-date/{date}` | 特定日の一覧 |
| POST | `/udemy-tips/by-date/{date}/reorder` | 同日内の並び替え |
| GET / PUT / DELETE | `/udemy-tips/entry/{entry_id}` | 取得 / 更新 / 削除 |
| GET | `/udemy-tips/labels` | タグ一覧 |
| POST | `/udemy-tips/labels/rename` | タグ改名 |
| DELETE | `/udemy-tips/labels/{name}` | タグ削除 |

### 単語帳 (Flashcards)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/flashcards` | カード作成（表 / 裏） |
| GET | `/flashcards` | 一覧 |
| GET / PUT / DELETE | `/flashcards/{card_id}` | 取得 / 更新 / 削除 |
| PUT | `/flashcards/{card_id}/mark` | 覚えた / まだ の切替 |
| POST | `/flashcards/upload-image` | 画像アップロード |

### やりたいことリスト (Wishlist) / ありがたいノート (Gratitude)

| Method | Path | 説明 |
|--------|------|------|
| POST | `/wishlist` | 項目作成 |
| GET | `/wishlist` | 一覧 |
| GET / PUT / DELETE | `/wishlist/{item_id}` | 取得 / 更新 / 削除 |
| PUT | `/wishlist/{item_id}/complete` | 達成 / 未達成の切替（達成日を記録） |
| POST | `/gratitude` | エントリ作成 |
| GET | `/gratitude` | 一覧 |
| GET | `/gratitude/recent` | 直近のエントリ |
| GET / PUT / DELETE | `/gratitude/{entry_id}` | 取得 / 更新 / 削除 |

### 設定・補助

| Method | Path | 説明 |
|--------|------|------|
| GET / PUT | `/categories` | タスクカテゴリ一覧の取得 / 全件上書き |
| GET / PUT | `/reminders` | 道しるべ（付箋）の取得 / 全件上書き |
| GET | `/task-meta` | タスクの追加日時・完了日時を全件取得 |
| POST | `/task-meta` | 複数件 upsert（送ったフィールドだけマージ） |
| POST | `/task-meta/delete` | 名前で削除 |
| GET / PUT | `/nav-order` | メニュー並び順の取得 / 保存（空配列で初期順） |
| GET | `/` `/health` | ヘルスチェック |

---

## Firestore コレクション

| コレクション | ドキュメント ID | 内容 |
|------------|---------------|------|
| `daily_records` | `YYYY-MM-DD` | 日次記録。`raw_input`（1 行 1 行動）、`parsed_activities`（Claude で構造化）、`tasks { planned, completed, completion_rate }`、`rest_day` / `rest_reason`、`available_hours` |
| `daily_analyses` | `YYYY-MM-DD` | 日次分析。`summary`（スコア・時間集計）と `analysis`（良い点・悪い点・根本原因・癖・改善提案・過去比較） |
| `weekly_analyses` | `YYYY-Www` | 週次分析。週間サマリー、深掘り分析、来週の改善計画、前週比 |
| `coaching_summaries` | `YYYY-MM` | 月次サマリー（コーチング形式） |
| `analysis_dialogues` | `YYYY-MM-DD` | ソクラテス式対話の履歴と状態（active / synthesized） |
| `diary_dialogues` | `YYYY-MM-DD` | 日記対話の履歴 |
| `journal_entries` | `YYYY-MM-DD#N` | 日記エントリ（本文、分析、Markdown 要約） |
| `weekly_journal_digests` | `YYYY-Www` | 日記の週次ダイジェスト |
| `braindump_entries` | `braindump#YYYY-MM-DD#N` | 自由帳・トレードメモ（`board` で区別）。タイトル、本文、画像 URL、ラベル、並び順 |
| `udemy_tips_entries` | — | Udemy Tips（本文、タグ、並び順） |
| `flashcards` | `fc-{uuid}` | 単語帳カード（表・裏・覚えたフラグ） |
| `wishlist` | — | やりたいこと（優先度、達成日） |
| `gratitude_entries` | — | ありがたいノート |
| `reminders` | `global` | 道しるべの付箋一覧（アーカイブ含む） |
| `categories` | `global` | タスクカテゴリ（名前・色） |
| `task_meta` | タスク本文の SHA-1 | タスクの追加日時・完了日時・推定フラグ |
| `ui_settings` | — | メニュー並び順などの UI 設定 |
| `migrations` / `users` | — | 内部用 |

### `daily_records` の例

```json
{
  "id": "2026-10-18",
  "date": "2026-10-18",
  "raw_input": "08:00 起床\n08:20 朝散歩開始\n09:20-09:34 朝散歩帰宅",
  "parsed_activities": [
    { "start_time": "08:00", "end_time": "08:20", "activity": "起床", "category": "生活", "is_productive": true }
  ],
  "tasks": {
    "planned": ["[株式投資] 株探の使い方を練る", "思考亭の動画を見る"],
    "completed": ["[株式投資] 株探の使い方を練る"],
    "completion_rate": 0.5
  },
  "rest_day": false,
  "rest_reason": "",
  "available_hours": 4,
  "created_at": "...",
  "updated_at": "..."
}
```

タスクは「`[カテゴリ] 本文`」の文字列で保存する。カテゴリなしは本文のみ。

---

## ディレクトリ構成

```
project_root/
├── frontend/
│   ├── index.html                  # SPA 本体（ナビ定義・テーマ初期化・API_BASE_URL）
│   ├── manifest.json               # PWA 設定
│   ├── sw.js                       # Service Worker（CACHE_NAME をデプロイごとに更新）
│   ├── css/style.css               # 全スタイル
│   ├── icons/                      # PWA アイコン
│   └── js/
│       ├── app.js  api.js  router.js  nav-order.js  swipe-nav.js  sidebar-resize.js  floating-toolbar.js
│       └── components/
│           ├── input-form.js       # タスク / 行動ログ
│           ├── analysis-view.js    # 日次分析・対話
│           ├── history-list.js  weekly-report.js  monthly-report.js
│           ├── journal.js  braindump.js  udemy-tips.js  michishirube.js
│           ├── wishlist.js  gratitude.js  task-stats.js
│           ├── flashcard-list.js  flashcard-study.js
│           └── home-launcher.js
│
├── backend/
│   ├── main.py                     # FastAPI エントリポイント・ルーター登録・CORS
│   ├── models/schemas.py           # Pydantic スキーマ
│   ├── routers/                    # records, analysis, weekly, summaries, dialogue, diary_dialogue,
│   │                               # journal, braindump, udemy_tips, flashcards, wishlist, gratitude,
│   │                               # reminders, categories, task_meta, nav_order
│   ├── services/
│   │   ├── claude_service.py       # Claude API 連携（リトライ付き）
│   │   ├── firestore_service.py    # Firestore CRUD
│   │   └── storage_service.py      # Cloud Storage（画像）
│   ├── prompts/                    # daily_analysis, weekly_analysis, monthly_summary,
│   │                               # socratic_dialogue, diary_dialogue, journal_analysis
│   ├── utils/helpers.py
│   ├── requirements.txt / Dockerfile
│
├── .github/workflows/deploy.yml    # 自動デプロイ
├── firebase.json / .firebaserc     # Firebase Hosting 設定
├── CLAUDE.md                       # プロジェクト規約（デプロイ・キャッシュ運用ルール）
├── spec.md                         # 本ドキュメント
└── README.md                       # セットアップ手順
```

---

## AI 処理一覧（`services/claude_service.py`）

| 関数 | 用途 | モデル（環境変数） |
|------|------|------|
| `parse_activities` | 行動テキスト → 活動リストの構造化 | DAILY_ANALYSIS_MODEL |
| `generate_daily_analysis` | 日次分析 | DAILY_ANALYSIS_MODEL |
| `generate_weekly_analysis` | 週次分析 | WEEKLY_ANALYSIS_MODEL |
| `generate_socratic_questions` / `_followup` / `generate_dialogue_synthesis` | ソクラテス式対話 | DAILY_ANALYSIS_MODEL |
| `generate_diary_questions` / `_followup` / `generate_diary_synthesis` | 日記対話 | DAILY_ANALYSIS_MODEL |
| `analyze_journal_entry` / `summarize_journal_as_markdown` | 日記の分析・要約 | DAILY_ANALYSIS_MODEL |
| `generate_weekly_journal_digest` | 日記の週次ダイジェスト | WEEKLY_ANALYSIS_MODEL |
| `summarize_braindump_as_markdown` / `generate_braindump_title` | 自由帳の要約・タイトル | DAILY_ANALYSIS_MODEL |

すべて `_call_claude_with_retry` 経由で呼び出し、一時的なエラーは再試行する。

---

## UI デザイン

- **テーマ**: ダーク（サイバーパンク調、シアン #00d4ff のネオングロー）/ ライト切り替え
- **フォント**: Space Grotesk（Google Fonts）
- **スコア色**: 緑（70 以上）/ 黄（40〜69）/ 赤（39 以下）
- **レイアウト**: 1024px 未満はモバイル（ホームランチャー・上部ナビ・スワイプ）、以上はデスクトップ（サイドバー・ヘッダー・複数列カード）
- **タスクページのカード見出し**: カテゴリ色を見出し文字・左バー・上端ラインに使い、件数は右端に等幅数字

---

## 環境変数（backend/.env）

```env
ANTHROPIC_API_KEY=sk-ant-xxxxx
GOOGLE_CLOUD_PROJECT=daily-tracker-487904
FIRESTORE_DATABASE=(default)
CLOUD_STORAGE_BUCKET=your-bucket-name
DAILY_ANALYSIS_MODEL=claude-sonnet-4-6
WEEKLY_ANALYSIS_MODEL=claude-sonnet-4-6
ALLOWED_ORIGINS=http://localhost:3000,https://your-app.web.app
```

---

## デプロイ

### GitHub Actions（`deploy.yml`）

**トリガー**: `main` ブランチへの push

1. GCP 認証（Workload Identity）、Cloud SDK セットアップ
2. Artifact Registry のクリーンアップポリシー適用
3. Docker イメージをビルドして Artifact Registry へ push
4. Cloud Run へデプロイ
5. Cloud Run の URL を `frontend/index.html` の `API_BASE_URL` に注入
6. Firebase Hosting へデプロイ

### フロントエンド変更時の必須手順（詳細は CLAUDE.md）

1. `frontend/sw.js` の `CACHE_NAME` を +1
2. `index.html` / `app.js` / 各コンポーネントの `?v=` を同じ新しい値に一括更新
3. `firebase.json` の `no-cache` ヘッダーは削除しない

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

## 主要機能一覧（要約）

1. **タスク管理** — カテゴリ別カード、予定→完了、達成までの期間表示、引き継ぎ、ドラッグ並べ替え
2. **行動ログ** — タイムライン入力、活動可能時間、おやすみモード、下書き保持と 3-way マージによる安全な自動保存
3. **AI 日次分析** — スコア・根本原因・改善提案・過去比較、ソクラテス式対話
4. **履歴** — カレンダー / リスト
5. **週次・月次レポート** — パターン分析と改善計画、月間サマリー
6. **日記** — 複数エントリ、AI 分析・要約、日記対話、週次ダイジェスト
7. **自由帳・トレードメモ** — ラベル、画像、AI タイトル・要約、6 つのトレードボード
8. **道しるべ** — 付箋リマインダー、アーカイブ、ランダム表示
9. **Udemy 制作 Tips** — タグ・ソート・モーダル編集
10. **やりたいことリスト** — 優先度 ★、達成管理
11. **ありがたいノート** — 感謝の記録
12. **タスク実績** — 今日 / 今週 / 今月、日別 / 週別 / 月別グラフ
13. **単語帳** — 2 ペイン一覧、一括追加、学習モード
14. **ナビゲーション** — ホームランチャー、メニュー並び替えの端末間共有、スワイプ、サイドバー幅調整、テーマ切替
15. **PWA** — インストール、オフライン表示、キャッシュ更新運用
