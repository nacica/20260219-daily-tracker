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


# ---- analysis_dialogues ----

def get_dialogue(date: str) -> Optional[dict]:
    """指定日のソクラテス式対話を取得"""
    db = get_db()
    doc = db.collection("analysis_dialogues").document(date).get()
    if doc.exists:
        return doc.to_dict()
    return None


def save_dialogue(date: str, data: dict) -> dict:
    """対話を保存（上書き）"""
    db = get_db()
    db.collection("analysis_dialogues").document(date).set(data)
    return data


def delete_dialogue(date: str) -> bool:
    """対話を削除"""
    db = get_db()
    ref = db.collection("analysis_dialogues").document(date)
    if not ref.get().exists:
        return False
    ref.delete()
    return True


# ---- morning_dialogues ----

def get_morning_dialogue(date: str) -> Optional[dict]:
    """指定日の朝問答を取得"""
    db = get_db()
    doc = db.collection("morning_dialogues").document(date).get()
    if doc.exists:
        return doc.to_dict()
    return None


def save_morning_dialogue(date: str, data: dict) -> dict:
    """朝問答を保存（上書き）"""
    db = get_db()
    db.collection("morning_dialogues").document(date).set(data)
    return data


def delete_morning_dialogue(date: str) -> bool:
    """朝問答を削除"""
    db = get_db()
    ref = db.collection("morning_dialogues").document(date)
    if not ref.get().exists:
        return False
    ref.delete()
    return True


# ---- diary_dialogues ----

def get_diary_dialogue(date: str) -> Optional[dict]:
    """指定日の日記入力対話を取得"""
    db = get_db()
    doc = db.collection("diary_dialogues").document(date).get()
    if doc.exists:
        return doc.to_dict()
    return None


def save_diary_dialogue(date: str, data: dict) -> dict:
    """日記入力対話を保存（上書き）"""
    db = get_db()
    db.collection("diary_dialogues").document(date).set(data)
    return data


def delete_diary_dialogue(date: str) -> bool:
    """日記入力対話を削除"""
    db = get_db()
    ref = db.collection("diary_dialogues").document(date)
    if not ref.get().exists:
        return False
    ref.delete()
    return True


# ---- ナレッジグラフ: user_entities ----

DEFAULT_USER_ID = "default"


def _user_ref(user_id: str = DEFAULT_USER_ID):
    """ユーザードキュメントの参照を返す"""
    db = get_db()
    return db.collection("users").document(user_id)


def get_entity(entity_id: str, user_id: str = DEFAULT_USER_ID) -> Optional[dict]:
    """エンティティを取得"""
    doc = _user_ref(user_id).collection("user_entities").document(entity_id).get()
    if doc.exists:
        return doc.to_dict()
    return None


def list_entities(
    user_id: str = DEFAULT_USER_ID,
    entity_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
) -> list[dict]:
    """エンティティ一覧を取得"""
    query = _user_ref(user_id).collection("user_entities")
    if entity_type:
        query = query.where(filter=FieldFilter("entityType", "==", entity_type))
    if status:
        query = query.where(filter=FieldFilter("status", "==", status))
    query = query.limit(limit)
    return [doc.to_dict() for doc in query.stream()]


def find_entity_by_name(name: str, user_id: str = DEFAULT_USER_ID) -> Optional[dict]:
    """名前でエンティティを検索"""
    query = _user_ref(user_id).collection("user_entities").where(
        filter=FieldFilter("name", "==", name)
    ).limit(1)
    docs = list(query.stream())
    if docs:
        return docs[0].to_dict()
    return None


def save_entity(entity_id: str, data: dict, user_id: str = DEFAULT_USER_ID) -> dict:
    """エンティティを保存"""
    _user_ref(user_id).collection("user_entities").document(entity_id).set(data)
    return data


def update_entity(entity_id: str, data: dict, user_id: str = DEFAULT_USER_ID) -> dict:
    """エンティティを部分更新"""
    _user_ref(user_id).collection("user_entities").document(entity_id).update(data)
    return data


def delete_entity(entity_id: str, user_id: str = DEFAULT_USER_ID) -> bool:
    """エンティティを削除"""
    ref = _user_ref(user_id).collection("user_entities").document(entity_id)
    if not ref.get().exists:
        return False
    ref.delete()
    return True


# ---- ナレッジグラフ: entity_relations ----

def get_relation(relation_id: str, user_id: str = DEFAULT_USER_ID) -> Optional[dict]:
    """リレーションを取得"""
    doc = _user_ref(user_id).collection("entity_relations").document(relation_id).get()
    if doc.exists:
        return doc.to_dict()
    return None


def list_relations(
    user_id: str = DEFAULT_USER_ID,
    min_strength: Optional[float] = None,
    limit: int = 100,
) -> list[dict]:
    """リレーション一覧を取得"""
    query = _user_ref(user_id).collection("entity_relations")
    if min_strength is not None:
        query = query.where(filter=FieldFilter("strength", ">=", min_strength))
    query = query.limit(limit)
    return [doc.to_dict() for doc in query.stream()]


