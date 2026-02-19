"""
スクリーンショット アップロード & OCR エンドポイント
POST /api/v1/screenshots/{date}
GET  /api/v1/screenshots/{date}
"""

import os
from fastapi import APIRouter, HTTPException, UploadFile, File
from services import firestore_service, ocr_service, storage_service
from utils.helpers import now_jst

router = APIRouter()

ALLOWED_CONTENT_TYPES = {
    "image/jpeg", "image/jpg", "image/png",
    "image/heic", "image/heif", "image/webp",
}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/screenshots/{date}")
async def upload_screenshot(date: str, file: UploadFile = File(...)):
    """
    スクリーンタイムのスクリーンショットをアップロードし、
    Claude Vision API で OCR 処理してスクリーンタイムデータを抽出する。
    結果は daily_records の screen_time フィールドに保存される。
    """
    # バリデーション
    content_type = file.content_type or "image/jpeg"
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"サポートされていない画像形式です: {content_type}。JPEG/PNG/HEIC を使用してください。",
        )

    image_bytes = await file.read()
    if len(image_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="ファイルサイズが大きすぎます（上限 10MB）")

    # 行動記録の存在確認
    record = firestore_service.get_record(date)
    if not record:
        raise HTTPException(
            status_code=404,
            detail=f"{date} の行動記録が見つかりません。先に行動記録を作成してください。",
        )

    # Cloud Storage へのアップロード（環境変数が設定されている場合のみ）
    image_url = None
    if os.getenv("CLOUD_STORAGE_BUCKET"):
        try:
            image_url = storage_service.upload_screenshot(date, image_bytes, content_type)
        except Exception as e:
            # Storage エラーは致命的でないため継続
            print(f"Storage upload warning: {e}")

    # Claude Vision API で OCR
    try:
        screen_time_data = ocr_service.extract_screen_time(image_bytes, content_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR 処理に失敗しました: {str(e)}")

    # GCS URI を追加
    if image_url:
        screen_time_data["raw_image_url"] = image_url

    # daily_records の screen_time を更新
    firestore_service.update_record(date, {
        "screen_time": screen_time_data,
        "updated_at": now_jst(),
    })

    return {
        "date": date,
        "screen_time": screen_time_data,
        "message": "スクリーンタイムデータを抽出しました",
    }


@router.get("/screenshots/{date}/url")
async def get_screenshot_url(date: str):
    """
    指定日のスクリーンショットの署名付き URL を返す
    """
    if not os.getenv("CLOUD_STORAGE_BUCKET"):
        raise HTTPException(status_code=503, detail="Cloud Storage が設定されていません")

    url = storage_service.get_screenshot_url(date)
    if not url:
        raise HTTPException(status_code=404, detail=f"{date} のスクリーンショットが見つかりません")

    return {"date": date, "url": url}
