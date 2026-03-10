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
    backlog: list[str] = []
    completion_rate: float = 0.0


# ---- API リクエスト ----

class RecordCreate(BaseModel):
    """行動記録作成リクエスト"""
    date: str = Field(..., description="日付 (YYYY-MM-DD)")
    raw_input: str = Field(..., description="ユーザーが入力した生テキスト")
    tasks_planned: list[str] = Field(default=[], description="予定タスク")
    tasks_backlog: list[str] = Field(default=[], description="近日中タスク")


class RecordUpdate(BaseModel):
    """行動記録更新リクエスト"""
    raw_input: Optional[str] = None
    tasks_planned: Optional[list[str]] = None
    tasks_completed: Optional[list[str]] = None
    tasks_backlog: Optional[list[str]] = None
    rest_day: Optional[bool] = None
    rest_reason: Optional[str] = None


class RestDayRequest(BaseModel):
    """おやすみモード切替リクエスト"""
    rest_day: bool = Field(..., description="おやすみモードの有効/無効")
    rest_reason: str = Field(default="", description="理由（残業・体調不良・出張など）")


# ---- API レスポンス ----

class DailyRecord(BaseModel):
    """行動記録レスポンス"""
    id: str
    date: str
    raw_input: str
    parsed_activities: list[Activity] = []
    screen_time: Optional[ScreenTime] = None
    tasks: Tasks = Tasks()
    rest_day: bool = False
    rest_reason: str = ""
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


# ---- ソクラテス式対話 ----

class DialogueMessage(BaseModel):
    """対話の1メッセージ"""
    role: str              # "ai" | "user"
    content: str
    timestamp: Optional[str] = None


class AnalysisDialogue(BaseModel):
    """ソクラテス式対話セッション"""
    id: str
    date: str
    status: str            # "in_progress" | "completed"
    messages: list[DialogueMessage] = []
    turn_count: int = 0    # ユーザーの発言回数
    max_turns: int = 5
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class DialogueReplyRequest(BaseModel):
    """対話返信リクエスト"""
    message: str = Field(..., min_length=1, max_length=2000)


# ---- 朝のタスク整理 ----

class MorningPlanTask(BaseModel):
    """朝プランの個別タスク"""
    task: str
    priority: str = "medium"  # high|medium|low
    reason: str = ""


class MorningPlan(BaseModel):
    """朝問答から生成されたプラン"""
    tasks_today: list[MorningPlanTask] = []
    carried_over: list[str] = []
    context_summary: str = ""
    focus_message: str = ""


# ---- ナレッジグラフ（コーチング機能） ----

class EntityObservation(BaseModel):
    """エンティティの観測記録"""
    content: str
    source_date: str
    confidence: float = 0.8


class UserEntity(BaseModel):
    """ナレッジグラフのエンティティ"""
    id: str = ""
    name: str
    entityType: str  # goal|behavior_pattern|trigger|strength|weakness|habit|value|emotion_pattern|life_context
    observations: list[EntityObservation] = []
    first_observed: str = ""
    last_observed: str = ""
    observation_count: int = 0
    status: str = "active"  # active|resolved|monitoring
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class EntityRelation(BaseModel):
    """エンティティ間の関係性"""
    id: str = ""
    from_entity: str
    from_entity_id: str = ""
    to_entity: str
    to_entity_id: str = ""
    relation_type: str  # triggers|prevents|supports|conflicts_with|correlates_with|part_of|leads_to
    strength: float = 0.5
    evidence_count: int = 1
    evidence_dates: list[str] = []
    description: str = ""
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PatternSummary(BaseModel):
    """月次パターンサマリー"""
    pattern: str
    frequency: int = 0
    trend: str = "stable"  # improving|stable|worsening


class GoalProgress(BaseModel):
    """月次目標進捗"""
    goal: str
    progress_percentage: int = 0
    blockers: list[str] = []
    achievements: list[str] = []


class EmotionalSummary(BaseModel):
    """月次感情サマリー"""
    average_score: float = 0.0
    best_day_pattern: str = ""
    worst_day_pattern: str = ""


class CoachingEffectiveness(BaseModel):
    """コーチング効果"""
    advice_followed_rate: float = 0.0
    most_effective_advice: str = ""
    least_effective_advice: str = ""


class CoachingSummary(BaseModel):
    """月次コーチングサマリー"""
    period: str  # YYYY-MM
    top_patterns: list[PatternSummary] = []
    goals_progress: list[GoalProgress] = []
    emotional_summary: EmotionalSummary = EmotionalSummary()
    key_insights: list[str] = []
    coaching_effectiveness: CoachingEffectiveness = CoachingEffectiveness()
    created_at: Optional[str] = None


# ---- コーチング API リクエスト ----

class CoachChatRequest(BaseModel):
    """コーチングチャットリクエスト"""
    message: str = Field(..., min_length=1, max_length=2000)
    conversation_history: list[dict] = Field(default=[], description="直近の対話履歴（最大10ターン）")


class CoachChatResponse(BaseModel):
    """コーチングチャットレスポンス"""
    reply: str
    referenced_patterns: list[str] = []
    suggested_action: str = ""
