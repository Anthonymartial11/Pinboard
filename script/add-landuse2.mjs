// Second batch: Meridian and Nampa land use, plus the Nederend family.
import fs from "fs";
const DIR = new URL("../idaho-power-board", import.meta.url).pathname;
let src = fs.readFileSync(DIR + "/data.js", "utf8");
const A = src.indexOf("const NODES = ["), B = src.indexOf("\n];", A);
const NODES = JSON.parse(src.slice(A + "const NODES = ".length, B + 2));
const have = new Set(NODES.map((n) => n.id));

const ROUGH_LOW = "No personal financial data is published for this person. Occupation-class estimate only: this is a part-time appointed seat. Nothing suggests wealth beyond an ordinary house and savings. The band reflects the class, not any figure about this individual. BAND, ROUGH.";
const ROUGH_MID = "No personal financial data is published for this person. Occupation-class estimate only: senior municipal staff in the valley are paid roughly $100,000 to $160,000, and a full career at that level ends in home equity plus a PERSI pension whose capital value alone passes $1M. The band reflects the class, not any figure about this individual. BAND, ROUGH.";

const P = (o) => Object.assign({
  kind: "person", tier: "C", segment: "ground", verification: "verified",
  degree: 0, worthBand: "Under $1M", worthConfidence: "rough", netWorth: ROUGH_LOW,
  intel: [], flags: [],
}, o);

const MER = (name, id, role) => P({
  id, name, role: role || "Commissioner, Meridian Planning and Zoning Commission", org: "City of Meridian",
  jurisdiction: "Meridian", control: "Votes on rezones, annexations, conditional use and preliminary plats in Meridian",
  summary: "Sits on the commission that hears land use in Meridian, the largest and fastest-growing city in the county after Boise.",
  intel: ["ROLE: named on the roll of the Meridian Planning and Zoning Commission in the city's own meeting document for 7 May 2026.",
          "COMMISSION SIZE: Meridian's commission runs to nine seats on three-year terms, so a roll of six means seats are open."],
});

