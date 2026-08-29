// Idaho Power Database service worker.
//
// NETWORK-FIRST: the board is updated often, and a cache-first worker once
// pinned a broken build on the device. We always try the network first and
// fall back to cache only when offline, so a bad cached copy can never trap
// the user and updates arrive on the next open.
//
// STRICT ALLOWLIST (security): the previous version cached the response to
// EVERY GET it saw. That was harmless while the app only ever fetched its own
// four files, but it meant any future request (a county parcel lookup, a news
// fetch) would be written to disk in the clear, leaving an unencrypted record
// of what was being researched on a device whose whole point is that it keeps
// that private. The worker now caches ONLY the app shell listed below.
// Anything not on this list is passed straight through to the network and is
// never written to storage.
const CACHE = "argus-v6";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-512.png", "./icon-192.png"];

// Same-origin app-shell paths only. Compared against the resolved pathname so
// a query string cannot smuggle a non-shell URL past the check.
// parcels.enc is on this list deliberately: it is encrypted at rest, so a
// cached copy discloses nothing, and caching it keeps the map working offline.
const SHELL = new Set(["/", "/index.html", "/manifest.json", "/icon-512.png", "/icon-192.png", "/parcels.enc"]);

function isShell(request) {
  let url;
  try { url = new URL(request.url); } catch (e) { return false; }
  if (url.origin !== self.location.origin) return false;   // never cache third parties
  const scope = new URL("./", self.location.href).pathname; // e.g. "/Pinboard/"
  if (!url.pathname.startsWith(scope)) return false;
  const rel = "/" + url.pathname.slice(scope.length);       // "/index.html", "/"
  return SHELL.has(rel === "/" ? "/" : rel);
}

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

  // Not part of the app shell: hand it to the network untouched and store
  // nothing. No response body, no URL, no timing is retained.
  if (!isShell(e.request)) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Only cache a genuinely good same-origin response.
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      // Offline fallback. parcels.enc is matched EXACTLY (query included):
      // its URL carries a content version, and serving a different version
      // than the page expects would fail decryption rather than degrade.
      .catch(() => caches.match(e.request, { ignoreSearch: !/\/parcels\.enc$/.test(new URL(e.request.url).pathname) })),
  );
});
