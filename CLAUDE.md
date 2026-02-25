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
