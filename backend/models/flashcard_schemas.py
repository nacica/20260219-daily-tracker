"""
単語帳カード用 Pydantic スキーマ定義
表面・裏面の2面構成。覚えた/まだ の自己評価。
"""

from pydantic import BaseModel, Field
from typing import Optional


# ---- API リクエスト ----

class FlashcardCreate(BaseModel):
    """カード作成リクエスト"""
    front: str = Field(..., min_length=1, max_length=5000, description="表面（問題・単語）")
    back: str = Field(..., min_length=1, max_length=5000, description="裏面（答え・意味）")


class FlashcardUpdate(BaseModel):
    """カード更新リクエスト"""
    front: Optional[str] = Field(None, min_length=1, max_length=5000)
    back: Optional[str] = Field(None, min_length=1, max_length=5000)


class FlashcardMark(BaseModel):
    """覚えた/まだ マーク"""
    remembered: bool = Field(..., description="true=覚えた, false=まだ")


# ---- API レスポンス ----

class FlashcardEntry(BaseModel):
    """単語帳カードエントリ"""
    id: str
    front: str
    back: str
    remembered: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