def find_relation(
    from_name: str, to_name: str, relation_type: str,
    user_id: str = DEFAULT_USER_ID,
) -> Optional[dict]:
    """from/to/typeでリレーションを検索"""
    query = (
        _user_ref(user_id).collection("entity_relations")
        .where(filter=FieldFilter("from_entity", "==", from_name))
        .where(filter=FieldFilter("to_entity", "==", to_name))
        .where(filter=FieldFilter("relation_type", "==", relation_type))
        .limit(1)
    )
    docs = list(query.stream())
    if docs:
        return docs[0].to_dict()
    return None


def save_relation(relation_id: str, data: dict, user_id: str = DEFAULT_USER_ID) -> dict:
    """リレーションを保存"""
    _user_ref(user_id).collection("entity_relations").document(relation_id).set(data)
    return data


def update_relation(relation_id: str, data: dict, user_id: str = DEFAULT_USER_ID) -> dict:
    """リレーションを部分更新"""
    _user_ref(user_id).collection("entity_relations").document(relation_id).update(data)
    return data


def delete_relation(relation_id: str, user_id: str = DEFAULT_USER_ID) -> bool:
    """リレーションを削除"""
    ref = _user_ref(user_id).collection("entity_relations").document(relation_id)
    if not ref.get().exists:
        return False
    ref.delete()
    return True


# ---- コーチングサマリー ----

def get_coaching_summary(year_month: str, user_id: str = DEFAULT_USER_ID) -> Optional[dict]:
    """月次コーチングサマリーを取得"""
    doc = _user_ref(user_id).collection("coaching_summaries").document(year_month).get()
    if doc.exists:
        return doc.to_dict()
    return None


def get_latest_coaching_summary(user_id: str = DEFAULT_USER_ID) -> Optional[dict]:
    """最新の月次コーチングサマリーを取得"""
    query = (
        _user_ref(user_id).collection("coaching_summaries")
        .order_by("period", direction=firestore.Query.DESCENDING)
        .limit(1)
    )
    docs = list(query.stream())
    if docs:
        return docs[0].to_dict()
    return None


def save_coaching_summary(year_month: str, data: dict, user_id: str = DEFAULT_USER_ID) -> dict:
    """月次コーチングサマリーを保存"""
    _user_ref(user_id).collection("coaching_summaries").document(year_month).set(data)
    return data


# ---- journal_entries ----

def _ensure_entry_number(data: dict) -> dict:
    """entry_number が無い旧データにデフォルト値を補完する"""
    if data and "entry_number" not in data:
        data["entry_number"] = 1
    return data


def get_journal(entry_id: str) -> Optional[dict]:
    """指定IDのジャーナルを取得（entry_id は 'YYYY-MM-DD' or 'YYYY-MM-DD#N'）"""
    db = get_db()
    doc = db.collection("journal_entries").document(entry_id).get()
    if doc.exists:
        return _ensure_entry_number(doc.to_dict())
    return None


def list_journals(start_date: Optional[str] = None, end_date: Optional[str] = None) -> list[dict]:
    """ジャーナル一覧を取得（日付範囲指定可能）"""
    db = get_db()
    query = db.collection("journal_entries").order_by("date", direction=firestore.Query.DESCENDING)

    if start_date:
        query = query.where(filter=FieldFilter("date", ">=", start_date))
    if end_date:
        query = query.where(filter=FieldFilter("date", "<=", end_date))

    return [_ensure_entry_number(doc.to_dict()) for doc in query.stream()]


def list_journals_for_date(date: str) -> list[dict]:
    """指定日の全ジャーナルエントリを取得（entry_number 昇順）"""
    db = get_db()
    query = (
        db.collection("journal_entries")
        .where(filter=FieldFilter("date", "==", date))
        .order_by("entry_number")
    )
    results = [_ensure_entry_number(doc.to_dict()) for doc in query.stream()]
    # 旧形式（ID が YYYY-MM-DD）のドキュメントも含まれるようにする
    if not results:
        legacy = get_journal(date)
        if legacy:
            results = [legacy]
    return results


def get_next_entry_number(date: str) -> int:
    """指定日の次のエントリ番号を返す"""
    entries = list_journals_for_date(date)
    if not entries:
        return 1
    max_num = max(e.get("entry_number", 1) for e in entries)
    return max_num + 1


def create_journal(entry_id: str, data: dict) -> dict:
    """ジャーナルを作成"""
    db = get_db()
    db.collection("journal_entries").document(entry_id).set(data)
    return data


def update_journal(entry_id: str, data: dict) -> Optional[dict]:
    """ジャーナルを更新"""
    db = get_db()
    ref = db.collection("journal_entries").document(entry_id)
    if not ref.get().exists:
        return None
    ref.update(data)
    return _ensure_entry_number(ref.get().to_dict())


def delete_journal(entry_id: str) -> bool:
    """ジャーナルを削除"""
    db = get_db()
    ref = db.collection("journal_entries").document(entry_id)
    if not ref.get().exists:
        return False
    ref.delete()
    return True


# ---- weekly_journal_digests ----

def get_journal_digest(week_id: str) -> Optional[dict]:
    """週次ジャーナルダイジェストを取得"""
    db = get_db()
    doc = db.collection("weekly_journal_digests").document(week_id).get()
    if doc.exists:
        return doc.to_dict()
    return None


def save_journal_digest(week_id: str, data: dict) -> dict:
    """週次ジャーナルダイジェストを保存"""
    db = get_db()
    db.collection("weekly_journal_digests").document(week_id).set(data)
    return data
