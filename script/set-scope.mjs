// Marks every record as core, statewide or context.
//
// A third of this database is Pocatello, Twin Falls, Ketchum, Coeur d'Alene
// and two Utah resorts. Each was defensible when it was added and none of it
// is on the owner's battlefield. Carrying it unlabelled made the database look
// thin in places where thinness costs nothing, and hid how complete the part
// that matters actually is.
//
//   core      Ada and Canyon: the two counties in scope
//   statewide acts from the capitol on the whole state, valley included
//   context   elsewhere in Idaho, or out of state: kept for background, not
//             to be deepened
import fs from "fs";
const DIR = new URL("../idaho-power-board", import.meta.url).pathname;
let src = fs.readFileSync(DIR + "/data.js", "utf8");
const A = src.indexOf("const NODES = ["), B = src.indexOf("\n];", A);
const NODES = JSON.parse(src.slice(A + "const NODES = ".length, B + 2));

const CORE_SEG = new Set(["canyon", "cityhalls", "ground", "developers", "realestate", "lawlobby",
  "tvwealth", "localgov", "establishment", "bsu", "emp-stlukes", "emp-alphonsus", "emp-micron",
  "money", "civic", "press", "machine", "emp-albertson", "emp-simplot", "emp-boren", "sports", "legacy"]);
const STATE_SEG = new Set(["statehouse", "legislature", "courts", "agencies", "movement", "federal",
  "statewide", "emp-federal", "emp-farmbureau", "emp-little"]);
const CONTEXT_SEG = new Set(["north", "east", "magic", "central", "tribes", "emp-hagadone",
  "emp-chobani", "emp-holding", "emp-cdatribe", "emp-inl", "emp-tull", "emp-ifg", "emp-melaleuca"]);
const FAR_REGION = new Set(["North Idaho", "Eastern Idaho", "East Idaho", "Magic Valley", "Central Idaho", "National"]);

const count = {};
for (const n of NODES) {
  let scope;
  if (n.jurisdiction) scope = "core";                       // acts in a named valley jurisdiction
  else if (n.region === "Treasure Valley" || n.region === "Canyon County") scope = "core";
  else if (FAR_REGION.has(n.region)) scope = "context";
  else if (CORE_SEG.has(n.segment)) scope = "core";
  else if (STATE_SEG.has(n.segment)) scope = "statewide";
  else if (CONTEXT_SEG.has(n.segment)) scope = "context";
  else scope = "statewide";
  n.scope = scope;
  count[scope] = (count[scope] || 0) + 1;
}
src = src.slice(0, A) + "const NODES = " + JSON.stringify(NODES, null, 1) + ";" + src.slice(B + 3);
fs.writeFileSync(DIR + "/data.js", src);
console.log("scope set:", JSON.stringify(count));

const thin = (list) => list.filter((n) => (n.intel || []).length <= 1).length;
for (const s of ["core", "statewide", "context"]) {
  const g = NODES.filter((n) => n.scope === s);
  const lines = g.reduce((a, n) => a + (n.intel || []).length, 0);
  console.log("  " + s.padEnd(10) + g.length + " records, " + (lines / g.length).toFixed(1) + " lines each, " + thin(g) + " nearly empty");
}
const core = NODES.filter((n) => n.scope === "core");
console.log("\nTHIN RECORDS THAT ACTUALLY MATTER (core, 1 line or fewer):");
for (const n of core.filter((x) => (x.intel || []).length <= 1))
  console.log("  [" + (n.tier || "-") + "] " + n.name.padEnd(30) + (n.role || "").slice(0, 50));
