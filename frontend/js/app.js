/**
 * アプリのメインロジック
 * ルーティングの設定とトップ画面（記録入力）の表示を担当する。
 *
 * コード分割方針:
 *   - 起動に必要なコア（router / api / swipe-nav）のみ静的 import
 *   - 各画面のコンポーネントはルート遷移時に動的 import（初期ロードを軽量化）
 *
 * 注: トップ URL は `/`（旧 `/input`）。`/input`・`/input/:date` は後方互換のため
 *     リダイレクトのみ提供する。
 */

import { addRoute, navigate, updateNavActive } from "./router.js?v=20260515c";
import { recordsApi } from "./api.js?v=20260515c";
import { initSwipeNav } from "./swipe-nav.js?v=20260515c";
import { initBedtimeTimer } from "./bedtime-timer.js?v=20260515c";

// ===== 動的 import ヘルパー =====
// 各コンポーネントは初回訪問時に初めてネットワーク取得（以降は SW キャッシュから即応答）
const loadInputForm       = () => import("./components/input-form.js?v=20260515c");
const loadAnalysisView    = () => import("./components/analysis-view.js?v=20260515c");
const loadHistoryList     = () => import("./components/history-list.js?v=20260515c");
const loadWeeklyReport    = () => import("./components/weekly-report.js?v=20260515c");
const loadSuggestions     = () => import("./components/suggestions.js?v=20260515c");
const loadCoachingChat    = () => import("./components/coaching-chat.js?v=20260515c");
const loadMonthlyReport   = () => import("./components/monthly-report.js?v=20260515c");
const loadJournal         = () => import("./components/journal.js?v=20260515c");
const loadBraindump       = () => import("./components/braindump.js?v=20260515c");
const loadTaskStats       = () => import("./components/task-stats.js?v=20260515c");
const loadFlashcardList   = () => import("./components/flashcard-list.js?v=20260515c");
const loadFlashcardStudy  = () => import("./components/flashcard-study.js?v=20260515c");
const loadWishlist        = () => import("./components/wishlist.js?v=20260515c");
const loadGratitude       = () => import("./components/gratitude.js?v=20260515c");

// ===== ユーティリティ =====

/** 今日の日付を YYYY-MM-DD 形式で返す */
function today() {
  return new Date().toLocaleDateString("sv-SE"); // "2026-02-19"
}

/** メインコンテンツエリアを返す */
function getMain() {
  return document.querySelector("main");
}

// ===== デスクトップヘッダー更新 =====

/** ルート名マッピング */
const ROUTE_TITLES = {
  "/": { title: "行動記録", breadcrumb: "記録入力" },
  "/edit": { title: "行動記録", breadcrumb: "記録入力" },
  "/history": { title: "履歴一覧", breadcrumb: "履歴" },
  "/weekly": { title: "週次レポート", breadcrumb: "週次分析" },
  "/suggestions": { title: "改善提案", breadcrumb: "提案アーカイブ" },
  "/coach": { title: "コーチング", breadcrumb: "パーソナルコーチ" },
  "/monthly": { title: "月次レポート", breadcrumb: "月次サマリー" },
  "/journal": { title: "フリージャーナル", breadcrumb: "ジャーナル" },
  "/braindump": { title: "ブレインダンプ", breadcrumb: "頭の整理メモ" },
  "/task-stats": { title: "タスク実績", breadcrumb: "タスク実績" },
  "/flashcards": { title: "単語帳", breadcrumb: "単語帳カード" },
  "/wishlist": { title: "やりたいことリスト", breadcrumb: "Wishlist" },
  "/gratitude": { title: "ありがたいノート", breadcrumb: "Gratitude" },
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
        // 今日なら "/"、それ以外は "/edit/:date" に遷移
        const todayStr = today();
        window.location.hash = date === todayStr ? "/" : `/edit/${date}`;
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

// ===== ペースト時の段落空行保持（全 textarea 対象） =====
// claude.ai 等のレンダリング HTML から textarea にペーストすると、
// ブラウザが text/plain に変換する際に <p> 境界の空行を落とすことがある。
// ここでは clipboardData の text/html を解析し、ブロック境界を空行として
// 保持したテキストを生成して挿入する。改善が無い場合はデフォルト動作に任せる。

const _PASTE_PARAGRAPH_TAGS = new Set([
  "P", "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6",
]);
const _PASTE_BLOCK_TAGS = new Set([
  "P", "DIV", "BLOCKQUOTE", "PRE", "LI", "TR", "DL", "DT", "DD",
  "FIGURE", "ARTICLE", "SECTION", "HEADER", "FOOTER",
  "H1", "H2", "H3", "H4", "H5", "H6",
]);

function _htmlToTextPreserveParagraphs(html) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
  const root = doc && doc.body;
  if (!root) return null;

  doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.tagName;
    if (tag === "BR") return "\n";
    let inner = "";
    for (const child of node.childNodes) inner += walk(child);
    if (_PASTE_PARAGRAPH_TAGS.has(tag)) return "\n\n" + inner + "\n\n";
    if (_PASTE_BLOCK_TAGS.has(tag)) return "\n" + inner + "\n";
    return inner;
  }

  let result = walk(root);

  // インデントによる「空白だけの行」を空行に正規化し、過剰な改行を 2 にまとめる
  result = result.split("\n").map((line) => (/^\s*$/.test(line) ? "" : line)).join("\n");
  result = result.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  return result;
}

