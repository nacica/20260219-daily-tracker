/**
 * Service Worker
 * キャッシュ戦略:
 *   - 静的アセット（CSS/JS/HTML）: Cache First
 *   - API リクエスト: Network First（オフライン時はキャッシュ）
 */

const CACHE_NAME = "daily-tracker-v176";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/app.js",
  "/js/api.js",
  "/js/router.js",
  "/js/swipe-nav.js",
  "/js/components/input-form.js",
  "/js/components/analysis-view.js",
  "/js/components/history-list.js",
  "/js/components/weekly-report.js",
  "/js/components/screenshot-upload.js",
  "/js/components/suggestions.js",
  "/js/components/coaching-chat.js",
  "/js/components/knowledge-graph.js",
  "/js/components/monthly-report.js",
  "/js/components/journal.js",
  "/js/components/task-stats.js",
  "/js/components/braindump.js",
  "/js/components/flashcard-list.js",
  "/js/components/flashcard-study.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

// インストール時に静的アセットをキャッシュ
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// アクティベート時に古いキャッシュを削除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// フェッチ処理
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API リクエストは Network First
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // JS/CSS は Network First（デプロイ後すぐ反映させるため）
  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // その他の静的アセット（HTML, 画像, manifest等）は Cache First
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("オフラインです", { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: "オフラインです" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
