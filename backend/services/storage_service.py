"""
Firebase Cloud Storage サービス
スクリーンショット画像の保存・取得を担当する
"""

import os
import firebase_admin
from firebase_admin import storage


def get_bucket():
    """Cloud Storage バケットを返す"""
    bucket_name = os.getenv("CLOUD_STORAGE_BUCKET")
    return storage.bucket(bucket_name)


def upload_screenshot(date: str, image_bytes: bytes, content_type: str = "image/jpeg") -> str:
    """
    スクリーンショットを Cloud Storage にアップロードする

    Args:
        date: 日付 (YYYY-MM-DD) → ファイル名に使用
        image_bytes: 画像のバイト列
        content_type: MIME タイプ

    Returns:
        gs://... 形式の GCS URI
    """
    bucket = get_bucket()
    ext = content_type.split("/")[-1]  # jpeg / png
    blob_name = f"screenshots/{date}.{ext}"
    blob = bucket.blob(blob_name)
    blob.upload_from_string(image_bytes, content_type=content_type)

    bucket_name = os.getenv("CLOUD_STORAGE_BUCKET")
    return f"gs://{bucket_name}/{blob_name}"


def get_screenshot_url(date: str, expiration_seconds: int = 3600) -> str | None:
    """
    指定日のスクリーンショットの署名付き URL を返す（存在しない場合は None）

    Args:
        date: 日付 (YYYY-MM-DD)
        expiration_seconds: URL の有効期限（秒）

    Returns:
        署名付き URL または None
    """
    from datetime import timedelta

    bucket = get_bucket()
    for ext in ("jpeg", "jpg", "png", "heic"):
        blob = bucket.blob(f"screenshots/{date}.{ext}")
        if blob.exists():
            return blob.generate_signed_url(expiration=timedelta(seconds=expiration_seconds))
    return None
