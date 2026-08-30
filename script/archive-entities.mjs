// Watches the companies themselves, weekly.
//
// The old change watcher said entity dissolution could not be done, because
// the Secretary of State publishes no feed of it. That was true and is no
// longer the point: there is no feed, but there is a filing page per company,
// and once script/entities.mjs has worked out WHICH companies matter, checking
// a few thousand pages a week is nothing.
//
// Four things on that page are worth a phone call when they move:
//   status     a company going Dissolved, Revoked or Administratively
//              Dissolved. Somebody stopped paying the annual fee, or wound it
//              up on purpose. Either way the land it held has to go somewhere.
//   agent      a change of registered agent usually means a change of lawyer,
//              and a change of lawyer usually means a change of plan.
//   principal  the operating address moving.
//   mailing    where the post goes, which is the closest thing on a public
//              record to where the money actually sits.
//
// Same three rules as the main archive: append only, replays itself, and
// refuses to record a collapse.
import fs from "fs";
import { ARCHIVE_ROOT, today, commit } from "./arclib.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const ARC = ARCHIVE_ROOT(ROOT);
const DAY = today();

const srcFile = ROOT + "entities.json";
if (!fs.existsSync(srcFile)) {
  console.log("no entities.json yet, so there is no list of companies to watch. Run script/entities.mjs first.");
  process.exit(0);
}
const ids = JSON.parse(fs.readFileSync(srcFile, "utf8")).entities.map((e) => e.id);
console.log("companies to check:", ids.length.toLocaleString());

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

const now = new Map();
let read = 0, failed = 0;
const q = [...ids];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const id = q.shift();
    if (id === undefined) return;
    const j = await get("https://sosbiz.idaho.gov/api/FilingDetail/business/" + id + "/false");
    if (!j) { failed++; continue; }
    const o = {};
    for (const x of j.DRAWER_DETAIL_LIST || []) o[String(x.LABEL || "").trim()] = x.VALUE == null ? null : String(x.VALUE).replace(/\s+/g, " ").trim();
    now.set(id, {
      status: o["Status"] || null, principal: o["Principal Address"] || null,
      mailing: o["Mailing Address"] || null, agent: o["Registered Agent"] || null,
    });
    if (++read % 250 === 0) console.log("  read " + read + "/" + ids.length);
  }
}));
console.log("  read " + read + ", failed " + failed);

// If a fifth of the checks fell over, the state was having a bad day and this
// run has no business writing anything down.
if (read < ids.length * 0.8) {
  console.log("SKIPPED: only " + read + " of " + ids.length + " came back. Recording nothing rather than recording a lie.");
  process.exit(0);
}

// A company that stops answering is NOT recorded as gone: only a real read
// counts, so the floor is set against what was actually reached today.
const res = commit(ARC, "entities", DAY, now, Math.floor(read * 0.95));
if (res && !res.first) {
  const DEAD = /dissolv|revok|terminat|withdraw|expired|inactive/i;
  const died = res.changes.filter((c) => c.f === "status" && DEAD.test(c.b || "") && !DEAD.test(c.a || ""));
  const moved = res.changes.filter((c) => c.f === "agent" || c.f === "principal" || c.f === "mailing");
  if (died.length) {
    console.log("\n  COMPANIES THAT DIED SINCE THE LAST CHECK:");
    for (const x of died.slice(0, 40)) console.log("    " + x.id + "  " + x.a + " -> " + x.b);
  }
  if (moved.length) console.log("  address or lawyer changes: " + moved.length);
}
