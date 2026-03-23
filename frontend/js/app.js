/**
 * アプリのメインロジック
 * ルーティングの設定とホーム画面の表示を担当する
 */

import { addRoute, navigate, updateNavActive } from "./router.js?v=20260323f";
import { renderInputForm } from "./components/input-form.js?v=20260323f";
import { renderAnalysisView } from "./components/analysis-view.js?v=20260323f";
import { renderHistoryList } from "./components/history-list.js?v=20260323f";
import { renderWeeklyReport } from "./components/weekly-report.js?v=20260323f";
import { renderSuggestions } from "./components/suggestions.js?v=20260323f";
import { renderCoachingChat } from "./components/coaching-chat.js?v=20260323f";
import { renderKnowledgeGraph } from "./components/knowledge-graph.js?v=20260323f";
import { renderMonthlyReport } from "./components/monthly-report.js?v=20260323f";
import { renderJournal } from "./components/journal.js?v=20260323f";
import { recordsApi, analysisApi } from "./api.js?v=20260323f";
import { initSwipeNav } from "./swipe-nav.js?v=20260323f";
import { buildTaskStatsCards, renderTaskStats } from "./components/task-stats.js?v=20260323f";

// ===== ユーティリティ =====

/** 今日の日付を YYYY-MM-DD 形式で返す */
function today() {
  return new Date().toLocaleDateString("sv-SE"); // "2026-02-19"
}

/** 日付を日本語表記にフォーマット */
function formatDateJP(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${weekdays[d.getDay()]}）`;
}

/** メインコンテンツエリアを返す */
function getMain() {
  return document.querySelector("main");
}

// ===== デスクトップヘッダー更新 =====

/** ルート名マッピング */
const ROUTE_TITLES = {
  "/": { title: "ダッシュボード", breadcrumb: "ホーム" },
  "/input": { title: "行動記録", breadcrumb: "記録入力" },
  "/history": { title: "履歴一覧", breadcrumb: "履歴" },
  "/weekly": { title: "週次レポート", breadcrumb: "週次分析" },
  "/suggestions": { title: "改善提案", breadcrumb: "提案アーカイブ" },
  "/coach": { title: "コーチング", breadcrumb: "パーソナルコーチ" },
  "/knowledge": { title: "ナレッジグラフ", breadcrumb: "行動パターン" },
  "/monthly": { title: "月次レポート", breadcrumb: "月次サマリー" },
  "/journal": { title: "フリージャーナル", breadcrumb: "ジャーナル" },
  "/task-stats": { title: "タスク実績", breadcrumb: "タスク実績" },
};

/** デスクトップヘッダーのタイトルと日付を更新 */
function updateDesktopHeader() {
  const titleEl = document.getElementById("desktop-page-title");
  const breadcrumbEl = document.getElementById("desktop-breadcrumb");
  const dateEl = document.getElementById("desktop-date");
  if (!titleEl) return;

  const hash = window.location.hash.slice(1) || "/";
  const baseRoute = "/" + (hash.split("/")[1] || "");
  const route = ROUTE_TITLES[baseRoute] || ROUTE_TITLES["/"];

  titleEl.textContent = route.title;
  breadcrumbEl.textContent = route.breadcrumb;

  // 日付+時刻表示（コロン点滅）
  function updateDateTime() {
    const now = new Date();
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    const dateText = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日（${weekdays[now.getDay()]}）`;
    dateEl.innerHTML = `${dateText}${h}<span class="blink-colon">:</span>${m}`;
  }
  updateDateTime();
  if (!dateEl.dataset.timerInit) {
    dateEl.dataset.timerInit = "1";
    setInterval(updateDateTime, 60000);
  }

  // カレンダーピッカーのイベント登録（初回のみ）
  if (!dateEl.dataset.calInit) {
    dateEl.dataset.calInit = "1";
    dateEl.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDatePicker(dateEl);
    });
  }
}

// ===== カレンダー日付ピッカー =====

let calendarState = { year: null, month: null, recordDates: new Set() };

function toggleDatePicker(anchorEl) {
  const existing = document.querySelector(".date-picker-calendar");
  if (existing) { closeDatePicker(); return; }

  const now = new Date();
  calendarState.year = now.getFullYear();
  calendarState.month = now.getMonth();

  openDatePicker(anchorEl);
}

function closeDatePicker() {
  document.querySelector(".date-picker-calendar")?.remove();
  document.querySelector(".date-picker-overlay")?.remove();
}

