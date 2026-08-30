// ENTITY RESOLUTION. Cracking the shells.
//
// A county record says a parcel belongs to "ALAMEDA SQUARE LLC". That is the
// end of the public trail. It never says that Alameda Square, Barber Mill
// Investments and Brighton Land Holdings are the same people, and no source
// anywhere publishes that. Working it out is the part nobody can download,
// which is exactly why it is worth doing.
//
// The Idaho Secretary of State gives three things per entity: its principal
// address, its mailing address, and its registered agent. Entities under one
// hand share at least one of those, because someone had to type the same
// address on every filing.
//
// The unlock is a flag on the state's own search that its website barely uses.
// Send CRA_SEARCH_YN true with a person's name and it stops matching business
// names and starts matching REGISTERED AGENTS, returning every entity that
// person is the agent for. One search on the agent named on a single Brighton
// filing returns 121 companies. That is the whole method: find one filing,
// read the agent off it, then ask the state for the rest of the family.
//
// Two things stop this turning into noise:
//   - The state labels agents Commercial or Noncommercial. Commercial means an
//     agent service (CT Corporation and the like) serving thousands of
//     unrelated companies. Only NONCOMMERCIAL agents, real people, are
//     expanded. This is the difference between a graph and a phone book.
//   - Any address that turns out to host more entities than a real office
//     could is treated as a service address (a law firm, an accountant) and is
//     not allowed to join anything together.
//
// Nothing here is asserted as fact about a family. A shared address is
// evidence, recorded with what the evidence actually is, and graded.
import fs from "fs";
import vm from "vm";

const ROOT = new URL("..", import.meta.url).pathname;
const CACHE = ROOT + "state/sos/";
fs.mkdirSync(CACHE, { recursive: true });

const ARGS = new Set(process.argv.slice(2));
const LIMIT = (() => { const a = [...ARGS].find((x) => x.startsWith("--seeds=")); return a ? +a.slice(8) : Infinity; })();

/* ── polite, cached access to the state ────────────────────────────────── */
let hits = 0, misses = 0;
const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 90);

// A filing that was read a month ago is a filing that may since have been
// dissolved, sold or handed to a new lawyer. Old answers get thrown away.
const MAX_AGE = 30 * 86400000;

async function cached(key, fn) {
  const f = CACHE + key + ".json";
  if (fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < MAX_AGE) {
    hits++; try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  }
  const v = await fn();
  if (v !== null) { fs.writeFileSync(f, JSON.stringify(v)); misses++; }
  return v;
}

async function post(url, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
      });
      if (r.status === 429 || r.status >= 500) throw new Error("HTTP " + r.status);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (i === tries - 1) return null;
      await new Promise((z) => setTimeout(z, 1500 * Math.pow(2, i)));
    }
  }
}
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429 || r.status >= 500) throw new Error("HTTP " + r.status);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      if (i === tries - 1) return null;
      await new Promise((z) => setTimeout(z, 1500 * Math.pow(2, i)));
    }
  }
}

const SEARCH = "https://sosbiz.idaho.gov/api/Records/businesssearch";
const DETAIL = (id) => "https://sosbiz.idaho.gov/api/FilingDetail/business/" + id + "/false";

function rowsOf(j) {
  if (!j || !j.rows) return [];
  return Object.values(j.rows).map((r) => ({
    id: String(r.ID), name: Array.isArray(r.TITLE) ? r.TITLE[0].replace(/\s*\(\d+\)\s*$/, "") : String(r.TITLE || ""),
    type: Array.isArray(r.TITLE) ? r.TITLE[1] : null,
    filed: r.FILING_DATE || null, status: r.STATUS || null,
    standing: r.STANDING || null, agentRaw: r.AGENT || null,
  }));
}
const searchName = (t) => cached("n_" + slug(t), () => post(SEARCH, { SEARCH_VALUE: t, STARTS_WITH_YN: false, ACTIVE_ONLY_YN: false, CRA_SEARCH_YN: false })).then(rowsOf);
const searchAgent = (t) => cached("a_" + slug(t), () => post(SEARCH, { SEARCH_VALUE: t, STARTS_WITH_YN: false, ACTIVE_ONLY_YN: false, CRA_SEARCH_YN: true })).then(rowsOf);

async function detail(id) {
  const j = await cached("d_" + id, () => get(DETAIL(id)));
  if (!j) return null;
  const o = {};
  for (const x of j.DRAWER_DETAIL_LIST || []) o[String(x.LABEL || "").trim()] = x.VALUE == null ? null : String(x.VALUE).replace(/\s+/g, " ").trim();
  return {
    type: o["Filing Type"] || null, status: o["Status"] || null, formedIn: o["Formed In"] || null,
    principal: o["Principal Address"] || null, mailing: o["Mailing Address"] || null,
    filed: o["Initial Filing Date"] || null, agent: o["Registered Agent"] || null,
  };
}

