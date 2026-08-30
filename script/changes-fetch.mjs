// Watches public county and city data for the events the owner's watchlist
// cares about, and publishes what changed. It publishes EVERYTHING it finds,
// for the whole county, with no idea who is watching what: the matching
// against the private watchlist happens inside the unlocked app. Publishing a
// filtered list would broadcast the watchlist, which would be worse than
// publishing the database.
//
// Four triggers are live now:
//   assessment jump  - Ada County parcel TOTALVALUE, diffed against last run
//   new permit       - City of Boise residential permits and demolitions
//   new application  - City of Boise development tracker: a planning project
//                      the moment it is filed, with its next hearing date
//   rezone activity  - City of Boise zoning activities: rezone and entitlement
//                      cases, their status, and the units being proposed
//
// The last two are the earliest signals that exist. A rezone application is
// public the day it is filed and moves value long before a price does, so a
// snapshot of what is planned was never enough: what matters is what changed.
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

/* ── planning applications, the earliest public signal ─────────────────── */
const BOISE = "https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/";

async function pullAll(path, fields) {
  const out = [];
  let offset = 0;
  for (;;) {
    const j = await getJSON(BOISE + path + "/query?where=1%3D1&outFields=" + encodeURIComponent(fields)
      + "&outSR=4326&returnGeometry=true&geometryPrecision=6&f=json&resultOffset=" + offset + "&resultRecordCount=1000");
    if (!j || !j.features || !j.features.length) break;
    out.push(...j.features);
    offset += j.features.length;
    if (!j.exceededTransferLimit && j.features.length < 1000) break;
    if (offset > 40000) break;
  }
  return out;
}
// A polygon's rough centre is enough to put a pin on the map.
function centre(g) {
  if (!g) return [null, null];
  const r = (g.rings && g.rings[0]) || (g.paths && g.paths[0]);
  if (!r || !r.length) return [g.x != null ? +g.x.toFixed(6) : null, g.y != null ? +g.y.toFixed(6) : null];
  let x = 0, y = 0;
  for (const p of r) { x += p[0]; y += p[1]; }
  return [+(x / r.length).toFixed(6), +(y / r.length).toFixed(6)];
}

console.log("reading Boise planning applications...");
const trackFile = STATE + "tracker.json";
let appChanges = [];
const track = await pullAll("Development_Tracker_Open_Data/FeatureServer/0",
  "RecordID,RecordName,Status,RecordType,PropertyAddress,ReviewAuthority,NextHearingDate,HearingBody,Website,AddToTrackerDate,Description");
console.log("  development tracker:", track.length, "live projects");
if (track.length) {
  const prev = fs.existsSync(trackFile) ? JSON.parse(fs.readFileSync(trackFile, "utf8")) : null;
  const now = {};
  for (const f of track) {
    const a = f.attributes, id = String(a.RecordID || "");
    if (!id) continue;
    now[id] = a.Status || "";
    const was = prev ? prev[id] : undefined;
    if (prev && was !== undefined && was === now[id]) continue;      // nothing moved
    const [lon, lat] = centre(f.geometry);
    appChanges.push({
      t: prev === null ? "application" : (was === undefined ? "application" : "application-status"),
      id, addr: String(a.PropertyAddress || a.RecordName || "").trim(),
      status: a.Status || "", was: was === undefined ? null : was,
      desc: [a.RecordType, a.Description].filter(Boolean).join(" · ").slice(0, 160),
      hearing: a.NextHearingDate || null, body: a.HearingBody || null,
      url: a.Website || null, lon, lat,
    });
  }
  fs.writeFileSync(trackFile, JSON.stringify(now));
  if (!prev) { console.log("  first run: baseline recorded, nothing to report yet"); appChanges = []; }
  else console.log("  new or moved since last run:", appChanges.length);
}

console.log("reading Boise rezone and entitlement cases...");
const zaFile = STATE + "zoneacts.json";
let zoneChanges = [];
const za = await pullAll("PDS_Zoning_Activities/FeatureServer/0",
  "RecordID,RecordName,Status,StatusCategory,ProjectType,ProposedUse,ProposedUseCategory,ProposedUnitsTotal,FullAddress,ZoningDistrict,ReviewAuthority,Description,CRCompleteDate");
console.log("  zoning activities:", za.length, "cases");
if (za.length) {
  const prev = fs.existsSync(zaFile) ? JSON.parse(fs.readFileSync(zaFile, "utf8")) : null;
  const now = {};
  for (const f of za) {
    const a = f.attributes, id = String(a.RecordID || "");
    if (!id) continue;
    now[id] = a.Status || "";
    const was = prev ? prev[id] : undefined;
    if (prev && was !== undefined && was === now[id]) continue;
    const [lon, lat] = centre(f.geometry);
    zoneChanges.push({
      t: was === undefined ? "rezone" : "rezone-status",
      id, addr: String(a.FullAddress || a.RecordName || "").trim(),
      status: a.Status || "", was: was === undefined ? null : was,
      desc: [a.ProjectType, a.ProposedUse, a.Description].filter(Boolean).join(" · ").slice(0, 160),
      units: a.ProposedUnitsTotal && +a.ProposedUnitsTotal > 0 ? +a.ProposedUnitsTotal : null,
      zone: a.ZoningDistrict || null, lon, lat,
    });
  }
  fs.writeFileSync(zaFile, JSON.stringify(now));
  if (!prev) { console.log("  first run: baseline recorded, nothing to report yet"); zoneChanges = []; }
  else console.log("  new or moved since last run:", zoneChanges.length);
}

/* ── publish ─────────────────────────────────────────────────────────── */
// Kept to a bounded size so the app never has to swallow an unbounded file.
const MAXV = 4000, MAXP = 1500;
const prevPub = fs.existsSync(PUB + "changes.json") ? JSON.parse(fs.readFileSync(PUB + "changes.json", "utf8")) : { items: [] };
const fresh = [...valueChanges.slice(0, MAXV), ...permitChanges.slice(0, MAXP),
               ...appChanges.slice(0, 3000), ...zoneChanges.slice(0, 3000)].map((c) => ({ ...c, seen: Date.now() }));
const merged = [...fresh, ...(prevPub.items || [])]
  .filter((c) => Date.now() - (c.seen || 0) < 120 * 86400000)
  .slice(0, 20000);
fs.writeFileSync(PUB + "changes.json", JSON.stringify({ v: 1, built: Date.now(), count: merged.length, items: merged }));
console.log("changes.json:", merged.length, "entries,",
            (fs.statSync(PUB + "changes.json").size / 1024).toFixed(0), "KB");
