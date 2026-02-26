const CACHE_NAME = "resenha-ferreira-campeonato-cache-v39";
const ASSETS = ["/admin", "/player", "/player/home", "/jogo", "/jogo/ao-vivo", "/index.html", "/player.html", "/player-home.html", "/jogo.html", "/jogo-live.html", "/styles.css", "/player.css", "/player-home.css", "/jogo.css", "/jogo-live.css", "/app.js", "/player.js", "/player-home.js", "/jogo.js", "/jogo-live.js", "/manifest.webmanifest", "/manifest-jogo.webmanifest", "/icons/icon-192.svg", "/icons/icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isApi = url.pathname.startsWith("/api/");
  const isAppShellAsset = ["/admin", "/player", "/player/home", "/jogo", "/jogo/ao-vivo", "/index.html", "/player.html", "/player-home.html", "/jogo.html", "/jogo-live.html", "/app.js", "/player.js", "/player-home.js", "/jogo.js", "/jogo-live.js", "/styles.css", "/player.css", "/player-home.css", "/jogo.css", "/jogo-live.css"].includes(url.pathname);

  if (isApi) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (isAppShellAsset) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(event.request)).then((cached) => cached || caches.match("/admin")))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(event.request)).then((cached) => cached || fetch(event.request).then((response) => {
      if (response && response.status === 200) {
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
      }
      return response;
    }).catch(() => caches.match("/admin")))
  );
});
