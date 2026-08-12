// Offline-capable service worker for Panels.
//
// Strategy:
// - Page navigations: network-first, falling back to the cached app shell
//   ("/") when there's no connection. This means whatever page you're on,
//   losing your connection still lets you re-open the app.
// - Same-origin static assets (JS/CSS/icons/fonts, etc.): cache-first, with
//   the network response saved into the cache for next time. Vite fingerprints
//   these filenames per build, so we don't need to know them ahead of time —
//   we just cache whatever gets requested as the user browses.
// - Everything cross-origin (Supabase API calls, auth, images from other
//   hosts) is left alone and always goes to the network. We never want to
//   serve stale reads/writes as if they succeeded — the app's own local
//   cache (see the reading-list cache in the app code) handles showing your
//   last-synced data while offline instead.
//
// Bump CACHE_NAME whenever this file changes so old caches get cleared out.
const CACHE_NAME = "panels-shell-v1";
const APP_SHELL_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(APP_SHELL_URL)).catch(() => {
      // Non-fatal: if this fails (e.g. offline on first install), runtime
      // caching below will still fill the cache on the next successful visit.
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever handle GET — never intercept POST/PUT/etc (auth, writes).
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // leave Supabase etc. alone

  // Page navigations: try the network, fall back to the cached shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(APP_SHELL_URL, copy));
          return response;
        })
        .catch(() => caches.match(APP_SHELL_URL).then((cached) => cached || caches.match(request))),
    );
    return;
  }

  // Static assets: cache-first, then update the cache from the network.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    }),
  );
});
