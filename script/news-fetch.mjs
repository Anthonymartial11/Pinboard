// Pulls Idaho news, keeps what touches Ada County ground, and works out WHERE
// each story is. Runs on a schedule in GitHub Actions, with no secrets and no
// access to the database: it only ever sees public articles and public county
// geography. Deciding whether a story touches someone the owner tracks happens
// later, inside the unlocked app, so that judgement never leaves the device.
//
// Output: news.json, published in the clear. Everything in it is already
// public, and serving one identical file to everyone means opening the feed
// says nothing about what the reader cares about.
import fs from "fs";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = ROOT + "pinboard-fresh/news.json";
const GEO = JSON.parse(fs.readFileSync(ROOT + "pinboard-fresh/newsgeo.json", "utf8"));
const KEEP_DAYS = 45, MAX_ITEMS = 400;

const FEEDS = [
  { id: "capitalsun", name: "Idaho Capital Sun", url: "https://idahocapitalsun.com/feed/" },
  { id: "idahopress", name: "Idaho Press", url: "https://www.idahopress.com/search/?f=rss&t=article&c=news&l=50&s=start_time&sd=desc" },
  { id: "idahoednews", name: "Idaho Ed News", url: "https://www.idahoednews.org/feed/" },
  { id: "ktvb", name: "KTVB", url: "https://www.ktvb.com/feeds/syndication/rss/news/local" },
  { id: "ibr", name: "Idaho Business Review", url: "https://idahobusinessreview.com/feed/" },
];

/* ── minimal feed parsing ──────────────────────────────────────────────
   RSS and Atom are regular enough that a parser beats a dependency here, and
   a build job with no dependencies is a build job that cannot be poisoned by
   one. Entities are decoded, tags stripped, whitespace collapsed. */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#8217": "’", "#8216": "‘", "#8220": "“", "#8221": "”", "#8230": "…" };
function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, k) => {
      if (ENT[k] !== undefined) return ENT[k];
      if (k[0] === "#") return String.fromCodePoint(parseInt(k[1] === "x" || k[1] === "X" ? k.slice(2) : k.slice(1), k[1] === "x" || k[1] === "X" ? 16 : 10)) || m;
      return m;
    });
}
const strip = (s) => decode(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const tag = (block, name) => {
  const m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">", "i"));
  return m ? m[1] : "";
};

function parseFeed(xml, feed) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s\S]*?<\/entry>/gi : /<item[\s\S]*?<\/item>/gi) || [];
  return blocks.map((b) => {
    let link = strip(tag(b, "link"));
    if (isAtom && !link) {
      const lm = b.match(/<link[^>]*href="([^"]+)"/i);
      link = lm ? decode(lm[1]) : "";
    }
    const body = strip(tag(b, "content:encoded") || tag(b, "content") || tag(b, "description") || tag(b, "summary"));
    const when = strip(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const ts = when ? Date.parse(when) : NaN;
    return {
      title: strip(tag(b, "title")),
      url: link,
      source: feed.name, sourceId: feed.id,
      ts: Number.isFinite(ts) ? ts : Date.now(),
      body: body.slice(0, 4000),
    };
  }).filter((a) => a.title && a.url);
}

/* ── relevance ─────────────────────────────────────────────────────────
   The feeds are statewide, so most of what arrives is somewhere else. A story
   is kept only if it names ground inside the two counties in scope. */
const CITIES = ["boise", "meridian", "nampa", "caldwell", "eagle", "kuna", "star", "garden city", "middleton", "greenleaf", "melba", "notus", "parma", "wilder", "marsing"];
const AREAS = ["ada county", "canyon county", "treasure valley", "north end", "east end", "west bench", "boise bench", "harris ranch", "barber valley", "hyde park", "warm springs", "bown crossing", "collister", "linen district", "downtown boise", "southeast boise", "west boise", "southwest boise", "boise foothills", "the bench", "veterans park", "lake hazel", "columbia village"];
const ELSEWHERE = ["idaho falls", "pocatello", "twin falls", "coeur d'alene", "moscow", "lewiston", "rexburg", "blackfoot", "sandpoint", "hailey", "ketchum", "salmon", "burley", "rupert", "preston", "driggs", "mccall", "sun valley"];

