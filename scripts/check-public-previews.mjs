import fs from "node:fs";
const catalog = JSON.parse(fs.readFileSync("catalog/instrumentals.json", "utf8"));
const tracks = catalog.tracks;
const failures = [];
let cursor = 0;

async function checkTrack(track) {
  const timeout = AbortSignal.timeout(15000);
  const response = await fetch(track.preview, {
    headers: { Range: "bytes=0-4095", "User-Agent": "BruA1-Preview-QA/1.0" },
    redirect: "follow",
    signal: timeout
  });
  if (!response.ok || ![200, 206].includes(response.status)) {
    throw new Error("HTTP " + response.status);
  }
  const type = response.headers.get("content-type") || "";
  if (!/audio|mpeg|mp3|octet-stream/i.test(type)) {
    throw new Error("Unexpected content-type: " + type);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");
  const first = await reader.read();
  await reader.cancel().catch(() => {});
  if (!first.value?.length) throw new Error("Empty audio response");
  const b = first.value;
  const id3 = b.length > 2 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
  const frame = b.length > 1 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0;
  if (!id3 && !frame) throw new Error("Response does not start with MP3 data");
  console.log("PASS", track.id, track.title, response.status, type);
}
async function worker() {
  while (cursor < tracks.length) {
    const track = tracks[cursor++];
    try { await checkTrack(track); }
    catch (error) {
      failures.push({ id: track.id, title: track.title, error: String(error?.message || error) });
      console.error("FAIL", track.id, track.title, String(error?.message || error));
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()));
console.log("Public MP3 preview check", tracks.length - failures.length, "/", tracks.length, "PASS");
if (failures.length) process.exitCode = 1;