const NEW = [
  MER("Maria Lorcher", "lorcher-maria", "Chairperson, Meridian Planning and Zoning Commission"),
  MER("Dom Gelsomino", "gelsomino-dom"),
  MER("Matthew Stoll", "stoll-matthew"),
  MER("Matthew Sandoval", "sandoval-matthew"),
  MER("Jared Smith", "smith-jared-meridian"),
  MER("Jessica Perreault", "perreault-jessica"),

  P({ id: "hood-caleb", name: "Caleb Hood", role: "Planning Division Manager, City of Meridian", org: "City of Meridian",
      tier: "B", jurisdiction: "Meridian", control: "Runs the division that writes the staff report and recommendation on every Meridian application",
      worthBand: "$1M+", netWorth: ROUGH_MID,
      summary: "Has run planning for Meridian since August 2003, through the period in which it went from a farm town to the second-largest city in Idaho. Twenty-two years in the same chair makes him the longest institutional memory in valley land use, and the person whose division writes the document every application is judged against.",
      intel: ["ROLE: Planning Division Manager, City of Meridian, AICP, in post since August 2003.",
              "WHY THIS SEAT MATTERS MOST: commissioners rotate on three-year terms and councils turn over at elections. He has outlasted all of them. On a routine application the staff recommendation is the decision, and he has been shaping how Meridian writes them for two decades."] }),

  P({ id: "ashby-rodney", name: "Rodney Ashby", role: "Director of Planning and Zoning, City of Nampa", org: "City of Nampa",
      tier: "B", segment: "canyon", jurisdiction: "Nampa", control: "Runs the department that writes the staff report on every Nampa application",
      worthBand: "$1M+", netWorth: ROUGH_MID, verification: "partial",
      summary: "Directs planning and zoning for Nampa, the largest city in Canyon County and the fastest-growing half of the valley.",
      intel: ["ROLE: Director, Nampa Planning and Zoning, reported as of February 2025."],
      flags: ["Sourced from a news summary rather than the city's own directory, which could not be read. Confirm before relying on it."] }),

  P({ id: "vanauker-ron-jr", name: "Ron Van Auker Jr.", role: "Chair, Nampa Planning and Zoning Commission", org: "City of Nampa",
      tier: "B", segment: "canyon", jurisdiction: "Nampa", control: "Chairs the body that votes on Nampa annexations, rezones and preliminary plats",
      verification: "partial",
      summary: "Chairs the nine-member commission that hears every annexation and rezone in Nampa before it reaches the council.",
      intel: ["ROLE: Chair of the Nampa Planning and Zoning Commission, reported as of November 2024. The commission has nine members, appointed by the mayor and confirmed by council."],
      flags: ["WORTH CHECKING, AND IT MATTERS: Van Auker is the name of a long-established Boise commercial development family (Van Auker Companies). Whether this man is of that family has NOT been established and is not asserted here. If he is, the chair of Nampa's land-use commission belongs to a development dynasty, which is exactly the kind of overlap worth knowing before you appear in front of it.",
              "Chairmanship reported as of November 2024 and may have rotated. Roster of the other eight seats appears in city minutes by surname only (Garner, Daffer, Turner, Kehoe, Morgan, Kirkman, Selman, Copeland, Miller), which is not enough to create records from."] }),

  // ── the Nederend family ───────────────────────────────────────────────
  P({ id: "nederend-family", name: "The Nederend Family", role: "Owners, Nederend Farms LLLP; one of the valley's largest dairy operations",
      org: "Nederend Farms LLLP", tier: "B", segment: "canyon", jurisdiction: "Marsing (Owyhee County)",
      control: "Milks about 8,000 head across two dairies and farms the ground that feeds them",
      worthBand: "$10M+", worthConfidence: "rough",
      netWorth: "No personal financial data is published for this family. BAND, ROUGH: an 8,000-head dairy operation across two sites, with enough owned or controlled cropland to grow 75% of its own feed, is a capital-heavy business in the tens of millions before any land is valued separately. Idaho dairies of that scale carry substantial herd, equipment and real property. The band reflects the operation, not any published figure about any family member.",
      summary: "A Dutch dairy family that moved its operation from southern California to Marsing in 1999 and now milks about 8,000 Holsteins across two dairies, growing most of its own feed. Three generations deep, and one of the larger private agricultural operations on the valley's western edge.",
      intel: [
        "THE MOVE: Hans Nederend Sr. arrived in Chino, California from the Netherlands in 1952. His son, named 1997 California Dairyman of the Year, moved the dairy to Marsing, Idaho in 1999, part of the wider migration of California dairies into southern Idaho over that period.",
        "SCALE: about 8,000 Holsteins milked across two dairies. Mirada Farms was bought in 2001 as the second site. Nederend Farms grows most of its own hay and corn silage and supplies roughly 75% of the feed its cows eat, which is unusual vertical integration for an operation that size.",
        "THE ENTITY: Nederend Farms LLLP, trading as Mirada Dairy, is the legal vehicle. A limited liability limited partnership is a family-succession structure rather than an operating convenience, which fits a business being handed down.",
        "THE GENERATION IN CHARGE: brothers John and Hans Nederend manage the dairy, the third generation on it. John Nederend has done public-facing work for the Idaho dairy industry.",
        "WHY THEY ARE IN THIS DATABASE: land and water. A dairy of this size holds or controls substantial acreage on the western edge of the valley, in the direction Nampa and Caldwell are growing, and dairy ground with established water is what development eventually buys."],
      flags: [
        "SCOPE NOTE: Marsing is in Owyhee County, not Ada or Canyon. It sits directly across the Snake River from Canyon County and is inside the valley's agricultural economy, but it is outside the two counties this database is scoped to.",
        "NOT FOUND: acreage owned, the ownership split between family members, any political contributions, and any land holdings beyond the dairy sites. None of that surfaced in public sources and none is asserted here.",
        "Herd numbers and history come from a Capital Press feature on the family; the entity name from an FDA inspection record. Neither is a filing that establishes ownership shares."],
  }),
];

let added = 0, skipped = 0;
for (const rec of NEW) {
  if (have.has(rec.id)) { skipped++; console.log("  already present:", rec.id); continue; }
  NODES.push(rec); added++;
}
src = src.slice(0, A) + "const NODES = " + JSON.stringify(NODES, null, 1) + ";" + src.slice(B + 3);
fs.writeFileSync(DIR + "/data.js", src);
console.log("added:", added, "| skipped:", skipped, "| records now:", NODES.length);
const j = {}; for (const n of NODES) if (n.jurisdiction) j[n.jurisdiction] = (j[n.jurisdiction] || 0) + 1;
console.log("jurisdictions:", JSON.stringify(j));
