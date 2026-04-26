/**
 * スワイプナビゲーション
 * モバイルで左右スワイプによるタブ切り替えを実現する
 */

/** ナビタブの順序（data-route と一致） */
const TAB_ORDER = [
  "/input",
  "/history",
  "/weekly",
  "/suggestions",
  "/coach",
  "/journal",
  "/knowledge",
  "/monthly",
];

/** スワイプ判定の閾値 */
const SWIPE_THRESHOLD = 60;   // 最低スワイプ距離 (px)
const SWIPE_MAX_Y = 80;       // 縦方向の許容ズレ (px)
const SWIPE_MAX_TIME = 400;   // 最大スワイプ時間 (ms)

/** 現在のルートからベースパスを取得 */
function getCurrentBase() {
  const hash = window.location.hash.slice(1) || "/";
  if (hash === "/") return "/";
  return "/" + hash.split("/")[1];
}

/** 現在のタブインデックスを取得 */
function getCurrentTabIndex() {
  const base = getCurrentBase();
  const idx = TAB_ORDER.indexOf(base);
  return idx >= 0 ? idx : 0;
}

/**
 * スワイプナビゲーションを初期化する
 */
export function initSwipeNav() {
  const app = document.getElementById("app");
  if (!app) return;

  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let tracking = false;

  app.addEventListener("touchstart", (e) => {
    // マルチタッチは無視
    if (e.touches.length !== 1) return;
    // デスクトップでは無効 (1024px 以上)
    if (window.innerWidth >= 1024) return;

    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = Date.now();
    tracking = true;
  }, { passive: true });

  app.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    // 縦スクロールが大きい場合はスワイプ判定を中止
    const touch = e.touches[0];
    const dy = Math.abs(touch.clientY - startY);
    if (dy > SWIPE_MAX_Y) {
      tracking = false;
    }
  }, { passive: true });

  app.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = Math.abs(touch.clientY - startY);
    const dt = Date.now() - startTime;

    // スワイプ判定: 横移動が閾値以上、縦ズレが許容範囲内、時間内
    if (Math.abs(dx) < SWIPE_THRESHOLD || dy > SWIPE_MAX_Y || dt > SWIPE_MAX_TIME) {
      return;
    }

    const currentIdx = getCurrentTabIndex();
    let nextIdx;

    if (dx < 0) {
      // 左スワイプ → 次のタブ
      nextIdx = currentIdx + 1;
    } else {
      // 右スワイプ → 前のタブ
      nextIdx = currentIdx - 1;
    }

    // 範囲チェック
    if (nextIdx < 0 || nextIdx >= TAB_ORDER.length) return;

    // ページ遷移アニメーション
    const main = document.querySelector("main");
    if (main) {
      const direction = dx < 0 ? "left" : "right";
      main.classList.add("swipe-exit-" + direction);

      // 短い遅延でページ遷移
      setTimeout(() => {
        window.location.hash = TAB_ORDER[nextIdx];
        main.classList.remove("swipe-exit-" + direction);
        main.classList.add("swipe-enter-" + direction);
        // アニメーション完了後にクラスを除去
        setTimeout(() => {
          main.classList.remove("swipe-enter-" + direction);
        }, 250);
      }, 120);
    } else {
      window.location.hash = TAB_ORDER[nextIdx];
    }
  }, { passive: true });
}
