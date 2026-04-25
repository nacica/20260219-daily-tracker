/**
 * 就寝までの残り時間ウィジェット — Cyber HUD Edition
 *
 * 機能:
 *   - 24 時間文字盤のアナログ時計（球体風グラデーション）
 *   - カウントダウン（HH:MM:SS 特大モノ数字）
 *   - プログレスバー（液体ウェーブ入り、その日の初回アクセス時刻〜22:00）
 *   - 色分け: 残り >6h 通常 / 6h〜3h 黄 / <3h 赤
 *   - 22:00 以降は「就寝時刻を過ぎています」を表示し、状態は維持
 *   - クリック／タップで詳細モーダル（拡大＋起床/就寝/経過時間）
 *   - 連続秒針 + 軌跡残像ゴースト
 *   - マウント時に針が 0° → 現在位置へ回り込むアニメ
 *   - 1 分ごとにパルス発光
 *   - 残り時間が減るほど脈動が速くなる
 */

const BEDTIME_HOUR = 22;
const FIRST_OPEN_KEY_PREFIX = "bedtime_first_open_";
const AFTER_BEDTIME_TEXT = "就寝時刻を過ぎています";
const AFTER_BEDTIME_SHORT = "就寝超過";

// ===== 時刻ユーティリティ =====

function todayKey() {
  return new Date().toLocaleDateString("sv-SE");
}

function getBedtimeToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), BEDTIME_HOUR, 0, 0, 0);
}

function isAfterBedtime() {
  return new Date() >= getBedtimeToday();
}

function getOrInitFirstOpen() {
  const key = FIRST_OPEN_KEY_PREFIX + todayKey();
  const saved = localStorage.getItem(key);
  if (saved) {
    const t = Date.parse(saved);
    if (!Number.isNaN(t)) return new Date(t);
  }
  if (isAfterBedtime()) return null;
  const now = new Date();
  try { localStorage.setItem(key, now.toISOString()); } catch {}
  return now;
}

// ===== フォーマット =====

function formatHHMMSS(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatHM(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatElapsedReadable(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}時間${String(m).padStart(2, "0")}分${String(s).padStart(2, "0")}秒`;
}

function getColorLevel(remainingMs) {
  const h = remainingMs / 3_600_000;
  if (h >= 6) return "normal";
  if (h >= 3) return "warn";
  return "danger";
}

// 残り時間に応じた脈動周期（小さいほど速い鼓動）
function getHeartPeriodSec(remainingMs, afterBedtime) {
  if (afterBedtime) return 0.9;
  const h = remainingMs / 3_600_000;
  if (h >= 6) return 9;
  if (h >= 3) return 4.5;
  if (h >= 1) return 2.4;
  if (h >= 0.5) return 1.5;
  return 1.0;
}

// ===== 24 時間時計スケルトン =====

function buildClockSkeleton() {
  const cx = 50, cy = 50;
  // 24 個のティック
  let ticks = "";
  for (let i = 0; i < 24; i++) {
    const a = ((i * 15 - 90) * Math.PI) / 180;
    const isMajor = i % 6 === 0;
    const inner = isMajor ? 30 : 36;
    const outer = 42;
    const x1 = cx + inner * Math.cos(a);
    const y1 = cy + inner * Math.sin(a);
    const x2 = cx + outer * Math.cos(a);
    const y2 = cy + outer * Math.sin(a);
    ticks += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" class="bt-tick${isMajor ? " bt-tick-major" : ""}"/>`;
  }
  // 主要時刻ラベル（0/6/12/18）
  const labelPositions = [[0, 50, 14], [6, 87, 52], [12, 50, 93], [18, 13, 52]];
  let labels = "";
  for (const [h, x, y] of labelPositions) {
    labels += `<text x="${x}" y="${y}" class="bt-hour-label" text-anchor="middle" dominant-baseline="middle">${h}</text>`;
  }

  return `
    <circle cx="50" cy="50" r="42" class="bt-clock-face"/>
    <circle cx="50" cy="50" r="42" class="bt-clock-rim"/>
    <path class="bt-clock-sector" d=""/>
    <g class="bt-clock-ticks">${ticks}</g>
    <g class="bt-clock-labels">${labels}</g>
    <line x1="50" y1="50" x2="50" y2="30" class="bt-hand bt-hand-hour"/>
    <line x1="50" y1="50" x2="50" y2="20" class="bt-hand bt-hand-minute"/>
    <line x1="50" y1="50" x2="50" y2="16" class="bt-hand bt-hand-second"/>
    <circle cx="50" cy="50" r="2.4" class="bt-clock-center"/>
  `;
}

