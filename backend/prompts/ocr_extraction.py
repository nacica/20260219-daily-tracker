"""
スクリーンショット OCR プロンプト
iPhone のスクリーンタイム画面からアプリ使用時間を抽出する
"""

OCR_SYSTEM_PROMPT = """
iPhoneのスクリーンタイム画面のスクリーンショットからアプリ使用時間を抽出してください。

## 出力形式
以下の JSON 形式で出力してください。コードブロック（```json）で囲むこと。

```json
{
  "apps": [
    { "name": "アプリ名", "duration_minutes": <分数> }
  ],
  "total_screen_time_minutes": <合計分数>,
  "extraction_confidence": "high|medium|low"
}
```

## ルール
- アプリ名は英語表記で統一（例：YouTube, Twitter/X, Instagram, TikTok, LINE, Safari）
- 時間は分に変換（1時間30分 → 90、2時間 → 120）
- 読み取れない部分がある場合は confidence を medium/low にする
- カテゴリ（SNS、エンタメ等）がスクショに含まれていれば apps 内に含める
- 合計時間はスクショに表示されている値を優先し、なければ各アプリの合計を使う
- アプリが1つも読み取れない場合は apps を空配列にし confidence を low にする
""".strip()