/* ── an agent line, taken apart ────────────────────────────────────────── */
// "Noncommercial 0080489 AMANDA MCCURRY 2929 W. NAVIGATOR DR. STE. 400 MERIDIAN, ID 83642"
// The leading word is the state's own judgement on whether this is a person
// standing behind the company or a service being paid to receive mail.
// A filing whose agent has quit says so in the agent field. Those words are not
// a person, and letting them through joins every abandoned company in the state
// into one imaginary empire.
const NOT_AN_AGENT = /\b(NO AGENT|AGENT RESIGNED|RESIGNED|INVALID|VACANT|NONE|UNKNOWN|N\/A)\b/i;

function parseAgent(line) {
  if (!line) return null;
  const m = line.match(/^(Noncommercial|Commercial)\s+(\d+)\s+(.*)$/i);
  if (!m) return { commercial: null, code: null, name: NOT_AN_AGENT.test(line) ? null : line.slice(0, 60), addr: null };
  const rest = m[3];
  // The name runs until the address starts, and an address starts with a number.
  const at = rest.search(/\s\d+\s/);
  const name = (at > 0 ? rest.slice(0, at) : rest).trim();
  if (NOT_AN_AGENT.test(name)) return { commercial: null, code: m[2], name: null, addr: null };
  return {
    commercial: m[1].toLowerCase() === "commercial",
    code: m[2],
    name,
    addr: at > 0 ? rest.slice(at).trim() : null,
  };
}

/* ── addresses, made comparable ────────────────────────────────────────── */
// Two filings for the same office are typed differently every time. This
// reduces an address to the three things that cannot vary: the street number,
// the street's own name, and the zip. Suite numbers are kept but held apart:
// sharing a building is weak, sharing a suite is strong.
const DIR = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW", "NORTH", "SOUTH", "EAST", "WEST"]);
const SUF = new Set(["ST", "STREET", "AVE", "AVENUE", "RD", "ROAD", "DR", "DRIVE", "LN", "LANE", "BLVD",
  "BOULEVARD", "CT", "COURT", "WAY", "PL", "PLACE", "PKWY", "PARKWAY", "CIR", "CIRCLE", "TER", "TERRACE", "LOOP", "HWY", "HIGHWAY"]);

