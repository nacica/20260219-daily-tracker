"""
メニュー（サイドバー／ホーム画面）の並び順エンドポイント

ドラッグで並び替えた順番をルート（"/", "/log", "/stocks" …）の配列で保存する。
PC とスマホで同じ順番になるよう、端末ではなくサーバー側に 1 件だけ持つ。

GET /api/v1/nav-order  — 並び順を取得（未設定なら空配列＝初期順）
PUT /api/v1/nav-order  — 並び順を全件上書き保存（空配列で初期順に戻す）
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from services import firestore_service

router = APIRouter()


class NavOrderRequest(BaseModel):
    routes: list[str] = Field(default_factory=list, max_length=200)


class NavOrderResponse(BaseModel):
    routes: list[str]


@router.get("/nav-order", response_model=NavOrderResponse)
async def get_nav_order():
    """並び順を取得"""
    return {"routes": firestore_service.get_nav_order()}


@router.put("/nav-order", response_model=NavOrderResponse)
async def save_nav_order(body: NavOrderRequest):
    """並び順を保存（全件上書き）。重複・長すぎる値は落とす"""
    seen: set[str] = set()
    routes: list[str] = []
    for r in body.routes:
        if not r or len(r) > 100 or r in seen:
            continue
        seen.add(r)
        routes.append(r)
    return {"routes": firestore_service.save_nav_order(routes)}
