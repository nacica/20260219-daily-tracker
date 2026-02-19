/**
 * 履歴一覧コンポーネント
 * カレンダービュー（月ごとのスコア色）＋リストビュー
 */

import { recordsApi, analysisApi } from "../api.js";

/**
 * 履歴一覧画面をメインエリアに描画する
 */
export async function renderHistoryList() {
  const main = document.querySelector("main");
  main.innerHTML = `<div class="loading"><div class="spinner"></div><p>履歴を読み込み中...</p></div>`;

  try {
    // 直近3ヶ月のデータを取得
    const endDate = todayStr();
    const startDate = monthsAgo(3);

    const [records, analyses] = await Promise.all([
      recordsApi.list(startDate, endDate),
      analysisApi.list(startDate, endDate),
    ]);

    main.innerHTML = buildHistoryHTML(records, analyses);
    attachHistoryEvents(records, analyses);
  } catch (err) {
    main.innerHTML = `
      <div class="empty-state">
        <div class="icon">📅</div>
        <p>データの取得に失敗しました: ${err.message}</p>
        <button class="btn btn-outline" onclick="window.location.hash='/'">ホームへ戻る</button>
      </div>`;
  }
}

function buildHistoryHTML(records, analyses) {
  const analysisMap = Object.fromEntries(analyses.map((a) => [a.date, a]));
  const recordDates = new Set(records.map((r) => r.date));

  if (records.length === 0) {
    return `
      <h2 style="margin-bottom: var(--gap);">履歴</h2>
      <div class="empty-state">
        <div class="icon">📅</div>
        <p>まだ記録がありません。<br>行動記録を入力して始めましょう。</p>
        <button class="btn btn-primary" onclick="window.location.hash='/input'">記録を入力する</button>
      </div>`;
  }

  // 今月のカレンダーを生成
  const calendarHTML = buildCalendarHTML(analysisMap, recordDates);

  // リストビュー（新しい順）
  const listHTML = records.slice(0, 30).map((rec) => {
    const analysis = analysisMap[rec.date];
    const score = analysis?.summary?.overall_score;
    const scoreClass = score == null ? "" : score >= 70 ? "good" : score >= 40 ? "mid" : "bad";
    const tasks = rec.tasks || {};
    const completionRate = Math.round((tasks.completion_rate || 0) * 100);

    return `
      <div class="history-item" data-date="${rec.date}" onclick="window.location.hash='/analysis/${rec.date}'" role="button">
        <div class="history-date">${formatDateShort(rec.date)}</div>
        <div class="history-body">
          <div class="history-preview">${truncate(rec.raw_input, 60)}</div>
          ${completionRate > 0 ? `<div class="history-meta">タスク完了率: ${completionRate}%</div>` : ""}
        </div>
        ${score != null ? `
          <div class="history-score ${scoreClass}">${score}</div>
        ` : `<div class="history-score no-score">-</div>`}
      </div>`;
  }).join("");

  return `
    <h2 style="margin-bottom: var(--gap);">履歴</h2>
    ${calendarHTML}
    <div class="card">
      <div class="card-title">記録一覧（直近 ${Math.min(records.length, 30)} 件）</div>
      <div class="history-list">${listHTML}</div>
    </div>`;
}

function buildCalendarHTML(analysisMap, recordDates) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay(); // 0=日

  const monthLabel = `${year}年${month + 1}月`;
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

  let cells = "";
  // 先頭の空白
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell empty"></div>`;

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const analysis = analysisMap[dateStr];
    const hasRecord = recordDates.has(dateStr);
    const score = analysis?.summary?.overall_score;
    const isToday = dateStr === todayStr();

    let cls = "cal-cell";
    if (isToday) cls += " today";
    if (hasRecord && score != null) {
      cls += score >= 70 ? " score-good" : score >= 40 ? " score-mid" : " score-bad";
    } else if (hasRecord) {
      cls += " has-record";
    }

    cells += `
      <div class="${cls}" onclick="window.location.hash='/${hasRecord ? "analysis" : "input"}/${dateStr}'" title="${dateStr}${score != null ? ` スコア:${score}` : ""}">
        <span class="cal-day">${d}</span>
        ${score != null ? `<span class="cal-score">${score}</span>` : ""}
      </div>`;
  }

  return `
    <div class="card">
      <div class="card-title">カレンダー - ${monthLabel}</div>
      <div class="calendar-grid">
        ${weekdays.map((w) => `<div class="cal-header">${w}</div>`).join("")}
        ${cells}
      </div>
      <div class="cal-legend">
        <span class="legend-item score-good-bg">70+ 良</span>
        <span class="legend-item score-mid-bg">40-69 普通</span>
        <span class="legend-item score-bad-bg">39- 要改善</span>
        <span class="legend-item has-record-bg">記録のみ</span>
      </div>
    </div>`;
}

function attachHistoryEvents(records, analyses) {
  // 現在は onclick で処理しているため追加イベントなし
}

// ---- ユーティリティ ----

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toLocaleDateString("sv-SE");
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}（${weekdays[d.getDay()]}）`;
}

function truncate(str, len) {
  if (!str) return "";
  const firstLine = str.split("\n")[0];
  return firstLine.length > len ? firstLine.slice(0, len) + "…" : firstLine;
}
