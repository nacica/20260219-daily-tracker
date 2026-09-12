/**
 * ホームランチャー（モバイル用スタート画面）
 *
 * 上部ナビ（.nav-links）に並んでいるアイコン＋ラベルをそのまま複製し、
 * スマホのホーム画面風の大きなタイル（3列）として表示する。
 * アイコン定義を二重管理しないため、index.html のナビ DOM を唯一のソースとする。
 */

/** 現在日時のテキスト（例: 9月12日（土））*/
function todayLabel() {
  const now = new Date();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${now.getMonth() + 1}月${now.getDate()}日（${weekdays[now.getDay()]}）`;
}

export function renderHomeLauncher() {
  const main = document.querySelector("main");
  if (!main) return;

  const links = Array.from(document.querySelectorAll(".nav-links .nav-link"));

  const tiles = links
    .map((link) => {
      const svg = link.querySelector("svg.icon");
      const label = link.querySelector("span")?.textContent?.trim() ?? "";
      const href = link.getAttribute("href") || "#/";
      const iconHtml = svg ? svg.outerHTML : "";
      return `
        <a class="launcher-tile" href="${href}" data-route="${link.dataset.route || ""}">
          ${iconHtml}
          <span class="launcher-label">${label}</span>
        </a>`;
    })
    .join("");

  main.innerHTML = `
    <section class="launcher">
      <header class="launcher-header">
        <div class="launcher-title">
          <span class="launcher-logo">行動分析AI</span>
          <span class="launcher-date">${todayLabel()}</span>
        </div>
        <button class="launcher-theme-btn" type="button" aria-label="テーマ切替">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>
          </svg>
        </button>
      </header>
      <div class="launcher-grid">${tiles}</div>
    </section>`;

  // テーマ切替はナビ内の既存ボタン（インラインスクリプトが処理）を代理クリックする
  main.querySelector(".launcher-theme-btn")?.addEventListener("click", () => {
    document.getElementById("theme-toggle")?.click();
  });
}
