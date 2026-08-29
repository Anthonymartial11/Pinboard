// Fills the 347 people left at "Not public" with an occupation-class estimate.
//
// This is the "rough" tier of the existing methodology, and it is labelled as
// such everywhere it appears: a red dot, the words "rough guess", and a line
// saying what the band is actually based on. It is not a claim about anyone's
// finances. It is what someone in that job, in Idaho, at that stage of a
// career, typically ends up worth.
//
// The anchors are published and real:
//   Governor about $151,000; Attorney General $146,730 by statute; Supreme
//   Court justices $186,508 from July 2025; Speaker and Pro Tem $30,500;
//   rank-and-file legislators are part-time and paid far less.
//   (Idaho Code 59-501/59-502; Coeur d'Alene Press salary survey, Jan 2026.)
//
// The reasoning for a career public servant is home equity plus PERSI. A long
// Idaho public career ends in a pension whose capital value on its own runs
// past a million, and Idaho's median house is around half of that again. That
// is why senior officials land at $1M+ and part-time ones do not.
import fs from "fs";
const DIR = new URL("../idaho-power-board", import.meta.url).pathname;
const src = fs.readFileSync(DIR + "/data.js", "utf8");
const { NODES } = new Function(src + "; return {NODES};")();

const BASIS = {
  "$10M+": "No personal financial data is published for this person. Occupation-class estimate only: equity partners, principals and senior executives at this level in Idaho typically hold a share of the firm itself, which is where the wealth sits rather than in pay. The band reflects the class, not any figure about this individual.",
  "$1M+": "No personal financial data is published for this person. Occupation-class estimate only: Idaho's senior public and professional salaries run roughly $120,000 to $190,000 (the Governor about $151,000, the Attorney General $146,730 by statute, Supreme Court justices $186,508), and a full career at that level ends in home equity plus a PERSI pension whose capital value alone passes $1M. The band reflects the class, not any figure about this individual.",
  "Under $1M": "No personal financial data is published for this person. Occupation-class estimate only: this is a part-time, junior or modestly paid role. Idaho legislators are part-time, and city council seats in the valley pay in the low tens of thousands. Nothing suggests wealth beyond an ordinary house and savings. The band reflects the class, not any figure about this individual.",
};

// A first attempt keyed on job titles alone put the founder of a one-man news
// site at $10M+ and the owners of a manufacturing company under $1M. Titles do
// not carry wealth; what a person owns and what kind of organisation pays them
// do. So three things decide it, in this order.
//
// 1. SECTOR CAPS. A think-tank president, an agency director and a newspaper
//    editor cannot reach $10M+ on salary, however senior the title reads.
//    Government, nonprofit, media, education and tribal roles cap at $1M+.
// 2. OWNERSHIP LIFTS. Owning a real trading business is where wealth actually
//    sits, so anything in the businesses file lifts the band, and a developer,
//    builder or manufacturer lifts it further.
// 3. SENIORITY sets the floor within whatever the cap allows.
const BUSINESSES = (() => {
  try {
    const t = fs.readFileSync(DIR + "/businesses.js", "utf8");
    return new Function(t + "; return BUSINESSES;")();
  } catch (e) { return {}; }
})();

const CAPPED = /\b(government|governor|senator|representative|legislator|attorney general|secretary of state|treasurer|controller|justice|judge|magistrate|mayor|council|commissioner|clerk|assessor|sheriff|chief of staff|agency|department|bureau|division|state board|school|district|university|college|professor|dean|provost|chancellor|superintendent|principal of|foundation|nonprofit|non-profit|association|institute|policy center|think tank|reporter|journalist|editor|publisher|newsroom|tribe|tribal|church|pastor|charity|united way|chamber of commerce|economic development|public affairs|advocacy|caucus|party)\b/i;
const PART_TIME = /\b(city council|council ?member|legislator|state senator|state representative|R-|D-|JFAC|precinct|committee ?(chair|member)|volunteer|trustee|board member|activist|organiser|organizer|student|intern)\b/i;
// What kind of business actually compounds. A bare "insurance" used to be on
// this list and lifted a Nampa agency co-owner to $10M+, which an agency is
// not; a carrier is a different thing from a storefront.
const BIG_MONEY = /\b(developer|development|homebuilder|home ?builder|construction|contractor|real estate|brokerage|manufactur|industries|capital|holdings|private equity|investment|ventures|bancorp|dealership|ranching|timber|mining|semiconductor)\b/i;
// Owning one of these is a job, not a fortune. A one-man newsletter and a
// furniture shop are genuinely owned and genuinely not worth eight figures.
const SMALL_BUSINESS = /\b(chronicle|gazette|newsletter|news site|blog|publishing|furnishings|furniture|restaurant|cafe|salon|shop|store|studio|agency|consultancy|consulting|policy|public affairs|clinic|practice|foundation|institute)\b/i;
const SENIOR = /\b(chief executive|CEO|president|chairman|chair of the board|managing partner|equity partner|senior partner|managing director|principal|owner|co-owner|proprietor|CFO|COO|general counsel|executive vice president|EVP|senior vice president|SVP)\b/i;
const MIDDLE = /\b(vice president|VP|director|executive director|partner|attorney|lawyer|lobbyist|physician|surgeon|dentist|banker|broker|architect|engineer|superintendent|administrator|manager|counsel)\b/i;

