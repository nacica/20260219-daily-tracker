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
過去にこれを怠り、変更がユーザーに届かない障害が発生した。

### 1. SW キャッシュバージョンのバンプ

`frontend/sw.js` の `CACHE_NAME` を必ずインクリメントする。
バンプしないと古いキャッシュが残り続け、変更がユーザーに届かない。

```js
// 変更前
const CACHE_NAME = "daily-tracker-v5";
// 変更後（数字を +1）
const CACHE_NAME = "daily-tracker-v6";
```

### 2. CSS/JS リンク + ES Module import のキャッシュバスティング

以下 **3 箇所すべて** の `?v=` を同じ値に更新すること。
iOS PWA では ES Module のメモリキャッシュが残り続け、
index.html の CSS/JS だけバンプしても古い JS モジュールが配信される。

1. `frontend/index.html` — CSS `<link>` と `<script>` タグ
2. `frontend/js/app.js` — すべての `import ... from "...?v=..."` 行
3. `frontend/js/components/input-form.js` — `import` 行

```html
<!-- index.html: v=YYYYMMDDx 形式で更新 -->
<link rel="stylesheet" href="/css/style.css?v=20260225e" />
<script type="module" src="/js/app.js?v=20260225e"></script>
```

```js
// app.js / input-form.js: import パスも同じバージョンに更新
import { renderInputForm } from "./components/input-form.js?v=20260225e";
```

### 3. Firebase Hosting キャッシュヘッダー

`firebase.json` で HTML/CSS/JS に `Cache-Control: no-cache` が設定済み。
**この設定を削除しないこと。** 削除すると CDN が古いファイルを配信し続ける。
