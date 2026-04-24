/**
 * 就寝までの残り時間ウィジェット（ヘッダー常駐）
 *
 * 機能:
 *   - カウントダウン（残り時間テキスト）
 *   - プログレスバー（その日の初回アクセス時刻〜22:00）
 *   - アナログ時計（12時間文字盤＋現在〜22:00の扇形）
 *   - 22:00以降は翌日扱いで非表示
 *   - クリック／タップで詳細モーダルを開く
 *   - 色分け: 残り >6h 通常 / 6h〜3h 黄 / <3h 赤
 *   - 1 秒ごとに更新
 */

const BEDTIME_HOUR = 22;
const FIRST_OPEN_KEY_PREFIX = "bedtime_first_open_";

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

/** 今日の初回アクセス時刻を取得。未保存なら now を保存して返す。22:00 以降は null。 */
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

function formatRemaining(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `残り ${h}時間${mm}分${ss}秒` : `残り ${mm}分${ss}秒`;
}

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}時間${String(m).padStart(2, "0")}分${String(s).padStart(2, "0")}秒`;
}

function formatHM(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function getColorLevel(remainingMs) {
  const h = remainingMs / 3_600_000;
  if (h >= 6) return "normal";
  if (h >= 3) return "warn";
  return "danger";
}

// ===== 12時間文字盤 SVG =====

function buildClockSVG(now, bedtime) {
  const cx = 50, cy = 50, r = 42;
  const currentDeg = ((now.getHours() % 12) + now.getMinutes() / 60 + now.getSeconds() / 3600) * 30;
  const bedDeg = ((bedtime.getHours() % 12) + bedtime.getMinutes() / 60) * 30;

  // 現在 → 就寝 の扇形（時計回り）
  let sweep = bedDeg - currentDeg;
  if (sweep < 0) sweep += 360;

  const startRad = ((currentDeg - 90) * Math.PI) / 180;
  const endRad = ((bedDeg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArc = sweep > 180 ? 1 : 0;

  const sectorPath = sweep > 0.01
    ? `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
    : "";

  // 12個の目盛り
  let ticks = "";
  for (let i = 0; i < 12; i++) {
    const a = ((i * 30 - 90) * Math.PI) / 180;
    const isMajor = i % 3 === 0;
    const inner = isMajor ? 32 : 37;
    const outer = 42;
    const x1t = cx + inner * Math.cos(a);
    const y1t = cy + inner * Math.sin(a);
    const x2t = cx + outer * Math.cos(a);
    const y2t = cy + outer * Math.sin(a);
    ticks += `<line x1="${x1t.toFixed(2)}" y1="${y1t.toFixed(2)}" x2="${x2t.toFixed(2)}" y2="${y2t.toFixed(2)}" class="bt-tick${isMajor ? " bt-tick-major" : ""}"/>`;
  }

  // 時計針
  const hourRad = ((currentDeg - 90) * Math.PI) / 180;
  const minRad = (((now.getMinutes() + now.getSeconds() / 60) * 6 - 90) * Math.PI) / 180;
  const secRad = ((now.getSeconds() * 6 - 90) * Math.PI) / 180;

  const hx = (cx + 22 * Math.cos(hourRad)).toFixed(2);
  const hy = (cy + 22 * Math.sin(hourRad)).toFixed(2);
  const mx = (cx + 30 * Math.cos(minRad)).toFixed(2);
  const my = (cy + 30 * Math.sin(minRad)).toFixed(2);
  const sx = (cx + 34 * Math.cos(secRad)).toFixed(2);
  const sy = (cy + 34 * Math.sin(secRad)).toFixed(2);

  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" class="bt-clock-face"/>
    ${sectorPath ? `<path d="${sectorPath}" class="bt-clock-sector"/>` : ""}
    ${ticks}
    <line x1="${cx}" y1="${cy}" x2="${hx}" y2="${hy}" class="bt-hand bt-hand-hour"/>
    <line x1="${cx}" y1="${cy}" x2="${mx}" y2="${my}" class="bt-hand bt-hand-minute"/>
    <line x1="${cx}" y1="${cy}" x2="${sx}" y2="${sy}" class="bt-hand bt-hand-second"/>
    <circle cx="${cx}" cy="${cy}" r="2" class="bt-clock-center"/>
  `;
}

// ===== 状態 =====

let timerId = null;
let modalEl = null;

// ===== 描画 =====

function applyLevel(el, level) {
  el.classList.remove("bt-level-normal", "bt-level-warn", "bt-level-danger");
  el.classList.add(`bt-level-${level}`);
}

function updateAll() {
  const now = new Date();
  const bedtime = getBedtimeToday();
  const remaining = bedtime - now;

  const widgets = document.querySelectorAll(".bedtime-timer");

  // 22:00 以降は全部非表示
  if (remaining <= 0) {
    widgets.forEach((el) => el.classList.add("is-hidden"));
    if (modalEl) closeModal();
    return;
  }

  widgets.forEach((el) => el.classList.remove("is-hidden"));

  const firstOpen = getOrInitFirstOpen();
  let progress = 0;
  if (firstOpen) {
    const total = bedtime - firstOpen;
    const elapsed = now - firstOpen;
    progress = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 0;
  }
  const level = getColorLevel(remaining);
  const remainingText = formatRemaining(remaining);

  widgets.forEach((el) => {
    applyLevel(el, level);
    const cd = el.querySelector(".bt-countdown");
    if (cd) cd.textContent = remainingText;

    const fill = el.querySelector(".bt-progress-fill");
    if (fill) fill.style.width = `${progress.toFixed(2)}%`;

    const clockSvg = el.querySelector(".bt-clock svg");
    if (clockSvg) clockSvg.innerHTML = buildClockSVG(now, bedtime);
  });

  if (modalEl) {
    updateModal(now, bedtime, firstOpen, remaining, progress, level);
  }
}

function updateModal(now, bedtime, firstOpen, remaining, progress, level) {
  applyLevel(modalEl, level);

  const cd = modalEl.querySelector(".btm-countdown");
  if (cd) cd.textContent = formatRemaining(remaining);

  const fill = modalEl.querySelector(".btm-progress-fill");
  if (fill) fill.style.width = `${progress.toFixed(2)}%`;

  const clockSvg = modalEl.querySelector(".btm-clock svg");
  if (clockSvg) clockSvg.innerHTML = buildClockSVG(now, bedtime);

  const wake = modalEl.querySelector(".btm-wake");
  if (wake) wake.textContent = firstOpen ? formatHM(firstOpen) : "--:--";

  const bed = modalEl.querySelector(".btm-bed");
  if (bed) bed.textContent = formatHM(bedtime);

  const elapsed = modalEl.querySelector(".btm-elapsed");
  if (elapsed) elapsed.textContent = firstOpen ? formatElapsed(now - firstOpen) : "--";
}

// ===== モーダル =====

function openModal() {
  if (modalEl) return;
  if (isAfterBedtime()) return;

  modalEl = document.createElement("div");
  modalEl.className = "bedtime-modal-overlay";
  modalEl.innerHTML = `
    <div class="bedtime-modal" role="dialog" aria-modal="true" aria-labelledby="bedtime-modal-title">
      <button class="bedtime-modal-close" type="button" aria-label="閉じる">×</button>
      <h2 id="bedtime-modal-title" class="bedtime-modal-title">就寝までの残り時間</h2>
      <div class="btm-countdown">--</div>
      <div class="btm-progress"><div class="btm-progress-fill"></div></div>
      <div class="btm-clock"><svg viewBox="0 0 100 100"></svg></div>
      <dl class="btm-meta">
        <div class="btm-meta-row"><dt>起床時刻（本日の初回アクセス）</dt><dd class="btm-wake">--:--</dd></div>
        <div class="btm-meta-row"><dt>就寝時刻</dt><dd class="btm-bed">22:00</dd></div>
        <div class="btm-meta-row"><dt>起点からの経過時間</dt><dd class="btm-elapsed">--</dd></div>
      </dl>
    </div>
  `;

  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl || e.target.closest(".bedtime-modal-close")) {
      closeModal();
    }
  });

  document.body.appendChild(modalEl);
  updateAll();
}

function closeModal() {
  if (!modalEl) return;
  modalEl.remove();
  modalEl = null;
}

// ===== 初期化 =====

export function initBedtimeTimer() {
  // クリック委任
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest(".bedtime-timer-trigger");
    if (trigger) {
      e.preventDefault();
      openModal();
    }
  });

  // Esc で閉じる
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalEl) closeModal();
  });

  updateAll();
  if (timerId) clearInterval(timerId);
  timerId = setInterval(updateAll, 1000);
}
