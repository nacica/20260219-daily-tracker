# CLAUDE.md — プロジェクト規約

## デプロイフロー

このプロジェクトは `main` ブランチへの push をトリガーに GitHub Actions が自動デプロイを実行する。

- バックエンド → Cloud Run (asia-northeast1)
- フロントエンド → Firebase Hosting

**コードを修正した場合は、必ず commit → `git push origin main` まで実行すること。**
修正がローカルに留まったままだと本番に反映されない。

```
git add <変更ファイル>
git commit -m "..."
git push origin main
```

**push 後は `gh run watch` でデプロイ完了を確認してからユーザーに報告すること。**
デプロイが失敗した場合はログを確認し、原因を報告する。

## フロントエンド変更時の必須チェックリスト

フロントエンド (HTML/CSS/JS) を変更した場合、**以下を毎回必ず実施する**こと。
過去にこれを怠り、変更がユーザーに届かない障害が複数回発生した。

### 1. SW キャッシュバージョンのバンプ

`frontend/sw.js` の `CACHE_NAME` を必ずインクリメントする。
バンプしないと古いキャッシュが残り続け、変更がユーザーに届かない。

```js
// 変更前
const CACHE_NAME = "daily-tracker-v5";
// 変更後（数字を +1）
const CACHE_NAME = "daily-tracker-v6";
```

### 2. CSS/JS リンク + ES Module import のキャッシュバスティング（最重要）

> **過去の障害:** index.html の CSS/JS リンクだけキャッシュバスティングし、
> ES Module の import パスを更新しなかった結果、iOS PWA で古い JS が
> 配信され続け、新機能が一切動作しない障害が発生した（5回の修正デプロイが無駄になった）。
>
> **根本原因:** iOS PWA は ES Module をメモリキャッシュに保持する。
> `index.html` → `app.js` のキャッシュを破棄しても、`app.js` 内の
> `import ... from "./components/input-form.js"` が古い URL のまま
> だと、ブラウザはキャッシュ済みの古いモジュールを返す。

以下 **3 箇所すべて** の `?v=` を **同じ値** に更新すること。**1 箇所でも漏れると iOS で古いコードが動く。**

1. `frontend/index.html` — CSS `<link>` と `<script>` タグの `?v=`
2. `frontend/js/app.js` — **すべての** `import ... from "...?v=..."` 行（7 箇所）
3. `frontend/js/components/input-form.js` — `import` 行（2 箇所）

```html
<!-- index.html: v=YYYYMMDDx 形式（末尾 a→b→c… でインクリメント） -->
<link rel="stylesheet" href="/css/style.css?v=20260225e" />
<script type="module" src="/js/app.js?v=20260225e"></script>
```

```js
// app.js: すべての import に同じバージョンを付与
import { addRoute, navigate, updateNavActive } from "./router.js?v=20260225e";
import { renderInputForm } from "./components/input-form.js?v=20260225e";
// ... 他の import もすべて同じ ?v= にする

// input-form.js:
import { recordsApi, analysisApi } from "../api.js?v=20260225e";
import { showToast } from "../app.js?v=20260225e";
```

### 3. Firebase Hosting キャッシュヘッダー

`firebase.json` で HTML/CSS/JS に `Cache-Control: no-cache` が設定済み。
**この設定を削除しないこと。** 削除すると CDN が古いファイルを配信し続ける。
