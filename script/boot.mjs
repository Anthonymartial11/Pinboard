// Opens the bundle and runs one thing out of it.
//   node script/boot.mjs archive
import fs from "fs";
import zlib from "zlib";
import crypto from "crypto";
import os from "os";
import path from "path";

const key = Buffer.from((process.env.ARGUS_KEY || "").trim(), "base64");
if (key.length !== 32) {
  console.error("ARGUS_KEY is missing or the wrong size, so nothing can be started.");
  console.error("Set it in the repository's Actions secrets. Nothing here runs without it.");
  process.exit(1);
}
const want = process.argv[2];
if (!want) { console.error("nothing named to run"); process.exit(1); }

const HERE = new URL(".", import.meta.url).pathname;
const buf = fs.readFileSync(HERE + "bundle.enc");
let files;
try {
  const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  files = JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()])).toString("utf8"));
} catch (e) {
  console.error("The bundle would not open. Either the key is wrong or the file has been altered.");
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-"));
for (const [name, src] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), src);
// Unpacked, the scripts sit in a scratch directory, so both of these have to
// be told rather than worked out. In the published repository the checkout IS
// the folder the files live in, which is not true in a working copy.
const repo = path.resolve(HERE, "..") + "/";
process.env.ARGUS_ROOT = repo;
if (!process.env.ARGUS_PUB) process.env.ARGUS_PUB = repo;

const target = path.join(dir, want.endsWith(".mjs") ? want : want + ".mjs");
if (!fs.existsSync(target)) { console.error("no such thing in the bundle: " + want); process.exit(1); }
try {
  await import(target);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
