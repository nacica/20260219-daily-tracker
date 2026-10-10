/**
 * メニューの並び替え（ドラッグ＆ドロップ）
 *
 * - サイドバー（.nav-links）とホーム画面のタイル（.launcher-grid）を、ドラッグで上下・前後に並び替える
 *   - マウス: 行を押したまま少し動かすとドラッグ開始（動かさずに離せば普通のクリック＝ページを開く）
 *   - タッチ: 長押しでドラッグ開始（すぐ指を動かした場合は普通のスクロール）
 *   - ドラッグ中に Esc で取り消し
 * - 並び順はサーバー（/nav-order）に保存して PC とスマホで共有する。
 *   localStorage("navOrder") にも写しを持ち、起動直後の表示（index.html のインラインスクリプト）と
 *   オフライン時の保存待ち（dirty）に使う
 * - サイドバー・ホーム画面・スワイプ移動の順番はすべてこの順番に従う（getNavOrder）
 * - 初期順に戻す: サイドバーの右クリックメニュー／ホーム画面下のボタン
 */

import { navOrderApi } from "./api.js?v=20261010a";

const CACHE_KEY = "navOrder";      // { routes: string[], dirty: boolean }
const LONG_PRESS_MS = 380;         // タッチでドラッグを始めるまでの長押し時間
const TOUCH_SLOP = 10;             // 長押し待ちの間にこれ以上動いたらスクロールとみなす (px)
const MOUSE_SLOP = 5;              // マウスでこれ以上動いたらドラッグ開始 (px)
const AUTO_SCROLL_EDGE = 48;       // スクロール領域の端からこの距離に入ったら自動スクロール (px)

let defaultOrder = [];             // index.html に書かれた初期順
let currentOrder = [];
let saveSeq = 0;                   // 保存のたびに +1（古い保存の完了で dirty を消さないため）

/* ---------- 並び順の管理 ---------- */

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (c && Array.isArray(c.routes)) return c;
  } catch {}
  return null;
}

function writeCache(routes, dirty) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ routes, dirty })); } catch {}
}

/** 保存済みの順番を今のページ一覧に合わせる（新しく増えたページは初期順で直前のページの後ろへ、無くなったページは捨てる） */
function normalize(saved) {
  const out = saved.filter((r, i) => defaultOrder.includes(r) && saved.indexOf(r) === i);
  defaultOrder.forEach((r, di) => {
    if (out.includes(r)) return;
    let pos = 0;
    for (let k = di - 1; k >= 0; k--) {
      const p = out.indexOf(defaultOrder[k]);
      if (p >= 0) { pos = p + 1; break; }
    }
    out.splice(pos, 0, r);
  });
  return out;
}

const sameOrder = (a, b) => a.length === b.length && a.every((r, i) => r === b[i]);

/** container 直下の [data-route] 要素を routes の順に並べ直す */
function arrange(container, routes) {
  if (!container) return;
  const items = sortableItems(container);
  if (sameOrder(items.map((el) => el.dataset.route), routes)) return;
  const map = new Map(items.map((el) => [el.dataset.route, el]));
  for (const r of routes) {
    const el = map.get(r);
    if (el) container.appendChild(el);
  }
}

function applyOrder(routes) {
  currentOrder = normalize(routes);
  arrange(document.querySelector(".nav-links"), currentOrder);
  document.querySelectorAll(".launcher-grid").forEach((g) => arrange(g, currentOrder));
  window.dispatchEvent(new CustomEvent("navorderchange", { detail: { routes: currentOrder.slice() } }));
}

/** 今のメニュー順（ルートの配列） */
export function getNavOrder() {
  return currentOrder.length ? currentOrder.slice() : defaultOrder.slice();
}

/** 初期順から変えているか */
export function isNavOrderCustomized() {
  return !sameOrder(getNavOrder(), defaultOrder);
}

function pushToServer(routes) {
  const seq = ++saveSeq;
  // 初期順と同じなら空配列で保存（今後ページが増えたとき初期順の位置にそのまま入るように）
  const payload = sameOrder(routes, defaultOrder) ? [] : routes;
  navOrderApi.save(payload)
    .then(() => { if (seq === saveSeq) writeCache(routes, false); })
    .catch((e) => console.warn("メニュー順の保存に失敗（次回起動時に再送します）:", e.message));
}

