const CACHE = "wandeng-v13";
const FILES = [
  "./",
  "./index.html",
  "./assets/app.css?v=13",
  "./assets/logic.js?v=13",
  "./assets/data.js?v=13",
  "./assets/app.js?v=13",
  "./assets/favicon.svg",
  "./assets/apple-touch.png",
  "./assets/img/hotel.jpg",
  "./assets/img/game-tod.png",
  "./assets/img/game-dice.png",
  "./assets/img/game-wheel.png",
  "./assets/img/tile-combo.png",
  "./assets/img/tile-scene.png",
  "./assets/img/tile-choice.png",
  "./assets/img/tile-timer.png",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
    );
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      // 兜底必须返回真正的 Response：caches.match 未命中会返回 undefined，respondWith(undefined) 会被判成 net::ERR_FAILED。
      .catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