const STREET_TYPES = "St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pkwy|Parkway|Hwy|Highway|Pl|Place|Cir|Circle|Ter|Terrace|Loop|Trail";
const ADDR_RE = new RegExp("\\b(\\d{2,5})\\s+((?:[NSEW]\\.?|North|South|East|West)\\s+)?((?:[A-Z][A-Za-z'\\.]*\\s+){0,3}?)(" + STREET_TYPES + ")\\b", "g");
// A capitalised phrase followed by a street type: how a road is actually
// written in prose. Case matters, and so does the type word.
const NAME_RE = new RegExp("\\b((?:(?:[NSEW]\\.?|North|South|East|West)\\s+)?(?:[A-Z][A-Za-z'\\-]*\\s+){1,3}?)(" + STREET_TYPES + ")\\b", "g");
// Words that end a capitalised phrase but never a road name, so "Harvest
// Classic Fun Run" and "Wall Street Journal" do not become locations.
const NOT_A_STREET = new Set(["fun", "run", "walk", "race", "festival", "fair", "market", "journal", "times", "post", "news", "press", "review", "report", "board", "district", "county", "city", "state", "department", "office", "company", "group", "fund", "bank", "church", "school", "college", "university", "hospital", "center", "centre", "club", "team", "series", "classic", "open", "cup", "day", "week", "month", "year", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]);

// Street lookup. A reporter writes "Fairview Avenue"; the county writes
// "W Fairview Ave". Both have to land on the same road, so the compass prefix
// goes, the street type is folded to one spelling, and each road is also
// indexed by its bare name when that name is distinctive enough to stand alone
// ("Chinden", "Ustick"). Without this the matcher found one street in ninety.
const TYPE_FOLD = {
  street: "st", avenue: "ave", road: "rd", boulevard: "blvd", drive: "dr", lane: "ln",
  court: "ct", parkway: "pkwy", highway: "hwy", place: "pl", circle: "cir",
  terrace: "ter", trail: "trl", tr: "trl",
};
const norm = (s) => s.toLowerCase()
  .replace(/[.,]/g, "")
  .replace(/\b(n|s|e|w|north|south|east|west|ne|nw|se|sw)\b/g, " ")
  .replace(/\s+/g, " ").trim()
  .split(" ").map((w) => TYPE_FOLD[w] || w).join(" ");
const TYPE_WORDS = new Set(Object.values(TYPE_FOLD).concat(["st", "ave", "rd", "blvd", "dr", "ln", "way", "ct", "pkwy", "hwy", "pl", "cir", "ter", "trl", "loop"]));
// Bare names too common to be a location on their own.
const TOO_COMMON = new Set(["main", "state", "front", "park", "river", "lake", "hill", "valley", "center", "central", "union", "market", "grand", "capitol", "school", "college", "church", "spring", "springs", "orchard", "garden", "eagle", "star", "victory", "liberty", "freedom", "commerce", "industrial", "airport", "cherry", "linden", "maple", "elm", "oak", "pine", "cedar", "birch", "aspen", "willow"]);

const STREETS = new Map();
function addStreet(key, s) {
  if (!key || key.length < 5) return;
  const cur = STREETS.get(key);
  if (!cur || s.seg > cur.seg) STREETS.set(key, s);
}
for (const s of GEO.streets) {
  const full = norm(s.name);
  addStreet(full, s);
}
const CITY_PT = new Map(GEO.cities.map((c) => [c.name.toLowerCase(), c]));
// Canyon County is in scope for the database but NOT for the map: the county
// publishes parcels with no assessed value, so it was never loaded. These
// stories still get a place name and are marked as off the map rather than
// being dropped or given a false pin.
const CANYON = {
  nampa: [-116.5635, 43.5407], caldwell: [-116.6874, 43.6629], middleton: [-116.6193, 43.7071],
  parma: [-116.9432, 43.7857], wilder: [-116.9107, 43.6788], greenleaf: [-116.8221, 43.6699],
  notus: [-116.7996, 43.7241], melba: [-116.5324, 43.3760], marsing: [-116.8138, 43.5460],
};

/* ── cascading geolocation ─────────────────────────────────────────────
   Finest first: a full street address, then a named street, then a
   neighbourhood or district, then the city, then the county. Each level
   carries how sure it is and, when it is not exact, the area to highlight
   rather than a false pinpoint. */
