// Puts real substance on the land-use records added this week, and records the
// Van Auker finding.
//
// The thinness that mattered was not the whole database. It was 24 core
// records, 16 of them people I created from a roster with nothing behind them.
// A name and a seat is not intelligence. What an applicant actually faces in
// front of that body is.
import fs from "fs";
const DIR = new URL("../idaho-power-board", import.meta.url).pathname;
let src = fs.readFileSync(DIR + "/data.js", "utf8");
const A = src.indexOf("const NODES = ["), B = src.indexOf("\n];", A);
const NODES = JSON.parse(src.slice(A + "const NODES = ".length, B + 2));
const byId = new Map(NODES.map((n) => [n.id, n]));

// What every applicant faces, regardless of who is in the chair. True of the
// body, sourced from Idaho's Local Land Use Planning Act and the cities' own
// procedures, and the thing worth knowing before walking in.
const BODY = {
  kuna: "HOW THIS BODY WORKS: five members, appointed by the mayor and confirmed by council, serving fixed terms. It holds a public hearing on every rezone, conditional use permit and preliminary plat, then forwards a recommendation. Council makes the final decision but rarely reverses a unanimous recommendation. Under Idaho's Local Land Use Planning Act the commission must base its decision on the comprehensive plan and make written findings, which is the ground on which a refusal can be appealed.",
  eagle: "HOW THIS BODY WORKS: five members, appointed by the mayor and confirmed by council. It hears rezones, conditional use permits and preliminary plats in public session and forwards a recommendation to council. Idaho's Local Land Use Planning Act requires the decision to rest on the comprehensive plan and to be written down, so the plan designation on a parcel is the argument, not the commissioners' preferences.",
  star: "HOW THIS BODY WORKS: Star is governed by a mayor and four councillors on four-year terms. The council takes the final vote on annexation, rezoning and development agreements, on a recommendation from the planning and zoning commission and a staff report from the planning director. In a city this size the staff report carries unusual weight because there is no large professional planning bureaucracy behind it.",
  achd: "HOW THIS BODY WORKS: five commissioners elected countywide by district, four-year terms. ACHD owns every public road in Ada County outside the state highway system, so it decides access, approach permits, right-of-way dedication and impact fees. A development can hold a perfect zoning approval from a city and still be undeliverable if ACHD will not grant the access it needs. Its five-year work plan is the single best published forecast of where the county expects growth.",
  nampa: "HOW THIS BODY WORKS: nine members, appointed by the mayor and confirmed by council. It hears annexations, rezones and preliminary plats and forwards recommendations to council. Nampa is the largest city in Canyon County and the fastest-growing half of the valley, so this commission handles more raw-ground conversion than any other body in the two counties.",
};

const ADD = {
  "clark-bryan-kuna": [BODY.kuna, "TIMING: his term expires in May 2026, the earliest on the commission, so this seat turns over before any other Kuna seat."],
  "main-jim": [BODY.kuna, "TIMING: his term runs to April 2028, the longest currently held on the commission."],
  "hennis-dana": [BODY.kuna],
  "rossadillo-bobby": [BODY.kuna],
  "guerber-steve": [BODY.eagle],
  "mccauley-todd": [BODY.eagle],
  "smith-derek-eagle": [BODY.eagle],
  "oland-paul": [BODY.eagle],
  "wright-trent": [BODY.eagle],
  "nielsen-kevin": [BODY.star],
  "salmonsen-jennifer": [BODY.star, "AS COUNCIL PRESIDENT she presides when the mayor is absent, which on a four-member council means she can control the order and pace of a land-use hearing."],
  "wheelock-kevan": [BODY.star],
  "day-steve-star": [BODY.star],
  "yorgenson-chris": [BODY.star, "WHY THE CITY ATTORNEY MATTERS IN A LAND-USE FIGHT: Idaho's Local Land Use Planning Act constrains what a council may refuse and requires written findings. The attorney is the person who tells the council whether a refusal will survive an appeal, which is often what decides whether it refuses at all."],
  "field-ryan": ["FIRST CONTACT: the planning assistant routes applications, schedules hearings and answers pre-application questions. On a small-city staff this is the person who knows what the director will object to before anything is filed."],
  "mckinney-dave": [BODY.achd],
  "nilsson-patricia": [BODY.achd],
  "gold-miranda": [BODY.achd],
  "goldthorpe-kent": [BODY.achd],
  "ashby-rodney": [BODY.nampa, "WHAT A PLANNING DIRECTOR CONTROLS: the staff report, the conditions of approval attached to it, and how strictly the code is read. Two applications identical on paper can come back differently depending on the conditions the department attaches."],
  "vanauker-ron-jr": [BODY.nampa,
    "TENURE: he has sat on the Nampa commission since at least May 2021 and chaired it, moving and seconding on annexations, rezones and subdivision approvals throughout that period. That is four years of decisions on the fastest-converting ground in the valley.",
    "THE NAME, AND WHY IT IS WORTH AN HOUR OF YOUR TIME: Van Auker Companies is one of the Treasure Valley's largest industrial developers. Ron Van Auker began developing here in 1969 and built a portfolio of more than 2 million square feet of industrial buildings and 400 acres of development land, starting from Caldwell, in Canyon County. In May 2019 Adler Industrial bought that portfolio, over 80 properties, in what the buyer called perhaps the biggest deal in Idaho history. Whether the commission chair is of that family is NOT established here and is not claimed. But the name, the county and the generational suffix all line up, and if it is the same family then the chair of Nampa's land-use commission carries a development surname built on Canyon County ground."],
};