function saveOrder(routes) {
  applyOrder(routes);
  writeCache(currentOrder, true);
  pushToServer(currentOrder);
}

export function resetNavOrder() {
  saveOrder(defaultOrder);
}

/* ---------- ドラッグで並び替え ---------- */

function sortableItems(container) {
  return Array.from(container.children).filter((el) => el.dataset && el.dataset.route !== undefined);
}

/** transform やアニメーションを無視した、レイアウト上の位置（画面座標） */
function naturalRect(el) {
  const op = el.offsetParent;
  if (!op) return el.getBoundingClientRect();
  let left, top;
  if (op === document.body) {
    left = el.offsetLeft - window.scrollX;
    top = el.offsetTop - window.scrollY;
  } else {
    const r = op.getBoundingClientRect();
    left = r.left + op.clientLeft - op.scrollLeft + el.offsetLeft;
    top = r.top + op.clientTop - op.scrollTop + el.offsetTop;
  }
  const width = el.offsetWidth, height = el.offsetHeight;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function findScrollParent(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement || document.documentElement;
}

/** 並び順の変更を、他の項目がすっと動くアニメーション付きで行う */
function moveWithFlip(container, dragged, doMove) {
  const others = sortableItems(container).filter((el) => el !== dragged);
  const before = new Map(others.map((el) => [el, el.getBoundingClientRect()]));
  others.forEach((el) => el.getAnimations?.().forEach((a) => a.cancel()));
  doMove();
  for (const el of others) {
    const a = before.get(el), b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) continue;
    el.animate?.(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 160, easing: "cubic-bezier(.2,.7,.3,1)" }
    );
  }
}

let lastTouchAt = 0;   // タッチ由来の互換マウスイベント・長押しメニューを無視するため
let activeSorter = null;   // マウス押下中／ドラッグ中の並び替え対象（window のリスナーは全体で 1 組だけ持つ）

window.addEventListener("mousemove", (e) => activeSorter?.mouseMove(e));
window.addEventListener("mouseup", () => activeSorter?.mouseUp());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") activeSorter?.escape(); });

