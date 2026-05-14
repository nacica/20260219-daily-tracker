"""
月次サマリーエンドポイント
POST /api/v1/summaries/generate/{yearMonth}  - 月次サマリー生成
GET  /api/v1/summaries/{yearMonth}           - 月次サマリー取得
GET  /api/v1/summaries                       - サマリー一覧
"""

import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException

from services import firestore_service
from services.claude_service import get_client, _call_claude_with_retry, _extract_json
from prompts.monthly_summary import MONTHLY_SUMMARY_SYSTEM_PROMPT, build_monthly_summary_prompt
from utils.helpers import now_jst

logger = logging.getLogger(__name__)

router = APIRouter()

# 月次サマリーは Sonnet を使用
SUMMARY_MODEL = "claude-sonnet-4-6"


@router.post("/summaries/generate/{year_month}")
async def generate_monthly_summary(year_month: str):
    """
    指定月の月次コーチングサマリーを生成する。
    形式: YYYY-MM（例: 2026-02）
    """
    try:
        # 月の開始日・終了日を計算
        year, month = year_month.split("-")
        start_date = f"{year}-{month}-01"
        if int(month) == 12:
            end_date = f"{int(year)+1}-01-01"
        else:
            end_date = f"{year}-{int(month)+1:02d}-01"
        # 月末日を計算
        end_dt = datetime.strptime(end_date, "%Y-%m-%d") - timedelta(days=1)
        end_date = end_dt.strftime("%Y-%m-%d")

        # 該当月の日次分析を取得
        analyses = firestore_service.list_analyses(start_date=start_date, end_date=end_date)
        if not analyses:
            raise HTTPException(status_code=404, detail=f"{year_month}の分析データがありません。")

        # テキスト化
        analyses_lines = []
        for a in sorted(analyses, key=lambda x: x.get("date", "")):
            s = a.get("summary", {})
            score = s.get("overall_score", 0)
            detail = a.get("analysis", {})
            good = detail.get("good_points", [])
            bad = detail.get("bad_points", [])
            analyses_lines.append(
                f"{a.get('date')}: スコア={score}, "
                f"生産的={s.get('productive_hours', '-')}h, "
                f"無駄={s.get('wasted_hours', '-')}h "
                f"良: {', '.join(good[:2])} / 悪: {', '.join(bad[:2])}"
            )

        # Claude API で月次サマリー生成
        user_prompt = build_monthly_summary_prompt(
            period=year_month,
            analyses_text="\n".join(analyses_lines),
        )

        client = get_client()
        response = _call_claude_with_retry(
            client,
            model=SUMMARY_MODEL,
            max_tokens=4096,
            system=MONTHLY_SUMMARY_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )

        summary_data = _extract_json(response.content[0].text)

        # Firestore に保存
        now = now_jst()
        doc = {
            "period": year_month,
            **summary_data,
            "created_at": now,
        }
        firestore_service.save_coaching_summary(year_month, doc)

        return doc

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"サマリー生成エラー: {type(e).__name__}: {str(e)}")


@router.get("/summaries/{year_month}")
async def get_monthly_summary(year_month: str):
    """月次コーチングサマリーを取得"""
    summary = firestore_service.get_coaching_summary(year_month)
    if not summary:
        raise HTTPException(status_code=404, detail=f"{year_month}のサマリーが見つかりません。")
    return summary


@router.get("/summaries")
async def list_summaries():
    """サマリー一覧を取得（最新のもの）"""
    latest = firestore_service.get_latest_coaching_summary()
    if not latest:
        return []
    return [latest]
