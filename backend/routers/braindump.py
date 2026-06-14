"""
ブレインダンプ CRUD + AIタイトル生成エンドポイント
1日に複数メモを作成可能（entry_id = braindump#YYYY-MM-DD#N）

POST   /api/v1/braindump                          - メモ作成
GET    /api/v1/braindump                          - メモ一覧
GET    /api/v1/braindump/by-date/{date}           - 指定日の全メモ取得
GET    /api/v1/braindump/dates-with-entries        - メモが存在する日付一覧
GET    /api/v1/braindump/entry/{entry_id}         - 単一メモ取得
PUT    /api/v1/braindump/entry/{entry_id}         - メモ更新
DELETE /api/v1/braindump/entry/{entry_id}         - メモ削除
POST   /api/v1/braindump/entry/{entry_id}/generate-title - AIタイトル生成
"""

import os

from fastapi import APIRouter, HTTPException, Query, Response, BackgroundTasks, UploadFile, File
from typing import Optional

from models.braindump_schemas import (
    BraindumpCreate, BraindumpUpdate, BraindumpEntry,
    LabelRenameRequest, LabelListResponse, LabelCount,
    BraindumpReorderRequest,
)
from services import firestore_service, claude_service, storage_service
from utils.helpers import now_jst


def _normalize_labels(labels: Optional[list[str]]) -> list[str]:
    """ラベル配列を正規化（trim・空除去・重複排除・順序維持）"""
    if not labels:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for lbl in labels:
        if not isinstance(lbl, str):
            continue
        name = lbl.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        out.append(name)
    return out

router = APIRouter()


# ---- CRUD ----

@router.post("/braindump", response_model=BraindumpEntry, status_code=201)
async def create_braindump(body: BraindumpCreate, background_tasks: BackgroundTasks):
    """ブレインダンプを作成する（1日に複数作成可能）"""
    date = body.date

    # エントリ番号の決定
    entry_number = firestore_service.get_next_braindump_entry_number(date)
    entry_id = f"braindump#{date}#{entry_number}"

    # 手動タイトル指定があればそれを採用（AI 自動生成はスキップ）
    manual_title = (body.title or "").strip()
    title_custom = bool(manual_title)
    if title_custom:
        temp_title = manual_title[:200]
    else:
        # 仮タイトル: 本文の先頭30文字
        temp_title = body.content[:30].replace("\n", " ")
        if len(body.content) > 30:
            temp_title += "..."

    # 同日内の既存 sort_order の最大値+1（手動並び替え済みでも末尾に追加されるように）
    existing_today = firestore_service.list_braindumps_for_date(date)
    existing_max_order = 0.0
    for e in existing_today:
        order = e.get("sort_order")
        if order is None:
            order = float(e.get("entry_number", 1))
        existing_max_order = max(existing_max_order, float(order))
    sort_order = existing_max_order + 1.0

    now = now_jst()
    data = {
        "id": entry_id,
        "date": date,
        "entry_number": entry_number,
        "content": body.content,
        "title": temp_title,
        "title_custom": title_custom,
        "labels": _normalize_labels(body.labels),
        "sort_order": sort_order,
        "created_at": now,
        "updated_at": now,
    }

    saved = firestore_service.create_braindump(entry_id, data)

    # バックグラウンドでAIタイトル生成（手動タイトル指定時はスキップ）
    if not title_custom:
        background_tasks.add_task(_generate_title_background, entry_id, body.content)

    return BraindumpEntry(**saved)


