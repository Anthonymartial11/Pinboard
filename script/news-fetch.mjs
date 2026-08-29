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

  // BOISEDEV, READ THROUGH THE NEWS INDEXES. Its own feed sits behind a
  // Cloudflare bot challenge that answers 403 to every path, its RSS and its
  // WordPress API included. That is the publisher deliberately saying no to
  // automated readers, and working around it is not something this job will
  // do. The indexes below are public feeds those companies publish about
  // BoiseDev, so BoiseDev's own server is never touched.
  //
  // Two of them, because they fail in opposite directions. Google carries far
  // more headlines but no article text and only a redirect link. Bing carries
  // fewer stories but real opening paragraphs and, inside its redirect, the
  // direct boisedev.com address. Merged, the coverage is Google's and the
  // detail is Bing's.
  { id: "boisedev", name: "BoiseDev", local: true, via: "Google News", strip: / - Boise ?Dev$/i,
    url: "https://news.google.com/rss/search?q=site:boisedev.com&hl=en-US&gl=US&ceid=US:en" },
  { id: "boisedev", name: "BoiseDev", local: true, via: "Bing News", unwrap: true,
    url: "https://www.bing.com/news/search?q=site%3Aboisedev.com&format=RSS&count=40" },
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
    // An index appends its own furniture: Google puts " - Boise Dev" on every
    // headline, Bing wraps the real address in a click tracker. Both are
    // undone here so the story reads as the publisher wrote it and the link
    // goes straight to them.
    let title = strip(tag(b, "title"));
    if (feed.strip) title = title.replace(feed.strip, "").trim();
    if (feed.unwrap) {
      const u = link.replace(/&amp;/g, "&").match(/[?&]url=([^&]+)/);
      if (u) { try { link = decodeURIComponent(u[1]); } catch (e) {} }
    }
    const body = strip(tag(b, "content:encoded") || tag(b, "content") || tag(b, "description") || tag(b, "summary"));
    // Google's "description" is a link whose visible text is the headline
    // again. Stripping the tags leaves the title, which then looks like a
    // summary and is not one. The raw block is checked, not the stripped text,
    // because the giveaway is the href and stripping removes it.
    let text = body;
    const rawDesc = tag(b, "description");
    const echoed = text && title && text.replace(/\s+/g, " ").toLowerCase().indexOf(title.replace(/\s+/g, " ").toLowerCase()) === 0
                   && text.length < title.length + 40;
    if (/^\s*$/.test(text) || rawDesc.indexOf("news.google.com") >= 0 || echoed) text = "";
    const when = strip(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const ts = when ? Date.parse(when) : NaN;
    return {
      title, url: link,
      source: feed.name, sourceId: feed.id, via: feed.via || null, local: !!feed.local,
      ts: Number.isFinite(ts) ? ts : Date.now(),
      body: text.slice(0, 4000),
    };
  }).filter((a) => a.title && a.url
      && !/bing\.com\/news\/search/.test(a.url)
      // Tag, author and category listings, not articles. A search index treats
      // them as pages like any other; a reader would find them baffling.
      && !/\bArchives?\s*$/i.test(a.title)
      && !/\/(tag|tags|category|author|topic|page)\//i.test(a.url));
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

function relevant(text, art) {
  // A publication whose entire beat is this valley is in scope by definition.
  // Requiring it to name a city as well would drop stories that simply say
  // "the Bench" or nothing at all, which is most of what a local outlet runs.
  if (art && art.local) {
    const hay0 = flatten(text);
    const far = ELSEWHERE.filter((c) => hay0.includes(" " + c + " ")).length;
    const near = CITIES.filter((c) => hay0.includes(" " + c + " ")).length;
    return near >= far;
  }
  const hay = flatten(text);
  const here = CITIES.some((c) => hay.includes(" " + c + " ")) || AREAS.some((a) => hay.includes(" " + a + " "));
  if (!here) return false;
  // A story about somewhere else that merely mentions Boise in passing.
  const far = ELSEWHERE.filter((c) => hay.includes(" " + c + " ")).length;
  const near = CITIES.filter((c) => hay.includes(" " + c + " ")).length;
  return near >= far;
}

/* ── run ───────────────────────────────────────────────────────────── */
// Outlets rate-limit, and one 429 should not cost a whole outlet for the run.
// Backing off and asking again politely is the difference between four sources
// and five.
async function grab(f, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(f.url, {
        headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                   "accept": "application/rss+xml, application/xml, text/xml, */*;q=0.8" },
        signal: AbortSignal.timeout(30000),
      });
      if ((r.status === 429 || r.status >= 500) && i < tries - 1) {
        await new Promise((z) => setTimeout(z, 4000 * Math.pow(2, i)));
        continue;
      }
      if (!r.ok) { console.log("  " + f.name + (f.via ? " (" + f.via + ")" : "") + ": HTTP " + r.status); return []; }
      const items = parseFeed(await r.text(), f);
      console.log("  " + f.name + (f.via ? " (" + f.via + ")" : "") + ": " + items.length + " items");
      return items;
    } catch (e) {
      if (i === tries - 1) { console.log("  " + f.name + ": " + e.message); return []; }
      await new Promise((z) => setTimeout(z, 4000 * Math.pow(2, i)));
    }
  }
  return [];
}

