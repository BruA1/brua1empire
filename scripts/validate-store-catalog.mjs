import fs from "node:fs";
import assert from "node:assert/strict";

const data = JSON.parse(fs.readFileSync("catalog/instrumentals.json", "utf8"));
const page = fs.readFileSync("instrumentals.html", "utf8");
const titles = new Set();
const expectedPreviewBase = "https://pub-994c8c7a928c44ba9521493dbdeb80cf.r2.dev/";

assert(Array.isArray(data.tracks) && data.tracks.length > 0, "Catalog must contain tracks");
assert.equal(data.trackCount, data.tracks.length, "Catalog track count mismatch");
assert.equal(data.checkoutEnabled, false, "Public checkout must remain disabled until separate launch approval");
assert(page.includes('fetch("catalog/instrumentals.json"'), "Storefront must load the JSON catalog");
assert(page.includes('licensing_inquiry_only'), "Storefront must require inquiry-only listings");
assert(page.includes("PayPal checkout coming soon"), "Live checkout must not be implied");

for (const track of data.tracks) {
  assert.equal(typeof track.title, "string");
  assert(track.title && track.title.trim() === track.title, "Missing or padded track title");
  assert(!titles.has(track.title.toLocaleLowerCase()), "Duplicate title: " + track.title);
  titles.add(track.title.toLocaleLowerCase());
  assert.deepEqual(track.formats.filter(f => !["MP3", "WAV"].includes(f)), [], "Unknown format");
  assert(track.formats.includes("MP3"), "Basic license requires MP3: " + track.title);
  assert(typeof track.id==="string" && track.id.startsWith("BRUA1-INS-") && track.id.length===14 && [...track.id.slice(-4)].every(ch=>ch>="0"&&ch<="9"), "Missing stable product ID");
  assert.equal(track.listing_status, "licensing_inquiry_only", "Unexpected sale-enabled track");
  assert.equal(track.inventory_status, "private_master_uploaded", "Master not verified in inventory");
  assert(!Object.keys(track).some(key => /private|r2_object|download_token|secret|api_key|master_key/i.test(key)),
    "Private download metadata in public catalog: " + track.title);
  if (track.preview !== null) {
    assert.equal(typeof track.preview, "string", "Invalid preview type");
    const u = new URL(track.preview);
    assert(track.preview.startsWith(expectedPreviewBase), "Unrecognized preview host");
    const tagged = u.pathname.endsWith("_TAGGED_PREVIEW.mp3");
    const short = u.pathname.startsWith("/store-previews/BRUA1-INS-") && u.pathname === "/store-previews/" + track.id + ".mp3";
    assert(tagged || short, "Only tagged or numbered public short-preview URLs are allowed");
    if(short) assert.equal(u.pathname, "/store-previews/" + track.id + ".mp3", "Short preview must match product ID");
    assert(!decodeURIComponent(u.pathname).toLowerCase().includes("untagged"), "Untagged master exposed");
  }
}
const serialized = JSON.stringify(data);
assert(!/brua1-instrumentals-masters|r2_object_key|secret_access_key|PAYPAL_CLIENT_SECRET|Unt(a|q)gged\.mp3/i.test(serialized),
  "Public catalog contains sensitive material or private file names");
assert(titles.has("loving you"), "Owner-approved Loving You display title missing");
assert(!titles.has("lovinu") && !titles.has("luvinU".toLowerCase()), "Source-only misspelling exposed");
console.log("PASS BruA1 catalog privacy and listing QA:", data.tracks.length, "tracks.",
  data.tracks.filter(t=>t.preview).length, "tagged and short preview targets (HTTP listening QA still required).");
