/**
 * シンプルな SPA ハッシュルーター
 * URL ハッシュ (#/path) をもとにコンポーネントを切り替える
 */

const routes = new Map();

/**
 * ルートを登録する
 * @param {string|RegExp} pattern - URL パターン（文字列 or 正規表現）
 * @param {Function} handler - マウント関数 (params) => void
 */
export function addRoute(pattern, handler) {
  routes.set(pattern, handler);
}

/**
 * 現在の URL に合うルートを実行する
 */
export function navigate(path) {
  const hash = path || window.location.hash.slice(1) || "/";

  for (const [pattern, handler] of routes) {
    let params = {};

    if (typeof pattern === "string") {
      // シンプルな文字列マッチ（:param 対応）
      const regexStr = pattern.replace(/:(\w+)/g, "([^/]+)");
      const re = new RegExp(`^${regexStr}$`);
      const keys = [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1]);
      const match = hash.match(re);
      if (match) {
        keys.forEach((key, i) => (params[key] = match[i + 1]));
        handler(params);
        return;
      }
    } else if (pattern instanceof RegExp) {
      const match = hash.match(pattern);
      if (match) {
        handler(match);
        return;
      }
    }
  }

  // マッチなし → 404 表示
  handler404();
}

function handler404() {
  const main = document.querySelector("main");
  if (main) {
    main.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔍</div>
        <p>ページが見つかりません</p>
      </div>`;
  }
}

/** ハッシュ変更時にナビゲートする */
window.addEventListener("hashchange", () => navigate());

/** ナビリンクのアクティブ状態を更新 */
export function updateNavActive() {
  const hash = window.location.hash.slice(1) || "/";
  document.querySelectorAll(".nav-link").forEach((link) => {
    const target = link.dataset.route;
    link.classList.toggle("active", target && hash.startsWith(target));
  });
}

window.addEventListener("hashchange", updateNavActive);
