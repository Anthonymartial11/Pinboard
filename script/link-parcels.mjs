// Cross-references the 698 records against the 239,717 county parcels and
// writes the links into the app payload.
//
// WHAT THIS IS AND IS NOT. Ada County publishes no owner name on any of its
// GIS services, and the Assessor's own lookup sits behind a reCAPTCHA, so
// there is no lawful bulk source of ownership. Everything below is therefore
// OCCUPANCY, not ownership: an address that appears in a record, matched to
// the lot that address sits on. "Kidder Mathews is at 999 W Main" means their
// office is there. It does not mean they own the building, and the app must
// never say that it does.
import fs from "fs";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = ROOT + "idaho-power-board/";

/* ── parcels ─────────────────────────────────────────────────────────── */
const bin = fs.readFileSync(SRC + "mapdata.bin");
const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length);
const hLen = new DataView(ab).getUint32(4, true);
const h = JSON.parse(Buffer.from(ab, 8, hLen).toString("utf8"));
const CTOR = { Int32Array, Int16Array, Uint8Array };
const V = {};
for (const [n, o, l, t] of h.sections) V[n] = new CTOR[t](ab, h.base + o, l / CTOR[t].BYTES_PER_ELEMENT);
const strArr = (p) => {
  const off = V[p + "_off"], whole = new TextDecoder().decode(V[p + "_buf"]);
  const out = new Array(off.length - 1);
  for (let i = 0; i < out.length; i++) out[i] = whole.slice(off[i], off[i + 1]);
  return out;
};
const ADDRS = strArr("p_ad"), PIDS = strArr("p_id");

