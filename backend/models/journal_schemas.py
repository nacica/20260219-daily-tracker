"""
ジャーナル（フリー日記）用 Pydantic スキーマ定義
"""

from pydantic import BaseModel, Field
from typing import Optional


# ---- ジャーナル分析サブモデル ----

class EmotionTag(BaseModel):
    """感情タグ"""
    tag: str                          # 焦り, 充実感, 疲労, 不安, やる気 etc.
    intensity: float = 0.5            # 0.0-1.0
    context: str = ""                 # 簡潔な文脈説明


class ActionBlocker(BaseModel):
    """行動ブロッカー"""
    blocker: str                      # 具体的な阻害要因
    category: str                     # 睡眠不足|割り込み|モチベーション低下|体調不良|環境|計画不足|情報不足|人間関係|スキル不足|ツール問題|その他
    affected_tasks: list[str] = []
    severity: str = "medium"          # high|medium|low


class JournalAnalysis(BaseModel):
    """ジャーナルのAI分析結果"""
    emotions: list[EmotionTag] = []
    blockers: list[ActionBlocker] = []
    mood_score: int = 50              # 0-100
    energy_level: str = "medium"      # high|medium|low
    key_themes: list[str] = []
    insights: list[str] = []
    gratitude: list[str] = []
    summary: str = ""
    advice: list[str] = []
    encouragement: str = ""


# ---- API リクエスト ----

class JournalCreate(BaseModel):
    """ジャーナル作成リクエスト"""
    date: str = Field(..., description="日付 (YYYY-MM-DD)")
    content: str = Field(..., min_length=1, max_length=10000, description="ジャーナル本文")


class JournalUpdate(BaseModel):
    """ジャーナル更新リクエスト"""
    content: Optional[str] = Field(None, min_length=1, max_length=10000)


# ---- API レスポンス ----

class JournalEntry(BaseModel):
    """ジャーナルエントリ"""
    id: str
    date: str
    content: str
    ai_analysis: Optional[JournalAnalysis] = None
    is_analyzed: bool = False
    md_summary: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ---- 週次ダイジェスト ----

class EmotionTrend(BaseModel):
    """感情トレンド"""
    emotion: str
    daily_intensities: dict[str, float] = {}
    trend: str = "stable"             # increasing|stable|decreasing
    avg_intensity: float = 0.0


class TopBlocker(BaseModel):
    """トップブロッカー"""
    blocker: str
    frequency: int = 0
    severity_avg: str = "medium"
    suggestion: str = ""


class MoodTrajectory(BaseModel):
    """気分の軌跡"""
    start_of_week: int = 50
    end_of_week: int = 50
    trend: str = "stable"             # improving|stable|declining


class WeeklyJournalDigest(BaseModel):
    """週次ジャーナルダイジェスト"""
    id: str
    week_id: str
    week_start: str
    week_end: str
    emotion_trends: list[EmotionTrend] = []
    top_blockers: list[TopBlocker] = []
    weekly_insights: list[str] = []
    hidden_patterns: list[str] = []
    mood_trajectory: MoodTrajectory = MoodTrajectory()
    action_recommendations: list[str] = []
    created_at: Optional[str] = None
