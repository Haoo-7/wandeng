const CACHE = "wandeng-v20";
const FILES = [
  "./",
  "./index.html",
  "./assets/app.css?v=20",
  "./assets/logic.js?v=20",
  "./assets/data.js?v=20",
  "./assets/app.js?v=20",
  "./assets/favicon.svg",
  "./assets/apple-touch.png",
  "./assets/img/hotel.jpg",
  "./assets/img/game-tod.png",
  "./assets/img/game-dice.png",
  "./assets/img/game-wheel.png",
  "./assets/img/game-board.png",
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

// 缓存写入失败（配额、不支持的 scheme）不该冒泡成未处理的拒绝。
function cachePut(req, res) {
  caches
    .open(CACHE)
    .then((cache) => cache.put(req, res))
    .catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          cachePut(req, res.clone());
          return res;
        })
        // 链尾必须落到真正的 Response：两处都没命中就是 undefined，respondWith(undefined) 会被判成 net::ERR_FAILED。
        .catch(() =>
          caches
            .match(req)
            .then((hit) => hit || caches.match("./index.html"))
            .then((hit) => hit || Response.error())
        )
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) cachePut(req, res.clone());
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