function makeSortable(container) {
  if (!container || container.dataset.sortable === "1") return;
  container.dataset.sortable = "1";

  let pending = null;   // { el, x, y, touch, timer } — 押したがまだドラッグ開始していない
  let drag = null;      // { el, grabX, grabY, x, y, list, startOrder, scrollEl, raf }
  let suppressClickUntil = 0;

  const itemFrom = (target) => {
    const el = target?.closest?.("[data-route]");
    return el && el.parentElement === container ? el : null;
  };

  /* 押下 */
  function press(el, x, y, touch) {
    suppressClickUntil = 0;   // 新しく押した＝前回ドロップ時のクリック止めは不要（DOM 移動でクリック自体が出ないことがある）
    pending = { el, x, y, touch, timer: 0 };
    activeSorter = sorter;
    if (touch) {
      pending.timer = setTimeout(() => { if (pending) begin(); }, LONG_PRESS_MS);
    }
  }

  function clearPending() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
    if (!drag && activeSorter === sorter) activeSorter = null;
  }

  function begin() {
    const { el, x, y } = pending;
    clearTimeout(pending.timer);
    pending = null;
    const r = naturalRect(el);
    const cs = getComputedStyle(container);
    drag = {
      el, x, y,
      grabX: x - r.left,
      grabY: y - r.top,
      // 縦一列（デスクトップのサイドバー）は上下にだけ動かす
      list: cs.display.includes("flex") && cs.flexDirection === "column",
      startOrder: sortableItems(container).map((e) => e.dataset.route),
      scrollEl: findScrollParent(container),
      raf: 0,
    };
    el.classList.add("nav-sort-dragging");
    document.body.classList.add("nav-sorting");
    navigator.vibrate?.(12);
    position();
    drag.raf = requestAnimationFrame(autoScroll);
  }

  /** ドラッグ中の項目を指（マウス）に追従させる */
  function position() {
    const { el, x, y, grabX, grabY, list } = drag;
    const r = naturalRect(el);
    const tx = list ? 0 : x - grabX - r.left;
    const ty = y - grabY - r.top;
    el.style.transform = `translate(${tx}px, ${ty}px)`;
  }

  /** 指の位置にある項目と入れ替える */
  function reorder() {
    const { el, x, y, list } = drag;
    const items = sortableItems(container);
    const others = items.filter((s) => s !== el);
    if (!others.length) return;
    let target = null;
    for (const s of others) {
      const r = naturalRect(s);
      // 縦一列は横位置を問わない（サイドバーの外へはみ出しても上下だけで判定）
      if ((list || (x >= r.left && x <= r.right)) && y >= r.top && y <= r.bottom) { target = s; break; }
    }
    if (target) {
      const after = items.indexOf(el) < items.indexOf(target);
      moveWithFlip(container, el, () => (after ? target.after(el) : target.before(el)));
      return;
    }
    // 先頭より上・末尾より下まで持っていったときは端へ
    const first = naturalRect(others[0]), last = naturalRect(others[others.length - 1]);
    if (y < first.top && items[0] !== el) {
      moveWithFlip(container, el, () => container.insertBefore(el, items[0]));
    } else if (y > last.bottom && items[items.length - 1] !== el) {
      moveWithFlip(container, el, () => others[others.length - 1].after(el));
    }
  }

  function move(x, y) {
    drag.x = x; drag.y = y;
    reorder();
    position();
  }

  /** 端に近づいたらスクロール領域を自動でスクロールする */
  function autoScroll() {
    if (!drag) return;
    const se = drag.scrollEl;
    const isDoc = se === document.scrollingElement || se === document.documentElement;
    const top = isDoc ? 0 : se.getBoundingClientRect().top;
    const bottom = isDoc ? window.innerHeight : se.getBoundingClientRect().bottom;
    let dy = 0;
    if (drag.y < top + AUTO_SCROLL_EDGE) dy = -Math.ceil((top + AUTO_SCROLL_EDGE - drag.y) / 4);
    else if (drag.y > bottom - AUTO_SCROLL_EDGE) dy = Math.ceil((drag.y - (bottom - AUTO_SCROLL_EDGE)) / 4);
    if (dy) {
      const before = se.scrollTop;
      se.scrollTop += dy;
      if (se.scrollTop !== before) { reorder(); position(); }
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function finish(cancel) {
    if (!drag) return;
    const { el, startOrder, raf } = drag;
    cancelAnimationFrame(raf);
    drag = null;
    if (activeSorter === sorter) activeSorter = null;
    if (cancel) arrange(container, startOrder);
    // 指を離した位置から本来の位置へすっと収まる
    const from = el.getBoundingClientRect();
    el.style.transform = "";
    el.classList.remove("nav-sort-dragging");
    document.body.classList.remove("nav-sorting");
    const to = el.getBoundingClientRect();
    el.animate?.(
      [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: "none" }],
      { duration: 160, easing: "cubic-bezier(.2,.7,.3,1)" }
    );
    suppressClickUntil = Date.now() + 400;   // 離した瞬間のクリックでページを開かない
    const order = sortableItems(container).map((e) => e.dataset.route);
    if (!sameOrder(order, getNavOrder())) saveOrder(order);
  }

  /* マウス */
  container.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || Date.now() - lastTouchAt < 800 || drag || pending) return;
    const el = itemFrom(e.target);
    if (el) press(el, e.clientX, e.clientY, false);
  });
  const sorter = {
    mouseMove(e) {
      if (pending && !pending.touch) {
        if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > MOUSE_SLOP) begin();
        else return;
      }
      if (drag) { e.preventDefault(); move(e.clientX, e.clientY); }
    },
    mouseUp() {
      if (pending && !pending.touch) clearPending();
      if (drag) finish(false);
    },
    escape() {
      clearPending();
      finish(true);
    },
  };

  /* タッチ（長押しで開始） */
  container.addEventListener("touchstart", (e) => {
    lastTouchAt = Date.now();
    if (e.touches.length !== 1 || drag || pending) { clearPending(); return; }
    const el = itemFrom(e.target);
    if (el) press(el, e.touches[0].clientX, e.touches[0].clientY, true);
  }, { passive: true });
  // passive: false — ドラッグ中だけスクロールを止める（長押し待ちの間は止めない＝普通にスクロールできる）
  container.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (pending) {
      if (Math.hypot(t.clientX - pending.x, t.clientY - pending.y) > TOUCH_SLOP) clearPending();
      return;
    }
    if (drag) {
      if (e.cancelable) e.preventDefault();
      move(t.clientX, t.clientY);
    }
  }, { passive: false });
  const touchEnd = () => {
    lastTouchAt = Date.now();
    clearPending();
    if (drag) finish(false);
  };
  container.addEventListener("touchend", touchEnd);
  container.addEventListener("touchcancel", touchEnd);

  /* ドラッグ直後のクリック（ページ遷移）を止める */
  container.addEventListener("click", (e) => {
    if (Date.now() < suppressClickUntil) {
      suppressClickUntil = 0;   // 止めるのは離した直後の 1 回だけ
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
  // リンク標準のドラッグ（URL をつまむ動作）は使わない
  container.addEventListener("dragstart", (e) => { if (itemFrom(e.target)) e.preventDefault(); });
  // 長押しで出るリンクのメニューを出さない
  container.addEventListener("contextmenu", (e) => {
    if (drag || pending || Date.now() - lastTouchAt < 1500) e.preventDefault();
  });
}

/* ---------- 初期順に戻すメニュー（サイドバーの右クリック） ---------- */

let menuEl = null;

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

function openMenu(x, y) {
  closeMenu();
  menuEl = document.createElement("div");
  menuEl.className = "nav-order-menu";
  menuEl.innerHTML = `
    <div class="nav-order-menu-hint">項目はドラッグで並び替えできます</div>
    <button type="button" class="nav-order-menu-item"${isNavOrderCustomized() ? "" : " disabled"}>並び順を初期状態に戻す</button>`;
  document.body.appendChild(menuEl);
  const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
  menuEl.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
  menuEl.style.top = `${Math.max(8, Math.min(y, window.innerHeight - h - 8))}px`;
  menuEl.querySelector("button").addEventListener("click", () => { closeMenu(); resetNavOrder(); });
}

document.addEventListener("mousedown", (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }, true);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
window.addEventListener("blur", closeMenu);
window.addEventListener("resize", closeMenu);

/* ---------- 公開 API ---------- */

/** ホーム画面のタイル一覧を並び替え可能にし、「初期順に戻す」ボタンを連動させる */
export function enableLauncherSort(grid, resetBtn) {
  if (!grid) return;
  arrange(grid, getNavOrder());
  makeSortable(grid);
  if (!resetBtn) return;
  const sync = () => { resetBtn.hidden = !isNavOrderCustomized(); };
  sync();
  resetBtn.addEventListener("click", resetNavOrder);
  const onChange = () => {
    if (!resetBtn.isConnected) { window.removeEventListener("navorderchange", onChange); return; }
    sync();
  };
  window.addEventListener("navorderchange", onChange);
}

export function initNavOrder() {
  const nav = document.querySelector(".nav-links");
  if (!nav) return;
  defaultOrder = Array.isArray(window.__navDefaultOrder)
    ? window.__navDefaultOrder.slice()
    : sortableItems(nav).map((el) => el.dataset.route);

  const cache = readCache();
  applyOrder(cache ? cache.routes : defaultOrder);

  if (cache?.dirty) {
    // 前回の保存がサーバーに届いていない → 端末側の順番を送り直す
    pushToServer(currentOrder);
  } else {
    const seqAtStart = saveSeq;
    navOrderApi.get()
      .then(({ routes }) => {
        if (saveSeq !== seqAtStart) return;   // 取得中に並び替えた場合は、そちらを優先
        const next = normalize(routes || []);
        writeCache(next, false);
        if (!sameOrder(next, currentOrder)) applyOrder(next);
      })
      .catch((e) => console.warn("メニュー順の取得に失敗（端末の写しで表示）:", e.message));
  }

  makeSortable(nav);
  nav.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented || Date.now() - lastTouchAt < 1500) return;
    if (!e.target.closest("[data-route]")) return;
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  });
}
