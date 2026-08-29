// Structures what the database already says about who owns and founded what.
//
// NOTHING HERE IS RESEARCHED OR INFERRED. Every entry comes from a sentence
// already in the record, and the sentence is carried along with it so any
// claim can be read back to its source. Ada County publishes no ownership
// data and the Secretary of State has no open feed, so anything beyond what
// the records already state would be invention.
//
// Owning, founding and running are kept apart. They are three different
// claims, and a person who founded a company they later sold does not own it.
import fs from "fs";
const SRC = new URL("../idaho-power-board/", import.meta.url).pathname;
const src = fs.readFileSync(SRC + "data.js", "utf8");
const NODES = eval(src.slice(src.indexOf("const NODES = ") + 14, src.indexOf("];", src.indexOf("const NODES = ")) + 2));
const byId = new Map(NODES.map((n) => [n.id, n]));

/* ── the curated role line ─────────────────────────────────────────────
   Short, written by hand, and far cleaner than prose. "Founder/Owner, CBH
   Homes" says exactly what it means. */
const ROLE_OWN = /\b(sole owner|co-owner|owner|proprietor|principal owner|managing owner)\b/i;
const ROLE_FOUND = /\b(co-founder|founder|founded|founding partner)\b/i;

// A role line is several claims separated by semicolons, and the business has
// to come from the SAME clause as the ownership word. Reading the first clause
// instead credited Jamie Jo Scott with founding JKAF, which she chairs; the
// clause that says "founder" names Mill 95.
//
// Two shapes appear: "Founder, Mill 95" puts the business after the word, and
// "IFF founder" puts it before. Both are handled, and a clause that yields
// only a year or a job title yields nothing.
const JUNK = /^(\d{4}\)?$|^(the|a|an|its|his|her|their|this|that|president|ceo|chairman|chair|director|partner|owner|founder|publisher|principal|manager|head|out|heiress|wife|husband)\b)/i;
// The org field is a label, not always a clean company name.
const cleanOrg = (o) => String(o || "").replace(/\([^)]*\)/g, " ")
  .replace(/\s*\/\s*(trusts?|family|historical|founding family|estate)\b.*$/i, "")
  .replace(/\s+/g, " ").trim();

function entitiesFromRole(rec) {
  const found = [];
  const role = (rec.role || "").replace(/\([^)]*\)/g, " ");
  for (const clause of role.split(/;|\u2014| \u2013 /)) {
    const c = clause.trim();
    if (!c) continue;
    const isOwn = ROLE_OWN.test(c), isFound = ROLE_FOUND.test(c);
    if (!isOwn && !isFound) continue;

    let ent = "";
    // "Founder, Mill 95" / "Chairman / owner, Idaho Forest Group"
    const comma = c.match(/^(.*?),\s*(.+)$/);
    if (comma && (ROLE_OWN.test(comma[1]) || ROLE_FOUND.test(comma[1]))) ent = comma[2];
    // "Co-founder of Micron", "owner of Roaring Springs"
    if (!ent) {
      const of = c.match(/\b(?:co-)?(?:founder|owner|proprietor)\s+of\s+(?:the\s+)?(.+)$/i);
      if (of) ent = of[1];
    }
    // "IFF founder"
    if (!ent) {
      const before = c.match(/^(.+?)\s+(?:co-)?(?:founder|owner|proprietor)\b/i);
      if (before) ent = before[1];
    }
    const tidy = (x) => String(x).replace(/\([^)]*\)/g, " ").replace(/\s+[-\u2014]\s+.*$/, "")
      .replace(/^(?:president|ceo|chairman|chair|director|partner|publisher|manager|head)\s+and\s+\w+,\s*/i, "")
      .replace(/[.,;]+$/, "").replace(/\s+/g, " ").trim();
    ent = tidy(ent);
    // A clause that yields only an article or a job title falls back to the
    // curated org label, which is what it was describing all along.
    if (!ent || JUNK.test(ent)) ent = cleanOrg(rec.org);
    if (!ent || JUNK.test(ent)) continue;
    found.push({ ent, isOwn, isFound, clause: c });
  }
  return found;
}

const NOT_A_COMPANY = /^(family|trusts?|historical|founding family|wife|husband|heiress)\b/i;