// Parcel centres, so a link can jump the map without the map being loaded.
function centre(i) {
  let x = V.p_ox[i], y = V.p_oy[i];
  let x0 = x, y0 = y, x1 = x, y1 = y;
  const st = V.p_st[i];
  for (let k = 1; k < V.p_gn[i]; k++) {
    x += V.p_dx[(st + k - 1) * 2]; y += V.p_dx[(st + k - 1) * 2 + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [+(h.bb[0] + (x0 + x1) / 2 / h.q).toFixed(6), +(h.bb[1] + (y0 + y1) / 2 / h.q).toFixed(6)];
}

/* ── address normalising ─────────────────────────────────────────────── */
const TYPE = { STREET: "ST", AVENUE: "AVE", ROAD: "RD", BOULEVARD: "BLVD", DRIVE: "DR",
  LANE: "LN", COURT: "CT", PARKWAY: "PKWY", HIGHWAY: "HWY", PLACE: "PL", CIRCLE: "CIR",
  TERRACE: "TER", TRAIL: "TRL" };
// A reporter writes "999 West Main Street"; the county writes "999 W MAIN ST".
const DIR = { NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W" };
function norm(s) {
  return s.toUpperCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").map((w) => TYPE[w] || DIR[w] || w).join(" ")
    .replace(/\s+(STE|SUITE|UNIT|APT|FL|FLOOR|BLDG)\s+\S+$/, "").trim();
}
// The same address without its compass letter, as a second chance: records
// often drop it ("501 Baybrook Ct" for "501 E BAYBROOK CT").
const undir = (k) => k.replace(/^(\d+)\s+[NSEW]\s+/, "$1 ");

const EXACT = new Map(), LOOSE = new Map();
for (let i = 0; i < ADDRS.length; i++) {
  const k = norm(ADDRS[i]);
  if (!k) continue;
  if (!EXACT.has(k)) EXACT.set(k, i);
  const u = undir(k);
  if (u !== k) { if (!LOOSE.has(u)) LOOSE.set(u, []); LOOSE.get(u).push(i); }
}

/* ── pulling addresses out of prose ──────────────────────────────────── */
const TYPES = "St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pkwy|Parkway|Hwy";
const RE = new RegExp("\\b(\\d{2,5})\\s+((?:[NSEW]\\.?|North|South|East|West)\\s+)?((?:[A-Z][A-Za-z'\\.]*\\s+){0,3}?)(" + TYPES + ")\\b", "g");
// "2024 Idaho Supreme Ct" is a case citation, not a building. So is "2021
// Supreme Court". Left in, they would place real people on unrelated lots,
// which is precisely the kind of confident error this database exists to
// avoid. Anything reading as a court, a session or a statute is refused.
const NOT_AN_ADDRESS = /\b(SUPREME|DISTRICT|CIRCUIT|APPEALS|APPELLATE|MAGISTRATE|PROBATE|JUVENILE|BANKRUPTCY|FEDERAL)\s+(CT|COURT)\b/i;

const src = fs.readFileSync(SRC + "data.js", "utf8");
const NODES = eval(src.slice(src.indexOf("const NODES = ") + 14, src.lastIndexOf("];") + 2));

const SITES = {};
let cand = 0, exact = 0, loose = 0, cited = 0, unmatched = 0;
const missed = [], looseLog = [];

for (const n of NODES) {
  const blob = [n.summary, (n.intel || []).join(" "), n.role, n.org].filter(Boolean).join("  ");
  const seen = new Set();
  for (const m of blob.matchAll(RE)) {
    const raw = m[0].replace(/\s+/g, " ").trim();
    if (NOT_AN_ADDRESS.test(raw)) { cited++; continue; }
    // "in 2012 St Luke's opened..." produces a number and a street type with
    // no street between them. There is no such address.
    if (!(m[3] || "").trim()) { cited++; continue; }
    const k = norm(raw);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    cand++;

    let i = EXACT.get(k), how = "exact";
    if (i === undefined) {
      const alts = LOOSE.get(undir(k));
      // Only accept a compass-less match when it is unambiguous. Two lots at
      // "501 Baybrook" on different sides of town is a coin flip, not a match.
      if (alts && alts.length === 1) { i = alts[0]; how = "no compass letter in the record"; loose++;
        looseLog.push(k + "  ->  " + ADDRS[alts[0]]); }
    } else exact++;

    if (i === undefined) { unmatched++; missed.push(k + "  <- " + n.name); continue; }
    const [lon, lat] = centre(i);
    (SITES[n.id] = SITES[n.id] || []).push({
      p: PIDS[i], a: ADDRS[i], v: V.p_vl[i], ac: +(V.p_ac[i] / 100).toFixed(2),
      lon, lat, how,
    });
  }
}

// Which buildings hold more than one tracked name. This is the part that is
// actually new: it is not in the records anywhere, it only appears once the
// addresses are put on the same map.
const byAddr = new Map();
for (const [id, sites] of Object.entries(SITES)) {
  for (const s of sites) {
    if (!byAddr.has(s.p)) byAddr.set(s.p, { a: s.a, v: s.v, lon: s.lon, lat: s.lat, who: [] });
    byAddr.get(s.p).who.push(id);
  }
}
const SHARED = [...byAddr.entries()].filter(([, x]) => x.who.length > 1)
  .map(([p, x]) => ({ p, ...x })).sort((a, b) => b.who.length - a.who.length);

fs.writeFileSync(SRC + "sites.js",
  "/* Generated by script/link-parcels.mjs. Occupancy, never ownership: an\n"
  + "   address named in a record, matched to the lot it stands on. Ada County\n"
  + "   publishes no owner field, so no claim of ownership is made anywhere. */\n"
  + "const SITES = " + JSON.stringify(SITES) + ";\n"
  + "const SHARED_SITES = " + JSON.stringify(SHARED) + ";\n");

console.log("addresses found in records:", cand + cited, "| rejected as case citations:", cited);
console.log("matched to a parcel:", exact + loose, "(" + exact + " exact, " + loose + " without a compass letter)");
console.log("records with at least one site:", Object.keys(SITES).length);
console.log("buildings holding more than one tracked name:", SHARED.length);
for (const s of SHARED) console.log("   " + s.a.padEnd(26) + " " + s.who.length + " names");
if (looseLog.length) { console.log("matched without a compass letter (each unambiguous):"); for (const l of looseLog) console.log("   " + l); }
console.log("unmatched:", unmatched);
for (const m of missed) console.log("   " + m);
