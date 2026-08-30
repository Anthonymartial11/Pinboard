// The archive's one shared piece: how it is stored, and how it is read back.
//
// Storage is one small gzipped file per source per day:
//   archive/owners/20260830.jsonl.gz
// rather than one file per source that grows forever. The seed day is large
// once; every day after it is a few kilobytes, because only what moved is
// written. It also means any single day can be looked at on its own, and a
// corrupt write costs one day instead of the whole record.
//
// Nothing is ever edited or deleted. A wrong line stays and is corrected by a
// later one, so the record of what we believed and when survives too.
import fs from "fs";
import zlib from "zlib";
import path from "path";

export const ARCHIVE_ROOT = (root) =>
  (process.env.ARGUS_PUB || root + "pinboard-fresh/").replace(/\/?$/, "/") + "archive/";

// Phoenix, never UTC. A run at 6pm Phoenix belongs to the 30th, not the 31st.
export const today = () => +new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date()).replace(/-/g, "");

export const iso = (d) => String(d).replace(/(\d{4})(\d\d)(\d\d)/, "$1-$2-$3");

function dayFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^\d{8}\.jsonl(\.gz)?$/.test(f))
    .sort();                                   // filenames sort as dates do
}

// Every line, oldest first. This is the whole history of one source.
export function* lines(arc, name) {
  const dir = arc + name + "/";
  for (const f of dayFiles(dir)) {
    const buf = fs.readFileSync(dir + f);
    const txt = f.endsWith(".gz") ? zlib.gunzipSync(buf).toString("utf8") : buf.toString("utf8");
    for (const raw of txt.split("\n")) {
      if (!raw) continue;
      try { yield JSON.parse(raw); } catch { /* a bad line is skipped, never repaired in place */ }
    }
  }
}

// Replays the history forward into what the source looked like at the end of
// the last run. `dead` keeps the last known shape of anything that vanished,
// because a record disappearing is usually the interesting part.
export function replay(arc, name) {
  const state = new Map(), dead = new Map();
  let count = 0, since = null, last = null;
  for (const l of lines(arc, name)) {
    count++;
    if (since === null) since = l.d;
    last = l.d;
    if (l.k === "+") state.set(l.id, typeof l.v === "object" && l.v !== null ? { ...l.v } : l.v);
    else if (l.k === "-") { if (state.has(l.id)) dead.set(l.id, state.get(l.id)); state.delete(l.id); }
    else if (l.k === "~") {
      const cur = state.get(l.id);
      if (cur === undefined) continue;
      if (typeof cur !== "object" || cur === null) state.set(l.id, l.b);
      else cur[l.f] = l.b;
    }
  }
  return { state, dead, count, since, last };
}

// One day, one file. Written whole, so a crash mid-write cannot leave half a
// day looking like a complete one.
export function write(arc, name, day, out) {
  if (!out.length) return 0;
  const dir = arc + name + "/";
  fs.mkdirSync(dir, { recursive: true });
  const file = dir + day + ".jsonl.gz";
  // A second run on the same day adds to that day rather than replacing it.
  let body = "";
  if (fs.existsSync(file)) body = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
  body += out.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const tmp = file + ".part";
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(body), { level: 9 }));
  fs.renameSync(tmp, file);
  return out.length;
}

// The diff that becomes history. `now` maps id -> record (an object of fields,
// or a bare value). `floor` is the smallest believable size for this source:
// below it, nothing is written at all, because a source having a bad morning
// must never be recorded as a thousand things disappearing.
export function commit(arc, name, day, now, floor) {
  if (now.size < floor) {
    console.log("  " + name + ": SKIPPED. Source returned " + now.size.toLocaleString()
      + " and the floor is " + floor.toLocaleString()
      + ". Nothing written rather than writing down a lie.");
    return null;
  }
  const { state, count, since } = replay(arc, name);
  const out = [];
  let added = 0, changed = 0, gone = 0;
  const changes = [];

  for (const [id, rec] of now) {
    const was = state.get(id);
    if (was === undefined) { out.push({ d: day, k: "+", id, v: rec }); added++; continue; }
    if (typeof rec !== "object" || rec === null) {
      if (was !== rec) { out.push({ d: day, k: "~", id, f: "v", a: was, b: rec }); changed++; changes.push({ id, f: "v", a: was, b: rec }); }
      continue;
    }
    for (const f of Object.keys(rec)) {
      const a = was && typeof was === "object" ? (was[f] ?? null) : null, b = rec[f] ?? null;
      if (a === b) continue;
      out.push({ d: day, k: "~", id, f, a, b });
      changed++; changes.push({ id, f, a, b });
    }
  }
  for (const id of state.keys()) if (!now.has(id)) { out.push({ d: day, k: "-", id }); gone++; }

  write(arc, name, day, out);
  const first = count === 0;
  console.log("  " + name + ": " + now.size.toLocaleString() + " live"
    + (first ? "   FIRST RUN, this is the seed and the clock starts today"
             : "   +" + added + " new, " + changed + " field changes, " + gone + " gone")
    + "   archive " + (count + out.length).toLocaleString() + " lines"
    + (since && !first ? " back to " + iso(since) : ""));
  return { added, changed, gone, first, changes };
}
