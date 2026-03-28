"""
カテゴリ管理エンドポイント
GET  /api/v1/categories       — 全件取得
PUT  /api/v1/categories       — 全件上書き保存
"""

from fastapi import APIRouter
from pydantic import BaseModel

from services import firestore_service

router = APIRouter()


class CategoryItem(BaseModel):
    name: str
    color: str


class CategoriesSaveRequest(BaseModel):
    categories: list[CategoryItem]


class CategoriesResponse(BaseModel):
    categories: list[dict]


@router.get("/categories", response_model=CategoriesResponse)
async def get_categories():
    """カテゴリ一覧を取得"""
    categories = firestore_service.get_categories()
    return {"categories": categories}


@router.put("/categories", response_model=CategoriesResponse)
async def save_categories(body: CategoriesSaveRequest):
    """カテゴリ一覧を保存（全件上書き）"""
    categories = [item.model_dump() for item in body.categories]
    saved = firestore_service.save_categories(categories)
    return {"categories": saved}
