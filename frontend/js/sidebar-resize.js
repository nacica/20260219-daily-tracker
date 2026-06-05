/**
 * サイドバー幅のドラッグリサイズ
 * - 境界線（.nav-resize-handle）をドラッグして --sidebar-w を更新
 * - 幅は localStorage に保存し次回起動時に復元
 * - ダブルクリックで初期値 (260px) にリセット
 * - 可動範囲: 100px 〜 600px
 * - デスクトップ (min-width: 1024px) のみ動作
 */

const STORAGE_KEY = "sidebarWidth";
const MIN_W = 100;
const MAX_W = 600;
const DEFAULT_W = 260;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function applyWidth(px) {
  document.documentElement.style.setProperty("--sidebar-w", `${px}px`);
}

function loadSavedWidth() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return clamp(n, MIN_W, MAX_W);
}

export function initSidebarResize() {
  const handle = document.getElementById("navResizeHandle");
  if (!handle) return;

  // 起動時に保存幅を適用（デスクトップ判定は CSS 側で吸収されるが
  //   ここでもデスクトップ時のみ復元して mobile に影響しないようにする）
  const mq = window.matchMedia("(min-width: 1024px)");
  const saved = loadSavedWidth();
  if (saved !== null && mq.matches) applyWidth(saved);

  let dragging = false;
  let startX = 0;
  let startW = 0;

  function onPointerDown(e) {
    if (!mq.matches) return;
    if (e.button !== undefined && e.button !== 0) return; // 左クリックのみ
    dragging = true;
    startX = e.clientX;
    const current = getComputedStyle(document.documentElement)
      .getPropertyValue("--sidebar-w")
      .trim();
    startW = parseInt(current, 10) || DEFAULT_W;
    handle.setPointerCapture?.(e.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add("nav-resizing");
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const next = clamp(startW + (e.clientX - startX), MIN_W, MAX_W);
    applyWidth(next);
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture?.(e.pointerId);
    handle.classList.remove("dragging");
    document.body.classList.remove("nav-resizing");
    const current = getComputedStyle(document.documentElement)
      .getPropertyValue("--sidebar-w")
      .trim();
    const px = parseInt(current, 10);
    if (Number.isFinite(px)) {
      localStorage.setItem(STORAGE_KEY, String(px));
    }
  }

  function onDblClick() {
    if (!mq.matches) return;
    applyWidth(DEFAULT_W);
    localStorage.removeItem(STORAGE_KEY);
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);
  handle.addEventListener("dblclick", onDblClick);

  // ブレークポイントを跨いだ際の整合性確保
  mq.addEventListener("change", (ev) => {
    if (ev.matches) {
      const w = loadSavedWidth();
      if (w !== null) applyWidth(w);
    } else {
      // モバイル時はインライン --sidebar-w を解除（CSS デフォルトに戻す）
      document.documentElement.style.removeProperty("--sidebar-w");
    }
  });
}
