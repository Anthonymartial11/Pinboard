// First batch of the land-use expansion: the people who actually decide what
// gets built in Star, Kuna and Eagle, plus the county road commission.
//
// Two new fields go on every record here and will be backfilled elsewhere:
//   jurisdiction - which city, district or board they act in, so "everyone who
//                  touches a decision in Star" is one filter rather than a
//                  judgement call baked into the data
//   control      - what they can actually DO. Voting on a rezone, writing the
//                  staff report that decides it beforehand, and signing off on
//                  road access are three different powers.
import fs from "fs";
const DIR = new URL("../idaho-power-board", import.meta.url).pathname;
let src = fs.readFileSync(DIR + "/data.js", "utf8");
const A = src.indexOf("const NODES = ["), B = src.indexOf("\n];", A);
const NODES = JSON.parse(src.slice(A + "const NODES = ".length, B + 2));
const have = new Set(NODES.map((n) => n.id));

const ROUGH_LOW = "No personal financial data is published for this person. Occupation-class estimate only: this is a part-time or modestly paid appointed or elected seat. Nothing suggests wealth beyond an ordinary house and savings. The band reflects the class, not any figure about this individual. BAND, ROUGH.";
const ROUGH_MID = "No personal financial data is published for this person. Occupation-class estimate only: senior municipal staff in the valley are paid roughly $100,000 to $160,000, and a full career at that level ends in home equity plus a PERSI pension whose capital value alone passes $1M. The band reflects the class, not any figure about this individual. BAND, ROUGH.";

const P = (o) => Object.assign({
  kind: "person", tier: "C", segment: "ground", verification: "verified",
  degree: 0, worthBand: "Under $1M", worthConfidence: "rough", netWorth: ROUGH_LOW,
  intel: [], flags: [],
}, o);