function addrKey(raw) {
  if (!raw) return null;
  const up = raw.toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const zip = (up.match(/\b(\d{5})(?:-?\d{4})?\b(?!.*\b\d{5}\b)/) || [])[1] || null;
  // Pull the suite out before anything else so it cannot be mistaken for the number.
  let suite = null;
  const sm = up.match(/\b(?:STE|SUITE|UNIT|APT|BLDG|BUILDING|RM|ROOM|#)\s*([A-Z0-9-]+)/);
  if (sm) suite = sm[1];
  const body = up.replace(/\b(?:STE|SUITE|UNIT|APT|BLDG|BUILDING|RM|ROOM|#)\s*[A-Z0-9-]+/g, " ")
    .replace(/\bPO BOX\s*(\d+)/g, "POBOX$1").replace(/\s+/g, " ").trim();
  const box = (body.match(/\bPOBOX(\d+)\b/) || [])[1];
  if (box) return { key: "BOX" + box + "|" + (zip || ""), suite: null, box: true };
  const tok = body.split(" ");
  const numAt = tok.findIndex((t) => /^\d+$/.test(t));
  if (numAt < 0 || !zip) return null;
  const num = tok[numAt];
  let street = null;
  for (let i = numAt + 1; i < tok.length; i++) {
    const t = tok[i];
    if (DIR.has(t) || SUF.has(t) || /^\d+(ST|ND|RD|TH)$/.test(t) === false && /^\d+$/.test(t)) continue;
    if (/^[A-Z0-9]{2,}$/.test(t)) { street = t; break; }
  }
  if (!street) return null;
  return { key: num + " " + street + " " + zip, suite, box: false };
}

/* ── seeds ─────────────────────────────────────────────────────────────── */
const src = fs.readFileSync(ROOT + "idaho-power-board/data.js", "utf8");
const ctx = { console }; vm.createContext(ctx); vm.runInContext(src + ";globalThis.__O={NODES,EDGES};", ctx);
const { NODES } = ctx.__O;

// Only names that could plausibly be a filed Idaho entity. Government bodies,
// federal agencies and out-of-state institutions waste a search each.
const SKIP = /\b(city of|county|state of|us |u s |united states|federal|department|senate|house of|congress|court|district|university|college|school district|highway district|library|police|fire department|chamber of the)\b/i;
const seedNames = new Set();
for (const nd of NODES) {
  if (nd.kind === "org" || nd.kind === "pac") { if (!SKIP.test(nd.name)) seedNames.add(nd.name); }
  if (nd.org && !SKIP.test(nd.org)) seedNames.add(nd.org);
  for (const a of nd.aka || []) if (!SKIP.test(a) && /[A-Z]/.test(a)) seedNames.add(a);
}
try {
  const rb = JSON.parse(fs.readFileSync(ROOT + "research-businesses.json", "utf8"));
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    if (typeof v.entity === "string" && !SKIP.test(v.entity)) seedNames.add(v.entity);
    Object.values(v).forEach(walk);
  };
  walk(rb);
} catch {}

const seeds = [...seedNames].filter((s) => s.length > 3 && s.length < 70).sort().slice(0, LIMIT);
console.log("seed names from the database:", seeds.length, "\n");

/* ── phase 1: what the state has under each name ───────────────────────── */
const ent = new Map();      // sos id -> record
function note(row, how, why) {
  const e = ent.get(row.id) || { ...row, found: [] };
  if (!e.found.some((f) => f.how === how && f.why === why)) e.found.push({ how, why });
  ent.set(row.id, e);
}

async function run(list, fn, label, conc = 3) {
  let done = 0;
  const q = [...list];
  await Promise.all(Array.from({ length: conc }, async () => {
    for (;;) {
      const item = q.shift();
      if (item === undefined) return;
      await fn(item);
      if (++done % 50 === 0) console.log("  " + label + " " + done + "/" + list.length);
    }
  }));
}

console.log("phase 1: asking the state for each name...");
await run(seeds, async (name) => {
  const rows = await searchName(name);
  // A one-word search drags in everything; only keep hits that really contain it.
  const want = name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
  for (const r of rows) {
    const got = r.name.toUpperCase().replace(/[^A-Z0-9 ]/g, "");
    if (rows.length > 25 && !got.includes(want)) continue;
    note(r, "name", name);
  }
}, "names");
console.log("  entities found by name:", ent.size);

/* ── phase 2: the filing behind each one ───────────────────────────────── */
console.log("phase 2: reading each filing...");
await run([...ent.keys()], async (id) => {
  const d = await detail(id);
  if (d) Object.assign(ent.get(id), d, { agentP: parseAgent(d.agent) });
}, "filings");

/* ── phase 3: the siblings, via the agent flag ─────────────────────────── */
console.log("phase 3: expanding noncommercial agents...");
const agents = new Map();
for (const e of ent.values()) {
  const a = e.agentP;
  if (!a || a.commercial !== false || !a.name || a.name.length < 5) continue;
  if (!agents.has(a.name)) agents.set(a.name, 0);
  agents.set(a.name, agents.get(a.name) + 1);
}
console.log("  noncommercial agents to expand:", agents.size);
const before = ent.size;
await run([...agents.keys()], async (nm) => {
  const rows = await searchAgent(nm);
  if (rows.length > 400) return;           // an agent this busy is a service in all but name
  for (const r of rows) note(r, "agent", nm);
}, "agents");
console.log("  entities after expansion:", ent.size, "(+" + (ent.size - before) + " nobody told us about)");

console.log("phase 4: reading the new filings...");
await run([...ent.keys()].filter((id) => !ent.get(id).agentP), async (id) => {
  const d = await detail(id);
  if (d) Object.assign(ent.get(id), d, { agentP: parseAgent(d.agent) });
}, "filings");

/* ── phase 5: what binds to what ───────────────────────────────────────── */
console.log("\nphase 5: clustering...");
const byAddr = new Map(), byAgent = new Map();
for (const e of ent.values()) {
  e.pKey = addrKey(e.principal); e.mKey = addrKey(e.mailing);
  for (const k of [e.pKey, e.mKey]) {
    if (!k) continue;
    if (!byAddr.has(k.key)) byAddr.set(k.key, new Set());
    byAddr.get(k.key).add(e.id);
  }
  const a = e.agentP;
  if (a && a.commercial === false && a.name) {
    if (!byAgent.has(a.name)) byAgent.set(a.name, new Set());
    byAgent.get(a.name).add(e.id);
  }
}
// An address behind this many companies is a professional service, not an
// office. It binds nothing, and saying otherwise would join half of Boise.
const ADDR_CAP = 40, AGENT_CAP = 300;
const serviceAddr = [...byAddr].filter(([, v]) => v.size > ADDR_CAP).map(([k]) => k);
console.log("  addresses treated as service addresses (ignored):", serviceAddr.length);

// Union-find over the links that survived.
const parent = new Map();
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent.set(a, b); };
for (const id of ent.keys()) parent.set(id, id);
const links = [];
for (const [k, set] of byAddr) {
  if (set.size < 2 || set.size > ADDR_CAP) continue;
  const ids = [...set];
  for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  links.push({ kind: "address", key: k, n: set.size });
}
for (const [nm, set] of byAgent) {
  if (set.size < 2 || set.size > AGENT_CAP) continue;
  const ids = [...set];
  for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  links.push({ kind: "agent", key: nm, n: set.size });
}
const groups = new Map();
for (const id of ent.keys()) {
  const r = find(id);
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r).push(id);
}
const clusters = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);

