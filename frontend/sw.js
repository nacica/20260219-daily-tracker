/**
 * Service Worker
 * キャッシュ戦略:
 *   - 静的アセット（CSS/JS/HTML）: Stale-While-Revalidate（キャッシュ即返し + 背景更新）
 *   - API リクエスト: Network First（オフライン時はキャッシュ）
 *   - index.html / sw.js: Network First（新デプロイを即反映）
 *
 * JS/CSS は `?v=xxx` で URL が変わるとキャッシュキーも変わるため、
 * SWR でも古いコードが出続けることはない（新バージョンは新 URL として取得される）。
 */

const CACHE_NAME = "daily-tracker-v249";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/app.js",
  "/js/api.js",
  "/js/router.js",
  "/js/swipe-nav.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

// インストール時に主要アセットをキャッシュ（失敗しても SW 起動は継続）
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(STATIC_ASSETS.map((url) => cache.add(url)))
    )
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
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API リクエストは Network First
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // index.html / ナビゲーションリクエストは Network First（新デプロイを即反映）
  if (request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith("/index.html")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // JS/CSS は Stale-While-Revalidate（キャッシュ即返し、背景で更新）
  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // その他の静的アセット（画像, manifest, フォント等）は Cache First
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

/**
 * Stale-While-Revalidate
 * 1. キャッシュがあれば即返す
 * 2. 背景でネットワーク取得してキャッシュを更新
 * 3. キャッシュがなければネットワーク結果を待つ
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || (await networkPromise) || new Response("オフラインです", { status: 503 });
}
