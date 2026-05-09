"""
ありがたいノート用 Pydantic スキーマ定義

「今自分が恵まれている点 / 感謝できる対象」を思いついた時にその都度書き留める
シンプルなノート。1件 = 短いテキスト + 作成日時。一覧は新しい順。
"""

from pydantic import BaseModel, Field
from typing import Optional


class GratitudeCreate(BaseModel):
    """ありがたいノート作成リクエスト"""
    content: str = Field(..., min_length=1, max_length=2000, description="ありがたい内容")


class GratitudeUpdate(BaseModel):
    """ありがたいノート更新リクエスト"""
    content: str = Field(..., min_length=1, max_length=2000)


class GratitudeEntry(BaseModel):
    """ありがたいノートエントリ"""
    id: str
    content: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