function computeSectorPath(currentDeg, bedDeg, afterBedtime) {
  if (afterBedtime) return "";
  const cx = 50, cy = 50, r = 40;
  let sweep = bedDeg - currentDeg;
  if (sweep < 0) sweep += 360;
  if (sweep < 0.01) return "";
  const startRad = ((currentDeg - 90) * Math.PI) / 180;
  const endRad = ((bedDeg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

// ===== 状態 =====

let modalEl = null;
let initialized = false;
let rafId = 0;
let lastMinute = -1;
const initializedSvgs = new WeakSet();

function ensureClockInitialized(svgEl) {
  if (initializedSvgs.has(svgEl)) return;
  svgEl.innerHTML = buildClockSkeleton();
  initializedSvgs.add(svgEl);
}

function applyLevel(el, level) {
  el.classList.remove("bt-level-normal", "bt-level-warn", "bt-level-danger");
  el.classList.add(`bt-level-${level}`);
}

// 1 秒ごとの更新（テキスト、色、セクター、脈動周期、分変化パルス）
function tickSecond() {
  const now = new Date();
  const bedtime = getBedtimeToday();
  const remaining = bedtime - now;
  const afterBedtime = remaining <= 0;
  const level = afterBedtime ? "danger" : getColorLevel(remaining);
  const heartPeriod = getHeartPeriodSec(remaining, afterBedtime);

  const firstOpen = afterBedtime ? null : getOrInitFirstOpen();
  let progress = 0;
  if (afterBedtime) {
    progress = 100;
  } else if (firstOpen) {
    const total = bedtime - firstOpen;
    const elapsed = now - firstOpen;
    progress = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 0;
  }

  const currentDeg = (now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600) * 15;
  const bedDeg = BEDTIME_HOUR * 15;
  const sectorPath = computeSectorPath(currentDeg, bedDeg, afterBedtime);

  // 分変化の検出（B26 パルス）
  const currentMinute = now.getMinutes();
  const minuteChanged = currentMinute !== lastMinute && lastMinute !== -1;
  lastMinute = currentMinute;

  const widgets = document.querySelectorAll(".bedtime-timer");
  widgets.forEach((el) => {
    applyLevel(el, level);
    el.classList.toggle("is-after-bedtime", afterBedtime);
    el.style.setProperty("--bt-heart-period", `${heartPeriod}s`);

    const isCompact = !el.classList.contains("bedtime-inline");

    const cd = el.querySelector(".bt-countdown");
    if (cd) {
      cd.textContent = afterBedtime
        ? (isCompact ? AFTER_BEDTIME_SHORT : AFTER_BEDTIME_TEXT)
        : formatHHMMSS(remaining);
    }

    const status = el.querySelector(".bt-status-label");
    if (status) status.textContent = afterBedtime ? "OVERDUE" : "TRACKING";

    const fill = el.querySelector(".bt-progress-fill");
    if (fill) fill.style.width = `${progress.toFixed(2)}%`;

    const svg = el.querySelector(".bt-clock svg");
    if (svg) {
      ensureClockInitialized(svg);
      const sector = svg.querySelector(".bt-clock-sector");
      if (sector) sector.setAttribute("d", sectorPath);
    }

    if (minuteChanged) {
      el.classList.remove("bt-pulse-minute");
      void el.offsetWidth;
      el.classList.add("bt-pulse-minute");
    }
  });

  // モーダル
  if (modalEl) {
    applyLevel(modalEl, level);
    modalEl.classList.toggle("is-after-bedtime", afterBedtime);
    modalEl.style.setProperty("--bt-heart-period", `${heartPeriod}s`);

    const cd = modalEl.querySelector(".bt-countdown");
    if (cd) cd.textContent = afterBedtime ? AFTER_BEDTIME_TEXT : formatHHMMSS(remaining);
    const status = modalEl.querySelector(".bt-status-label");
    if (status) status.textContent = afterBedtime ? "OVERDUE" : "TRACKING";
    const fill = modalEl.querySelector(".bt-progress-fill");
    if (fill) fill.style.width = `${progress.toFixed(2)}%`;

    const svg = modalEl.querySelector(".bt-clock svg");
    if (svg) {
      ensureClockInitialized(svg);
      const sector = svg.querySelector(".bt-clock-sector");
      if (sector) sector.setAttribute("d", sectorPath);
    }
    const wake = modalEl.querySelector(".btm-wake");
    if (wake) wake.textContent = firstOpen ? formatHM(firstOpen) : "--:--";
    const bed = modalEl.querySelector(".btm-bed");
    if (bed) bed.textContent = formatHM(bedtime);
    const elapsed = modalEl.querySelector(".btm-elapsed");
    if (elapsed) elapsed.textContent = firstOpen ? formatElapsedReadable(now - firstOpen) : "--";
  }
}

// requestAnimationFrame ループ: 針の滑らかな回転 + 軌跡
function tickFrame() {
  const now = new Date();
  const ms = now.getMilliseconds();
  const secondsFloat = now.getSeconds() + ms / 1000;
  const minutesFloat = now.getMinutes() + secondsFloat / 60;
  const hoursFloat = now.getHours() + minutesFloat / 60;

  // 24 時間文字盤: 時針 15°/h, 分針 6°/min, 秒針 6°/sec
  const hourDeg = hoursFloat * 15;
  const minuteDeg = minutesFloat * 6;
  const secondDeg = secondsFloat * 6;

  const svgs = document.querySelectorAll(".bt-clock svg");
  svgs.forEach((svg) => {
    ensureClockInitialized(svg);
    const hHand = svg.querySelector(".bt-hand-hour");
    const mHand = svg.querySelector(".bt-hand-minute");
    const sHand = svg.querySelector(".bt-hand-second");
    if (hHand) hHand.style.transform = `rotate(${hourDeg}deg)`;
    if (mHand) mHand.style.transform = `rotate(${minuteDeg}deg)`;
    if (sHand) sHand.style.transform = `rotate(${secondDeg}deg)`;
  });

  rafId = requestAnimationFrame(tickFrame);
}

// ===== モーダル =====

function openModal() {
  if (modalEl) return;

  modalEl = document.createElement("div");
  modalEl.className = "bedtime-modal-overlay";
  modalEl.innerHTML = `
    <div class="bedtime-modal bedtime-timer bedtime-inline" role="dialog" aria-modal="true" aria-labelledby="bedtime-modal-title">
      <span class="bt-corner bt-corner-tl"></span>
      <span class="bt-corner bt-corner-tr"></span>
      <span class="bt-corner bt-corner-bl"></span>
      <span class="bt-corner bt-corner-br"></span>
      <span class="bt-scanline"></span>
      <button class="bedtime-modal-close" type="button" aria-label="閉じる">×</button>
      <div class="bt-status-row">
        <span class="bt-lamp"></span>
        <span class="bt-status-label">TRACKING</span>
      </div>
      <div id="bedtime-modal-title" class="bt-caption">就寝まで</div>
      <div class="bt-countdown">--:--:--</div>
      <div class="bt-progress">
        <div class="bt-progress-fill">
          <svg class="bt-progress-wave" viewBox="0 0 200 10" preserveAspectRatio="none">
            <path d="M 0 5 Q 12.5 1 25 5 T 50 5 T 75 5 T 100 5 T 125 5 T 150 5 T 175 5 T 200 5 V 10 H 0 Z"/>
          </svg>
        </div>
      </div>
      <div class="bt-clock"><svg viewBox="0 0 100 100"></svg></div>
      <dl class="btm-meta">
        <div class="btm-meta-row"><dt>起床時刻</dt><dd class="btm-wake">--:--</dd></div>
        <div class="btm-meta-row"><dt>就寝時刻</dt><dd class="btm-bed">22:00</dd></div>
        <div class="btm-meta-row"><dt>起点からの経過</dt><dd class="btm-elapsed">--</dd></div>
      </dl>
    </div>
  `;

  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl || e.target.closest(".bedtime-modal-close")) closeModal();
  });

  document.body.appendChild(modalEl);
  tickSecond();
}

function closeModal() {
  if (!modalEl) return;
  modalEl.remove();
  modalEl = null;
}

// ===== 初期化 =====

export function initBedtimeTimer() {
  if (initialized) return;
  initialized = true;

  document.addEventListener("click", (e) => {
    const trigger = e.target.closest(".bedtime-timer-trigger");
    if (trigger) {
      e.preventDefault();
      openModal();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalEl) closeModal();
  });

  // 起動時の全クロック SVG を初期化
  document.querySelectorAll(".bt-clock svg").forEach(ensureClockInitialized);

  lastMinute = new Date().getMinutes(); // 最初の tick でパルスを発火しない
  tickSecond();
  setInterval(tickSecond, 1000);

  // 針アニメーションループ（rAF）
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tickFrame);
}
