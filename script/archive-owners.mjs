// THE OWNERSHIP ROLL. Who the county says owns each of 195,677 parcels.
//
// This was written off twice as not existing. It does exist, it is public, and
// it was hiding inside a Boise bonus-zoning service under a layer plainly
// called "Ada County Parcels". It carries the owner's NAME and, far more
// usefully, the address the tax bill is posted to.
//
// The mailing address is the part that matters. A developer registers a
// separate company for every subdivision, so searching names finds a fraction
// of what they hold. Searching for everything that posts its tax bill to the
// same suite finds the rest, because somebody has to actually receive the post.
// On one Meridian office: 380 parcels carry the family name, and 817 mail to
// their door under 33 different names.
//
// TWO THINGS TO BE HONEST ABOUT, EVERY TIME THIS IS USED:
//   1. It is a 2021 snapshot. 195,287 rows say PROPYEAR 2021 and 391 say 2022.
//      Anything bought or sold since is wrong here. It is a baseline, not the
//      present, and it must never be shown as the present.
//   2. Sharing a mailing address is EVIDENCE, not ownership. A builder's
//      office also receives post for the homeowner associations it set up,
//      and an HOA common lot is not the builder's asset. The link is real; the
//      conclusion drawn from it has to be argued case by case.
//
// It is archived for the same reason as everything else here: the layer is
// somebody else's, it is already four years stale, and the day Boise retires
// it the only copy that still exists is the copy that was taken first.
import fs from "fs";
import { ARCHIVE_ROOT, today, commit } from "./arclib.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const ARC = ARCHIVE_ROOT(ROOT);
const DAY = today();

const SRC = "https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/"
  + "Activity_Center_Supportive_Bonus_WFL1/FeatureServer/4";
const FIELDS = "PARCEL,PROPYEAR,PRIMOWNER,SECOWNER,ADDCONCAT,CITY,STATE,ZIPCODE,ADDRESS,TOTALVALUE,ACRES,ZONING,SUBNM,PROPCODE";

async function getJSON(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "ArgusArchive/1.0" }, signal: AbortSignal.timeout(120000) });
      if (r.status === 429 || r.status >= 500) throw new Error("HTTP " + r.status);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (i === tries - 1) { console.log("  give up at this page:", e.message); return null; }
      await new Promise((z) => setTimeout(z, 2000 * Math.pow(2, i)));
    }
  }
}

// Every string field comes back padded out with spaces to a fixed width.
const t = (v) => { const s = v == null ? "" : String(v).trim(); return s === "" ? null : s; };
const n = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);

console.log("reading the Ada County ownership roll...");
const now = new Map();
let offset = 0, pages = 0;
for (;;) {
  const j = await getJSON(SRC + "/query?where=1%3D1&outFields=" + FIELDS
    + "&returnGeometry=false&f=json&resultOffset=" + offset + "&resultRecordCount=2000");
  if (!j || !j.features || !j.features.length) break;
  for (const f of j.features) {
    const a = f.attributes || {}, id = t(a.PARCEL);
    if (!id) continue;
    now.set(id, {
      owner: t(a.PRIMOWNER), owner2: t(a.SECOWNER),
      mail: t(a.ADDCONCAT), city: t(a.CITY), st: t(a.STATE), zip: t(a.ZIPCODE),
      site: t(a.ADDRESS), value: n(a.TOTALVALUE), acres: a.ACRES == null ? null : +(+a.ACRES).toFixed(3),
      zoning: t(a.ZONING), sub: t(a.SUBNM), code: t(a.PROPCODE), year: n(a.PROPYEAR),
    });
  }
  offset += j.features.length;
  if (++pages % 20 === 0) console.log("  " + offset.toLocaleString() + " parcels");
  if (!j.exceededTransferLimit && j.features.length < 2000) break;
  if (offset > 400000) break;
}
console.log("  read " + now.size.toLocaleString() + " parcels with an owner record");

const yrs = {};
for (const r of now.values()) yrs[r.year] = (yrs[r.year] || 0) + 1;
console.log("  vintage: " + Object.entries(yrs).sort().map(([k, v]) => k + " = " + v.toLocaleString()).join(", ")
  + "   (this is a SNAPSHOT, not the present)");

const res = commit(ARC, "owners", DAY, now, 150000);
if (res && !res.first) {
  const sold = res.changes.filter((c) => c.f === "owner");
  console.log("  parcels that CHANGED HANDS: " + sold.length);
  for (const x of sold.slice(0, 40)) console.log("    " + x.id + "  " + (x.a || "?") + "  ->  " + (x.b || "?"));
}
