"""
PIS の記録を Claude（MCP）へ渡すための取得・整形層

MCP ツール（get_recent_context / search_pis / get_entry / get_day、将来のプロフィール生成）は
必ずこのモジュールを通して記録を取り出す。ここで次の 3 つを一元管理する:

  1. 非公開の除外 ...... is_private(doc) が True の記録は一切返さない
                        （`is_private` フラグ、または `非公開` ラベル）
  2. 整形 ................ Markdown。各記録に「種類 / 日付 / ID / ラベル」を付け、Claude が出典を示せるようにする
  3. 文字数制限 .......... 1 回のツール応答は約 8,000 文字まで。超えた分は切り詰めて案内を付ける

データ取得は既存の services/firestore_service.py を再利用する。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from services import firestore_service as fs

logger = logging.getLogger(__name__)

PRIVATE_LABEL = "非公開"
MAX_CHARS = 8000
TRUNCATED_NOTE = "\n\n…（文字数上限のため省略しました。続きは条件を絞って再検索してください）"

JST = timezone(timedelta(hours=9))

SOURCES = [
    "activity_log", "tasks", "analysis", "journal", "braindump", "trade",
    "michishirube", "wishlist", "gratitude", "udemy_tips", "flashcards",
]

TYPE_LABELS = {
    "activity_log": "行動ログ",
    "tasks": "タスク",
    "analysis": "日次分析",
    "journal": "日記",
    "braindump": "自由帳",
    "trade": "トレードメモ",
    "michishirube": "道しるべ",
    "wishlist": "やりたいこと",
    "gratitude": "ありがたいノート",
    "udemy_tips": "Udemy Tips",
    "flashcards": "単語帳",
}

BOARDS = {
    "stocks": "株全般",
    "cfd-silver": "CFD銀",
    "sumco": "sumcoデイトレ",
    "breakout": "新高値ブレイク",
    "crude-oil": "原油",
    "natural-gas": "天然ガス",
}


# ---- 非公開判定（唯一の判定箇所） ----

def is_private(doc: Optional[dict]) -> bool:
    """この記録を Claude に渡してはいけないか。
    - `is_private: true` のドキュメント（日記・行動記録・やりたいこと・ありがたいノート・単語帳・付箋）
    - `非公開` ラベルの付いたもの（自由帳・トレードメモ・Udemy Tips）
    フィールドが無ければ公開扱い（既存データのマイグレーション不要）。"""
    if not doc:
        return False
    if doc.get("is_private") is True:
        return True
    labels = doc.get("labels")
    if isinstance(labels, list) and PRIVATE_LABEL in labels:
        return True
    return False


def public(docs: Iterable[dict]) -> list[dict]:
    return [d for d in docs if not is_private(d)]


# ---- ユーティリティ ----

def today() -> str:
    return datetime.now(JST).strftime("%Y-%m-%d")


def days_ago(n: int) -> str:
    return (datetime.now(JST) - timedelta(days=n)).strftime("%Y-%m-%d")


def default_range(start: Optional[str], end: Optional[str], days: int = 365) -> tuple[str, str]:
    """省略時は直近 days 日"""
    return (start or days_ago(days), end or today())


def truncate(text: str, limit: int = MAX_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - len(TRUNCATED_NOTE)].rstrip() + TRUNCATED_NOTE


def _date_of(iso: Optional[str]) -> str:
    return (iso or "")[:10]


def _ms_to_date(ms: Any) -> str:
    try:
        return datetime.fromtimestamp(int(ms) / 1000, JST).strftime("%Y-%m-%d")
    except Exception:
        return ""


def _in_range(date: str, start: str, end: str) -> bool:
    return bool(date) and start <= date <= end


def _first_line(text: str, n: int = 40) -> str:
    line = (text or "").strip().splitlines()[0] if (text or "").strip() else ""
    return line[:n]


def _lines(items: Iterable[str], bullet: str = "- ") -> str:
    return "\n".join(f"{bullet}{s}" for s in items if s)


# ---- 検索・整形で扱う共通の記録表現 ----

@dataclass
class Doc:
    type: str
    id: str
    date: str
    title: str = ""
    labels: list[str] = field(default_factory=list)
    texts: list[str] = field(default_factory=list)   # 検索対象の本文（複数フィールド）
    raw: dict = field(default_factory=dict)

    @property
    def type_label(self) -> str:
        return TYPE_LABELS.get(self.type, self.type)

    def header(self) -> str:
        lab = f"　ラベル: {', '.join(self.labels)}" if self.labels else ""
        title = f" — {self.title}" if self.title else ""
        return f"### [{self.type_label}] {self.date}{title}　(id: {self.id}){lab}"


# ---- 各ソースの取得（すべて非公開除外済み） ----

def _records(start: str, end: str) -> list[dict]:
    return public(fs.list_records(start_date=start, end_date=end))


def _private_record_dates(start: str, end: str) -> set[str]:
    """非公開の行動記録の日付。その日の分析・タスクも連動して除外する"""
    return {r.get("date", "") for r in fs.list_records(start_date=start, end_date=end) if is_private(r)}


def _record_doc(r: dict) -> Doc:
    labels = ["おやすみ"] if r.get("rest_day") else []
    return Doc("activity_log", r.get("date", ""), r.get("date", ""), title="行動ログ", labels=labels,
               texts=[r.get("raw_input", ""), r.get("rest_reason", "")], raw=r)


def _tasks_doc(r: dict) -> Optional[Doc]:
    tasks = r.get("tasks") or {}
    planned = [str(t) for t in tasks.get("planned", [])]
    completed = [str(t) for t in tasks.get("completed", [])]
    if not planned and not completed:
        return None
    return Doc("tasks", r.get("date", ""), r.get("date", ""), title="タスク", texts=planned + completed, raw=r)


def _analysis_doc(a: dict) -> Doc:
    an = a.get("analysis") or {}
    s = a.get("summary") or {}
    texts = []
    for key in ("good_points", "bad_points", "root_causes", "thinking_weaknesses", "behavior_weaknesses"):
        texts += [str(x) for x in an.get(key, [])]
    texts += [str(x.get("suggestion", "")) for x in an.get("improvement_suggestions", []) if isinstance(x, dict)]
    comp = an.get("comparison_with_past") or {}
    texts += [str(x) for x in comp.get("recurring_patterns", [])] + [str(x) for x in comp.get("improvements_from_last_week", [])]
    return Doc("analysis", a.get("date", ""), a.get("date", ""), title=f"スコア {s.get('overall_score', '-')}", texts=texts, raw=a)


def _journal_doc(j: dict) -> Doc:
    return Doc("journal", j.get("id", ""), j.get("date", ""), title=f"日記 #{j.get('entry_number', 1)}",
               texts=[j.get("content", ""), j.get("md_summary") or ""], raw=j)


def _braindump_doc(b: dict) -> Doc:
    board = b.get("board")
    typ = "trade" if board else "braindump"
    labels = list(b.get("labels") or [])
    if board:
        labels = [BOARDS.get(board, board)] + labels
    return Doc(typ, b.get("id", ""), b.get("date", ""), title=b.get("title") or _first_line(b.get("content", "")),
               labels=labels, texts=[b.get("title") or "", b.get("content", "")], raw=b)


def _reminder_doc(r: dict) -> Doc:
    labels = ["アーカイブ"] if r.get("archived") else []
    return Doc("michishirube", str(r.get("id", "")), _ms_to_date(r.get("createdAt")), title=_first_line(r.get("text", "")),
               labels=labels, texts=[r.get("text", "")], raw=r)


def _wishlist_doc(w: dict) -> Doc:
    labels = [w.get("category") or "その他", f"優先度{w.get('priority', 3)}"] + (["達成済み"] if w.get("completed") else [])
    return Doc("wishlist", w.get("id", ""), _date_of(w.get("created_at")), title=w.get("title", ""), labels=labels,
               texts=[w.get("title", ""), w.get("notes") or "", w.get("category") or ""], raw=w)


def _gratitude_doc(g: dict) -> Doc:
    return Doc("gratitude", g.get("id", ""), _date_of(g.get("created_at")), title=_first_line(g.get("content", "")),
               texts=[g.get("content", "")], raw=g)


def _udemy_doc(u: dict) -> Doc:
    return Doc("udemy_tips", u.get("id", ""), u.get("date", ""), title=u.get("title") or _first_line(u.get("content", "")),
               labels=list(u.get("labels") or []), texts=[u.get("title") or "", u.get("content", "")], raw=u)


def _flashcard_doc(c: dict) -> Doc:
    labels = ["覚えた"] if c.get("remembered") else ["まだ"]
    return Doc("flashcards", c.get("id", ""), _date_of(c.get("created_at")), title=_first_line(c.get("front", "")),
               labels=labels, texts=[c.get("front", ""), c.get("back", "")], raw=c)


def collect(sources: Optional[list[str]], start: str, end: str, board: Optional[str] = None,
            date_filter_undated: bool = False) -> list[Doc]:
    """検索対象の記録を集める（期間内・非公開除外・日付降順）

    date_filter_undated: 「日付に紐づかない記録」（道しるべ・やりたいこと・ありがたいノート・単語帳）にも
    期間を適用するか。既定 False（期間が明示されたときだけ適用。これらは作成日が古くても現役の情報なので、
    既定の「直近 365 日」で落とさない）。"""
    wanted = [s for s in (sources or SOURCES) if s in SOURCES] or list(SOURCES)
    docs: list[Doc] = []

    def undated_ok(d: Doc) -> bool:
        return (not date_filter_undated) or (not d.date) or _in_range(d.date, start, end)

    if "activity_log" in wanted or "tasks" in wanted:
        recs = _records(start, end)
        if "activity_log" in wanted:
            docs += [_record_doc(r) for r in recs if r.get("raw_input") or r.get("rest_day")]
        if "tasks" in wanted:
            docs += [d for d in (_tasks_doc(r) for r in recs) if d]

    if "analysis" in wanted:
        hidden = _private_record_dates(start, end)
        docs += [_analysis_doc(a) for a in fs.list_analyses(start_date=start, end_date=end) if a.get("date") not in hidden]

    if "journal" in wanted:
        docs += [_journal_doc(j) for j in public(fs.list_journals(start_date=start, end_date=end))]

    if "braindump" in wanted or "trade" in wanted:
        for b in public(fs.list_braindumps(start_date=start, end_date=end)):
            d = _braindump_doc(b)
            if d.type == "trade":
                if "trade" in wanted and (not board or b.get("board") == board):
                    docs.append(d)
            elif "braindump" in wanted:
                docs.append(d)

    if "michishirube" in wanted:
        docs += [d for d in (_reminder_doc(r) for r in public(fs.get_reminders())) if undated_ok(d)]

    if "wishlist" in wanted:
        docs += [d for d in (_wishlist_doc(w) for w in public(fs.list_wishlist())) if undated_ok(d)]

    if "gratitude" in wanted:
        docs += [d for d in (_gratitude_doc(g) for g in public(fs.list_gratitude())) if undated_ok(d)]

    if "udemy_tips" in wanted:
        docs += [_udemy_doc(u) for u in public(fs.list_udemy_tips(start_date=start, end_date=end))]

    if "flashcards" in wanted:
        docs += [d for d in (_flashcard_doc(c) for c in public(fs.list_flashcards())) if undated_ok(d)]

    docs.sort(key=lambda d: d.date, reverse=True)
    return docs


# ---- 全文整形 ----

def format_doc_full(doc: Doc) -> str:
    """1 件の記録を全文 Markdown で返す（get_entry / get_day 用）"""
    r = doc.raw
    parts = [doc.header()]
    if doc.type == "activity_log":
        if r.get("rest_day"):
            parts.append(f"おやすみモード（分析対象外）{('：' + r['rest_reason']) if r.get('rest_reason') else ''}")
        if r.get("available_hours") is not None:
            parts.append(f"活動可能時間: {r['available_hours']} 時間")
        parts.append(r.get("raw_input", "") or "（記録なし）")
    elif doc.type == "tasks":
        t = r.get("tasks") or {}
        parts.append("予定:\n" + (_lines(str(x) for x in t.get("planned", []) if x not in t.get("completed", [])) or "- なし"))
        parts.append("完了:\n" + (_lines(str(x) for x in t.get("completed", [])) or "- なし"))
    elif doc.type == "analysis":
        s, an = r.get("summary") or {}, r.get("analysis") or {}
        parts.append(f"スコア {s.get('overall_score', '-')} / 生産的 {s.get('productive_hours', '-')}h / 浪費 {s.get('wasted_hours', '-')}h / タスク完了率 {round(float(s.get('task_completion_rate') or 0) * 100)}%")
        for key, name in (("good_points", "良い点"), ("bad_points", "悪い点"), ("root_causes", "根本原因"),
                          ("thinking_weaknesses", "思考の癖"), ("behavior_weaknesses", "行動の癖")):
            if an.get(key):
                parts.append(f"{name}:\n" + _lines(str(x) for x in an[key]))
        sug = [f"[{x.get('priority', '')}] {x.get('suggestion', '')}" for x in an.get("improvement_suggestions", []) if isinstance(x, dict)]
        if sug:
            parts.append("改善提案:\n" + _lines(sug))
        comp = an.get("comparison_with_past") or {}
        if comp.get("recurring_patterns"):
            parts.append("繰り返しパターン:\n" + _lines(str(x) for x in comp["recurring_patterns"]))
        if comp.get("improvements_from_last_week"):
            parts.append("先週からの改善:\n" + _lines(str(x) for x in comp["improvements_from_last_week"]))
    elif doc.type == "journal":
        parts.append(r.get("content", ""))
        if r.get("md_summary"):
            parts.append("要約:\n" + r["md_summary"])
        a = r.get("ai_analysis")
        if isinstance(a, dict) and a:
            keys = [k for k in ("summary", "mood_score", "key_insights", "themes") if k in a]
            if keys:
                parts.append("AI 分析: " + "; ".join(f"{k}={a[k]}" for k in keys))
    elif doc.type in ("braindump", "trade", "udemy_tips"):
        parts.append(r.get("content", ""))
    elif doc.type == "michishirube":
        parts.append(r.get("text", ""))
    elif doc.type == "wishlist":
        meta = []
        if r.get("estimated_cost") is not None:
            meta.append(f"費用 {r['estimated_cost']} 円")
        if r.get("target_period"):
            meta.append(f"時期 {r['target_period']}")
        if r.get("completed_at"):
            meta.append(f"達成 {_date_of(r['completed_at'])}")
        if meta:
            parts.append(" / ".join(meta))
        if r.get("notes"):
            parts.append(r["notes"])
    elif doc.type == "gratitude":
        parts.append(r.get("content", ""))
    elif doc.type == "flashcards":
        parts.append("表: " + r.get("front", ""))
        parts.append("裏: " + r.get("back", ""))
    return "\n".join(p for p in parts if p)


# ---- get_entry ----

def get_entry_doc(type_: str, id_: str) -> Optional[Doc]:
    """種類と ID で 1 件取得。非公開・不存在は None"""
    if type_ in ("activity_log", "tasks"):
        r = fs.get_record(id_)
        if not r or is_private(r):
            return None
        return _record_doc(r) if type_ == "activity_log" else _tasks_doc(r)
    if type_ == "analysis":
        r = fs.get_record(id_)
        if r and is_private(r):
            return None
        a = fs.get_analysis(id_)
        return _analysis_doc(a) if a else None
    if type_ == "journal":
        j = fs.get_journal(id_)
        return _journal_doc(j) if j and not is_private(j) else None
    if type_ in ("braindump", "trade"):
        b = fs.get_braindump(id_)
        return _braindump_doc(b) if b and not is_private(b) else None
    if type_ == "michishirube":
        for r in fs.get_reminders():
            if str(r.get("id")) == id_:
                return _reminder_doc(r) if not is_private(r) else None
        return None
    if type_ == "wishlist":
        w = fs.get_wishlist_item(id_)
        return _wishlist_doc(w) if w and not is_private(w) else None
    if type_ == "gratitude":
        g = fs.get_gratitude(id_)
        return _gratitude_doc(g) if g and not is_private(g) else None
    if type_ == "udemy_tips":
        u = fs.get_udemy_tip(id_)
        return _udemy_doc(u) if u and not is_private(u) else None
    if type_ == "flashcards":
        c = fs.get_flashcard(id_)
        return _flashcard_doc(c) if c and not is_private(c) else None
    return None


def get_entry_text(type_: str, id_: str) -> str:
    if type_ not in SOURCES:
        return f"type は次のいずれかを指定してください: {', '.join(SOURCES)}"
    doc = get_entry_doc(type_, id_)
    if not doc:
        return "該当する記録はありません（存在しないか、非公開です）。"
    return truncate(format_doc_full(doc))


# ---- get_day ----

def get_day_text(date: str) -> str:
    """その日の行動ログ・タスク・日次分析・日記・自由帳・トレードメモをまとめる"""
    out = [f"# {date} の記録"]
    r = fs.get_record(date)
    if r and is_private(r):
        out.append("（この日の行動記録・タスク・分析は非公開です）")
        r = None
        a = None
    else:
        a = fs.get_analysis(date) if r else fs.get_analysis(date)
    if r:
        out.append(format_doc_full(_record_doc(r)))
        td = _tasks_doc(r)
        if td:
            out.append(format_doc_full(td))
    elif a is None:
        out.append("行動記録はありません。")
    if a:
        out.append(format_doc_full(_analysis_doc(a)))

    journals = public(fs.list_journals_for_date(date))
    for j in journals:
        out.append(format_doc_full(_journal_doc(j)))

    for b in public(fs.list_braindumps_for_date(date)):
        out.append(format_doc_full(_braindump_doc(b)))

    if len(out) == 1:
        out.append("この日の記録はありません。")
    return truncate("\n\n".join(out))


# ---- get_recent_context ----

def recent_context_text(days: int = 7) -> str:
    days = max(1, min(int(days or 7), 30))
    start, end = days_ago(days - 1), today()
    out = [f"# 直近 {days} 日の状況（{start} 〜 {end}）"]

    # 日次分析サマリー
    hidden = _private_record_dates(start, end)
    analyses = [a for a in fs.list_analyses(start_date=start, end_date=end) if a.get("date") not in hidden]
    if analyses:
        lines = []
        for a in analyses:
            s, an = a.get("summary") or {}, a.get("analysis") or {}
            good = (an.get("good_points") or [""])[0]
            bad = (an.get("bad_points") or [""])[0]
            lines.append(f"- {a.get('date')}: スコア {s.get('overall_score', '-')}（生産的 {s.get('productive_hours', '-')}h / 浪費 {s.get('wasted_hours', '-')}h）"
                         + (f" 良: {good}" if good else "") + (f" 悪: {bad}" if bad else ""))
        out.append("## 日次分析\n" + "\n".join(lines))
    else:
        out.append("## 日次分析\n期間内の分析はありません。")

    # おやすみ日・記録の有無
    recs = _records(start, end)
    rest = [r["date"] for r in recs if r.get("rest_day")]
    if rest:
        out.append("おやすみ（分析対象外）: " + ", ".join(sorted(rest)))

    # 最新の週次分析
    try:
        weekly = fs.list_weekly_analyses(limit=1)
    except Exception as e:
        logger.warning("週次分析の取得に失敗: %s", e)
        weekly = []
    if weekly:
        w = weekly[0]
        da = w.get("deep_analysis") or {}
        plan = da.get("improvement_plan") or {}
        lines = [f"週: {w.get('week_id')}（{w.get('week_start')}〜{w.get('week_end')}）"]
        if da.get("weekly_pattern"):
            lines.append(f"パターン: {da['weekly_pattern']}")
        tw = da.get("biggest_time_wasters") or []
        if tw:
            lines.append("最大の時間浪費: " + "; ".join(f"{x.get('activity')}（{x.get('total_hours')}h, きっかけ: {x.get('trigger', '')}）" for x in tw if isinstance(x, dict)))
        if plan.get("next_week_goals"):
            lines.append("来週の目標: " + " / ".join(str(x) for x in plan["next_week_goals"]))
        if plan.get("concrete_actions"):
            lines.append("具体行動: " + " / ".join(str(x) for x in plan["concrete_actions"]))
        out.append("## 直近の週次分析\n" + "\n".join(lines))

    # 未完了タスク（最新の記録から）
    latest = next((r for r in recs if (r.get("tasks") or {}).get("planned")), None)
    if latest:
        t = latest["tasks"]
        pending = [str(x) for x in t.get("planned", []) if x not in t.get("completed", [])]
        out.append(f"## 未完了タスク（{latest['date']} 時点、{len(pending)} 件）\n" + (_lines(pending[:40]) or "- なし"))

    # 道しるべ（アクティブのみ）
    reminders = [r for r in public(fs.get_reminders()) if not r.get("archived")]
    if reminders:
        out.append("## 道しるべ（今日意識すること）\n" + _lines(_first_line(r.get("text", ""), 80) for r in reminders[:20]))

    # 直近の自由帳・トレードメモのタイトル
    notes = public(fs.list_braindumps(start_date=start, end_date=end))
    if notes:
        lines = []
        for b in notes[:30]:
            d = _braindump_doc(b)
            lines.append(f"- {d.date} [{d.type_label}{('/' + BOARDS.get(b.get('board'), '')) if b.get('board') else ''}] {d.title}　(id: {d.id})")
        out.append("## 直近の自由帳・トレードメモ\n" + "\n".join(lines))

    return truncate("\n\n".join(out))
