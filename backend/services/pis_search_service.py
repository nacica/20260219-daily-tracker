"""
PIS のキーワード検索（第 1 段階）

Firestore に全文検索は無いので、期間で絞って取得した記録を Python 側で照合する
（単一ユーザーなので件数的に問題ない）。

- 正規化: Unicode NFKC、英字小文字化、全角半角統一、カタカナ→ひらがな
  （1 文字 → 1 文字の対応に限定し、元の文字列と位置を揃える。スニペット抽出のため）
- 照合: スペース区切りの語をすべて含む記録（AND）。本文・タイトル・ラベル・タスク・分析の文章フィールド
- 並び: 一致数の多い順 → 新しい順
- 各ヒット: マッチ箇所前後 200 文字のスニペット + type + id + date

将来の意味検索（ベクトル）はこのモジュールの裏側に差し替える。search() の引数・返り値は固定。
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import Optional

from services import pis_context_service as ctx

SNIPPET_RADIUS = 200
DEFAULT_LIMIT = 20
MAX_LIMIT = 50


@dataclass
class SearchHit:
    type: str
    id: str
    date: str
    title: str
    labels: list[str]
    snippet: str
    score: int
    matched_field: str = ""   # どのフィールドでヒットしたか（本文 / タイトル / ラベル など）
    extra: dict = field(default_factory=dict)


# ---- 正規化 ----

def _norm_char(c: str) -> str:
    n = unicodedata.normalize("NFKC", c)
    if len(n) != 1:
        n = c
    o = ord(n)
    if 0x30A1 <= o <= 0x30F6:        # カタカナ → ひらがな
        n = chr(o - 0x60)
    return n.lower()


def normalize(text: str) -> str:
    """長さを保ったまま正規化（位置が元の文字列と 1:1 で対応する）"""
    return "".join(_norm_char(c) for c in (text or ""))


def parse_query(query: str) -> list[str]:
    terms = [t for t in normalize(query).replace("　", " ").split() if t]
    # 重複除去（順序維持）
    seen: set[str] = set()
    return [t for t in terms if not (t in seen or seen.add(t))]


# ---- 照合 ----

def _count(hay: str, needle: str) -> int:
    if not needle:
        return 0
    n, start = 0, 0
    while True:
        i = hay.find(needle, start)
        if i < 0:
            return n
        n += 1
        start = i + len(needle)


def _snippet(original: str, normalized: str, terms: list[str]) -> str:
    pos = min((p for p in (normalized.find(t) for t in terms) if p >= 0), default=0)
    s = max(0, pos - SNIPPET_RADIUS)
    e = min(len(original), pos + SNIPPET_RADIUS)
    text = original[s:e].replace("\n", " ").strip()
    return ("…" if s > 0 else "") + text + ("…" if e < len(original) else "")


def _match(doc: ctx.Doc, terms: list[str]) -> Optional[SearchHit]:
    fields = [("タイトル", doc.title)] + [("本文", t) for t in doc.texts] + [("ラベル", " ".join(doc.labels))]
    normalized = [(name, orig, normalize(orig)) for name, orig in fields if orig]
    joined = "\n".join(n for _, _, n in normalized)
    if not all(t in joined for t in terms):
        return None
    score = sum(_count(joined, t) for t in terms)
    # スニペットは最初にヒットしたフィールドから（本文を優先）
    for name, orig, norm in sorted(normalized, key=lambda x: 0 if x[0] == "本文" else 1):
        if any(t in norm for t in terms):
            return SearchHit(doc.type, doc.id, doc.date, doc.title, list(doc.labels), _snippet(orig, norm, terms), score, name)
    return SearchHit(doc.type, doc.id, doc.date, doc.title, list(doc.labels), "", score)


def search(query: str, sources: Optional[list[str]] = None, start_date: Optional[str] = None,
           end_date: Optional[str] = None, board: Optional[str] = None, limit: int = DEFAULT_LIMIT) -> list[SearchHit]:
    """キーワード検索。戻り値は一致数の多い順 → 新しい順"""
    terms = parse_query(query)
    if not terms:
        return []
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    explicit_range = bool(start_date or end_date)
    start, end = ctx.default_range(start_date, end_date)
    hits: list[SearchHit] = []
    for doc in ctx.collect(sources, start, end, board, date_filter_undated=explicit_range):
        h = _match(doc, terms)
        if h:
            hits.append(h)
    hits.sort(key=lambda h: h.date, reverse=True)
    hits.sort(key=lambda h: h.score, reverse=True)
    return hits[:limit]


def format_hits(hits: list[SearchHit], query: str, total_note: str = "") -> str:
    if not hits:
        return f"「{query}」に一致する記録はありません。語を減らす・期間を広げる・sources を変えるなどして再検索してください。"
    out = [f"# 検索結果: 「{query}」 {len(hits)} 件{total_note}"]
    for h in hits:
        lab = f"　ラベル: {', '.join(h.labels)}" if h.labels else ""
        title = f" — {h.title}" if h.title else ""
        out.append(f"### [{ctx.TYPE_LABELS.get(h.type, h.type)}] {h.date}{title}　(type: {h.type}, id: {h.id}){lab}\n{h.snippet}")
    out.append("全文は get_entry(type, id) で取得できます。")
    return ctx.truncate("\n\n".join(out))
