"""
Udemy コース制作 Tips 用 Pydantic スキーマ定義
ブレインダンプとほぼ同形式。1 Tip = 1 エントリ。タグ複数付与可。
"""

from pydantic import BaseModel, Field
from typing import Optional


# ---- API リクエスト ----

class UdemyTipCreate(BaseModel):
    """Tips 作成リクエスト"""
    date: str = Field(..., description="作成日 (YYYY-MM-DD)")
    content: str = Field(..., min_length=1, max_length=50000, description="Tips 本文")
    labels: Optional[list[str]] = Field(default=None, description="タグ名リスト")


class UdemyTipUpdate(BaseModel):
    """Tips 更新リクエスト"""
    content: Optional[str] = Field(None, min_length=1, max_length=50000)
    labels: Optional[list[str]] = Field(default=None, description="タグ名リスト（指定で全置換）")


class UdemyTipReorderRequest(BaseModel):
    """同一日付内の並び替えリクエスト"""
    ordered_ids: list[str] = Field(..., min_length=1)


class UdemyTipLabelRenameRequest(BaseModel):
    """タグリネームリクエスト"""
    old_name: str = Field(..., min_length=1, max_length=50)
    new_name: str = Field(..., min_length=1, max_length=50)


# ---- API レスポンス ----

class UdemyTipEntry(BaseModel):
    """Tips エントリ"""
    id: str
    date: str
    entry_number: int = 1
    content: str
    title: Optional[str] = None
    labels: list[str] = Field(default_factory=list)
    sort_order: Optional[float] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class UdemyTipLabelCount(BaseModel):
    """タグと使用件数"""
    name: str
    count: int


class UdemyTipLabelListResponse(BaseModel):
    """全タグ一覧"""
    labels: list[UdemyTipLabelCount]
