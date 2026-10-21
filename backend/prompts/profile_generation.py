"""
「自分の取扱説明書」生成プロンプト

PIS に蓄積した月次サマリー・週次分析・やりたいこと・道しるべ・トレードメモのラベル集計から、
Claude が会話の最初に読む「ユーザーの取扱説明書」（Markdown、2,000〜3,000 文字）を生成する。
既存の取扱説明書があれば、それを土台に差分更新する（全面的に書き換えない）。
非公開の記録は呼び出し側（services/pis_context_service）で除外済みの前提。
"""

from __future__ import annotations

import json
from typing import Optional

PROFILE_SYSTEM_PROMPT = """あなたは、ユーザー本人のために「自分の取扱説明書」を書くアシスタントです。
この文書は、別の AI アシスタント（Claude）がユーザーとの会話の最初に読み、ユーザー固有の文脈を踏まえて回答するための前提資料になります。

【書き方のルール】
- Markdown で出力する。見出しは次の 7 つを「## 」で、この順に必ず入れる:
  1. 基本情報と現在の目標
  2. 強み・得意なやり方
  3. 繰り返し出る失敗パターン・思考の癖
  4. 集中できる条件 / できない条件
  5. 進行中のプロジェクト
  6. 判断の基準・大事にしていること
  7. Claude に回答してほしいスタイル
- 全体で 2,000〜3,000 文字（日本語）。各見出しは箇条書き 3〜6 項目を目安にし、具体的に書く
- 根拠が記録にある内容だけを書く。推測で補う場合は「（推測）」と明示する
- 記録の日付や回数など、具体性のある手がかりがあれば添える（例: 「9 月は帰宅後の集中が 3 回続いた」）
- 「現在の取扱説明書」が与えられた場合は、それを土台に新しい記録で裏付けられた部分を更新・追記し、
  裏付けが無くなった記述は削る。文体と構成は維持する
- 前置きや後書き、コードブロック、出典の長い引用は不要。本文の Markdown だけを出力する
- 二人称（「あなたは」）ではなく、第三者が読んでも分かる記述（「ユーザーは」または主語省略）にする
"""


def _j(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=1)


def build_profile_prompt(
    monthly_summaries: list[dict],
    weekly_analyses: list[dict],
    wishlist: list[dict],
    reminders: list[dict],
    trade_labels: dict[str, list[dict]],
    current_content: Optional[str],
    source_range: dict,
) -> str:
    """ユーザーメッセージ本文を組み立てる"""
    monthly = [
        {
            "period": m.get("period"),
            "top_patterns": m.get("top_patterns", []),
            "goals_progress": m.get("goals_progress", []),
            "emotional_summary": m.get("emotional_summary", {}),
            "key_insights": m.get("key_insights", []),
            "coaching_effectiveness": m.get("coaching_effectiveness", {}),
        }
        for m in monthly_summaries
    ]
    weekly = []
    for w in weekly_analyses:
        da = w.get("deep_analysis") or {}
        weekly.append({
            "week": w.get("week_id"),
            "range": f"{w.get('week_start')}〜{w.get('week_end')}",
            "summary": w.get("weekly_summary", {}),
            "weekly_pattern": da.get("weekly_pattern"),
            "biggest_time_wasters": da.get("biggest_time_wasters", []),
            "cognitive_patterns": da.get("cognitive_patterns", []),
            "improvement_plan": da.get("improvement_plan", {}),
            "progress_vs_last_week": da.get("progress_vs_last_week", {}),
        })
    wishes = [
        {"title": x.get("title"), "category": x.get("category"), "priority": x.get("priority"),
         "completed": bool(x.get("completed")), "notes": (x.get("notes") or "")[:200]}
        for x in wishlist
    ]
    notes = [(r.get("text") or "")[:300] for r in reminders]

    parts = [
        f"対象期間: {source_range.get('start')} 〜 {source_range.get('end')}",
        "",
        "## 入力 1: 月次サマリー（直近 3 か月）",
        _j(monthly) if monthly else "（なし）",
        "",
        "## 入力 2: 週次分析（直近 12 週）",
        _j(weekly) if weekly else "（なし）",
        "",
        "## 入力 3: やりたいことリスト",
        _j(wishes) if wishes else "（なし）",
        "",
        "## 入力 4: 道しるべ（今日意識すること・本人が書いた付箋）",
        _j(notes) if notes else "（なし）",
        "",
        "## 入力 5: トレードメモのラベル集計（ボード別・件数）",
        _j(trade_labels) if trade_labels else "（なし）",
        "",
    ]
    if current_content and current_content.strip():
        parts += ["## 現在の取扱説明書（これを土台に差分更新する）", current_content.strip(), ""]
    else:
        parts += ["## 現在の取扱説明書", "（未作成。新規に作成する）", ""]
    parts.append("上記の記録から「自分の取扱説明書」を Markdown で作成してください。")
    return "\n".join(parts)
