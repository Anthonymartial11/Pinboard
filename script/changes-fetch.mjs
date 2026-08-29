// Watches public county and city data for the events the owner's watchlist
// cares about, and publishes what changed. It publishes EVERYTHING it finds,
// for the whole county, with no idea who is watching what: the matching
// against the private watchlist happens inside the unlocked app. Publishing a
// filtered list would broadcast the watchlist, which would be worse than
// publishing the database.
//
// Two triggers are live, because two have public data behind them:
//   assessment jump  - Ada County parcel TOTALVALUE, diffed against last run
//   new permit       - City of Boise residential permits and demolitions
//
// Three of the five asked for are NOT built, because no free public source
// carries them and inventing them would be worse than leaving them out:
//   ownership transfer  - the county parcel service publishes no owner field
//   listing status      - MLS data, not public
//   entity dissolution  - the Idaho Secretary of State has no queryable feed
import fs from "fs";
import zlib from "zlib";

const ROOT = new URL("..", import.meta.url).pathname;
const PUB = ROOT + "pinboard-fresh/";
const STATE = ROOT + "state/";
const PARCELS = "https://services2.arcgis.com/dgGjZc6xAH5m5JyP/arcgis/rest/services/Parcels/FeatureServer/5";
// The open-data download endpoint answers 501; the feature service behind the
// same dataset answers properly, so the service is what is used. Layer 0 is
// new residential permits, layer 1 is residential demolitions. Geometry comes
// back in a state-plane projection unless lon/lat is asked for explicitly.
const PERMITS = "https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Housing_OpenData/FeatureServer/";
fs.mkdirSync(STATE, { recursive: true });

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "ArgusWatch/1.0" }, signal: AbortSignal.timeout(90000) });
      if (r.status === 429 || r.status >= 500) throw new Error("HTTP " + r.status);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (i === tries - 1) { console.log("  give up:", url.slice(0, 80), e.message); return null; }
      await new Promise((z) => setTimeout(z, 2000 * Math.pow(2, i)));
    }
  }
}

/* ── assessed values ─────────────────────────────────────────────────── */
async function parcelValues() {
  const out = new Map();
  let offset = 0;
  for (;;) {
    const url = PARCELS + "/query?where=1%3D1&outFields=PARCEL,TOTALVALUE&returnGeometry=false&f=json"
      + "&resultOffset=" + offset + "&resultRecordCount=2000";
    const j = await getJSON(url);
    if (!j || !j.features || !j.features.length) break;
    for (const f of j.features) {
      const a = f.attributes;
      if (a.PARCEL) out.set(a.PARCEL, Math.round(a.TOTALVALUE || 0));
    }
    offset += j.features.length;
    if (!j.exceededTransferLimit && j.features.length < 2000) break;
    if (offset > 400000) break;
    if (offset % 50000 === 0) console.log("  parcels read:", offset.toLocaleString());
  }
  return out;
}

const snapFile = STATE + "values.json.gz";
console.log("reading assessed values from Ada County...");
const now = await parcelValues();
console.log("  parcels with a value:", now.size.toLocaleString());

let valueChanges = [];
if (now.size > 100000) {
  if (fs.existsSync(snapFile)) {
    const prev = new Map(Object.entries(JSON.parse(zlib.gunzipSync(fs.readFileSync(snapFile)).toString("utf8"))));
    for (const [id, v] of now) {
      const was = prev.get(id);
      if (was === undefined || was === v) continue;
      // Only movements worth waking someone for.
      const pct = was > 0 ? (v - was) / was : 1;
      if (Math.abs(pct) < 0.10 || Math.abs(v - was) < 25000) continue;
      valueChanges.push({ t: "value", parcel: id, from: was, to: v, pct: +(pct * 100).toFixed(1) });
    }
    valueChanges.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    console.log("  assessment jumps since last run:", valueChanges.length.toLocaleString());
  } else {
    console.log("  first run: recording a baseline, no jumps to report yet");
  }
  fs.writeFileSync(snapFile, zlib.gzipSync(Buffer.from(JSON.stringify(Object.fromEntries(now))), { level: 9 }));
} else {
  console.log("  SKIPPED: the county returned too few parcels to trust a diff");
}

/* ── permits ─────────────────────────────────────────────────────────── */
async function permits(layer, kind) {
  const out = [];
  let offset = 0;
  for (;;) {
    const url = PERMITS + layer + "/query?where=1%3D1&outFields=*&outSR=4326&f=json"
      + "&resultOffset=" + offset + "&resultRecordCount=2000";
    const j = await getJSON(url);
    if (!j || !j.features || !j.features.length) break;
    for (const f of j.features) {
      const a = f.attributes || {};
      const id = String(a.RecordID || a.OBJECTID || "");
      if (!id) continue;
      out.push({
        t: kind, id,
        addr: String(a.PropertyAddress || "").trim(),
        when: a.IssuedDate || a.ReceiveDate || null,
        status: String(a.PermitStatus || a.Status || "").trim(),
        desc: [a.ResidentialType, a.ResidentialSubtype].filter(Boolean).join(" ").slice(0, 160),
        units: a.LivingUnits || a.Units || null,
        lon: f.geometry && f.geometry.x != null ? +f.geometry.x.toFixed(6) : null,
        lat: f.geometry && f.geometry.y != null ? +f.geometry.y.toFixed(6) : null,
      });
    }
    offset += j.features.length;
    if (!j.exceededTransferLimit && j.features.length < 2000) break;
    if (offset > 200000) break;
  }
  console.log("  " + kind + ": " + out.length + " records");
  return out;
}

console.log("reading Boise permits...");
const permitNow = [...(await permits(0, "permit")), ...(await permits(1, "demolition"))];
const permFile = STATE + "permits.json";
let permitChanges = [];
if (permitNow.length) {
  const prevIds = fs.existsSync(permFile) ? new Set(JSON.parse(fs.readFileSync(permFile, "utf8"))) : null;
  if (prevIds) permitChanges = permitNow.filter((p) => !prevIds.has(p.t + ":" + p.id));
  else console.log("  first run: recording a baseline, no new permits to report yet");
  fs.writeFileSync(permFile, JSON.stringify(permitNow.map((p) => p.t + ":" + p.id)));
  console.log("  new since last run:", permitChanges.length);
}

/* ── publish ─────────────────────────────────────────────────────────── */
// Kept to a bounded size so the app never has to swallow an unbounded file.
const MAXV = 4000, MAXP = 1500;
const prevPub = fs.existsSync(PUB + "changes.json") ? JSON.parse(fs.readFileSync(PUB + "changes.json", "utf8")) : { items: [] };
const fresh = [...valueChanges.slice(0, MAXV), ...permitChanges.slice(0, MAXP)].map((c) => ({ ...c, seen: Date.now() }));
const merged = [...fresh, ...(prevPub.items || [])]
  .filter((c) => Date.now() - (c.seen || 0) < 120 * 86400000)
  .slice(0, 20000);
fs.writeFileSync(PUB + "changes.json", JSON.stringify({ v: 1, built: Date.now(), count: merged.length, items: merged }));
console.log("changes.json:", merged.length, "entries,",
            (fs.statSync(PUB + "changes.json").size / 1024).toFixed(0), "KB");