// Place names are looked for in text with punctuation flattened to spaces.
// Without that, "in Boise." never matched " boise " and real Boise stories
// were being dropped as out of area.
const flatten = (t) => " " + t.toLowerCase().replace(/[^a-z0-9']+/g, " ").replace(/\s+/g, " ").trim() + " ";

function locate(text) {
  const hay = flatten(text);

  // 1. a full street address
  ADDR_RE.lastIndex = 0;
  let m;
  while ((m = ADDR_RE.exec(text)) !== null) {
    const streetName = (m[3] || "").trim() + " " + m[4];
    const hit = STREETS.get(norm(streetName)) || STREETS.get(norm((m[3] || "").trim()));
    if (hit) {
      return { level: "address", label: m[0].replace(/\s+/g, " ").trim(), confidence: "high",
               lon: hit.lon, lat: hit.lat, bb: hit.bb, note: "Address named in the story; the map opens on that street." };
    }
  }

  // 2. a named street with no number.
  //
  // Candidates are read OUT of the text rather than the 11,533 road names
  // being tested against it. A road name must appear capitalised and be
  // followed by a real street type word. Searching the other way round matched
  // "a federal judge" to S Federal Way and "the daily forecast" to W Forecast
  // St: 74 street pins in 91 stories, nearly all of them invented. A pin that
  // confident and that wrong is worse than no pin.
  let best = null;
  NAME_RE.lastIndex = 0;
  let c;
  while ((c = NAME_RE.exec(text)) !== null) {
    const words = c[1].trim().split(/\s+/);
    if (NOT_A_STREET.has(words[words.length - 1].toLowerCase().replace(/[.,]/g, ""))) continue;
    const hit = STREETS.get(norm(c[1].trim() + " " + c[2]));
    if (hit && (!best || hit.seg > best.seg)) best = hit;
  }
  if (best) {
    return { level: "street", label: best.name, confidence: "medium",
             lon: best.lon, lat: best.lat, bb: best.bb, note: "Street named, but no number. The whole street is highlighted." };
  }

  // 3. a neighbourhood or district
  for (const a of AREAS) {
    if (hay.indexOf(" " + a + " ") >= 0 && !CITY_PT.has(a)) {
      const c = CITY_PT.get("boise");
      return { level: "area", label: a.replace(/\b\w/g, (ch) => ch.toUpperCase()), confidence: "medium",
               lon: c.lon, lat: c.lat, radiusKm: 3, note: "An area, not an address. The map highlights roughly where." };
    }
  }

  // 4. a city on the map
  for (const [name, c] of CITY_PT) {
    if (hay.indexOf(" " + name + " ") >= 0) {
      return { level: "city", label: c.name, confidence: "low",
               lon: c.lon, lat: c.lat, radiusKm: 8, note: "Only the city is known. The map highlights the whole city." };
    }
  }

  // 5. a Canyon County city, named but off the map
  for (const name of Object.keys(CANYON)) {
    if (hay.indexOf(" " + name + " ") >= 0) {
      return { level: "city", label: name.replace(/\b\w/g, (ch) => ch.toUpperCase()), confidence: "low",
               lon: CANYON[name][0], lat: CANYON[name][1], radiusKm: 8, offMap: true,
               note: "Canyon County. The map covers Ada County only, so there is nothing to jump to." };
    }
  }
  return null;
}

function relevant(text) {
  const hay = flatten(text);
  const here = CITIES.some((c) => hay.includes(" " + c + " ")) || AREAS.some((a) => hay.includes(" " + a + " "));
  if (!here) return false;
  // A story about somewhere else that merely mentions Boise in passing.
  const far = ELSEWHERE.filter((c) => hay.includes(" " + c + " ")).length;
  const near = CITIES.filter((c) => hay.includes(" " + c + " ")).length;
  return near >= far;
}

/* ── run ───────────────────────────────────────────────────────────── */
async function grab(f) {
  try {
    const r = await fetch(f.url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ArgusReader/1.0)" }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) { console.log("  " + f.name + ": HTTP " + r.status); return []; }
    const items = parseFeed(await r.text(), f);
    console.log("  " + f.name + ": " + items.length + " items");
    return items;
  } catch (e) { console.log("  " + f.name + ": " + e.message); return []; }
}

const all = (await Promise.all(FEEDS.map(grab))).flat();
const cutoff = Date.now() - KEEP_DAYS * 86400000;
const seen = new Set();
const kept = [];
for (const a of all.sort((x, y) => y.ts - x.ts)) {
  if (a.ts < cutoff) continue;
  const key = a.url.split("?")[0];
  if (seen.has(key)) continue;
  seen.add(key);
  const text = a.title + ". " + a.body;
  if (!relevant(text)) continue;
  const loc = locate(text);
  kept.push({
    id: Buffer.from(key).toString("base64url").slice(-22),
    title: a.title, url: a.url, source: a.source, sourceId: a.sourceId, ts: a.ts,
    summary: a.body.slice(0, 400), body: a.body,
    loc,
  });
  if (kept.length >= MAX_ITEMS) break;
}

const out = { v: 1, built: Date.now(), count: kept.length, items: kept };
fs.writeFileSync(OUT, JSON.stringify(out));
const byLevel = {};
for (const k of kept) { const l = k.loc ? k.loc.level : "none"; byLevel[l] = (byLevel[l] || 0) + 1; }
console.log("fetched:", all.length, "| kept for Ada County:", kept.length,
            "| news.json:", (fs.statSync(OUT).size / 1024).toFixed(0), "KB");
console.log("located:", JSON.stringify(byLevel));