const NEW = [
  // ── Kuna Planning and Zoning ──────────────────────────────────────────
  P({ id: "hennis-dana", name: "Dana Hennis", role: "Chairman, Kuna Planning and Zoning Commission", org: "City of Kuna",
      jurisdiction: "Kuna", control: "Votes on rezones, conditional use and subdivision preliminary plats in Kuna",
      summary: "Chairs the five-member body that hears every rezone, conditional use permit and preliminary plat in Kuna before it reaches the council. Term runs to January 2027.",
      intel: ["ROLE: Chairman of the Kuna Planning and Zoning Commission, a five-member body appointed by the mayor and confirmed by council. Term expires January 2027 (city roster).",
              "WHY THIS SEAT MATTERS: Kuna is the least built-out of the Ada County cities with sewer capacity, so raw ground still changes hands here at entry-level prices. This commission is the first vote any of it has to pass."] }),
  P({ id: "clark-bryan-kuna", name: "Bryan Clark", role: "Vice Chairman, Kuna Planning and Zoning Commission", org: "City of Kuna",
      jurisdiction: "Kuna", control: "Votes on rezones, conditional use and subdivision preliminary plats in Kuna",
      summary: "Vice chair of the Kuna Planning and Zoning Commission. Term expires May 2026, which makes his seat the next one to turn over.",
      intel: ["ROLE: Vice Chairman, Kuna Planning and Zoning Commission. Term expires May 2026 (city roster), the earliest expiry on the commission."] }),
  P({ id: "main-jim", name: "Jim Main", role: "Commissioner, Kuna Planning and Zoning Commission", org: "City of Kuna",
      jurisdiction: "Kuna", control: "Votes on rezones, conditional use and subdivision preliminary plats in Kuna",
      summary: "Kuna Planning and Zoning commissioner, holding the longest current term on the body, to April 2028.",
      intel: ["ROLE: Commissioner, Kuna Planning and Zoning Commission. Term expires April 2028 (city roster)."] }),
  P({ id: "rossadillo-bobby", name: "Bobby Rossadillo", role: "Commissioner, Kuna Planning and Zoning Commission", org: "City of Kuna",
      jurisdiction: "Kuna", control: "Votes on rezones, conditional use and subdivision preliminary plats in Kuna",
      summary: "Kuna Planning and Zoning commissioner, term to March 2027.",
      intel: ["ROLE: Commissioner, Kuna Planning and Zoning Commission. Term expires March 2027 (city roster).",
              "COMMISSION VACANCY: the city roster shows a fifth seat unfilled, so four people are currently deciding Kuna land use."] }),

  // ── Eagle Planning and Zoning ─────────────────────────────────────────
  P({ id: "wright-trent", name: "Trent Wright", role: "Chairman, Eagle Planning and Zoning Commission", org: "City of Eagle",
      jurisdiction: "Eagle", control: "Votes on rezones, conditional use and preliminary plats in Eagle",
      summary: "Chairs the commission that hears Eagle land use before council, in the city with the valley's most contested foothills development.",
      intel: ["ROLE: Chairman, Eagle Planning and Zoning Commission, five members appointed by the mayor and confirmed by council (city roster).",
              "WHY THIS SEAT MATTERS: Eagle contains Avimor and the foothills ground north of it, the largest privately held block in this database."] }),
  P({ id: "guerber-steve", name: "Steve Guerber", role: "Vice-Chairman, Eagle Planning and Zoning Commission", org: "City of Eagle",
      jurisdiction: "Eagle", control: "Votes on rezones, conditional use and preliminary plats in Eagle",
      summary: "Vice chair of the Eagle Planning and Zoning Commission.",
      intel: ["ROLE: Vice-Chairman, Eagle Planning and Zoning Commission (city roster)."],
      flags: ["A Steve Guerber served as mayor of Eagle historically. Whether that is the same person as this commissioner has NOT been confirmed from a source naming both, and is not asserted here."] }),
  P({ id: "mccauley-todd", name: "Todd McCauley", role: "Commissioner, Eagle Planning and Zoning Commission", org: "City of Eagle",
      jurisdiction: "Eagle", control: "Votes on rezones, conditional use and preliminary plats in Eagle",
      summary: "Eagle Planning and Zoning commissioner.",
      intel: ["ROLE: Commissioner, Eagle Planning and Zoning Commission (city roster)."] }),
  P({ id: "smith-derek-eagle", name: "Derek Smith", role: "Commissioner, Eagle Planning and Zoning Commission", org: "City of Eagle",
      jurisdiction: "Eagle", control: "Votes on rezones, conditional use and preliminary plats in Eagle",
      summary: "Eagle Planning and Zoning commissioner.",
      intel: ["ROLE: Commissioner, Eagle Planning and Zoning Commission (city roster)."] }),
  P({ id: "oland-paul", name: "Paul Oland", role: "Commissioner, Eagle Planning and Zoning Commission", org: "City of Eagle",
      jurisdiction: "Eagle", control: "Votes on rezones, conditional use and preliminary plats in Eagle",
      summary: "Eagle Planning and Zoning commissioner.",
      intel: ["ROLE: Commissioner, Eagle Planning and Zoning Commission (city roster)."],
      flags: ["WORTH CHECKING: a Paul Oland works as a land planner for applicants in the Treasure Valley. If that is the same person, he would be voting in a city where his day job files applications, which is exactly the kind of overlap worth confirming. Not asserted: no source naming both has been found."] }),

  // ── Star ──────────────────────────────────────────────────────────────
  P({ id: "nickel-shawn", name: "Shawn Nickel", role: "Planning Director and Zoning Administrator, City of Star", org: "City of Star",
      tier: "B", jurisdiction: "Star", control: "Writes the staff report and recommendation on every Star application, and administers the zoning code",
      worthBand: "$1M+", netWorth: ROUGH_MID,
      summary: "Runs planning for the fastest-growing city in Ada County by percentage. In practice the staff report he signs decides most applications before any commissioner votes, which makes this the most consequential unelected land-use seat in Star.",
      intel: ["ROLE: Planning Director and Zoning Administrator, City of Star (city planning page).",
              "WHY THIS SEAT MATTERS: a planning director's recommendation is the document a commission argues against rather than starts from. On routine applications it is effectively the decision."] }),
  P({ id: "field-ryan", name: "Ryan Field", role: "Planning Assistant, City of Star", org: "City of Star",
      tier: "D", jurisdiction: "Star", control: "Processes and routes Star planning applications",
      summary: "Planning assistant for the City of Star, the first point of contact on applications.",
      intel: ["ROLE: Planning Assistant, City of Star (city planning contact page)."] }),
  P({ id: "yorgenson-chris", name: "Chris Yorgenson", role: "City Attorney, City of Star", org: "City of Star",
      tier: "C", segment: "cityhalls", jurisdiction: "Star", control: "Advises Star council and commission on the legal limits of a land-use decision",
      worthBand: "$1M+", netWorth: ROUGH_MID,
      summary: "City attorney for Star, the person who tells the council what it can and cannot legally refuse.",
      intel: ["ROLE: City Attorney, City of Star (city directory)."] }),
  P({ id: "nielsen-kevin", name: "Kevin Nielsen", role: "Star City Council, Seat 1", org: "City of Star",
      segment: "cityhalls", jurisdiction: "Star", control: "Final vote on Star annexations, rezones and development agreements",
      summary: "Star city councillor, Seat 1. The council casts the final vote on annexation and rezoning in the fastest-growing city in the county.",
      intel: ["ROLE: Star City Council Seat 1. Star is governed by a mayor and four councillors, elected to four-year terms (city council page)."] }),
  P({ id: "salmonsen-jennifer", name: "Jennifer Salmonsen", role: "Council President, Star City Council, Seat 2", org: "City of Star",
      segment: "cityhalls", jurisdiction: "Star", control: "Final vote on Star annexations, rezones and development agreements; presides in the mayor's absence",
      summary: "Council President in Star, the senior voice on the body that gives final approval to annexation and rezoning.",
      intel: ["ROLE: Star City Council Seat 2 and Council President (city council page)."] }),
  P({ id: "wheelock-kevan", name: "Kevan Wheelock", role: "Star City Council, Seat 3", org: "City of Star",
      segment: "cityhalls", jurisdiction: "Star", control: "Final vote on Star annexations, rezones and development agreements",
      summary: "Star city councillor, Seat 3.",
      intel: ["ROLE: Star City Council Seat 3 (city council page)."] }),
  P({ id: "day-steve-star", name: "Steve Day", role: "Star City Council, Seat 4", org: "City of Star",
      segment: "cityhalls", jurisdiction: "Star", control: "Final vote on Star annexations, rezones and development agreements",
      summary: "Star city councillor, Seat 4.",
      intel: ["ROLE: Star City Council Seat 4 (city council page)."],
      flags: ["Distinct from Don Day, the founder of BoiseDev, who is a separate record in this database."] }),

  // ── Ada County Highway District ───────────────────────────────────────
  P({ id: "nilsson-patricia", name: "Patricia Nilsson", role: "ACHD Commissioner, District 1", org: "ACHD",
      tier: "B", jurisdiction: "Ada County (ACHD District 1)", control: "Votes on road access, impact fees and the project priority list that decides where growth is physically possible",
      verification: "partial",
      summary: "One of five people who set Ada County road policy. ACHD controls access, and access decides whether ground can be developed at all, which makes this body a gate on every project in the county.",
      intel: ["ROLE: ACHD Commissioner for District 1.",
              "WHY THIS BODY MATTERS: ACHD owns every public road in Ada County outside the state highway system. Its access decisions and its five-year work plan determine which ground is buildable and when."],
      flags: ["Roster taken from a search summary of ACHD's own commission page, which blocks automated reading. Confirm the district assignment against ACHD directly before relying on it."] }),
  P({ id: "gold-miranda", name: "Miranda Gold", role: "ACHD Commissioner, District 3", org: "ACHD",
      tier: "B", jurisdiction: "Ada County (ACHD District 3)", control: "Votes on road access, impact fees and the project priority list",
      verification: "partial",
      summary: "ACHD commissioner for District 3, reported as commission president as of April 2025. The commission elects its president each January.",
      intel: ["ROLE: ACHD Commissioner, District 3. Reported as Commission President as of April 2025.",
              "LEADERSHIP TURNS OVER ANNUALLY: the board elects a president and vice president each January, so the chair is a moving target worth re-checking."],
      flags: ["Whether she still holds the presidency in 2026 is unconfirmed. Roster from a search summary of ACHD's own page, which blocks automated reading."] }),
  P({ id: "goldthorpe-kent", name: "Kent Goldthorpe", role: "ACHD Commissioner, District 4", org: "ACHD",
      tier: "B", jurisdiction: "Ada County (ACHD District 4)", control: "Votes on road access, impact fees and the project priority list",
      verification: "partial",
      summary: "Long-serving ACHD commissioner, twice commission president, censured by his own board in April 2025 over remarks he made.",
      intel: ["ROLE: ACHD Commissioner, District 4. Has served twice as commission president.",
              "CENSURED: BoiseDev reported in April 2025 that the commission censured him over offensive comments. A censure by a member's own board is a standing weakness in any negotiation he is part of."],
      flags: ["Roster and censure both from search summaries; the censure is reported by BoiseDev (April 2025). Confirm the detail of the censure before relying on it."] }),
  P({ id: "mckinney-dave", name: "Dave McKinney", role: "ACHD Commissioner, District 5", org: "ACHD",
      tier: "B", jurisdiction: "Ada County (ACHD District 5)", control: "Votes on road access, impact fees and the project priority list",
      verification: "partial",
      summary: "ACHD commissioner for District 5.",
      intel: ["ROLE: ACHD Commissioner, District 5."],
      flags: ["Roster taken from a search summary of ACHD's own commission page, which blocks automated reading."] }),
];