const ORDER = ["Under $1M", "$1M+", "$10M+"];
const up = (band, n) => ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(band) + n)];
const capAt = (band, cap) => ORDER[Math.min(ORDER.indexOf(band), ORDER.indexOf(cap))];

// Statewide office is its own floor: these are full-time, published salaries
// around $147,000 to $186,000, and a career ending in one does not leave
// somebody under a million once a house and a PERSI pension are counted.
const STATEWIDE = /\b(governor|lieutenant governor|attorney general|secretary of state|state treasurer|state controller|superintendent of public instruction|chief justice|justice of the|supreme court|court of appeals|district judge|US senator|U\.S\. senator|congressman|US representative|U\.S\. representative)\b/i;

function classify(p) {
  // Caps and seniority read the CURRENT JOB only. Reading the whole summary
  // meant a past legislative seat pulled the Lieutenant Governor under a
  // million, and a foundation board seat capped the CEO of Albertsons.
  const title = [p.role, p.org].filter(Boolean).join(" ");
  const text = [p.role, p.org, p.summary].filter(Boolean).join(" ");
  let band = "Under $1M";

  if (SENIOR.test(title)) band = "$1M+";
  else if (MIDDLE.test(title)) band = "$1M+";

  // What they own outweighs what they are called.
  const owned = BUSINESSES[p.id] || [];
  const realOwnership = owned.filter((b) => b.rels.some((r) => /own|control|family-owned/.test(r)));
  if (realOwnership.length) {
    band = up(band, 1);
    const heavy = realOwnership.some((b) => BIG_MONEY.test(b.name + " " + title) && !SMALL_BUSINESS.test(b.name));
    if (heavy) band = up(band, 1);
    // A small owned business does not reach eight figures however it is worded.
    if (realOwnership.every((b) => SMALL_BUSINESS.test(b.name + " " + title))) band = capAt(band, "$1M+");
  } else if (owned.length) {
    band = up(band, 1);   // founded something, but no ownership established
  }

  // Salary-funded sectors cannot compound into real wealth. Applied after the
  // lift, so a legislator who owns a construction firm still reads correctly.
  if (!realOwnership.length && CAPPED.test(title)) band = capAt(band, "$1M+");
  if (!owned.length && PART_TIME.test(title)) band = capAt(band, "Under $1M");

  // A public company's chief executive is paid in stock, which is a different
  // machine from a salary, so the sector cap does not apply to them.
  if (/\b(CEO|chief executive|president & CEO|president and CEO)\b/i.test(title)
      && /\b(Inc\.?|Corporation|Corp\.?|Companies|Technology|Micron|Albertsons|Simplot|Melaleuca|Clearwater|PetIQ|Chobani|Kochava)\b/.test(title)) {
    band = up(band, 1);
  }
  // Full-time statewide office is a floor, never a ceiling.
  if (STATEWIDE.test(title)) band = ORDER[Math.max(ORDER.indexOf(band), 1)];
  // So is running one of the valley's real cities: those are full-time jobs on
  // six figures, unlike a small-town mayoralty which is a part-time stipend.
  if (/\bmayor of (boise|meridian|nampa|caldwell)\b/i.test(title)) band = ORDER[Math.max(ORDER.indexOf(band), 1)];

  return band;
}

let filled = 0;
const counts = {};
const patch = {};
for (const p of NODES) {
  if (p.kind !== "person") continue;
  if (p.worthBand && p.worthBand !== "Not public") continue;
  const band = classify(p);
  patch[p.id] = { worthBand: band, worthConfidence: "rough", netWorth: BASIS[band] };
  counts[band] = (counts[band] || 0) + 1;
  filled++;
}
fs.writeFileSync(new URL("../worth-class-patch.json", import.meta.url).pathname, JSON.stringify(patch, null, 1));
console.log("people filled:", filled, JSON.stringify(counts));
const show = (id) => { const p = NODES.find((n) => n.id === id); return p ? p.name + " -> " + patch[p.id].worthBand : id; };
console.log("");
for (const id of ["little", "labrador", "bedke", "moyle", "mcgrane", "moon", "hoffman", "day-don", "cargill", "mcclure-emily", "morris-susan"]) {
  if (patch[id]) console.log("  " + show(id));
}
