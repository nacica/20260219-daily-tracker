"""
Firebase Cloud Storage サービス
スクリーンショット画像の保存・取得を担当する
"""

import os
import firebase_admin
from firebase_admin import storage
import google.auth
from google.auth.transport import requests as google_auth_requests


def get_bucket():
    """Cloud Storage バケットを返す（Firebase 未初期化なら初期化する）"""
    if not firebase_admin._apps:
        project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
        if project_id:
            firebase_admin.initialize_app(options={"projectId": project_id})
        else:
            firebase_admin.initialize_app()
    bucket_name = os.getenv("CLOUD_STORAGE_BUCKET")
    return storage.bucket(bucket_name)


def _generate_signed_url(blob, expiration):
    """
    Cloud Run 対応の署名付き URL 生成。
    Compute Engine クレデンシャルにはプライベートキーが無いため、
    IAM signBlob API 経由で署名する。
    """
    credentials, project = google.auth.default()
    if hasattr(credentials, "service_account_email"):
        credentials.refresh(google_auth_requests.Request())
        return blob.generate_signed_url(
            version="v4",
            expiration=expiration,
            method="GET",
            service_account_email=credentials.service_account_email,
            access_token=credentials.token,
        )
    # ローカル開発時（サービスアカウントキーファイル使用時）
    return blob.generate_signed_url(expiration=expiration)


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


def _upload_public_image(prefix: str, image_bytes: bytes, content_type: str = "image/png") -> str:
    """
    画像を Cloud Storage にアップロードし、公開 URL を返す共通処理

    Args:
        prefix: バケット内のディレクトリプレフィックス（例 "braindump-images" / "flashcard-images"）
        image_bytes: 画像のバイト列
        content_type: MIME タイプ

    Returns:
        永続的な公開 URL（https://storage.googleapis.com/<bucket>/<path>）
    """
    import uuid
    from datetime import datetime

    bucket = get_bucket()
    ext = content_type.split("/")[-1]  # jpeg / png
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    unique_id = uuid.uuid4().hex[:8]
    blob_name = f"{prefix}/{timestamp}_{unique_id}.{ext}"
    blob = bucket.blob(blob_name)
    blob.upload_from_string(image_bytes, content_type=content_type)
    blob.make_public()
    return blob.public_url


def upload_braindump_image(image_bytes: bytes, content_type: str = "image/png") -> str:
    """ブレインダンプの貼り付け画像を公開URLでアップロードする"""
    return _upload_public_image("braindump-images", image_bytes, content_type)


def upload_flashcard_image(image_bytes: bytes, content_type: str = "image/png") -> str:
    """単語帳カードの貼り付け画像を公開URLでアップロードする"""
    return _upload_public_image("flashcard-images", image_bytes, content_type)


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
            return _generate_signed_url(blob, timedelta(seconds=expiration_seconds))
    return None
