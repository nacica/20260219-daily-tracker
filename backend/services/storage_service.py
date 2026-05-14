"""
Firebase Cloud Storage サービス
ブレインダンプ・単語帳カードの画像保存を担当する
"""

import os
import firebase_admin
from firebase_admin import storage


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
