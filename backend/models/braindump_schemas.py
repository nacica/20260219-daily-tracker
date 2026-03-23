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


class BraindumpUpdate(BaseModel):
    """ブレインダンプ更新リクエスト"""
    content: Optional[str] = Field(None, min_length=1, max_length=50000)


# ---- API レスポンス ----

class BraindumpEntry(BaseModel):
    """ブレインダンプエントリ"""
    id: str
    date: str
    entry_number: int = 1
    content: str
    title: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
