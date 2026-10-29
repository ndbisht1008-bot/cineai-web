// Browser tests in a real Chromium (system Chrome/Chromium, no browser download).
//   node e2e/run.mjs            all offline tests (no AI quota used)
//   node e2e/run.mjs --live     also calls the real LTX-Video Space once (uses free GPU quota if any is left)
// CHROME_PATH selects the browser; defaults to /usr/bin/chromium or google-chrome.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const LIVE = process.argv.includes("--live");
const PORT = 5179;
const ROOT = `http://localhost:${PORT}/`;
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME_PATH ?? ["/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find(existsSync);
if (!exe) { console.error("No Chrome/Chromium found; set CHROME_PATH."); process.exit(2); }

const server = spawn("node_modules/.bin/vite", ["--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((res, rej) => { server.stdout.on("data", (d) => { if (String(d).includes("Local")) res(); }); setTimeout(() => rej(new Error("vite did not start")), 30000); });

const browser = await chromium.launch({ executablePath: exe, args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"] });
const results = [];
async function test(name, fn) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g|ERR_NAME|net::ERR_INTERNET|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const t0 = Date.now();
  try {
    const info = await fn(page);
    if (errors.length) throw new Error("console errors: " + errors.join(" | "));
    results.push({ name, ok: true, sec: (Date.now() - t0) / 1000, info });
    console.log(`PASS ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${info ? " " + JSON.stringify(info) : ""}`);
  } catch (e) {
    results.push({ name, ok: false, sec: (Date.now() - t0) / 1000, info: String(e.message ?? e) });
    console.log(`FAIL ${name}: ${e.message ?? e}`);
    await page.screenshot({ path: `${OUT}${name.replace(/\W+/g, "_")}.png` }).catch(() => {});
  } finally { await page.close(); }
}
const fixture = (n) => new URL(`../test/fixtures/${n}`, import.meta.url).pathname;

// Loads a fixture in the page and runs a lib function from the dev server's module graph.
async function inPage(page, fn, arg) { await page.goto(ROOT); return page.evaluate(fn, arg); }

await test("motion check on real AI clips and slideshow clips (real decoder)", async (page) => {
  const names = ["ltx_t2v_walk.mp4", "ltx_i2v_continue.mp4", "ltx_t2v_village.mp4", "kenburns_zoom.mp4", "kenburns_pan.mp4", "crossfade.mp4", "static.mp4"];
  const out = await inPage(page, async (names) => {
    const { checkMotion } = await import("/src/lib/media.ts");
    const r = {};
    for (const n of names) {
      const b = await (await fetch(`/test/fixtures/${n}`)).blob();
      const t0 = performance.now();
      const m = await checkMotion(b);
      r[n] = { verdict: m.verdict, moving: m.movingPairs, sec: Math.round(performance.now() - t0) / 1000 };
    }
    return r;
  }, names);
  for (const n of names.slice(0, 3)) if (out[n].verdict !== "real_motion") throw new Error(`${n}: ${JSON.stringify(out[n])}`);
  for (const n of names.slice(3)) if (out[n].verdict === "real_motion") throw new Error(`${n} accepted as real motion: ${JSON.stringify(out[n])}`);
  return out;
});

await test("beat analysis in a Web Worker on a decoded WAV", async (page) => {
  return inPage(page, async () => {
    const { makeSong } = await import("/test/synth.ts");
    const { analyzeSong } = await import("/src/lib/analyzeSong.ts");
    const x = makeSong(120, 44100);
    const buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + x.length * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, x.length * 2, true);
    x.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true));
    const a = await analyzeSong(new Blob([buf], { type: "audio/wav" }), () => {});
    if (Math.abs(a.bpm - 120) > 2.4) throw new Error(`bpm ${a.bpm}`);
    return { bpm: a.bpm, sections: a.sections.map((s) => s.label).join(",") };
  });
});

async function uploadFixture(page, selector, name, type) {
  const buf = (await import("node:fs")).readFileSync(fixture(name));
  await page.setInputFiles(selector, { name, mimeType: type, buffer: buf });
}
async function exportAndCheck(page, prefix) {
  await page.getByRole("tab", { name: /Edit & export/ }).click();
  await page.getByRole("button", { name: "Export film" }).click();
  const dl = page.getByRole("link", { name: /Download MP4/ });
  await dl.waitFor({ timeout: 300000 });
  const href = await dl.getAttribute("href");
  const info = await page.evaluate(async (href) => {
    const b = await (await fetch(href)).blob();
    const { probeVideo, audioCodecOf } = await import("/src/lib/media.ts");
    const a = await audioCodecOf(b);
    const p = await probeVideo(b);
    const bytes = new Uint8Array(await b.arrayBuffer());
    let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ...p, size: b.size, audio: a, b64: btoa(s) };
  }, href);
  writeFileSync(`${OUT}${prefix}.mp4`, Buffer.from(info.b64, "base64"));
  delete info.b64;
  return info;
}

