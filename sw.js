// Idaho Power Database service worker.
//
// NETWORK-FIRST FOR THE SHELL: the page itself is updated often, and a
// cache-first worker once pinned a broken build on the device. index.html and
// the icons always try the network first and fall back to cache only when
// offline, so a bad cached copy can never trap the user.
//
// CACHE-FIRST FOR THE SEALED PAYLOADS: board.enc and parcels.enc carry a hash
// of their own contents in the URL, so those URLs are immutable by
// construction and re-fetching them can only ever return the same bytes. See
// isVersioned below for why that matters more than it sounds.
//
// STRICT ALLOWLIST (security): the previous version cached the response to
// EVERY GET it saw. That was harmless while the app only ever fetched its own
// four files, but it meant any future request (a county parcel lookup, a news
// fetch) would be written to disk in the clear, leaving an unencrypted record
// of what was being researched on a device whose whole point is that it keeps
// that private. The worker now caches ONLY the app shell listed below.
// Anything not on this list is passed straight through to the network and is
// never written to storage.
const CACHE = "argus-v9";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-512.png", "./icon-192.png"];

// Same-origin app-shell paths only. Compared against the resolved pathname so
// a query string cannot smuggle a non-shell URL past the check.
// parcels.enc is on this list deliberately: it is encrypted at rest, so a
// cached copy discloses nothing, and caching it keeps the map working offline.
const SHELL = new Set(["/", "/index.html", "/manifest.json", "/icon-512.png", "/icon-192.png", "/parcels.enc", "/board.enc"]);

// version.json is deliberately NOT on that list. It is how the app finds out a
// new build exists, so a cached answer would defeat the whole point: the app
// would be told it is up to date by the very copy that is out of date.
// Anything off the list is passed straight to the network and never stored.

// CONTENT-ADDRESSED FILES ARE CACHE-FIRST, and this is the difference between
// an app that opens and one that is unusable on a phone.
//
// board.enc and parcels.enc are fetched as "board.enc?v=<sha256 of the file>".
// The content behind one of those URLs can NEVER change: a new build produces
// new bytes, a new hash, and therefore a different URL. So going to the network
// to ask whether they have changed is not caution, it is 18MB of pointless
// download on EVERY SINGLE OPEN, before the app is allowed to show anything.
// That is what made it feel broken away from wifi.
//
// version.json stays network-first and uncached, so a genuinely new build is
// still found immediately. It changes the version in the URL, the cache misses,
// and the new file downloads once. Exactly once.
function isVersioned(url) {
  return /\/(board|parcels)\.enc$/.test(url.pathname) && url.search.length > 1;
}

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

// PRUNING OLD VERSIONS. board.enc and parcels.enc carry a content version in
// their query string, so each new build is cached as a separate entry and the
// old one is never asked for again. Left alone that grows without limit, and
// on a phone a full storage quota does not just waste space: it is what makes
// writing the owner's private notes start to fail. The page tells the worker
// which versions it is actually using and everything else is dropped.
self.addEventListener("message", (e) => {
  const keep = e.data && e.data.keep;
  if (!keep || !Array.isArray(keep)) return;
  e.waitUntil(caches.open(CACHE).then((c) => c.keys().then((reqs) => Promise.all(
    reqs.filter((r) => {
      const u = new URL(r.url);
      if (!/\/(parcels|board)\.enc$/.test(u.pathname)) return false;
      return keep.indexOf(u.pathname + u.search) < 0;
    }).map((r) => c.delete(r)),
  ))));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  // Not part of the app shell: hand it to the network untouched and store
  // nothing. No response body, no URL, no timing is retained.
  if (!isShell(e.request)) return;

  // Cache-first for the two big sealed files, matched on the exact URL
  // including its version. A hit is served from disk with no network at all;
  // a miss downloads once and keeps it.
  const u = new URL(e.request.url);
  if (isVersioned(u)) {
    // THE ESCAPE HATCH. The page asks with cache:"reload" when a file it
    // already has failed to decrypt, which is how it recovers from a truncated
    // or corrupt copy. Cache-first would hand back the same bad bytes forever
    // and the app would be bricked with a "wrong password" it could never get
    // past, so an explicit reload always goes to the network and replaces what
    // is stored.
    const bypass = e.request.cache === "reload" || e.request.cache === "no-store";
    e.respondWith(
      (bypass ? Promise.resolve(null) : caches.match(e.request)).then((hit) => {
        if (hit) return hit;
        return fetch(e.request).then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        });
      }),
    );
    return;
  }

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
      .catch(() => caches.match(e.request, { ignoreSearch: !/\/(parcels|board)\.enc$/.test(new URL(e.request.url).pathname) })),
  );
});