function _insertTextAtCursor(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  const cursor = start + text.length;
  textarea.selectionStart = textarea.selectionEnd = cursor;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

document.addEventListener("paste", (e) => {
  if (e.defaultPrevented) return; // 既に画像ペースト等で処理済み
  const target = e.target;
  if (!(target instanceof HTMLTextAreaElement)) return;

  const cd = e.clipboardData;
  if (!cd) return;

  const html = cd.getData("text/html");
  if (!html) return;

  const plain = cd.getData("text/plain") || "";
  const transformed = _htmlToTextPreserveParagraphs(html);
  if (transformed == null || !transformed) return;

  // text/plain と比べて空行（\n\n）が増えていなければ改変しない
  const plainBlanks = (plain.match(/\n\n/g) || []).length;
  const transformedBlanks = (transformed.match(/\n\n/g) || []).length;
  if (transformedBlanks <= plainBlanks) return;

  e.preventDefault();
  _insertTextAtCursor(target, transformed);
});

// ===== ルーティング設定 =====
// 各ルートは初回訪問時に動的 import（トップのバンドルには含めない）

// トップ（旧 /input）
addRoute("/", async () => (await loadInputForm()).renderInputForm(today()));
addRoute("/edit/:date", async ({ date }) => (await loadInputForm()).renderInputForm(date));

// 旧 URL の後方互換リダイレクト（ブックマーク・他コンポーネントの古いリンク用）
addRoute("/input", () => { window.location.hash = "/"; });
addRoute("/input/:date", ({ date }) => { window.location.hash = `/edit/${date}`; });

addRoute("/analysis/:date", async ({ date }) => (await loadAnalysisView()).renderAnalysisView(date));
addRoute("/history", async () => (await loadHistoryList()).renderHistoryList());
addRoute("/weekly", async () => (await loadWeeklyReport()).renderWeeklyReport(null));
addRoute("/weekly/:weekId", async ({ weekId }) => (await loadWeeklyReport()).renderWeeklyReport(weekId));
addRoute("/suggestions", async () => (await loadSuggestions()).renderSuggestions());
addRoute("/coach", async () => (await loadCoachingChat()).renderCoachingChat());
addRoute("/monthly", async () => (await loadMonthlyReport()).renderMonthlyReport(null));
addRoute("/monthly/:yearMonth", async ({ yearMonth }) => (await loadMonthlyReport()).renderMonthlyReport(yearMonth));
addRoute("/journal", async () => (await loadJournal()).renderJournal(today()));
addRoute("/journal/:date", async ({ date }) => (await loadJournal()).renderJournal(date));
addRoute("/braindump", async () => (await loadBraindump()).renderBraindump());
addRoute("/task-stats", async () => (await loadTaskStats()).renderTaskStats());
addRoute("/flashcards", async () => (await loadFlashcardList()).renderFlashcardList());
addRoute("/flashcards/study", async () => (await loadFlashcardStudy()).renderFlashcardStudy());
addRoute("/wishlist", async () => (await loadWishlist()).renderWishlist());
addRoute("/gratitude", async () => (await loadGratitude()).renderGratitude());

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

  // 就寝までの残り時間ウィジェット（ヘッダー常駐）
  initBedtimeTimer();

  // ネットワークアイドル時に主要ルートを先読み（体感高速化）
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => {
      loadInputForm();
      loadHistoryList();
    }, { timeout: 3000 });
  }
});

// ハッシュ変更時にデスクトップヘッダーも更新
window.addEventListener("hashchange", updateDesktopHeader);
