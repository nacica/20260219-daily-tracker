"""
やりたいことリスト用 Pydantic スキーマ定義

将来やりたいこと(欲しい物・行きたい場所・実現したい体験)を蓄えておくリスト。
タイトル・概算金額・カテゴリ・優先度(★1-5)・目標時期・メモ・画像URL・参考リンクを持ち、
達成したらフラグを立てて別タブに移動する。
"""

from pydantic import BaseModel, Field
from typing import Optional


# ---- API リクエスト ----

class WishlistCreate(BaseModel):
    """やりたいこと作成リクエスト"""
    title: str = Field(..., min_length=1, max_length=200, description="タイトル")
    estimated_cost: Optional[int] = Field(None, ge=0, description="概算金額(円)")
    category: str = Field("その他", min_length=1, max_length=50, description="カテゴリ")
    priority: int = Field(3, ge=1, le=5, description="優先度 ★1-5")
    target_period: Optional[str] = Field(None, max_length=50, description="目標時期(例: 2027年内)")
    notes: Optional[str] = Field(None, max_length=2000, description="メモ")
    # 画像はクリップボード貼り付けの data URL を直接受け取る
    # Firestore 1 ドキュメント 1MB 制限内に収めるためクライアント側で ~900KB に圧縮
    image_url: Optional[str] = Field(None, max_length=950_000, description="画像URL or data URL")
    reference_url: Optional[str] = Field(None, max_length=2000, description="参考リンク")


class WishlistUpdate(BaseModel):
    """やりたいこと更新リクエスト"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    estimated_cost: Optional[int] = Field(None, ge=0)
    category: Optional[str] = Field(None, min_length=1, max_length=50)
    priority: Optional[int] = Field(None, ge=1, le=5)
    target_period: Optional[str] = Field(None, max_length=50)
    notes: Optional[str] = Field(None, max_length=2000)
    image_url: Optional[str] = Field(None, max_length=950_000)
    reference_url: Optional[str] = Field(None, max_length=2000)


class WishlistComplete(BaseModel):
    """達成/未達成 マーク"""
    completed: bool = Field(..., description="true=達成済み, false=やりたい(未達)")


# ---- API レスポンス ----

class WishlistEntry(BaseModel):
    """やりたいことエントリ"""
    id: str
    title: str
    estimated_cost: Optional[int] = None
    category: str = "その他"
    priority: int = 3
    target_period: Optional[str] = None
    notes: Optional[str] = None
    image_url: Optional[str] = None
    reference_url: Optional[str] = None
    completed: bool = False
    completed_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