async function openDatePicker(anchorEl) {
  closeDatePicker();

  // 記録のある日を取得
  await fetchRecordDatesForMonth(calendarState.year, calendarState.month);

  const cal = document.createElement("div");
  cal.className = "date-picker-calendar";
  cal.innerHTML = buildCalendarHTML(calendarState.year, calendarState.month);

  // クリック外で閉じるオーバーレイ
  const overlay = document.createElement("div");
  overlay.className = "date-picker-overlay";
  overlay.addEventListener("click", closeDatePicker);

  document.body.appendChild(overlay);

  // body に直接配置し、anchorEl の位置に合わせる
  document.body.appendChild(cal);
  const rect = anchorEl.getBoundingClientRect();
  cal.style.position = "fixed";
  cal.style.top = `${rect.bottom + 8}px`;
  cal.style.right = `${document.documentElement.clientWidth - rect.right}px`;

  // カレンダー内のイベント
  cal.addEventListener("click", async (e) => {
    e.stopPropagation();

    const navBtn = e.target.closest(".cal-nav-btn");
    if (navBtn) {
      const dir = parseInt(navBtn.dataset.dir);
      calendarState.month += dir;
      if (calendarState.month < 0) { calendarState.month = 11; calendarState.year--; }
      if (calendarState.month > 11) { calendarState.month = 0; calendarState.year++; }
      await fetchRecordDatesForMonth(calendarState.year, calendarState.month);
      cal.innerHTML = buildCalendarHTML(calendarState.year, calendarState.month);
      return;
    }

    const dayEl = e.target.closest(".cal-day");
    if (dayEl && !dayEl.classList.contains("future")) {
      const date = dayEl.dataset.date;
      if (date) {
        closeDatePicker();
        window.location.hash = `/input/${date}`;
      }
    }
  });
}

async function fetchRecordDatesForMonth(year, month) {
  try {
    const startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const records = await recordsApi.list(startDate, endDate);
    const dates = new Set(records.map((r) => r.date));
    calendarState.recordDates = dates;
  } catch {
    calendarState.recordDates = new Set();
  }
}

function buildCalendarHTML(year, month) {
  const todayStr = today();
  const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  let days = "";

  // 前月の余白
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const prevMonth = month === 0 ? 12 : month;
    const prevYear = month === 0 ? year - 1 : year;
    const dateStr = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days += `<div class="cal-day other-month" data-date="${dateStr}">${d}</div>`;
  }

  // 今月
  const todayDate = new Date();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isFuture = new Date(year, month, d) > todayDate;
    const isToday = dateStr === todayStr;
    const hasRecord = calendarState.recordDates.has(dateStr);
    const classes = ["cal-day"];
    if (isToday) classes.push("today");
    if (isFuture) classes.push("future");
    if (hasRecord) classes.push("has-record");
    days += `<div class="${classes.join(" ")}" data-date="${dateStr}">${d}</div>`;
  }

  // 次月の余白
  const totalCells = firstDay + daysInMonth;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let d = 1; d <= remaining; d++) {
    const nextMonth = month === 11 ? 1 : month + 2;
    const nextYear = month === 11 ? year + 1 : year;
    const dateStr = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days += `<div class="cal-day other-month future" data-date="${dateStr}">${d}</div>`;
  }

  return `
    <div class="cal-header">
      <button class="cal-nav-btn" data-dir="-1">◀</button>
      <span class="cal-header-title">${year}年 ${monthNames[month]}</span>
      <button class="cal-nav-btn" data-dir="1">▶</button>
    </div>
    <div class="cal-weekdays">
      <span>日</span><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span>
    </div>
    <div class="cal-days">${days}</div>
  `;
}

