// Minimal service worker.
// Its only job right now is to exist and respond to fetch, which is what
// Chrome/Android require before showing the "Install app" prompt.
// It does NOT cache anything, so the site always loads fresh from the
// network exactly like it does today — this only affects the installed
// app shell, not the regular website.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
