"""
Pydantic スキーマ定義
Firestore のデータ構造と API のリクエスト/レスポンスを定義する
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# ---- 行動記録 ----

class Activity(BaseModel):
    """1件の行動記録（AIが構造化したもの）"""
    start_time: str                    # "08:00"
    end_time: Optional[str] = None     # "09:00"
    activity: str                      # "起床・準備"
    category: str                      # 生活/仕事/勉強/娯楽/無駄時間/運動
    is_productive: bool = True


class ScreenTimeApp(BaseModel):
    """スクリーンタイムのアプリ別使用時間"""
    name: str
    duration_minutes: int


class ScreenTime(BaseModel):
    """スクリーンタイム全体"""
    raw_image_url: Optional[str] = None
    apps: list[ScreenTimeApp] = []
    total_screen_time_minutes: int = 0


class Tasks(BaseModel):
    """その日のタスク"""
    planned: list[str] = []
    completed: list[str] = []
    completion_rate: float = 0.0


# ---- API リクエスト ----

class RecordCreate(BaseModel):
    """行動記録作成リクエスト"""
    date: str = Field(..., description="日付 (YYYY-MM-DD)")
    raw_input: str = Field(..., description="ユーザーが入力した生テキスト")
    tasks_planned: list[str] = Field(default=[], description="予定タスク")


class RecordUpdate(BaseModel):
    """行動記録更新リクエスト"""
    raw_input: Optional[str] = None
    tasks_completed: Optional[list[str]] = None


# ---- API レスポンス ----

class DailyRecord(BaseModel):
    """行動記録レスポンス"""
    id: str
    date: str
    raw_input: str
    parsed_activities: list[Activity] = []
    screen_time: Optional[ScreenTime] = None
    tasks: Tasks = Tasks()
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ---- AI 分析結果 ----

class ImprovementSuggestion(BaseModel):
    """改善提案"""
    suggestion: str
    priority: str   # "high" | "medium" | "low"
    category: str   # タスク管理/環境設計/習慣形成/メンタル/その他


class ComparisonWithPast(BaseModel):
    """過去との比較"""
    recurring_patterns: list[str] = []
    improvements_from_last_week: list[str] = []


class AnalysisDetail(BaseModel):
    """分析の詳細"""
    good_points: list[str] = []
    bad_points: list[str] = []
    root_causes: list[str] = []
    thinking_weaknesses: list[str] = []
    behavior_weaknesses: list[str] = []
    improvement_suggestions: list[ImprovementSuggestion] = []
    comparison_with_past: ComparisonWithPast = ComparisonWithPast()


class AnalysisSummary(BaseModel):
    """分析サマリー"""
    productive_hours: float = 0.0
    wasted_hours: float = 0.0
    youtube_hours: float = 0.0
    task_completion_rate: float = 0.0
    overall_score: int = 0       # 0-100


class DailyAnalysis(BaseModel):
    """日次分析レスポンス"""
    id: str
    date: str
    summary: AnalysisSummary
    analysis: AnalysisDetail
    created_at: Optional[str] = None