// NOT FEEDS.map(grab). Array.map hands the callback the index as its second
// argument, which lands in `tries`, so the first feed in the list got zero
// attempts and returned nothing without ever logging why. Idaho Capital Sun
// silently disappeared from the newsfeed for several runs because of it.
const all = (await Promise.all(FEEDS.map((f) => grab(f)))).flat();
const quiet = FEEDS.filter((f) => !all.some((a) => a.source === f.name && (!f.via || a.via === f.via)));
if (quiet.length) console.log("  returned nothing:", quiet.map((f) => f.name + (f.via ? " (" + f.via + ")" : "")).join(", "));
const cutoff = Date.now() - KEEP_DAYS * 86400000;
const seen = new Set();
const kept = [];
// The same BoiseDev story arrives from both indexes. Deduplicating on the URL
// alone would keep both, because the two indexes give different addresses for
// it, so the headline decides. Bing's copy is preferred where it exists: it
// carries the article's opening and a direct link to the publisher.
const titleKey = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);
const byTitle = new Map();
for (const a of all) {
  const k = titleKey(a.title);
  const cur = byTitle.get(k);
  if (!cur) { byTitle.set(k, a); continue; }
  const better = (a.body ? 2 : 0) + (a.url.indexOf("news.google.com") < 0 ? 1 : 0);
  const has = (cur.body ? 2 : 0) + (cur.url.indexOf("news.google.com") < 0 ? 1 : 0);
  if (better > has) byTitle.set(k, a);
}
for (const a of [...byTitle.values()].sort((x, y) => y.ts - x.ts)) {
  if (a.ts < cutoff) continue;
  const key = a.url.split("?")[0];
  if (seen.has(key)) continue;
  seen.add(key);
  const text = a.title + ". " + a.body;
  if (!relevant(text, a)) continue;
  const loc = locate(text);
  kept.push({
    id: Buffer.from(key).toString("base64url").slice(-22),
    title: a.title, url: a.url, source: a.source, sourceId: a.sourceId, ts: a.ts,
    via: a.via || undefined,
    // A story with no body is a headline the index gave us and nothing more.
    // The app says so rather than showing an empty article as if it had failed.
    titleOnly: a.body ? undefined : true,
    summary: a.body.slice(0, 400), body: a.body,
    loc,
  });
  if (kept.length >= MAX_ITEMS) break;
}

// A run that fetched almost nothing is a broken run, not a quiet news day:
// every outlet rate-limiting at once, or a parser mistake. Publishing it would
// blank the reader's feed. One such mistake here produced zero stories and
// would have shipped, so the previous file stands unless the new one is
// plausible.
const prevOut = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
const had = prevOut && prevOut.items ? prevOut.items.length : 0;
if (!kept.length && had) {
  console.log("REFUSING TO PUBLISH: 0 stories this run, keeping the " + had + " already live");
  process.exit(1);
}
if (had >= 20 && kept.length < had * 0.35) {
  console.log("REFUSING TO PUBLISH: " + kept.length + " stories against " + had + " live; that is a collapse, not a slow day");
  process.exit(1);
}
const out = { v: 1, built: Date.now(), count: kept.length, items: kept };
fs.writeFileSync(OUT, JSON.stringify(out));
const byLevel = {};
for (const k of kept) { const l = k.loc ? k.loc.level : "none"; byLevel[l] = (byLevel[l] || 0) + 1; }
const bySrc = {};
for (const k of kept) bySrc[k.source] = (bySrc[k.source] || 0) + 1;
console.log("by source:", JSON.stringify(bySrc));
console.log("fetched:", all.length, "| kept for Ada County:", kept.length,
            "| news.json:", (fs.statSync(OUT).size / 1024).toFixed(0), "KB");
console.log("located:", JSON.stringify(byLevel));
