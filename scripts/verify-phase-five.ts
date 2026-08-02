#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const requiredFiles = [
  "apps/web/index.html", "apps/web/styles.css", "apps/web/app.js", "apps/web/replay-cache.js", "tests/web.test.ts",
  "docs/phase-5-closure.md", "docs/api-v1.md", "playwright.config.ts", "tests/browser/version-one.visual.spec.ts",
];
const browserNames = ["chromium", "firefox", "webkit"];
const snapshotNames = ["author-desktop.png", "author-tablet.png", "replay-overlay.png", "comparison-results.png"];
const visualBaselines = browserNames.flatMap(browser => snapshotNames.map(name => `tests/browser/__screenshots__/${browser}/${name}`));
await Promise.all([...requiredFiles, ...visualBaselines].map(path => access(new URL(`../${path}`, import.meta.url))));
const assets = await Promise.all(requiredFiles.slice(0, 4).map(path => readFile(new URL(`../${path}`, import.meta.url))));
const compressedBytes = gzipSync(Buffer.concat(assets)).byteLength;
assert.ok(compressedBytes < 300_000);
const html = assets[0]!.toString("utf8");
for (const marker of [
  "Scenario structure", "Map tools", "Scenario source", "Deterministic replay", "Explanation trace",
  "Paired experiment", "prefers-reduced-motion", "Synthetic model",
]) {
  const combined = Buffer.concat(assets).toString("utf8");
  assert.ok(combined.includes(marker), `web client must include ${marker}`);
}
const ids = [...html.matchAll(/\sid="([^"]+)"/gu)].map(match => match[1]!);
assert.equal(ids.length, new Set(ids).size);
for (const path of visualBaselines) {
  const bytes = await readFile(new URL(`../${path}`, import.meta.url));
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${path} must be a PNG baseline`);
  const expected = path.endsWith("author-tablet.png") ? [768, 1024] : [1440, 1000];
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], expected, `${path} must retain its accepted viewport`);
}
const playwright = await readFile(new URL("../playwright.config.ts", import.meta.url), "utf8");
for (const browser of browserNames) assert.ok(playwright.includes(`name: "${browser}"`), `Playwright config must include ${browser}`);
const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
for (const token of ["browser-regression", "playwright install --with-deps chromium firefox webkit", "npm run test:browsers"]) {
  assert.ok(ci.includes(token), `browser CI must include ${token}`);
}
console.log(`Phase 5 verification passed: ${requiredFiles.length} core artifacts, ${visualBaselines.length} visual baselines, ${compressedBytes} compressed bytes, unique static IDs, and Chromium/Firefox/WebKit author/replay/comparison coverage.`);
