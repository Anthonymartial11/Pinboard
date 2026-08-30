// Downloads the three layers that together describe where growth is ALLOWED to
// go next, as opposed to where it has already been:
//
//   Zoning          what a parcel may be used for today
//   Future Land Use what the city's comprehensive plan says it should become
//   Impact Areas    the ground a city expects to annex
//
// The gap between the first two, inside the third, is the entitlement
// pipeline. Land zoned agricultural whose own city plan calls it residential,
// sitting inside the annexation boundary, is land the city has already said it
// intends to convert. That is a public statement of future value, published
// years ahead, and almost nobody reads it parcel by parcel.
import fs from "fs";
const OUT = new URL("../pipeline", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const BASE = "https://services2.arcgis.com/dgGjZc6xAH5m5JyP/arcgis/rest/services";

async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (r.status === 429 || r.status >= 500) throw new Error("HTTP " + r.status);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (i === tries - 1) { console.log("   give up:", e.message); return null; }
      await new Promise((z) => setTimeout(z, 2000 * 2 ** i));
    }
  }
}

async function pull(name, path, fields) {
  const feats = [];
  let offset = 0;
  for (;;) {
    const url = BASE + "/" + path + "/query?where=1%3D1&outFields=" + encodeURIComponent(fields)
      + "&outSR=4326&geometryPrecision=6&f=json&resultOffset=" + offset + "&resultRecordCount=1000";
    const j = await getJSON(url);
    if (!j || !j.features || !j.features.length) break;
    feats.push(...j.features);
    offset += j.features.length;
    if (!j.exceededTransferLimit && j.features.length < 1000) break;
    if (offset > 60000) break;
  }
  fs.writeFileSync(OUT + "/" + name + ".json", JSON.stringify(feats));
  console.log("  " + name + ":", feats.length, "polygons",
    "(" + (fs.statSync(OUT + "/" + name + ".json").size / 1048576).toFixed(1) + " MB)");
  return feats.length;
}

console.log("current zoning");
await pull("zoning", "Zoning/FeatureServer/22", "BASEZONE,CITY,ZONING");

console.log("what the comprehensive plans say it becomes");
for (const [name, svc] of [
  ["flu_ada", "Ada_County_Future_Land_Use"], ["flu_boise", "Boise_Future_Land_Use"],
  ["flu_meridian", "Meridian_Future_Land_Use"], ["flu_eagle", "Eagle_Future_Land_Use"],
  ["flu_star", "Star_Future_Land_Use"], ["flu_gardencity", "Garden_City_Future_Land_Use"],
  ["flu_avimor", "Avimor_Future_Land_Use"], ["flu_cartwright", "Cartwright_Ranch_Future_Land_Use"],
  ["flu_drycreek", "Dry_Creek_Ranch_Future_Land_Use"],
]) await pull(name, svc + "/FeatureServer/0", "*");

console.log("where the cities intend to annex");
await pull("impact", "Impact_Areas/FeatureServer/0", "CITY,ACRES");
