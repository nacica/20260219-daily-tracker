/**
 * タスク実績コンポーネント
 * - ホーム画面用サマリーカード（今日/今週/今月）
 * - 詳細ページ（棒グラフ: 日別/週別/月別タブ切替）
 * - タスク完了時 +1 フローティングアニメーション
 */

import { recordsApi } from "../api.js?v=20260311f";

// ===== ユーティリティ =====

function today() {
  return new Date().toLocaleDateString("sv-SE");
}

/** 指定日が含まれる週の月曜～日曜を返す */
function getWeekRange(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return {
    start: mon.toLocaleDateString("sv-SE"),
    end: sun.toLocaleDateString("sv-SE"),
  };
}

/** 指定日が含まれる月の初日～末日を返す */
function getMonthRange(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const end = last.toLocaleDateString("sv-SE");
  return { start, end };
}

/** 前の期間の範囲を返す */
function getPrevWeekRange(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - 7);
  return getWeekRange(d.toLocaleDateString("sv-SE"));
}

function getPrevMonthRange(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() - 1);
  return getMonthRange(d.toLocaleDateString("sv-SE"));
}

/** レコード配列からタスク完了数の合計を算出 */
function sumCompleted(records) {
  let total = 0;
  for (const r of records) {
    if (r.tasks && r.tasks.completed) {
      total += r.tasks.completed.length;
    }
  }
  return total;
}

/** レコードから日別の完了数を取得（前日との差分算出用） */
function getCompletedForDate(records, dateStr) {
  const r = records.find((rec) => rec.date === dateStr);
  return r?.tasks?.completed?.length || 0;
}

/** トレンドHTMLを生成 */
function buildTrend(current, previous) {
  const diff = current - previous;
  if (diff > 0) return `<div class="task-stat-trend up">+${diff}</div>`;
  if (diff < 0) return `<div class="task-stat-trend down">${diff}</div>`;
  return `<div class="task-stat-trend flat">±0</div>`;
}

// ===== ホーム画面サマリーカード =====

export async function buildTaskStatsCards() {
  const todayStr = today();

  // 今日の前日
  const yesterday = new Date(todayStr + "T00:00:00");
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString("sv-SE");

  const weekRange = getWeekRange(todayStr);
  const prevWeekRange = getPrevWeekRange(todayStr);
  const monthRange = getMonthRange(todayStr);
  const prevMonthRange = getPrevMonthRange(todayStr);

  try {
    // 必要なレコードを並行取得（今月+先月で十分）
    const earliest = prevMonthRange.start < prevWeekRange.start ? prevMonthRange.start : prevWeekRange.start;
    const allRecords = await recordsApi.list(earliest, monthRange.end);

    // 今日
    const todayCount = getCompletedForDate(allRecords, todayStr);
    const yesterdayCount = getCompletedForDate(allRecords, yesterdayStr);

    // 今週
    const weekRecords = allRecords.filter((r) => r.date >= weekRange.start && r.date <= weekRange.end);
    const weekCount = sumCompleted(weekRecords);
    const prevWeekRecords = allRecords.filter((r) => r.date >= prevWeekRange.start && r.date <= prevWeekRange.end);
    const prevWeekCount = sumCompleted(prevWeekRecords);

    // 今月
    const monthRecords = allRecords.filter((r) => r.date >= monthRange.start && r.date <= monthRange.end);
    const monthCount = sumCompleted(monthRecords);
    const prevMonthRecords = allRecords.filter((r) => r.date >= prevMonthRange.start && r.date <= prevMonthRange.end);
    const prevMonthCount = sumCompleted(prevMonthRecords);

    return `
      <div class="task-stats-row" id="task-stats-row">
        <div class="task-stat-card" data-period="today" onclick="window.location.hash='/task-stats'">
          <div class="task-stat-number" id="task-stat-today">${todayCount}</div>
          <div class="task-stat-period">今日</div>
          ${buildTrend(todayCount, yesterdayCount)}
          <div class="task-stat-detail-link">詳細 →</div>
        </div>
        <div class="task-stat-card" data-period="week" onclick="window.location.hash='/task-stats'">
          <div class="task-stat-number" id="task-stat-week">${weekCount}</div>
          <div class="task-stat-period">今週</div>
          ${buildTrend(weekCount, prevWeekCount)}
          <div class="task-stat-detail-link">詳細 →</div>
        </div>
        <div class="task-stat-card" data-period="month" onclick="window.location.hash='/task-stats'">
          <div class="task-stat-number" id="task-stat-month">${monthCount}</div>
          <div class="task-stat-period">今月</div>
          ${buildTrend(monthCount, prevMonthCount)}
          <div class="task-stat-detail-link">詳細 →</div>
        </div>
      </div>`;
  } catch {
    return "";
  }
}

// ===== +1 フローティングアニメーション =====

