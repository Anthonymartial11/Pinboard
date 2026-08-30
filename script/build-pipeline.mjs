// Works out, parcel by parcel, whether the city has already said in writing
// that this ground should become something else.
//
// Three facts per parcel: what it is zoned today, what the comprehensive plan
// says it should become, and whether it sits inside the boundary a city
// expects to annex. Where a rural or holding zone meets an urban plan
// designation inside an annexation boundary, the conversion has been announced
// years ahead in a public document and simply has not happened yet.
import fs from "fs";
const ROOT = new URL("..", import.meta.url).pathname;
const PIPE = ROOT + "pipeline/";

// ── parcel centroids, out of the map file we already ship ──────────────
const bin = fs.readFileSync(ROOT + "idaho-power-board/mapdata.bin");
const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length);
const hLen = new DataView(ab).getUint32(4, true);
const h = JSON.parse(Buffer.from(ab, 8, hLen).toString("utf8"));
const CTOR = { Int32Array, Int16Array, Uint8Array };
const V = {};
for (const [n, o, l, t] of h.sections) V[n] = new CTOR[t](ab, h.base + o, l / CTOR[t].BYTES_PER_ELEMENT);
const N = h.n;
const cx = new Float64Array(N), cy = new Float64Array(N);
for (let i = 0; i < N; i++) {
  let x = V.p_ox[i], y = V.p_oy[i], x0 = x, y0 = y, x1 = x, y1 = y;
  const st = V.p_st[i];
  for (let k = 1; k < V.p_gn[i]; k++) {
    x += V.p_dx[(st + k - 1) * 2]; y += V.p_dx[(st + k - 1) * 2 + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  cx[i] = h.bb[0] + (x0 + x1) / 2 / h.q;
  cy[i] = h.bb[1] + (y0 + y1) / 2 / h.q;
}
console.log("parcel centroids:", N.toLocaleString());

// ── a grid index over polygons, so 239,717 lookups stay cheap ──────────
function index(features, valueOf) {
  const items = [];
  for (const f of features) {
    const v = valueOf(f);
    if (!v) continue;
    const rings = f.geometry && f.geometry.rings;
    if (!rings) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) for (const p of r) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    items.push({ v, rings, x0, y0, x1, y1 });
  }
  const G = 120, bb = h.bb;
  const cw = (bb[2] - bb[0]) / G, ch = (bb[3] - bb[1]) / G;
  const cells = new Map();
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    const a = Math.max(0, Math.floor((it.x0 - bb[0]) / cw)), b = Math.min(G - 1, Math.floor((it.x1 - bb[0]) / cw));
    const c = Math.max(0, Math.floor((it.y0 - bb[1]) / ch)), d = Math.min(G - 1, Math.floor((it.y1 - bb[1]) / ch));
    for (let r = c; r <= d; r++) for (let q = a; q <= b; q++) {
      const key = r * G + q;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(k);
    }
  }
  return { items, cells, G, cw, ch, bb };
}
function inRings(rings, px, py) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
function lookup(idx, px, py) {
  const q = Math.floor((px - idx.bb[0]) / idx.cw), r = Math.floor((py - idx.bb[1]) / idx.ch);
  if (q < 0 || r < 0 || q >= idx.G || r >= idx.G) return null;
  const bucket = idx.cells.get(r * idx.G + q);
  if (!bucket) return null;
  for (const k of bucket) {
    const it = idx.items[k];
    if (px < it.x0 || px > it.x1 || py < it.y0 || py > it.y1) continue;
    if (inRings(it.rings, px, py)) return it.v;
  }
  return null;
}

const load = (f) => JSON.parse(fs.readFileSync(PIPE + f + ".json", "utf8"));

console.log("indexing zoning, plans and annexation boundaries...");
const zIdx = index(load("zoning"), (f) => f.attributes.BASEZONE);
const impIdx = index(load("impact"), (f) => f.attributes.CITY);
// Each city writes its plan in its own field name.
const FLU = [
  ["flu_boise", "LandUse"], ["flu_meridian", "class2"], ["flu_eagle", "citycode"],
  ["flu_star", "Land_Use"], ["flu_gardencity", "ZONING"], ["flu_ada", "NAME"],
];
const fluIdx = FLU.map(([file, field]) => index(load(file), (f) => f.attributes[field]));

// ── what counts as a plan for development, and what counts as holding ──
const URBAN = /residential|commercial|industrial|mixed use|office|compact|suburban|high density|medium density|low density|old town|^mu-|cbd|live-work|town|neighborhood|multiple use|limited office/i;
const NOT_URBAN = /agricultur|rangeland|open space|park|quasi-public|public\/|school|civic|large lot|rural residential|areas of city impact|incorporated cities|green space|planned communities|state and federal/i;
// Zones that mean "nothing has been built here yet". RUT is Ada County's own
// Rural Urban Transition zone, which exists precisely to hold ground until a
// city takes it.
const HOLDING = /^(RUT|A|A-1|A-2|A-R|RR|R-R|RP|RSW|R-E)$/i;

const zone = new Array(N), plan = new Array(N), impact = new Array(N);
const signal = new Uint8Array(N);   // 0 none, 1 planned, 2 in the path, 3 announced
let done = 0;
for (let i = 0; i < N; i++) {
  const px = cx[i], py = cy[i];
  zone[i] = lookup(zIdx, px, py) || "";
  impact[i] = lookup(impIdx, px, py) || "";
  let p = null;
  for (const idx of fluIdx) { p = lookup(idx, px, py); if (p) break; }
  plan[i] = p || "";

  const holding = HOLDING.test(zone[i]);
  const urbanPlan = !!plan[i] && URBAN.test(plan[i]) && !NOT_URBAN.test(plan[i]);
  if (holding && urbanPlan && impact[i]) signal[i] = 3;
  else if (holding && urbanPlan) signal[i] = 2;
  else if (holding && impact[i]) signal[i] = 1;
  if (++done % 60000 === 0) console.log("  ", done.toLocaleString(), "parcels classified");
}

const counts = [0, 0, 0, 0];
for (let i = 0; i < N; i++) counts[signal[i]]++;
console.log("\nTHE PIPELINE");
console.log("  3 announced  (holding zone + urban plan + inside an annexation boundary):", counts[3].toLocaleString());
console.log("  2 planned    (holding zone + urban plan, outside any boundary):        ", counts[2].toLocaleString());
console.log("  1 in the path(holding zone inside an annexation boundary, no plan yet):", counts[1].toLocaleString());
console.log("  0 nothing                                                             :", counts[0].toLocaleString());

// Where the announced ground actually is, and what it is worth today.
const byCity = {};
for (let i = 0; i < N; i++) {
  if (signal[i] !== 3) continue;
  const c = impact[i] || "(none)";
  byCity[c] = byCity[c] || { n: 0, acres: 0, value: 0 };
  byCity[c].n++; byCity[c].acres += V.p_ac[i] / 100; byCity[c].value += V.p_vl[i];
}
console.log("\nANNOUNCED CONVERSION GROUND, by the city that intends to annex it:");
for (const [c, s] of Object.entries(byCity).sort((a, b) => b[1].acres - a[1].acres))
  console.log("  " + c.padEnd(14) + String(s.n).padStart(6) + " parcels  " + Math.round(s.acres).toLocaleString().padStart(8) + " acres  assessed $" + Math.round(s.value).toLocaleString());

fs.writeFileSync(PIPE + "signal.json", JSON.stringify({ zone, plan, impact, signal: Array.from(signal) }));
console.log("\nwritten to pipeline/signal.json");
