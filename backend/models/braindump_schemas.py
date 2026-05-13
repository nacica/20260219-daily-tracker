"""
ブレインダンプ用 Pydantic スキーマ定義
1日に複数メモ作成可能。AIによる自動タイトル生成。
"""

from pydantic import BaseModel, Field
from typing import Optional


# ---- API リクエスト ----

class BraindumpCreate(BaseModel):
    """ブレインダンプ作成リクエスト"""
    date: str = Field(..., description="日付 (YYYY-MM-DD)")
    content: str = Field(..., min_length=1, max_length=50000, description="メモ本文")
    labels: Optional[list[str]] = Field(default=None, description="ラベル名リスト")


class BraindumpUpdate(BaseModel):
    """ブレインダンプ更新リクエスト"""
    content: Optional[str] = Field(None, min_length=1, max_length=50000)
    labels: Optional[list[str]] = Field(default=None, description="ラベル名リスト（指定で全置換）")


class LabelRenameRequest(BaseModel):
    """ラベルリネームリクエスト"""
    old_name: str = Field(..., min_length=1, max_length=50)
    new_name: str = Field(..., min_length=1, max_length=50)


class BraindumpReorderRequest(BaseModel):
    """同一日付内の並び替えリクエスト（ordered_ids の順に sort_order を 1,2,3,... で再採番）"""
    ordered_ids: list[str] = Field(..., min_length=1)


# ---- API レスポンス ----

class BraindumpEntry(BaseModel):
    """ブレインダンプエントリ"""
    id: str
    date: str
    entry_number: int = 1
    content: str
    title: Optional[str] = None
    labels: list[str] = Field(default_factory=list)
    sort_order: Optional[float] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class LabelCount(BaseModel):
    """ラベルと使用件数"""
    name: str
    count: int


class LabelListResponse(BaseModel):
    """全ラベル一覧（管理UI / 入力候補用）"""
    labels: list[LabelCount]