const OUT = {};
// One entry per business per person. "Founder/Owner, CBH Homes" is a single
// fact about a single company, not two, so the relations are collected onto
// one entry rather than listed twice.
const RANK = { owns: 0, "co-owns": 1, founded: 2, "co-founded": 3 };
const add = (id, rel, name, source, quote) => {
  if (!name || name.length < 3 || NOT_A_COMPANY.test(name)) return;
  const list = (OUT[id] = OUT[id] || []);
  const key = name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  let e = list.find((x) => x._k === key);
  if (!e) { e = { _k: key, name, rels: [], source, quote }; list.push(e); }
  if (!e.rels.includes(rel)) e.rels.push(rel);
  e.rels.sort((a, b) => RANK[a] - RANK[b]);
  // Prefer the longest, most explicit name we have seen for the same company.
  if (name.length > e.name.length) e.name = name;
};

for (const rec of NODES) {
  if (rec.kind !== "person") continue;
  for (const f of entitiesFromRole(rec)) {
    if (f.isOwn) add(rec.id, /co-owner/i.test(f.clause) ? "co-owns" : "owns", f.ent, "role", rec.role);
    if (f.isFound) add(rec.id, /co-found/i.test(f.clause) ? "co-founded" : "founded", f.ent, "role", rec.role);
  }
}

// Then the prose findings, already audited by find-ownership.mjs.
const prose = JSON.parse(fs.readFileSync(new URL("../ownership-candidates.json", import.meta.url).pathname, "utf8"));
for (const r of prose) {
  const rel = r.rel === "owns" ? (/co-owner/i.test(r.verb) ? "co-owns" : "owns")
            : (/co-found/i.test(r.verb) ? "co-founded" : "founded");
  add(r.id, rel, r.entity, r.where, r.quote);
}

/* ── join to what the database already holds ───────────────────────────
   Where the business is itself a record, the two are linked so the map, the
   parcel cross-reference and the network all reach each other. */
const orgs = NODES.filter((n) => n.kind === "org");
const norm = (s) => s.toLowerCase().replace(/\b(the|inc|llc|corp|corporation|company|co|group|holdings?)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const orgByName = new Map();
for (const o of orgs) {
  orgByName.set(norm(o.name), o.id);
  for (const a of o.aka || []) orgByName.set(norm(a), o.id);
}

let linked = 0, sited = 0;
const SITES = fs.existsSync(SRC + "sites.js")
  ? eval(fs.readFileSync(SRC + "sites.js", "utf8").replace(/^\/\*[\s\S]*?\*\//, "").replace("const SITES = ", "(").replace(/;\nconst SHARED_SITES[\s\S]*$/, ")"))
  : {};

for (const [id, list] of Object.entries(OUT)) {
  for (const b of list) {
    delete b._k;
    const hit = orgByName.get(norm(b.name));
    if (hit) { b.org = hit; linked++; }
    // If that business record has a matched parcel, carry the address through
    // so a person reaches the ground their company sits on.
    if (hit && SITES[hit] && SITES[hit].length) { b.site = SITES[hit][0]; sited++; }
  }
}

fs.writeFileSync(SRC + "businesses.js",
  "/* Generated by script/build-businesses.mjs from sentences already in the\n"
  + "   records. Nothing here is researched or inferred: each entry carries the\n"
  + "   line it came from. Owning, founding and running are separate claims. */\n"
  + "const BUSINESSES = " + JSON.stringify(OUT) + ";\n");

const people = Object.keys(OUT).length;
const total = Object.values(OUT).reduce((a, l) => a + l.length, 0);
const byRel = {};
for (const l of Object.values(OUT)) for (const b of l) for (const r of b.rels) byRel[r] = (byRel[r] || 0) + 1;
console.log("people with a business:", people, "| entries:", total, "|", JSON.stringify(byRel));
console.log("entries linked to an existing record:", linked, "| of those with a known lot:", sited);
console.log("");
for (const [id, list] of Object.entries(OUT)) {
  for (const b of list) {
    console.log("  " + (byId.get(id) || {}).name + "  " + b.rels.join("+") + "  " + b.name
      + (b.org ? "  [record: " + b.org + "]" : "") + (b.site ? "  [lot: " + b.site.a + "]" : "")
      + "   (" + b.source + ")");
  }
}
