"""
AI 分析エンドポイント
POST /api/v1/analysis/{date}/generate  - 分析を生成
GET  /api/v1/analysis/{date}           - 保存済み分析を取得
GET  /api/v1/analysis                  - 分析一覧を取得
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from models.schemas import DailyAnalysis, AnalysisSummary, AnalysisDetail
from services import firestore_service, claude_service
from utils.helpers import now_jst

router = APIRouter()


@router.post("/analysis/{date}/generate", response_model=DailyAnalysis)
async def generate_analysis(date: str):
    """
    指定日の行動記録をもとに Claude API で日次分析を生成し保存する。
    過去7日間のデータも参照して比較分析を行う。
    """
    try:
        # 行動記録の存在確認
        record = firestore_service.get_record(date)
        if not record:
            raise HTTPException(
                status_code=404,
                detail=f"{date} の行動記録が見つかりません。先に POST /records で記録を作成してください。",
            )

        # 過去データの取得（比較分析用）
        past_records = firestore_service.get_past_records(date, days=7)
        past_analyses = firestore_service.get_past_analyses(date, days=7)

        # Claude API で分析を生成
        try:
            analysis_data = claude_service.generate_daily_analysis(
                record=record,
                past_records=past_records,
                past_analyses=past_analyses,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Claude API エラー: {str(e)}")

        # 分析結果を Firestore に保存
        now = now_jst()
        doc = {
            "id": date,
            "date": date,
            "summary": analysis_data.get("summary", {}),
            "analysis": analysis_data.get("analysis", {}),
            "created_at": now,
        }
        saved = firestore_service.save_analysis(date, doc)

        return _build_response(saved)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"サーバーエラー: {type(e).__name__}: {str(e)}")


@router.get("/analysis/{date}", response_model=DailyAnalysis)
async def get_analysis(date: str):
    """保存済みの日次分析を取得する"""
    analysis = firestore_service.get_analysis(date)
    if not analysis:
        raise HTTPException(
            status_code=404,
            detail=f"{date} の分析が見つかりません。POST /analysis/{date}/generate で生成してください。",
        )
    return _build_response(analysis)


@router.get("/analysis", response_model=list[DailyAnalysis])
async def list_analyses(
    start_date: Optional[str] = Query(None, description="開始日 (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="終了日 (YYYY-MM-DD)"),
):
    """分析結果一覧を取得する"""
    analyses = firestore_service.list_analyses(start_date=start_date, end_date=end_date)
    return [_build_response(a) for a in analyses]


def _build_response(data: dict) -> DailyAnalysis:
    """Firestore のデータから DailyAnalysis レスポンスモデルを構築"""
    summary_raw = data.get("summary", {})
    analysis_raw = data.get("analysis", {})

    summary = AnalysisSummary(
        productive_hours=summary_raw.get("productive_hours") or 0.0,
        wasted_hours=summary_raw.get("wasted_hours") or 0.0,
        youtube_hours=summary_raw.get("youtube_hours") or 0.0,
        task_completion_rate=summary_raw.get("task_completion_rate") or 0.0,
        overall_score=summary_raw.get("overall_score") or 0,
    )

    from models.schemas import ImprovementSuggestion, ComparisonWithPast

    suggestions = [
        ImprovementSuggestion(**s) if isinstance(s, dict) else s
        for s in analysis_raw.get("improvement_suggestions", [])
    ]
    comparison_raw = analysis_raw.get("comparison_with_past", {})
    comparison = ComparisonWithPast(
        recurring_patterns=comparison_raw.get("recurring_patterns", []),
        improvements_from_last_week=comparison_raw.get("improvements_from_last_week", []),
    )

    analysis = AnalysisDetail(
        good_points=analysis_raw.get("good_points", []),
        bad_points=analysis_raw.get("bad_points", []),
        root_causes=analysis_raw.get("root_causes", []),
        thinking_weaknesses=analysis_raw.get("thinking_weaknesses", []),
        behavior_weaknesses=analysis_raw.get("behavior_weaknesses", []),
        improvement_suggestions=suggestions,
        comparison_with_past=comparison,
    )

    return DailyAnalysis(
        id=data.get("id", data.get("date", "")),
        date=data.get("date", ""),
        summary=summary,
        analysis=analysis,
        created_at=data.get("created_at"),
    )
