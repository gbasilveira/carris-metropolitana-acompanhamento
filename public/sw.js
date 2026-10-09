// Service worker: stale-while-revalidate para dados estáticos da rede; shell em cache.
// Posições em tempo real, alertas e chegadas NÃO são guardadas em cache (dados voláteis).
const SHELL = "shell-v1";
const DATA = "data-v1";
const STATIC_API = /^https:\/\/api\.carrismetropolitana\.pt\/v2\/(lines|stops|routes|patterns\/|shapes\/)/;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== DATA && k !== "tiles-v1").map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

async function swr(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return hit || (await net) || new Response("offline", { status: 503 });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (STATIC_API.test(req.url)) return e.respondWith(swr(req, DATA));
  if (url.origin === location.origin && !url.pathname.startsWith("/api/")) return e.respondWith(swr(req, SHELL));
  if (url.hostname.endsWith("tile.openstreetmap.org")) return e.respondWith(swr(req, "tiles-v1"));
});
