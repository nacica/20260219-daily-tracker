"""
Firestore サービス
daily_records / daily_analyses コレクションの CRUD 操作を担当する
"""

import os
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from typing import Optional

# Firebase Admin SDK の初期化（初回のみ）
_initialized = False


def _init_firebase():
    global _initialized
    if _initialized:
        return
    if not firebase_admin._apps:
        project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
        if project_id:
            # Cloud Run 上では Application Default Credentials が使われる
            firebase_admin.initialize_app(options={"projectId": project_id})
        else:
            firebase_admin.initialize_app()
    _initialized = True


def get_db():
    """Firestore クライアントを返す"""
    _init_firebase()
    db_name = os.getenv("FIRESTORE_DATABASE", "(default)")
    return firestore.client(database_id=db_name)


# ---- daily_records ----

def get_record(date: str) -> Optional[dict]:
    """指定日の行動記録を取得"""
    db = get_db()
    doc = db.collection("daily_records").document(date).get()
    if doc.exists:
        return doc.to_dict()
    return None


def list_records(start_date: Optional[str] = None, end_date: Optional[str] = None) -> list[dict]:
    """行動記録一覧を取得（日付範囲指定可能）"""
    db = get_db()
    query = db.collection("daily_records").order_by("date", direction=firestore.Query.DESCENDING)

    if start_date:
        query = query.where(filter=FieldFilter("date", ">=", start_date))
    if end_date:
        query = query.where(filter=FieldFilter("date", "<=", end_date))

    return [doc.to_dict() for doc in query.stream()]


def create_record(date: str, data: dict) -> dict:
    """行動記録を作成"""
    db = get_db()
    db.collection("daily_records").document(date).set(data)
    return data


def update_record(date: str, data: dict) -> Optional[dict]:
    """行動記録を更新"""
    db = get_db()
    ref = db.collection("daily_records").document(date)
    if not ref.get().exists:
        return None
    ref.update(data)
    return ref.get().to_dict()


def delete_record(date: str) -> bool:
    """行動記録を削除"""
    db = get_db()
    ref = db.collection("daily_records").document(date)
    if not ref.get().exists:
        return False
    ref.delete()
    return True


# ---- daily_analyses ----

def get_analysis(date: str) -> Optional[dict]:
    """指定日の分析結果を取得"""
    db = get_db()
    doc = db.collection("daily_analyses").document(date).get()
    if doc.exists:
        return doc.to_dict()
    return None


def list_analyses(start_date: Optional[str] = None, end_date: Optional[str] = None) -> list[dict]:
    """分析結果一覧を取得"""
    db = get_db()
    query = db.collection("daily_analyses").order_by("date", direction=firestore.Query.DESCENDING)

    if start_date:
        query = query.where(filter=FieldFilter("date", ">=", start_date))
    if end_date:
        query = query.where(filter=FieldFilter("date", "<=", end_date))

    return [doc.to_dict() for doc in query.stream()]


def save_analysis(date: str, data: dict) -> dict:
    """分析結果を保存（上書き）"""
    db = get_db()
    db.collection("daily_analyses").document(date).set(data)
    return data


def get_past_records(date: str, days: int = 7) -> list[dict]:
    """指定日より前の過去 N 日間の行動記録を取得"""
    from datetime import datetime, timedelta
    dt = datetime.strptime(date, "%Y-%m-%d")
    start = (dt - timedelta(days=days)).strftime("%Y-%m-%d")
    end = (dt - timedelta(days=1)).strftime("%Y-%m-%d")
    return list_records(start_date=start, end_date=end)


def get_past_analyses(date: str, days: int = 7) -> list[dict]:
    """指定日より前の過去 N 日間の分析結果を取得"""
    from datetime import datetime, timedelta
    dt = datetime.strptime(date, "%Y-%m-%d")
    start = (dt - timedelta(days=days)).strftime("%Y-%m-%d")
    end = (dt - timedelta(days=1)).strftime("%Y-%m-%d")
    return list_analyses(start_date=start, end_date=end)