/** ローディング表示 */
function showLoading(message = "読み込み中...") {
  getMain().innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>`;
}

/** トースト通知を表示 */
export function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  const icon = type === "error" ? "❌" : type === "success" ? "✅" : "ℹ️";

  if (type === "error") {
    toast.innerHTML = `<span>${icon}</span><span class="toast-msg">${message}</span><button class="toast-copy" title="コピー">📋</button>`;
    const copyBtn = toast.querySelector(".toast-copy");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(message).then(() => {
        copyBtn.textContent = "✅";
        setTimeout(() => { copyBtn.textContent = "📋"; }, 1500);
      });
    });
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 8000);
  } else {
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
}

// ===== 今日意識すること（ホーム用） =====

function getHomeReminders() {
  try {
    const saved = localStorage.getItem("daily-reminders");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

let homeReminderIndex = 0;

function buildHomeReminderCard() {
  const reminders = getHomeReminders();
  if (reminders.length === 0) return "";

  if (homeReminderIndex >= reminders.length) homeReminderIndex = 0;

  const navHTML = reminders.length > 1
    ? `<div class="sticky-nav">
        <button class="sticky-nav-btn" id="home-sticky-prev">&#9664;</button>
        <span class="sticky-counter" id="home-sticky-counter">${homeReminderIndex + 1} / ${reminders.length}</span>
        <button class="sticky-nav-btn" id="home-sticky-next">&#9654;</button>
      </div>`
    : "";

  const notesHTML = reminders.map((r, i) => {
    const activeClass = i === homeReminderIndex ? " active" : "";
    const d = r.createdAt ? new Date(r.createdAt) : null;
    const dateStr = d
      ? `${d.getMonth() + 1}/${d.getDate()}(${["日","月","火","水","木","金","土"][d.getDay()]}) ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`
      : "";
    const escaped = r.text.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
    return `<div class="sticky-note${activeClass}" data-id="${r.id}">
      <div class="sticky-note-body">
        ${dateStr ? `<div class="sticky-note-date">${dateStr}</div>` : ""}
        <span class="sticky-text">${escaped}</span>
      </div>
    </div>`;
  }).join("");

  return `
    <div class="card reminder-board-card" id="home-reminder-board">
      <div class="card-title">今日意識すること</div>
      ${navHTML}
      <div class="sticky-notes" id="home-sticky-notes">
        ${notesHTML}
      </div>
    </div>`;
}

function attachHomeReminderEvents() {
  const reminders = getHomeReminders();
  if (reminders.length <= 1) return;

  const container = document.getElementById("home-sticky-notes");
  if (!container) return;

  function showAtIndex() {
    const notes = container.querySelectorAll(".sticky-note");
    notes.forEach((note, i) => note.classList.toggle("active", i === homeReminderIndex));
    const counter = document.getElementById("home-sticky-counter");
    if (counter) counter.textContent = `${homeReminderIndex + 1} / ${notes.length}`;
  }

  function navigate(delta) {
    const len = reminders.length;
    homeReminderIndex = (homeReminderIndex + delta + len) % len;
    showAtIndex();
  }

  const prev = document.getElementById("home-sticky-prev");
  const next = document.getElementById("home-sticky-next");
  if (prev) prev.addEventListener("click", () => navigate(-1));
  if (next) next.addEventListener("click", () => navigate(1));

  // カード本体クリックで次へ
  container.addEventListener("click", (e) => {
    if (e.target.closest(".sticky-note") && reminders.length > 1) {
      navigate(1);
    }
  });
}

// ===== ホーム画面 =====

async function renderHome() {
  const todayStr = today();
  showLoading("今日のデータを確認中...");

  try {
    // 今日の記録と分析を並行取得
    const [record, analysis] = await Promise.allSettled([
      recordsApi.get(todayStr),
      analysisApi.get(todayStr),
    ]);

    const hasRecord = record.status === "fulfilled" && record.value;
    const hasAnalysis = analysis.status === "fulfilled" && analysis.value;
    const isRestDay = hasRecord && record.value.rest_day;
    const restReason = hasRecord ? record.value.rest_reason || "" : "";

    getMain().innerHTML = `
      <div class="home-date">${formatDateJP(todayStr)}</div>
      <h1 class="home-title">今日の行動分析</h1>
      ${buildHomeReminderCard()}
      ${isRestDay ? `
      <div class="card" style="border: 1px solid rgba(168, 85, 247, 0.3); background: rgba(168, 85, 247, 0.08); margin-bottom: var(--gap);">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 1.5rem;">🌙</span>
          <div>
            <div style="font-weight: 600;">おやすみモード</div>
            <div style="font-size: 0.82rem; color: var(--text-secondary);">
              今日は分析対象外です${restReason ? `（${restReason}）` : ""}
            </div>
          </div>
        </div>
      </div>` : ""}
      ${hasAnalysis && !isRestDay ? buildHomeSummary(analysis.value) : ""}
      ${buildHomeActions(hasRecord, hasAnalysis, todayStr, isRestDay)}
    `;
    attachHomeReminderEvents();
  } catch (e) {
    getMain().innerHTML = `
      ${buildHomeReminderCard()}
      <div class="empty-state">
        <div class="icon">📝</div>
        <p>今日の記録はまだありません。<br>行動記録を入力して分析を始めましょう。</p>
        <button class="btn btn-primary" onclick="window.location.hash='/input'">記録を入力する</button>
      </div>`;
    attachHomeReminderEvents();
  }
}

function buildHomeSummary(analysis) {
  const score = analysis.summary.overall_score;
  const scoreClass = score >= 70 ? "good" : score >= 40 ? "mid" : "bad";
  const scoreLabel = score >= 70 ? "良い一日" : score >= 40 ? "まあまあ" : "要改善";

  return `
    <div class="card">
      <div class="card-title">今日のスコア</div>
      <div class="score-circle ${scoreClass}">
        <span class="score-value">${score}</span>
        <span class="score-label">${scoreLabel}</span>
      </div>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">${analysis.summary.productive_hours.toFixed(1)}</div>
          <div class="stat-label">生産的（h）</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${analysis.summary.wasted_hours.toFixed(1)}</div>
          <div class="stat-label">無駄（h）</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${analysis.summary.tasks_completed_count ?? Math.round(analysis.summary.task_completion_rate * 100)}${analysis.summary.tasks_completed_count != null ? '個' : '%'}</div>
          <div class="stat-label">完了タスク</div>
        </div>
      </div>
      <button class="btn btn-outline btn-sm" onclick="window.location.hash='/analysis/${analysis.date}'">
        詳細を見る →
      </button>
    </div>`;
}

function buildHomeActions(hasRecord, hasAnalysis, date, isRestDay = false) {
  if (isRestDay) {
    return `
      <div class="card">
        <div class="card-title">アクション</div>
        <button class="btn btn-outline btn-sm" onclick="window.location.hash='/input'">記録を編集</button>
      </div>`;
  }
  if (!hasRecord) {
    return `
      <div class="card">
        <div class="card-title">今日の記録</div>
        <div class="empty-state" style="padding: 24px 0;">
          <div class="icon">✏️</div>
          <p>まだ今日の記録がありません</p>
        </div>
        <button class="btn btn-primary" onclick="window.location.hash='/input'">
          行動を記録する
        </button>
      </div>`;
  }

  if (!hasAnalysis) {
    return `
      <div class="card">
        <div class="card-title">AI 分析</div>
        <p style="color: var(--text-muted); margin-bottom: 16px; font-size: 0.9rem;">
          記録済みです。AIによる分析を実行しましょう。
        </p>
        <button class="btn btn-primary" id="btn-generate-analysis">
          🤖 AI で分析する
        </button>
      </div>`;
  }

  return `
    <div class="card">
      <div class="card-title">アクション</div>
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button class="btn btn-outline btn-sm" onclick="window.location.hash='/input'">記録を編集</button>
        <button class="btn btn-outline btn-sm" id="btn-regenerate">分析を再実行</button>
      </div>
    </div>`;
}

// ===== イベント委任（動的ボタン用）=====

document.addEventListener("click", async (e) => {
  if (e.target.id === "btn-generate-analysis" || e.target.id === "btn-regenerate") {
    const todayStr = today();
    e.target.disabled = true;
    e.target.textContent = "分析中...";
    try {
      await analysisApi.generate(todayStr);
      showToast("分析が完了しました！", "success");
      window.location.hash = `/analysis/${todayStr}`;
    } catch (err) {
      showToast(`分析に失敗しました: ${err.message}`, "error");
      e.target.disabled = false;
      e.target.textContent = "🤖 AI で分析する";
    }
  }
});

// ===== ルーティング設定 =====

addRoute("/", () => renderHome());
addRoute("/input", () => renderInputForm(today()));
addRoute("/input/:date", ({ date }) => renderInputForm(date));
addRoute("/analysis/:date", ({ date }) => renderAnalysisView(date));
addRoute("/history", () => renderHistoryList());
addRoute("/weekly", () => renderWeeklyReport(null));
addRoute("/weekly/:weekId", ({ weekId }) => renderWeeklyReport(weekId));
addRoute("/suggestions", () => renderSuggestions());
addRoute("/coach", () => renderCoachingChat());
addRoute("/knowledge", () => renderKnowledgeGraph());
addRoute("/monthly", () => renderMonthlyReport(null));
addRoute("/monthly/:yearMonth", ({ yearMonth }) => renderMonthlyReport(yearMonth));
addRoute("/journal", () => renderJournal(today()));
addRoute("/journal/:date", ({ date }) => renderJournal(date));
addRoute("/task-stats", () => renderTaskStats());

// ===== 初期化 =====

document.addEventListener("DOMContentLoaded", () => {
  // Service Worker 登録
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // 初回ナビゲーション
  navigate();
  updateNavActive();
  updateDesktopHeader();

  // モバイルスワイプナビゲーション
  initSwipeNav();
});

// ハッシュ変更時にデスクトップヘッダーも更新
window.addEventListener("hashchange", updateDesktopHeader);
