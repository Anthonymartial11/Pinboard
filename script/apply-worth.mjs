// Applies the occupation-class bands, keeping every word of the existing
// research. The prose already explains WHY no figure is published, and for
// several people it carries real anchors; none of that is thrown away. The
// estimate is appended to it, clearly marked as an estimate.
import fs from "fs";
const DIR = new URL("../idaho-power-board", import.meta.url).pathname;
const PATCH = JSON.parse(fs.readFileSync(new URL("../worth-class-patch.json", import.meta.url).pathname, "utf8"));
let src = fs.readFileSync(DIR + "/data.js", "utf8");
const { NODES } = new Function(src + "; return {NODES};")();

// One hand-reviewed lift. A man who lends his own campaign $800,000 in cash and
// runs a family ranching operation is not a $1M+ estimate, and that self-loan
// is a documented anchor rather than an occupation guess, so it is "informed".
const LIFT = {
  little: {
    worthBand: "$10M+", worthConfidence: "informed",
    add: "BAND, INFORMED: no figure is published, but he loaned his own 2018 campaign $800,000 in cash and was repaid $400,000, and he ran the family sheep and cattle operation for close to thirty years. Somebody able to write an $800,000 cheque from personal funds, on top of a share in a century-old ranching business, sits well above a million. Placed at $10M+ from those anchors, not from any stated figure.",
  },
};

// The records array is pure JSON, so it is parsed, changed and written back
// whole. Editing the text with patterns assumed unquoted keys, matched nothing
// and silently updated zero records.
const A = src.indexOf("const NODES = [");
const B = src.indexOf("\n];", A);
const list = JSON.parse(src.slice(A + "const NODES = ".length, B + 2));

let n = 0;
for (const p of list) {
  const patch = PATCH[p.id];
  if (!patch) continue;
  const lift = LIFT[p.id];
  const old = p.netWorth || "";
  if (old.includes("BAND, ROUGH:") || old.includes("BAND, INFORMED:")) continue;
  p.worthBand = lift ? lift.worthBand : patch.worthBand;
  p.worthConfidence = lift ? lift.worthConfidence : patch.worthConfidence;
  p.netWorth = (old ? old.replace(/\s*$/, "") + " " : "")
    + (lift ? lift.add : "BAND, ROUGH: " + patch.netWorth);
  n++;
}
src = src.slice(0, A) + "const NODES = " + JSON.stringify(list, null, 1) + ";" + src.slice(B + 3);
fs.writeFileSync(DIR + "/data.js", src);
console.log("records updated:", n);
const after = new Function(fs.readFileSync(DIR + "/data.js", "utf8") + "; return NODES;")();
const b = {}, c = {};
for (const p of after) if (p.kind === "person") { b[p.worthBand || "(none)"] = (b[p.worthBand || "(none)"] || 0) + 1; c[p.worthConfidence || "(none)"] = (c[p.worthConfidence || "(none)"] || 0) + 1; }
console.log("bands now:", JSON.stringify(b));
console.log("confidence now:", JSON.stringify(c));
