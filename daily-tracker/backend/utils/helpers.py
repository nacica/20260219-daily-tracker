"""
ヘルパー関数
"""

from datetime import datetime, timezone, timedelta


JST = timezone(timedelta(hours=9))


def now_jst() -> str:
    """現在の日本時間を ISO 8601 形式で返す"""
    return datetime.now(JST).isoformat()


def today_jst() -> str:
    """今日の日付を YYYY-MM-DD 形式で返す（日本時間）"""
    return datetime.now(JST).strftime("%Y-%m-%d")


def format_screen_time(screen_time: dict) -> str:
    """スクリーンタイムデータを文字列にフォーマット"""
    if not screen_time:
        return "データなし"

    apps = screen_time.get("apps", [])
    total = screen_time.get("total_screen_time_minutes", 0)

    lines = [f"合計スクリーンタイム: {total // 60}時間{total % 60}分"]
    for app in apps:
        mins = app.get("duration_minutes", 0)
        lines.append(f"  - {app.get('name', '不明')}: {mins // 60}時間{mins % 60}分")

    return "\n".join(lines)


def format_past_data(past_records: list, past_analyses: list) -> str:
    """過去データを文字列にフォーマット"""
    if not past_records:
        return "過去データなし"

    lines = []
    for record in past_records[-7:]:  # 直近7件
        date = record.get("date", "不明")
        # 対応する分析を探す
        analysis = next(
            (a for a in past_analyses if a.get("date") == date), None
        )
        if analysis:
            summary = analysis.get("summary", {})
            score = summary.get("overall_score", "-")
            productive = summary.get("productive_hours", "-")
            wasted = summary.get("wasted_hours", "-")
            lines.append(
                f"{date}: スコア={score}, 生産的={productive}h, 無駄={wasted}h"
            )
        else:
            lines.append(f"{date}: 分析データなし")

    return "\n".join(lines)