await test("Script to Movie: plan, import real clips, export MP4 with subtitles", async (page) => {
  await page.goto(ROOT);
  await page.getByRole("button", { name: /Script to Movie/ }).click();
  await page.locator("#script").fill("पहाड़ों के बीच एक छोटा सा गाँव था। एक सुबह रवि अपने घर से निकला और पहाड़ी रास्ते पर चलने लगा। बादल धीरे-धीरे घाटी में उतर रहे थे।");
  await page.getByRole("button", { name: /Plan storyboard/ }).click();
  const cards = page.locator("li.card");
  await cards.first().waitFor({ timeout: 30000 });
  const n = await cards.count();
  if (n < 2) throw new Error(`only ${n} shots planned`);
  const clips = ["ltx_t2v_walk.mp4", "ltx_i2v_continue.mp4", "ltx_t2v_village.mp4"];
  for (let i = 0; i < n; i++) {
    await uploadFixture(page, `li.card >> nth=${i} >> input[type=file]`, clips[i % 3], "video/mp4");
    await cards.nth(i).getByText(/Imported clip ready/).waitFor({ timeout: 60000 });
  }
  const info = await exportAndCheck(page, "movie");
  if (info.durationSec < 5) throw new Error(`film too short: ${JSON.stringify(info)}`);
  if (info.width !== 720 || info.height !== 1280) throw new Error(`size ${info.width}x${info.height}`);
  return { shots: n, ...info };
});

await test("Music Video Studio: analyse song, plan beat-synced shots, export with the song", async (page) => {
  await page.goto(ROOT);
  await page.getByRole("button", { name: /Music Video Studio/ }).click();
  const wav = await page.evaluate(async () => {
    const { makeSong } = await import("/test/synth.ts");
    const x = makeSong(96, 22050).slice(0, 22050 * 30);
    const buf = new ArrayBuffer(44 + x.length * 2), v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + x.length * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 22050, true); v.setUint32(28, 44100, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, x.length * 2, true);
    x.forEach((s, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true));
    const bytes = new Uint8Array(buf); let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  });
  await page.setInputFiles("input[type=file]", { name: "test_song_96bpm.wav", mimeType: "audio/wav", buffer: Buffer.from(wav, "base64") });
  await page.getByText(/BPM/).first().waitFor({ timeout: 60000 });
  const bpm = await page.locator(".chip", { hasText: "BPM" }).first().innerText();
  await page.locator("#mp").fill("A powerful male performer rapping in the Himalayas at night, aerial mountain landscapes, fire and smoke.");
  await page.locator("#mc").fill("3");
  await page.getByRole("button", { name: /Plan beat-synced shots/ }).click();
  await page.locator("li.card").first().waitFor({ timeout: 30000 });
  const owners = page.locator("li.card:has(textarea)");
  const n = await owners.count();
  const total = await page.locator("li.card").count();
  const clips = ["ltx_t2v_walk.mp4", "ltx_i2v_continue.mp4", "ltx_t2v_village.mp4"];
  for (let i = 0; i < n; i++) {
    await uploadFixture(page, `li.card:has(textarea) >> nth=${i} >> input[type=file]`, clips[i % 3], "video/mp4");
    await owners.nth(i).getByText(/Imported clip ready/).waitFor({ timeout: 60000 });
  }
  const info = await exportAndCheck(page, "music_video");
  if (Math.abs(info.durationSec - 30) > 1) throw new Error(`duration ${info.durationSec}`);
  if (!info.audio) throw new Error("no audio track");
  return { bpm, uniqueClips: n, shots: total, ...info };
});

await test("Provider failure: Gemini without billing shows a clear error and keeps the shot unfinished", async (page) => {
  await page.route("https://generativelanguage.googleapis.com/**", (r) => r.fulfill({ status: 403, body: '{"error":{"message":"Video generation is not available on the free tier."}}' }));
  await page.goto(ROOT);
  await page.evaluate(() => localStorage.setItem("cineai.settings", JSON.stringify({ provider: "gemini", geminiKey: "TESTKEY", rememberKeys: true, consent: true, hfToken: "" })));
  await page.getByRole("button", { name: /Script to Movie/ }).click();
  await page.locator("#script").fill("The river ran fast through the green valley. A boy watched it from the old bridge.");
  await page.getByRole("button", { name: /Plan storyboard/ }).click();
  await page.getByRole("tab", { name: /Generate$/ }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Generate \d+ missing/ }).click();
  await page.getByText(/needs the paid tier/).first().waitFor({ timeout: 30000 });
  const exportDisabled = await (async () => { await page.getByRole("tab", { name: /Edit & export/ }).click(); return page.getByRole("button", { name: "Export film" }).isDisabled(); })();
  if (!exportDisabled) throw new Error("export was enabled without clips");
  return { message: "billing error shown, export locked" };
});

await test("Phone-width layout has no horizontal scroll", async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
  await page.goto(ROOT);
  await page.getByRole("button", { name: /Script to Movie/ }).click();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  await page.screenshot({ path: `${OUT}phone_script.png` });
  await page.close();
  if (over > 1) throw new Error(`page is ${over}px wider than the screen`);
});

if (LIVE) await test("LIVE: LTX-Video Space from the browser (CORS + queue + real answer)", async (page) => {
  return inPage(page, async () => {
    const { ltxProvider } = await import("/src/lib/providers/ltx.ts");
    const { checkMotion } = await import("/src/lib/media.ts");
    const events = [];
    try {
      const r = await ltxProvider().generate({ prompt: "medium shot, an old woman in a red shawl waves from a stone doorway in a Himalayan village, wind moves her shawl, realistic cinematic film footage, one continuous shot", negativePrompt: "static image, still frame, slideshow, blurry", mode: "t2v", durationSec: 3, aspect: "9:16", seed: 1234 }, (p) => events.push(p.stage), new AbortController().signal);
      const m = await checkMotion(r.blob);
      return { outcome: "clip", size: r.blob.size, verdict: m.verdict, events: [...new Set(events)] };
    } catch (e) {
      return { outcome: "provider error", kind: e.kind, message: e.message, events: [...new Set(events)] };
    }
  });
});

await browser.close();
server.kill();
writeFileSync(`${OUT}results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
