// Pulls ownership and founding claims OUT of what the database already says,
// rather than inventing any. The rule that keeps it honest: a named business
// has to follow the ownership word. "owns no stocks at all" and "beat his own
// lieutenant" both match a loose pattern and neither is an ownership claim.
import fs from "fs";
const SRC = new URL("../idaho-power-board/data.js", import.meta.url).pathname;
const src = fs.readFileSync(SRC, "utf8");
const NODES = eval(src.slice(src.indexOf("const NODES = ") + 14, src.indexOf("];", src.indexOf("const NODES = ")) + 2));

const SUFFIX = "LLC|L\\.L\\.C\\.|Inc\\.?|Incorporated|Corp\\.?|Corporation|Company|Co\\.|Partners|Partnership|LP|LLP|Group|Holdings?|Development|Developments|Properties|Capital|Ventures|Enterprises|Industries|Farms|Ranch|Realty|Insurance|Bancorp|Bank|Brewing|Motors|Foods|Analytics|Technologies|Systems|Associates|Advisors|Management|Construction|Builders|Homes|Media|Studios|Labs";
const NAME = "[A-Z][\\w&'’.-]*(?:\\s+(?:of|and|&|the|for)\\s+[A-Z][\\w&'’.-]*|\\s+[A-Z][\\w&'’.-]*){0,4}";
// Three different relationships, kept apart on purpose. Owning a company,
// founding it and running it are not the same claim, and collapsing them is
// how a database starts telling people things that are not true. "Runs GBank"
// is a job.
// "principal of" is deliberately absent. In this database it matches a school
// principal far more often than a business principal, and it put three head
// teachers in as company owners.
const OWN = "owns|owner of|co-owner of|part-owner of|majority owner of|sole owner of|sole member of|managing member of|holds? a stake in|has an ownership stake in";
const FOUND = "founded|founder of|co-founder of|founding partner of|started";
const PAT_OWN = new RegExp("\\b(" + OWN + ")\\s+((?:the\\s+)?" + NAME + "(?:\\s+(?:" + SUFFIX + "))?)", "g");
const PAT_FOUND = new RegExp("\\b(" + FOUND + ")\\s+((?:the\\s+)?" + NAME + "(?:\\s+(?:" + SUFFIX + "))?)", "g");
// The reverse shape: "Melaleuca, the company he owns", "his firm Risch Pisca".
const PAT_REV = new RegExp("\\b(?:his|her|their|the family\x27s)\\s+(?:own\\s+)?(?:company|firm|business|holding company|development company|brokerage|agency|dealership)\\s+((?:the\\s+)?" + NAME + "(?:\\s+(?:" + SUFFIX + "))?)", "g");
const PAT_REV2 = new RegExp("(" + NAME + "(?:\\s+(?:" + SUFFIX + "))?)\\s*,\\s*(?:the\\s+)?(?:company|firm|business)\\s+(?:he|she|they)\\s+(owns|founded|co-founded)", "g");
// A business name is only credible if it either carries a company suffix or is
// several capitalised words. A bare capitalised word after "runs" is usually a
// department, a campaign or a chamber, not a company someone owns.
const CREDIBLE = new RegExp("(?:" + SUFFIX + ")\\s*$|^(?:[A-Z][\\w&'’.-]*\\s+){1,}[A-Z][\\w&'’.-]*$");
const NOT_A_BUSINESS = /^(the )?(House|Senate|State|Idaho|County|City|Board|Committee|Department|Office|Chamber|Caucus|Party|Legislature|Commission|District|Foundation|University|College|School|Church|Republican|Democratic|Governor|Speaker|President|Court)\b/i;

const out = [], rejected = [];
for (const rec of NODES) {
  if (rec.kind !== "person") continue;
  const fields = [["role", rec.role || ""], ["summary", rec.summary || ""]]
    .concat((rec.intel || []).map((t, i) => ["intel[" + i + "]", t]));
  const seen = new Set();
  // Three ways a match can be about somebody else, or about the opposite of
  // what it appears to say. Every one of these was found in the real data.
  //
  //   "His mother founded Old Boise"        -> credits the son
  //   "the grower co-op that owns Amalgamated" -> credits a man for a co-op
  //   "he no longer owns Hubble Homes"      -> records the reverse of the truth
  //
  // A database that says a man owns something he sold is worse than one that
  // says nothing, so all three are refused rather than flagged.
  const SOMEONE_ELSE = /\b(his|her|their|the)\s+(mother|father|parents?|brother|sister|son|daughter|wife|husband|family|grandfather|grandmother|uncle|aunt|cousin|widow|estate|late)\s+\S*\s*$/i;
  const RELATIVE_CLAUSE = /\b(that|which|who|whose)\s*$/i;
  const NEGATED = /\b(no longer|not|never|denies|denied|does not|did not|ceased to|sold)\s+\S{0,14}\s*$/i;

  const take = (m, rel, entRaw, verb, where, txt) => {
    const before = txt.slice(Math.max(0, m.index - 70), m.index);
    if (SOMEONE_ELSE.test(before)) { rejected.push([rec.name, entRaw, "the sentence credits a relative, not this person"]); return; }
    if (RELATIVE_CLAUSE.test(before)) { rejected.push([rec.name, entRaw, "the owner in the sentence is another entity"]); return; }
    if (NEGATED.test(before)) { rejected.push([rec.name, entRaw, "the sentence says they do NOT own it"]); return; }
    // A trailing article is a parse artifact, not part of a company name.
    let ent = String(entRaw).trim().replace(/[.,;:]+$/, "").replace(/\s+(The|A|An|And|In|At|On|Of|For|His|Her|Their|Which|That|Who)$/i, "").replace(/[.,;:]+$/, "").trim();
    if (!CREDIBLE.test(ent)) return;
    if (NOT_A_BUSINESS.test(ent)) return;
    const key = rel + "|" + ent.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: rec.id, who: rec.name, rel, verb, entity: ent, where,
      quote: txt.slice(Math.max(0, m.index - 70), m.index + m[0].length + 70).replace(/\s+/g, " ").trim(),
    });
  };
  for (const [where, txt] of fields) {
    for (const m of txt.matchAll(PAT_OWN)) take(m, "owns", m[2], m[1], where, txt);
    for (const m of txt.matchAll(PAT_FOUND)) take(m, "founded", m[2], m[1], where, txt);
    for (const m of txt.matchAll(PAT_REV)) take(m, "owns", m[1], "his/her company", where, txt);
    for (const m of txt.matchAll(PAT_REV2)) take(m, m[2] === "owns" ? "owns" : "founded", m[1], m[2], where, txt);
  }
}
fs.writeFileSync(new URL("../ownership-candidates.json", import.meta.url).pathname, JSON.stringify(out, null, 1));
console.log("kept:", out.length, "| refused as misattributed or negated:", rejected.length);
for (const [w, e, why] of rejected) console.log("  REFUSED  " + w + " -> " + e + "   (" + why + ")");
console.log("");
for (const r of out) {
  console.log("  [" + r.rel.toUpperCase() + "] " + r.who + "  ->  " + r.entity + "   (" + r.where + ")");
  console.log("        ..." + r.quote + "...");
}