let added = 0, skipped = 0;
for (const rec of NEW) {
  if (have.has(rec.id)) { skipped++; console.log("  already present, skipped:", rec.id); continue; }
  NODES.push(rec); added++;
}

// Backfill the two new fields onto records that already sit in these bodies.
const BACKFILL = {
  pickering: { jurisdiction: "Ada County (ACHD District 2)", control: "Votes on road access, impact fees and the project priority list" },
  chadwick: { jurisdiction: "Star", control: "Final vote on Star annexations, rezones and development agreements; appoints the planning commission" },
  stear: { jurisdiction: "Kuna", control: "Final vote on Kuna annexations, rezones and development agreements; appoints the planning commission" },
  pike: { jurisdiction: "Eagle", control: "Final vote on Eagle annexations, rezones and development agreements; appoints the planning commission" },
  "merrill-nancy": { jurisdiction: "Eagle", control: "Final vote on Eagle annexations, rezones and development agreements" },
  "gillis-robert": { jurisdiction: "Eagle", control: "Final vote on Eagle annexations, rezones and development agreements" },
};
let back = 0;
for (const n of NODES) {
  const b = BACKFILL[n.id];
  if (!b) continue;
  Object.assign(n, b); back++;
}

src = src.slice(0, A) + "const NODES = " + JSON.stringify(NODES, null, 1) + ";" + src.slice(B + 3);
fs.writeFileSync(DIR + "/data.js", src);
console.log("added:", added, "| skipped:", skipped, "| backfilled jurisdiction/control on:", back);
console.log("records now:", NODES.length);
const g = NODES.filter((n) => n.segment === "ground").length;
console.log("'Ground Level: Where Permission Is Granted' now holds:", g, "records");
