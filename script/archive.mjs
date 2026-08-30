// THE ARCHIVE. The one asset here that cannot be bought later at any price.
//
// Every source this file watches is a WINDOW, not a record. Boise's development
// tracker shows what a project's status is today; tomorrow it overwrites that
// cell and yesterday is gone. The county does the same with assessed values.
// Nobody keeps the past, including the people who own the data.
//
// So this keeps it. Once a day it reads each source, compares it against what
// was there last time, and APPENDS what moved to a file that is never rewritten
// and never trimmed. In two years that file answers questions no amount of
// money can answer from the sources themselves: how long did this project sit
// in review, how many times did it get sent back, what did this parcel's value
// do every year, who quietly disappeared off the tracker in March.
//
// Three rules make it trustworthy:
//   1. APPEND ONLY. Nothing in these files is ever edited or deleted. A wrong
//      line stays and gets a correcting line after it.
//   2. SELF HEALING. Current state is REPLAYED from the archive itself, not
//      kept in a cache beside it. A lost cache costs nothing. Losing the
//      archive is the only thing that hurts, and it lives in git history.
//   3. REFUSE A COLLAPSE. If a source answers with implausibly little, the
//      whole source is skipped for the day. Recording 1,038 disappearances
//      because an API had a bad morning would poison the record permanently.
//
// Dates are Phoenix dates. A run at 6pm Phoenix is the 30th, not the 31st.
import fs from "fs";
import { ARCHIVE_ROOT, today, iso, replay, commit } from "./arclib.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const ARC = ARCHIVE_ROOT(ROOT);
const DAY = today();

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "ArgusArchive/1.0" }, signal: AbortSignal.timeout(90000) });
      if (r.status === 429 || r.status >= 500) throw new Error("HTTP " + r.status);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (i === tries - 1) { console.log("    give up:", url.slice(0, 90), e.message); return null; }
      await new Promise((z) => setTimeout(z, 2000 * Math.pow(2, i)));
    }
  }
}

// Pull an ArcGIS layer completely, in pages.
async function pull(base, fields, geom) {
  const out = [];
  let offset = 0;
  for (;;) {
    const j = await getJSON(base + "/query?where=1%3D1&outFields=" + encodeURIComponent(fields)
      + "&outSR=4326&returnGeometry=" + (geom ? "true" : "false")
      + "&geometryPrecision=6&f=json&resultOffset=" + offset + "&resultRecordCount=2000");
    if (!j || !j.features || !j.features.length) break;
    out.push(...j.features);
    offset += j.features.length;
    if (!j.exceededTransferLimit && j.features.length < 2000) break;
    if (offset > 500000) break;
  }
  return out;
}

/* ── the sources ───────────────────────────────────────────────────────── */
const BOISE = "https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/";
const ADA = "https://services2.arcgis.com/dgGjZc6xAH5m5JyP/arcgis/rest/services/";

// Blank and null mean the same thing to a diff, so they are made the same.
const s = (v) => { const t = v == null ? "" : String(v).trim(); return t === "" ? null : t; };
const n = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);

console.log("archive run for " + iso(DAY) + " (Phoenix)\n");

/* Planning applications. The earliest public signal that exists: a project is
   in here the day it is filed, months before ground moves or a price does. */
console.log("Boise development tracker...");
{
  const rows = await pull(BOISE + "Development_Tracker_Open_Data/FeatureServer/0",
    "RecordID,RecordName,Status,RecordType,PropertyAddress,ReviewAuthority,NextHearingDate,HearingBody,Website,AddToTrackerDate,Description", true);
  const now = new Map();
  for (const f of rows) {
    const a = f.attributes || {}, id = s(a.RecordID);
    if (!id) continue;
    const g = f.geometry, r = g && ((g.rings && g.rings[0]) || (g.paths && g.paths[0]));
    let lon = g && g.x != null ? +g.x.toFixed(6) : null, lat = g && g.y != null ? +g.y.toFixed(6) : null;
    if (r && r.length) { lon = +(r.reduce((t, p) => t + p[0], 0) / r.length).toFixed(6); lat = +(r.reduce((t, p) => t + p[1], 0) / r.length).toFixed(6); }
    now.set(id, {
      name: s(a.RecordName), status: s(a.Status), type: s(a.RecordType),
      addr: s(a.PropertyAddress), auth: s(a.ReviewAuthority),
      hearing: n(a.NextHearingDate), body: s(a.HearingBody),
      url: s(a.Website), filed: n(a.AddToTrackerDate), desc: s(a.Description),
      lon, lat,
    });
  }
  commit(ARC, "tracker", DAY, now, 500);
}

