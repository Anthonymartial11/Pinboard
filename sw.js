// Idaho Power Board service worker.
// NETWORK-FIRST (changed from cache-first): the board is updated often, and a
// cache-first worker once pinned a broken build on the device. Now we always
// try the network first and fall back to cache only when offline, so a bad
// cached copy can never trap the user, and updates arrive on the next open.
const CACHE = "powerboard-v3";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