export function showTaskCompleteAnimation(anchorEl) {
  const rect = anchorEl
    ? anchorEl.getBoundingClientRect()
    : { left: window.innerWidth / 2, top: window.innerHeight / 2 };

  const float = document.createElement("div");
  float.className = "task-complete-float";
  float.textContent = "+1";
  float.style.left = `${rect.left + 10}px`;
  float.style.top = `${rect.top - 10}px`;
  document.body.appendChild(float);
  float.addEventListener("animationend", () => float.remove());

  // ホーム画面のカウンターをバンプ（表示されていれば）
  const todayEl = document.getElementById("task-stat-today");
  if (todayEl) {
    todayEl.textContent = parseInt(todayEl.textContent || "0") + 1;
    todayEl.classList.add("bump");
    setTimeout(() => todayEl.classList.remove("bump"), 300);
  }
  const weekEl = document.getElementById("task-stat-week");
  if (weekEl) {
    weekEl.textContent = parseInt(weekEl.textContent || "0") + 1;
    weekEl.classList.add("bump");
    setTimeout(() => weekEl.classList.remove("bump"), 300);
  }
  const monthEl = document.getElementById("task-stat-month");
  if (monthEl) {
    monthEl.textContent = parseInt(monthEl.textContent || "0") + 1;
    monthEl.classList.add("bump");
    setTimeout(() => monthEl.classList.remove("bump"), 300);
  }
}

// ===== 詳細ページ（棒グラフ切替） =====

export async function renderTaskStats() {
  const main = document.querySelector("main");
  main.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>タスク実績を読み込み中...</p>
    </div>`;

  // 6ヶ月分のレコードを取得
  const todayStr = today();
  const sixMonthsAgo = new Date(todayStr + "T00:00:00");
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const startDate = sixMonthsAgo.toLocaleDateString("sv-SE");

  let allRecords;
  try {
    allRecords = await recordsApi.list(startDate, todayStr);
  } catch {
    main.innerHTML = `<div class="empty-state"><div class="icon">📊</div><p>データの読み込みに失敗しました</p></div>`;
    return;
  }

  main.innerHTML = `
    <div class="task-stats-page">
      <h2 style="font-size: 1.15rem; font-weight: 700; margin-bottom: var(--gap); color: var(--text-primary);">タスク実績</h2>
      <div class="card">
        <div class="task-stats-tabs">
          <button class="task-stats-tab active" data-tab="daily">日別（7日）</button>
          <button class="task-stats-tab" data-tab="weekly">週別（4週）</button>
          <button class="task-stats-tab" data-tab="monthly">月別（6ヶ月）</button>
        </div>
        <div class="task-stats-chart-area" id="task-stats-chart"></div>
      </div>
    </div>`;

  const chartArea = document.getElementById("task-stats-chart");
  let activeTab = "daily";

  function renderChart(tab) {
    activeTab = tab;
    document.querySelectorAll(".task-stats-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === tab);
    });

    if (tab === "daily") renderDailyChart(chartArea, allRecords, todayStr);
    else if (tab === "weekly") renderWeeklyChart(chartArea, allRecords, todayStr);
    else renderMonthlyChart(chartArea, allRecords, todayStr);
  }

  document.querySelector(".task-stats-tabs").addEventListener("click", (e) => {
    const tab = e.target.dataset.tab;
    if (tab) renderChart(tab);
  });

  renderChart("daily");
}

function renderDailyChart(container, records, todayStr) {
  const days = [];
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayStr + "T00:00:00");
    d.setDate(d.getDate() - i);
    const dateStr = d.toLocaleDateString("sv-SE");
    const count = getCompletedForDate(records, dateStr);
    const label = i === 0 ? "今日" : `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`;
    days.push({ label, count, isToday: i === 0 });
  }
  renderBarChart(container, days);
}

function renderWeeklyChart(container, records, todayStr) {
  const weeks = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(todayStr + "T00:00:00");
    d.setDate(d.getDate() - i * 7);
    const range = getWeekRange(d.toLocaleDateString("sv-SE"));
    const weekRecords = records.filter((r) => r.date >= range.start && r.date <= range.end);
    const count = sumCompleted(weekRecords);
    const startD = new Date(range.start + "T00:00:00");
    const label = i === 0 ? "今週" : `${startD.getMonth() + 1}/${startD.getDate()}~`;
    weeks.push({ label, count, isToday: i === 0 });
  }
  renderBarChart(container, weeks);
}

function renderMonthlyChart(container, records, todayStr) {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(todayStr + "T00:00:00");
    d.setMonth(d.getMonth() - i);
    const range = getMonthRange(d.toLocaleDateString("sv-SE"));
    const monthRecords = records.filter((r) => r.date >= range.start && r.date <= range.end);
    const count = sumCompleted(monthRecords);
    const label = i === 0 ? "今月" : `${d.getFullYear()}/${d.getMonth() + 1}`;
    months.push({ label, count, isToday: i === 0 });
  }
  renderBarChart(container, months);
}

function renderBarChart(container, items) {
  const max = Math.max(...items.map((i) => i.count), 1);
  const avg = items.reduce((s, i) => s + i.count, 0) / items.length;

  const bars = items.map((item) => {
    const heightPct = (item.count / max) * 100;
    const barStyle = item.isToday
      ? "background: linear-gradient(180deg, var(--neon-green), rgba(0,255,148,0.4))"
      : "";
    return `
      <div class="task-bar-col">
        <div class="task-bar-value">${item.count}</div>
        <div class="task-bar" style="height: ${Math.max(heightPct, 2)}%; ${barStyle}"></div>
        <div class="task-bar-label">${item.label}</div>
      </div>`;
  }).join("");

  container.innerHTML = `
    <div class="task-bar-chart">${bars}</div>
    <div class="task-stats-avg-line">平均: <span>${avg.toFixed(1)}</span></div>`;
}
