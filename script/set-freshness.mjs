// Gives every record a sense of its own age.
//
// Nothing in this database knew how old it was. A roster from 2024 and a fact
// checked yesterday looked identical, which is worse than a visible gap: it
// reads as knowledge right up until it is wrong in a room. Two fields fix it:
//
//   asOf     the newest year the record's own prose cites. Inferred, not
//            claimed: it is the best evidence of when the research was current.
//   checked  a real date, set only where a source was actually re-read.
import fs from "fs";
const DIR = new URL("../idaho-power-board", import.meta.url).pathname;
let src = fs.readFileSync(DIR + "/data.js", "utf8");
const A = src.indexOf("const NODES = ["), B = src.indexOf("\n];", A);
const NODES = JSON.parse(src.slice(A + "const NODES = ".length, B + 2));

// Records touched in this week's land-use and ownership work were read from a
// live source, so they carry a real checked date rather than an inference.
const CHECKED_TODAY = new Set(["hennis-dana", "clark-bryan-kuna", "main-jim", "rossadillo-bobby",
  "wright-trent", "guerber-steve", "mccauley-todd", "smith-derek-eagle", "oland-paul",
  "nickel-shawn", "field-ryan", "yorgenson-chris", "nielsen-kevin", "salmonsen-jennifer",
  "wheelock-kevan", "day-steve-star", "nilsson-patricia", "gold-miranda", "goldthorpe-kent",
  "mckinney-dave", "lorcher-maria", "gelsomino-dom", "stoll-matthew", "sandoval-matthew",
  "smith-jared-meridian", "perreault-jessica", "hood-caleb", "ashby-rodney", "vanauker-ron-jr",
  "nederend-family", "org-vanauker", "little", "jb-scott", "jamie-jo-scott", "turnbull", "clyde-avimor", "moyle"]);
const TODAY = new Date().toISOString().slice(0, 10);
const THIS_YEAR = new Date().getFullYear();

let dated = 0, undated = 0, stale = 0;
for (const n of NODES) {
  const text = [n.summary, n.netWorth, (n.intel || []).join(" "), (n.flags || []).join(" ")].filter(Boolean).join(" ");
  const years = (text.match(/\b(19|20)\d\d\b/g) || []).map(Number).filter((y) => y >= 1990 && y <= THIS_YEAR + 1);
  n.asOf = years.length ? Math.max(...years) : null;
  if (CHECKED_TODAY.has(n.id)) n.checked = TODAY;
  if (n.asOf) dated++; else undated++;
  // Two years without a cited date, on a record about a living arrangement,
  // is long enough that a roster, a title or a term will have moved.
  if (!n.checked && (!n.asOf || n.asOf <= THIS_YEAR - 2)) { n.stale = true; stale++; }
  else delete n.stale;
}
src = src.slice(0, A) + "const NODES = " + JSON.stringify(NODES, null, 1) + ";" + src.slice(B + 3);
fs.writeFileSync(DIR + "/data.js", src);
console.log("records with an inferred asOf year:", dated, "| no year cited at all:", undated);
console.log("checked against a live source this week:", NODES.filter((n) => n.checked).length);
console.log("flagged stale (nothing newer than " + (THIS_YEAR - 2) + ", never re-checked):", stale);
const core = NODES.filter((n) => n.scope === "core");
console.log("  of which core:", core.filter((n) => n.stale).length, "of", core.length);
const byYear = {};
for (const n of NODES) if (n.asOf) byYear[n.asOf] = (byYear[n.asOf] || 0) + 1;
console.log("newest year cited, by count:", JSON.stringify(Object.fromEntries(Object.entries(byYear).sort((a, b) => b[0] - a[0]).slice(0, 6))));
