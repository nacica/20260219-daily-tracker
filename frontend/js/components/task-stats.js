/**
 * タスク実績コンポーネント
 * - ホーム画面用サマリーカード（今日/今週/今月）
 * - 詳細ページ（棒グラフ: 日別/週別/月別タブ切替）
 * - タスク完了時 +1 フローティングアニメーション
 */

import { recordsApi } from "../api.js?v=20260424f";

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

// ===== 瞑想連続日数の算出 =====

const MEDITATION_TASK_NAME = "トラタカ瞑想";

/** 今日から遡って瞑想タスクが連続で完了されている日数を返す */
function calcMeditationStreak(allRecords, todayStr) {
  // 日付降順でソート
  const sorted = [...allRecords].sort((a, b) => (b.date > a.date ? 1 : -1));
  let streak = 0;
  const d = new Date(todayStr + "T00:00:00");

  for (let i = 0; i <= 365; i++) {
    const dateStr = d.toLocaleDateString("sv-SE");
    const rec = sorted.find((r) => r.date === dateStr);
    const completed = rec?.tasks?.completed || [];
    if (completed.includes(MEDITATION_TASK_NAME)) {
      streak++;
    } else {
      // 今日まだ未完了の場合はスキップして昨日以前の連続を数える
      if (i === 0) {
        d.setDate(d.getDate() - 1);
        continue;
      }
      break;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
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
    // 必要なレコードを並行取得（瞑想ストリーク用に過去90日分も取得）
    const earliest = prevMonthRange.start < prevWeekRange.start ? prevMonthRange.start : prevWeekRange.start;
    const streakStart = new Date(todayStr + "T00:00:00");
    streakStart.setDate(streakStart.getDate() - 90);
    const streakStartStr = streakStart.toLocaleDateString("sv-SE");
    const fetchStart = earliest < streakStartStr ? earliest : streakStartStr;
    const allRecords = await recordsApi.list(fetchStart, monthRange.end);

    // 瞑想連続日数
    const meditationStreak = calcMeditationStreak(allRecords, todayStr);

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

    // 今日瞑想完了済みかチェック
    const todayRec = allRecords.find((r) => r.date === todayStr);
    const meditationDoneToday = (todayRec?.tasks?.completed || []).includes(MEDITATION_TASK_NAME);

    return `
      <div class="task-stats-row" id="task-stats-row">
        <div class="task-stat-card" data-period="meditation">
          <div class="task-stat-number" id="task-stat-meditation">${meditationStreak}</div>
          <div class="task-stat-period">瞑想連続</div>
          <div class="task-stat-trend ${meditationDoneToday ? "up" : "flat"}">${meditationDoneToday ? "完了" : "未完了"}</div>
        </div>
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

// ===== レベルアップ演出 + コンボ管理 =====

let _comboCount = 0;
let _comboTimer = null;
const COMBO_WINDOW_MS = 8000; // 8秒以内の連続完了でコンボ

function tickCombo() {
  _comboCount++;
  clearTimeout(_comboTimer);
  _comboTimer = setTimeout(() => { _comboCount = 0; }, COMBO_WINDOW_MS);
  return _comboCount;
}

function showLevelUpBanner(combo) {
  // 既存バナーを除去
  document.querySelectorAll(".levelup-banner").forEach(el => el.remove());

  const banner = document.createElement("div");
  banner.className = "levelup-banner";

  if (combo >= 2) {
    banner.innerHTML = `<span class="levelup-text">${combo} COMBO!</span>`;
    banner.classList.add("combo");
  } else {
    banner.innerHTML = `<span class="levelup-text">TASK COMPLETE!</span>`;
  }
  document.body.appendChild(banner);
  banner.addEventListener("animationend", (e) => {
    if (e.target === banner) banner.remove();
  });
}

function emitParticles(cx, cy, count) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "radial-particle";
    const angle = (Math.PI * 2 * i) / count;
    const dist = 60 + Math.random() * 50;
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    p.style.animationDelay = `${Math.random() * 80}ms`;
    document.body.appendChild(p);
    p.addEventListener("animationend", () => p.remove());
  }
}

const CONFETTI_COLORS = ["#00ff94", "#fbbf24", "#a855f7", "#00d4ff", "#ff6b6b", "#34d399"];

function emitConfetti(count) {
  const vw = window.innerWidth;
  for (let i = 0; i < count; i++) {
    const c = document.createElement("div");
    c.className = "confetti-piece";
    // ランダムな開始位置（画面上部の幅全体）
    c.style.left = `${Math.random() * vw}px`;
    c.style.top = `${-10 - Math.random() * 40}px`;
    // ランダムな色・サイズ・形状
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    c.style.background = color;
    c.style.setProperty("--drift", `${(Math.random() - 0.5) * 120}px`);
    c.style.setProperty("--spin", `${Math.random() * 720 - 360}deg`);
    c.style.animationDuration = `${1.8 + Math.random() * 1.4}s`;
    c.style.animationDelay = `${Math.random() * 600}ms`;
    // 長方形 or 正方形をランダムに
    if (Math.random() > 0.5) {
      c.style.width = `${6 + Math.random() * 4}px`;
      c.style.height = `${10 + Math.random() * 6}px`;
    } else {
      const s = 6 + Math.random() * 5;
      c.style.width = `${s}px`;
      c.style.height = `${s}px`;
    }
    document.body.appendChild(c);
    c.addEventListener("animationend", () => c.remove());
  }
}

let _lastAnimTime = 0;

export function showTaskCompleteAnimation(anchorEl) {
  const now = Date.now();
  if (now - _lastAnimTime < 500) return;
  _lastAnimTime = now;

  const rect = anchorEl
    ? anchorEl.getBoundingClientRect()
    : { left: window.innerWidth / 2, top: window.innerHeight / 2 };

  const cx = rect.left + (rect.width || 0) / 2;
  const cy = rect.top + (rect.height || 0) / 2;

  // --- 1. "+1" フローティング ---
  const float = document.createElement("div");
  float.className = "task-complete-float";
  float.textContent = "+1";
  float.style.left = `${rect.left + 10}px`;
  float.style.top = `${rect.top - 10}px`;
  document.body.appendChild(float);
  float.addEventListener("animationend", () => float.remove());

  // --- 2. パルスウェーブ（衝撃波リング x3） ---
  for (let i = 0; i < 3; i++) {
    const ring = document.createElement("div");
    ring.className = "pulse-ring";
    ring.style.left = `${cx}px`;
    ring.style.top = `${cy}px`;
    ring.style.animationDelay = `${i * 120}ms`;
    document.body.appendChild(ring);
    ring.addEventListener("animationend", () => ring.remove());
  }

  // --- 3. 画面シェイク（bodyではなくmainに適用。bodyにtransformを付けると
  //         position:fixedのバナーの基準がviewport→bodyに変わり二重表示になる） ---
  const mainEl = document.querySelector("main");
  if (mainEl) {
    mainEl.classList.add("screen-shake");
    setTimeout(() => mainEl.classList.remove("screen-shake"), 400);
  }

  // --- 4. 完了カードのグロウフラッシュ ---
  const card = anchorEl?.closest(".card");
  if (card) {
    card.classList.add("card-glow-flash");
    setTimeout(() => card.classList.remove("card-glow-flash"), 600);
  }

  // --- 5. レベルアップバナー + コンボ ---
  const combo = tickCombo();
  showLevelUpBanner(combo);

  // --- 6. 放射状パーティクル ---
  const particleCount = combo >= 3 ? 16 : combo >= 2 ? 12 : 8;
  emitParticles(cx, cy, particleCount);

  // --- 7. 紙吹雪 ---
  const confettiCount = combo >= 3 ? 50 : combo >= 2 ? 35 : 25;
  emitConfetti(confettiCount);

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