@router.get("/braindump", response_model=list[BraindumpEntry])
async def list_braindumps(
    start_date: Optional[str] = Query(None, description="開始日 (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="終了日 (YYYY-MM-DD)"),
):
    """ブレインダンプ一覧を取得する"""
    entries = firestore_service.list_braindumps(start_date=start_date, end_date=end_date)
    return [BraindumpEntry(**e) for e in entries]


@router.get("/braindump/dates-with-entries")
async def get_dates_with_entries(
    start_date: Optional[str] = Query(None, description="開始日 (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="終了日 (YYYY-MM-DD)"),
):
    """メモが存在する日付の一覧を返す（カレンダーのマーク表示用）"""
    entries = firestore_service.list_braindumps(start_date=start_date, end_date=end_date)
    dates = sorted(set(e["date"] for e in entries))
    return {"dates": dates}


@router.get("/braindump/by-date/{date}", response_model=list[BraindumpEntry])
async def get_braindumps_by_date(date: str):
    """指定日の全ブレインダンプを取得する"""
    entries = firestore_service.list_braindumps_for_date(date)
    return [BraindumpEntry(**e) for e in entries]


@router.post("/braindump/by-date/{date}/reorder")
async def reorder_braindumps(date: str, body: BraindumpReorderRequest):
    """同一日付内のブレインダンプを並び替える（ordered_ids の順に sort_order を 1,2,3... で再採番）"""
    affected = firestore_service.reorder_braindumps_for_date(date, body.ordered_ids)
    return {"affected": affected}


# ---- 単一エントリ操作 ----

@router.get("/braindump/entry/{entry_id}", response_model=BraindumpEntry)
async def get_braindump_entry(entry_id: str):
    """単一ブレインダンプを取得する"""
    entry = firestore_service.get_braindump(entry_id)
    if not entry:
        return Response(status_code=204)
    return BraindumpEntry(**entry)


@router.put("/braindump/entry/{entry_id}", response_model=BraindumpEntry)
async def update_braindump_entry(entry_id: str, body: BraindumpUpdate, background_tasks: BackgroundTasks):
    """ブレインダンプを更新する"""
    existing = firestore_service.get_braindump(entry_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"{entry_id} のメモが見つかりません")

    update_data: dict = {"updated_at": now_jst()}

    # 手動タイトル: 非空なら固定（title_custom=True）、空文字なら自動タイトルへ戻す
    title_custom = bool(existing.get("title_custom"))
    if body.title is not None:
        manual = body.title.strip()
        if manual:
            update_data["title"] = manual[:200]
            update_data["title_custom"] = True
            title_custom = True
        else:
            # 空文字 → 自動タイトルに戻す（本文先頭から仮タイトル + AI再生成）
            update_data["title_custom"] = False
            title_custom = False
            base = (body.content if body.content is not None else existing.get("content", "")) or ""
            temp_title = base[:30].replace("\n", " ")
            if len(base) > 30:
                temp_title += "..."
            update_data["title"] = temp_title
            if base.strip():
                background_tasks.add_task(_generate_title_background, entry_id, base)

    if body.content is not None:
        update_data["content"] = body.content
        # コンテンツが変わったらタイトルを再生成（手動タイトル固定中は上書きしない）
        if body.content != existing.get("content", "") and not title_custom:
            temp_title = body.content[:30].replace("\n", " ")
            if len(body.content) > 30:
                temp_title += "..."
            update_data["title"] = temp_title
            background_tasks.add_task(_generate_title_background, entry_id, body.content)

    if body.labels is not None:
        update_data["labels"] = _normalize_labels(body.labels)

    updated = firestore_service.update_braindump(entry_id, update_data)
    return BraindumpEntry(**updated)


@router.delete("/braindump/entry/{entry_id}", status_code=204)
async def delete_braindump_entry(entry_id: str):
    """ブレインダンプを削除する"""
    deleted = firestore_service.delete_braindump(entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"{entry_id} のメモが見つかりません")


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/braindump/upload-image")
async def upload_braindump_image(file: UploadFile = File(...)):
    """ブレインダンプに貼り付けた画像をアップロードする"""
    if not os.getenv("CLOUD_STORAGE_BUCKET"):
        raise HTTPException(status_code=503, detail="Cloud Storage が設定されていません")

    content_type = file.content_type or "image/png"
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"サポートされていない画像形式です: {content_type}",
        )

    image_bytes = await file.read()
    if len(image_bytes) > MAX_IMAGE_SIZE:
        raise HTTPException(status_code=413, detail="ファイルサイズが大きすぎます（上限 10MB）")

    try:
        url = storage_service.upload_braindump_image(image_bytes, content_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"画像のアップロードに失敗しました: {str(e)[:200]}")

    return {"url": url}


@router.post("/braindump/summarize")
async def summarize_braindump(body: BraindumpCreate):
    """ブレインダンプの内容をマークダウン形式で要約する"""
    content = body.content
    if not content or not content.strip():
        raise HTTPException(status_code=400, detail="要約する内容がありません")

    try:
        summary = claude_service.summarize_braindump_as_markdown(content)
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"要約生成でエラーが発生しました: {str(e)[:200]}",
        )

    return {"summary": summary}


@router.post("/braindump/entry/{entry_id}/generate-title", response_model=BraindumpEntry)
async def generate_braindump_title(entry_id: str):
    """AIタイトルを手動で生成する"""
    entry = firestore_service.get_braindump(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"{entry_id} のメモが見つかりません")

    try:
        title = claude_service.generate_braindump_title(entry["content"])
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"タイトル生成でエラーが発生しました: {str(e)[:200]}",
        )

    update_data = {"title": title, "updated_at": now_jst()}
    updated = firestore_service.update_braindump(entry_id, update_data)
    return BraindumpEntry(**updated)


# ---- ラベル管理 ----

@router.get("/braindump/labels", response_model=LabelListResponse)
async def list_braindump_labels():
    """全ブレインダンプから集計したラベル一覧（使用件数付き、件数降順→名前昇順）"""
    items = firestore_service.aggregate_braindump_labels()
    return LabelListResponse(labels=[LabelCount(**i) for i in items])


@router.post("/braindump/labels/rename")
async def rename_braindump_label_endpoint(body: LabelRenameRequest):
    """ラベルをリネーム（使用中の全メモを一括更新）"""
    old = body.old_name.strip()
    new = body.new_name.strip()
    if not old or not new:
        raise HTTPException(status_code=400, detail="ラベル名が空です")
    if old == new:
        return {"affected": 0}
    affected = firestore_service.rename_braindump_label(old, new)
    return {"affected": affected}


@router.delete("/braindump/labels/{name}")
async def delete_braindump_label_endpoint(name: str):
    """ラベルを削除（使用中の全メモからカスケード除去）"""
    target = (name or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="ラベル名が空です")
    affected = firestore_service.delete_braindump_label(target)
    return {"affected": affected}


# ---- バックグラウンドタスク ----

def _generate_title_background(entry_id: str, content: str):
    """バックグラウンドでAIタイトルを生成し保存する"""
    try:
        # 生成中に手動タイトルが設定された場合は上書きしない
        latest = firestore_service.get_braindump(entry_id)
        if latest and latest.get("title_custom"):
            return
        title = claude_service.generate_braindump_title(content)
        firestore_service.update_braindump(entry_id, {
            "title": title,
            "updated_at": now_jst(),
        })
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(
            "ブレインダンプ %s のタイトル生成に失敗: %s", entry_id, e,
        )