/* ── phase 6: which of these are people we already track ───────────────── */
const people = NODES.filter((n) => n.kind === "person");
const norm = (s) => s.toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
const byLast = new Map();
for (const p of people) {
  const t = norm(p.name).split(" ");
  if (t.length < 2) continue;
  const last = t[t.length - 1];
  if (!byLast.has(last)) byLast.set(last, []);
  byLast.get(last).push({ id: p.id, name: p.name, first: t[0] });
}
const matched = [];
for (const [nm, set] of byAgent) {
  const t = norm(nm).split(" ").filter(Boolean);
  if (t.length < 2) continue;
  const cands = byLast.get(t[t.length - 1]) || [];
  for (const c of cands) {
    // First name must agree, or one side is an initial of the other.
    const a = t[0], b = c.first;
    if (!(a === b || (a.length === 1 && b[0] === a) || (b.length === 1 && a[0] === b))) continue;
    matched.push({ person: c.id, personName: c.name, agent: nm, entities: set.size });
  }
}

/* ── write it down ─────────────────────────────────────────────────────── */
const out = {
  v: 1, built: Date.now(),
  note: "Idaho Secretary of State filings. Clusters are EVIDENCE OF A SHARED ADDRESS OR AGENT, not an assertion that the same person owns them. Grade before using.",
  counts: {
    seeds: seeds.length, entities: ent.size, withFiling: [...ent.values()].filter((e) => e.agentP).length,
    noncommercialAgents: byAgent.size, clusters: clusters.length,
    serviceAddresses: serviceAddr.length, peopleMatched: matched.length,
  },
  entities: [...ent.values()].map((e) => ({
    id: e.id, name: e.name, type: e.type, status: e.status, standing: e.standing,
    filed: e.filed, principal: e.principal, mailing: e.mailing,
    agent: e.agentP ? e.agentP.name : null,
    agentKind: e.agentP ? (e.agentP.commercial === true ? "service" : e.agentP.commercial === false ? "person" : "unknown") : null,
    pKey: e.pKey ? e.pKey.key : null, mKey: e.mKey ? e.mKey.key : null,
    found: e.found,
  })),
  clusters: clusters.map((ids) => {
    const es = ids.map((i) => ent.get(i));
    const ag = {}, ad = {};
    for (const e of es) {
      if (e.agentP && e.agentP.commercial === false && e.agentP.name) ag[e.agentP.name] = (ag[e.agentP.name] || 0) + 1;
      for (const k of [e.pKey, e.mKey]) if (k && !serviceAddr.includes(k.key)) ad[k.key] = (ad[k.key] || 0) + 1;
    }
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + " (" + v + ")");
    return {
      n: ids.length, agents: top(ag), addresses: top(ad),
      active: es.filter((e) => /Active/i.test(e.status || "")).length,
      members: es.map((e) => ({ id: e.id, name: e.name, status: e.status, filed: e.filed })),
    };
  }),
  peopleLinks: matched.sort((a, b) => b.entities - a.entities),
  serviceAddresses: serviceAddr,
};
fs.writeFileSync(ROOT + "entities.json", JSON.stringify(out, null, 1));

console.log("\n" + "".padEnd(60, "-"));
console.log("entities found          ", ent.size);
console.log("filings read            ", out.counts.withFiling);
console.log("agents that are not services", byAgent.size);
console.log("clusters (2 or more)    ", clusters.length);
console.log("people already tracked  ", matched.length);
console.log("cache: " + hits + " reused, " + misses + " fetched");
console.log("\nthe ten biggest clusters:");
for (const c of out.clusters.slice(0, 10)) {
  console.log("  " + String(c.n).padStart(4) + " entities  " + (c.agents[0] || c.addresses[0] || "?")
    + "   e.g. " + c.members.slice(0, 3).map((m) => m.name).join(", "));
}
