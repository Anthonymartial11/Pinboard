// Publishes the app's change list OUT OF THE ARCHIVE, instead of going back to
// the county for the same 235,000 parcels a second time every day.
//
// The archive already knows what moved, because working that out is the whole
// reason it exists. This just takes the last few months of it, keeps the
// movements a person would actually want waking up for, and writes the file
// the app reads.
//
// It publishes EVERYTHING it finds, for the whole county, with no idea who is
// watching what. Matching against the private watchlist happens inside the
// unlocked app, on the owner's device. A filtered list would broadcast the
// watchlist, which would be worse than publishing the database.
import fs from "fs";
import { ARCHIVE_ROOT, replay, lines as archiveLines, iso } from "./arclib.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const PUB = (process.env.ARGUS_PUB || ROOT + "pinboard-fresh/").replace(/\/?$/, "/");
const ARC = ARCHIVE_ROOT(ROOT);
const WINDOW_DAYS = 120;
// An archive day is a Phoenix calendar day. Noon local is a fair stamp for it.
const stamp = (d) => Date.parse(iso(d) + "T12:00:00-07:00");
const cutoff = Date.now() - WINDOW_DAYS * 86400000;

function read(name) {
  const { state, dead } = replay(ARC, name);
  return { state, dead, lines: [...archiveLines(ARC, name)] };
}

const items = [];
const seenAt = (l) => stamp(l.d);

/* ── planning applications ─────────────────────────────────────────────── */
{
  const { state, lines, dead } = read("tracker");
  // The seed day is not news. Everything was "new" that morning by definition.
  const first = lines.length ? lines[0].d : null;
  for (const l of lines) {
    if (l.d === first) continue;
    if (stamp(l.d) < cutoff) continue;
    const r = state.get(l.id) || dead.get(l.id) || {};
    const base = {
      id: l.id, addr: r.addr || r.name || "", desc: [r.type, r.desc].filter(Boolean).join(" · ").slice(0, 160),
      hearing: r.hearing || null, body: r.body || null, url: r.url || null,
      lon: r.lon ?? null, lat: r.lat ?? null, seen: seenAt(l),
    };
    if (l.k === "+") items.push({ t: "application", ...base, status: (l.v && l.v.status) || "", was: null });
    else if (l.k === "~" && l.f === "status") items.push({ t: "application-status", ...base, status: l.b || "", was: l.a });
    else if (l.k === "~" && l.f === "hearing" && l.b) items.push({ t: "hearing-set", ...base, status: r.status || "", was: null, hearing: l.b });
    // Leaving the tracker means the file closed. The county never announces it.
    else if (l.k === "-") items.push({ t: "application-closed", ...base, status: "left the tracker", was: r.status || null });
  }
}

/* ── rezone and entitlement cases ──────────────────────────────────────── */
{
  const { state, lines, dead } = read("zoneacts");
  const first = lines.length ? lines[0].d : null;
  for (const l of lines) {
    if (l.d === first || stamp(l.d) < cutoff) continue;
    const r = state.get(l.id) || dead.get(l.id) || {};
    const base = {
      id: l.id, addr: r.addr || r.name || "",
      desc: [r.ptype, r.use, r.desc].filter(Boolean).join(" · ").slice(0, 160),
      units: r.units ?? null, zone: r.zone || null,
      lon: r.lon ?? null, lat: r.lat ?? null, seen: seenAt(l),
    };
    if (l.k === "+") items.push({ t: "rezone", ...base, status: (l.v && l.v.status) || "", was: null });
    else if (l.k === "~" && l.f === "status") items.push({ t: "rezone-status", ...base, status: l.b || "", was: l.a });
    else if (l.k === "-") items.push({ t: "rezone-closed", ...base, status: "case closed", was: r.status || null });
  }
}

/* ── permits ───────────────────────────────────────────────────────────── */
{
  const { state, lines } = read("permits");
  const first = lines.length ? lines[0].d : null;
  for (const l of lines) {
    if (l.d === first || stamp(l.d) < cutoff || l.k !== "+") continue;
    const r = state.get(l.id) || (l.v || {});
    items.push({
      t: r.kind === "demolition" ? "demolition" : "permit",
      id: l.id.replace(/^[a-z]+:/, ""), addr: r.addr || "", status: r.status || "",
      desc: r.type || "", units: r.units ?? null, when: r.issued || r.received || null,
      lon: r.lon ?? null, lat: r.lat ?? null, seen: seenAt(l),
    });
  }
}

/* ── ownership ─────────────────────────────────────────────────────────── */
// The one the owner asked for first, and the one the old watcher said could
// not be done. A parcel changing hands is the loudest thing in this file.
{
  const { state, lines } = read("owners");
  const first = lines.length ? lines[0].d : null;
  for (const l of lines) {
    if (l.d === first || stamp(l.d) < cutoff || l.k !== "~") continue;
    if (l.f !== "owner" && l.f !== "owner2" && l.f !== "mail") continue;
    const r = state.get(l.id) || {};
    const base = {
      id: l.id, parcel: l.id, addr: r.site || "", value: r.value ?? null,
      acres: r.acres ?? null, sub: r.sub || null, seen: stamp(l.d),
    };
    if (l.f === "mail") items.push({ t: "owner-moved", ...base, status: r.owner || "", was: l.a, to: l.b });
    else items.push({ t: "owner-changed", ...base, status: l.b || "", was: l.a || null, to: l.b });
  }
}

/* ── assessed value ────────────────────────────────────────────────────── */
// Only movements worth waking someone for. The archive keeps every last dollar
// either way, so nothing is lost by being fussy here.
{
  const { lines } = read("values");
  const first = lines.length ? lines[0].d : null;
  for (const l of lines) {
    if (l.d === first || stamp(l.d) < cutoff || l.k !== "~") continue;
    const was = +l.a, now = +l.b;
    if (!isFinite(was) || !isFinite(now)) continue;
    const pct = was > 0 ? (now - was) / was : 1;
    if (Math.abs(pct) < 0.10 || Math.abs(now - was) < 25000) continue;
    items.push({ t: "value", id: l.id, parcel: l.id, from: was, to: now, pct: +(pct * 100).toFixed(1), seen: seenAt(l) });
  }
}

/* ── write ─────────────────────────────────────────────────────────────── */
items.sort((a, b) => (b.seen - a.seen) || (Math.abs(b.pct || 0) - Math.abs(a.pct || 0)));
const merged = items.slice(0, 20000);
// A read failure must never look like "nothing is happening in Ada County".
const had = (() => { try { return JSON.parse(fs.readFileSync(PUB + "changes.json", "utf8")).items.length; } catch { return 0; } })();
if (!merged.length && had) {
  console.log("REFUSED to publish: the archive produced nothing but the live file has " + had
    + " entries. Leaving it alone rather than telling the app the county went quiet.");
  process.exit(0);
}
fs.writeFileSync(PUB + "changes.json", JSON.stringify({ v: 1, built: Date.now(), count: merged.length, items: merged }));

const by = {};
for (const i of merged) by[i.t] = (by[i.t] || 0) + 1;
console.log("changes.json rebuilt from the archive:", merged.length, "entries,",
            (fs.statSync(PUB + "changes.json").size / 1024).toFixed(0), "KB");
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log("  " + k.padEnd(20) + v);
if (!merged.length) console.log("  (nothing yet: the archive has only its seed day, so there is no 'before' to compare against)");
