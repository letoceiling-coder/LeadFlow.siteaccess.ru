// Минимальный service worker: делает LeadFlow устанавливаемым и показывает заглушку без сети.
// Данные API не кэшируются — карточки и статусы всегда свежие.
const OFFLINE = "/offline.html";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("lf-v1").then((cache) => cache.add(OFFLINE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});
