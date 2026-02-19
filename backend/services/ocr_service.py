"""
OCR サービス
Claude Vision API を使って iPhone スクリーンタイムの
スクリーンショットからアプリ使用時間を抽出する
"""

import os
import base64
import json
import anthropic
from prompts.ocr_extraction import OCR_SYSTEM_PROMPT


def extract_screen_time(image_bytes: bytes, media_type: str = "image/jpeg") -> dict:
    """
    スクリーンショットの画像バイト列からスクリーンタイムデータを抽出する

    Args:
        image_bytes: 画像のバイト列
        media_type: 画像の MIME タイプ（image/jpeg, image/png 等）

    Returns:
        {
          "apps": [{"name": str, "duration_minutes": int}],
          "total_screen_time_minutes": int,
          "extraction_confidence": "high"|"medium"|"low"
        }
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    model = os.getenv("OCR_MODEL", "claude-sonnet-4-6")

    # 画像を base64 エンコード
    image_b64 = base64.standard_b64encode(image_bytes).decode("utf-8")

    with client.messages.stream(
        model=model,
        max_tokens=1024,
        system=OCR_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": "このスクリーンタイム画像からアプリ別使用時間を抽出してください。",
                    },
                ],
            }
        ],
    ) as stream:
        response = stream.get_final_message()

    raw_text = response.content[0].text
    return _parse_json(raw_text)


def _parse_json(text: str) -> dict:
    """テキストから JSON を抽出してパース"""
    if "```json" in text:
        start = text.index("```json") + 7
        end = text.index("```", start)
        text = text[start:end].strip()
    elif "```" in text:
        start = text.index("```") + 3
        end = text.index("```", start)
        text = text[start:end].strip()

    for i, ch in enumerate(text):
        if ch == "{":
            text = text[i:]
            break

    result = json.loads(text)

    # apps が存在しない場合のフォールバック
    result.setdefault("apps", [])
    result.setdefault("total_screen_time_minutes", sum(
        a.get("duration_minutes", 0) for a in result["apps"]
    ))
    result.setdefault("extraction_confidence", "medium")
    return result