/* Rezone and entitlement cases, with the unit counts being asked for. */
console.log("Boise zoning activities...");
{
  const rows = await pull(BOISE + "PDS_Zoning_Activities/FeatureServer/0",
    "RecordID,RecordName,Status,StatusCategory,ProjectType,ProposedUse,ProposedUseCategory,ProposedUnitsTotal,FullAddress,ZoningDistrict,ReviewAuthority,Description,CRCompleteDate", true);
  const now = new Map();
  for (const f of rows) {
    const a = f.attributes || {}, id = s(a.RecordID);
    if (!id) continue;
    const g = f.geometry, r = g && ((g.rings && g.rings[0]) || (g.paths && g.paths[0]));
    let lon = g && g.x != null ? +g.x.toFixed(6) : null, lat = g && g.y != null ? +g.y.toFixed(6) : null;
    if (r && r.length) { lon = +(r.reduce((t, p) => t + p[0], 0) / r.length).toFixed(6); lat = +(r.reduce((t, p) => t + p[1], 0) / r.length).toFixed(6); }
    now.set(id, {
      name: s(a.RecordName), status: s(a.Status), cat: s(a.StatusCategory),
      ptype: s(a.ProjectType), use: s(a.ProposedUse), usecat: s(a.ProposedUseCategory),
      units: n(a.ProposedUnitsTotal), addr: s(a.FullAddress), zone: s(a.ZoningDistrict),
      auth: s(a.ReviewAuthority), desc: s(a.Description), complete: n(a.CRCompleteDate),
      lon, lat,
    });
  }
  commit(ARC, "zoneacts", DAY, now, 1000);
}

/* Permits. What actually got approved, and what got knocked down. */
console.log("Boise permits and demolitions...");
{
  const now = new Map();
  for (const [layer, kind] of [[0, "permit"], [1, "demolition"]]) {
    const rows = await pull(BOISE + "Housing_OpenData/FeatureServer/" + layer, "*", true);
    for (const f of rows) {
      const a = f.attributes || {}, id = kind + ":" + s(a.RecordID || a.OBJECTID);
      if (!id) continue;
      const g = f.geometry;
      now.set(id, {
        kind, addr: s(a.PropertyAddress), status: s(a.PermitStatus || a.Status),
        issued: n(a.IssuedDate), received: n(a.ReceiveDate),
        type: s([a.ResidentialType, a.ResidentialSubtype].filter(Boolean).join(" ")),
        units: n(a.LivingUnits || a.Units),
        lon: g && g.x != null ? +g.x.toFixed(6) : null,
        lat: g && g.y != null ? +g.y.toFixed(6) : null,
      });
    }
  }
  commit(ARC, "permits", DAY, now, 1000);
}

/* Assessed value, every parcel in Ada County. Most days this moves almost
   nothing. Once a year it moves everything, and that is the year that matters. */
console.log("Ada County assessed values...");
{
  const rows = await pull(ADA + "Parcels/FeatureServer/5", "PARCEL,TOTALVALUE", false);
  const now = new Map();
  for (const f of rows) {
    const a = f.attributes || {}, id = s(a.PARCEL);
    if (id) now.set(id, Math.round(+a.TOTALVALUE || 0));
  }
  commit(ARC, "values", DAY, now, 100000);
}

/* ── what the archive is worth now ─────────────────────────────────────── */
console.log("\narchive on disk:");
let total = 0, oldest = null;
for (const name of fs.readdirSync(ARC).filter((d) => fs.statSync(ARC + d).isDirectory()).sort()) {
  const { count, since } = replay(ARC, name);
  const days = fs.readdirSync(ARC + name).filter((f) => f.endsWith(".gz"));
  const kb = days.reduce((t, f) => t + fs.statSync(ARC + name + "/" + f).size, 0) / 1024;
  total += count;
  if (since !== null && (oldest === null || since < oldest)) oldest = since;
  console.log("  " + name.padEnd(10) + String(count).padStart(9) + " lines  "
    + (kb > 1024 ? (kb / 1024).toFixed(1) + " MB" : kb.toFixed(0) + " KB").padStart(9)
    + "  " + String(days.length).padStart(4) + " day" + (days.length === 1 ? " " : "s")
    + "  since " + iso(since));
}
const span = oldest ? Math.round((Date.parse(iso(DAY)) - Date.parse(iso(oldest))) / 86400000) + 1 : 0;
console.log("  " + "TOTAL".padEnd(10) + String(total).padStart(9) + " lines covering "
  + span + " day" + (span === 1 ? "" : "s") + " nobody else kept");