let touched = 0, lines = 0;
for (const [id, add] of Object.entries(ADD)) {
  const n = byId.get(id);
  if (!n) { console.log("  missing:", id); continue; }
  n.intel = n.intel || [];
  for (const line of add) if (!n.intel.includes(line)) { n.intel.push(line); lines++; }
  touched++;
}

// Van Auker Companies as a record in its own right.
if (!byId.has("org-vanauker")) {
  NODES.push({
    id: "org-vanauker", kind: "org", name: "Van Auker Companies",
    role: "Industrial and warehouse developer; built and held over 2M sq ft in the valley",
    tier: "B", segment: "developers", scope: "core", region: "Treasure Valley", sector: "Real Estate",
    verification: "verified", degree: 0,
    summary: "One of the Treasure Valley's largest industrial developers for half a century, built from Caldwell. Ron Van Auker started developing here in 1969 and assembled more than 2 million square feet of warehouse and industrial buildings plus 400 acres of development land, designing, constructing and managing the leases in house. The bulk of the portfolio was sold to Adler Industrial in 2019.",
    intel: [
      "THE BUILD: started developing in the Treasure Valley in 1969 from simple beginnings in Caldwell. Over fifty years the portfolio reached more than 2 million square feet of industrial buildings and 400 acres of development land.",
      "THE MODEL: designs, builds and manages the leases on everything it owns, with its own in-house construction company. A small organisation holding its own cost and schedule control, which is why it could hold rather than flip.",
      "THE EXIT: in May 2019 Adler Industrial closed on the Van Auker portfolio, more than 80 properties, described by Adler principal Mike Adler as perhaps one of the biggest deals in Idaho history. Adler Industrial is separately in this database and matched to ground at 10259 W Emerald St.",
      "WHY IT MATTERS HERE: warehouse and industrial is the quiet half of valley development, and this is the firm that shaped it. Its ground is where the jobs sit, which is what pulls housing after it.",
    ],
    flags: ["The relationship between this company's founding family and Ron Van Auker Jr., chair of the Nampa Planning and Zoning Commission, is NOT established. The names and the Canyon County origin line up; no source confirming a family link has been found and none is asserted."],
    worthBand: "$100M+", worthConfidence: "rough",
    netWorth: "No figure is published for the company or the family. BAND, ROUGH: a portfolio of more than 2 million square feet of industrial buildings plus 400 acres, the bulk of which sold in 2019 in a transaction the buyer called perhaps the largest in Idaho history, implies a nine-figure enterprise before any retained land. The band reflects the portfolio, not a published figure.",
  });
  console.log("added: Van Auker Companies");
}

src = src.slice(0, A) + "const NODES = " + JSON.stringify(NODES, null, 1) + ";" + src.slice(B + 3);
fs.writeFileSync(DIR + "/data.js", src);
console.log("records deepened:", touched, "| intel lines added:", lines, "| records now:", NODES.length);
const core = NODES.filter((n) => n.scope === "core");
console.log("core nearly-empty records now:", core.filter((n) => (n.intel || []).length <= 1).length, "(was 24)");
