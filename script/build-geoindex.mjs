// Builds newsgeo.json: the place index the news job uses to work out WHERE a
// story is. Everything in it comes from the same public county data the map is
// built from, so it holds nothing private and is safe to publish in the clear.
//
// Three levels, coarse to fine:
//   city    -> the six Ada County cities, with their real polygon centroids
//   street  -> every named road, with the centre of its extent and a bbox
//   corridor-> streets that carry a lot of parcels, used to rank ambiguous hits
import fs from "fs";
const SRC = new URL("../idaho-power-board/mapdata.bin", import.meta.url).pathname;
const OUT = new URL("../pinboard-fresh/newsgeo.json", import.meta.url).pathname;

const bin = fs.readFileSync(SRC);
const ab = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length);
const hLen = new DataView(ab).getUint32(4, true);
const h = JSON.parse(Buffer.from(ab, 8, hLen).toString("utf8"));
const CTOR = { Int32Array, Int16Array, Uint8Array };
const V = {};
for (const [name, off, len, type] of h.sections) V[name] = new CTOR[type](ab, h.base + off, len / CTOR[type].BYTES_PER_ELEMENT);

// Quantized units back to degrees.
const q = h.q, bb = h.bb;
const lon = (qx) => +(bb[0] + qx / q).toFixed(6);
const lat = (qy) => +(bb[1] + qy / q).toFixed(6);

// --- cities -------------------------------------------------------------
const cities = h.cityNames.map((name, i) => ({ name, lon: lon(V.c_cx[i]), lat: lat(V.c_cy[i]) }));

// --- streets ------------------------------------------------------------
// Road geometry is origin + Int16 steps, same as everything else in the file.
const acc = new Map();
for (let i = 0; i < V.r_gn.length; i++) {
  const nm = h.roadNames[V.r_nm[i]];
  if (!nm) continue;
  let x = V.r_ox[i], y = V.r_oy[i];
  let x0 = x, y0 = y, x1 = x, y1 = y, sx = x, sy = y, n = 1;
  const st = V.r_st[i];
  for (let k = 1; k < V.r_gn[i]; k++) {
    x += V.r_dx[(st + k - 1) * 2]; y += V.r_dx[(st + k - 1) * 2 + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    sx += x; sy += y; n++;
  }
  let a = acc.get(nm);
  if (!a) { a = { x0, y0, x1, y1, sx: 0, sy: 0, n: 0, seg: 0 }; acc.set(nm, a); }
  if (x0 < a.x0) a.x0 = x0; if (x1 > a.x1) a.x1 = x1;
  if (y0 < a.y0) a.y0 = y0; if (y1 > a.y1) a.y1 = y1;
  a.sx += sx; a.sy += sy; a.n += n; a.seg++;
}
const streets = [...acc.entries()].map(([name, a]) => ({
  name,
  lon: lon(a.sx / a.n), lat: lat(a.sy / a.n),
  bb: [lon(a.x0), lat(a.y0), lon(a.x1), lat(a.y1)],
  seg: a.seg,
})).sort((p, r) => r.seg - p.seg);

// The county envelope, used to reject a story that is plainly somewhere else.
const out = { v: 1, built: new Date().toISOString(), county: "Ada", bbox: bb, cities, streets };
fs.writeFileSync(OUT, JSON.stringify(out));
console.log("cities:", cities.length, "| streets:", streets.length,
            "| newsgeo.json:", (fs.statSync(OUT).size / 1024).toFixed(0), "KB");
console.log("busiest streets:", streets.slice(0, 5).map((s) => s.name + " (" + s.seg + ")").join(", "));
