import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import test from "node:test";

const execFileAsync = promisify(execFile);
const htmlUrl = new URL("../apps/web/index.html", import.meta.url);
const cssUrl = new URL("../apps/web/styles.css", import.meta.url);
const jsUrl = new URL("../apps/web/app.js", import.meta.url);
const replayCacheUrl = new URL("../apps/web/replay-cache.js", import.meta.url);

function luminance(hex: string): number {
  const values = hex.match(/[a-f0-9]{2}/gi)!.map(value => Number.parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
}

function contrast(left: string, right: string): number {
  const [light, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (light! + 0.05) / (dark! + 0.05);
}

test("web client is dependency-free, syntactically valid, and below its compressed budget", async () => {
  const [html, css, javascript, replayCache] = await Promise.all([readFile(htmlUrl), readFile(cssUrl), readFile(jsUrl), readFile(replayCacheUrl)]);
  await execFileAsync(process.execPath, ["--check", new URL(jsUrl).pathname]);
  await execFileAsync(process.execPath, ["--check", new URL(replayCacheUrl).pathname]);
  const compressed = gzipSync(Buffer.concat([html, css, javascript, replayCache])).byteLength;
  assert.ok(compressed < 300_000, `compressed initial client is ${compressed} bytes`);
  const source = Buffer.concat([html, css, javascript, replayCache]).toString("utf8").replace("http://www.w3.org/2000/svg", "");
  assert.equal(/https?:\/\//u.test(source), false);
});

test("web document has unique IDs and critical accessible interaction contracts", async () => {
  const html = await readFile(htmlUrl, "utf8");
  const css = await readFile(cssUrl, "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/gu)].map(match => match[1]!);
  assert.equal(new Set(ids).size, ids.length, "static IDs must be unique");
  assert.match(html, /<html lang="en">/u);
  assert.match(html, /class="skip-link"/u);
  assert.match(html, /<main id="workspace"/u);
  assert.match(html, /aria-live="polite"/u);
  assert.match(css, /prefers-reduced-motion/u);
  assert.equal(/\son(?:click|change|input|keydown)=/u.test(html), false, "inline event handlers are prohibited");
  for (const id of ["arena", "run-scenario", "json-source", "replay-tick", "why-content", "compare-target", "comparison-results"]) {
    assert.ok(ids.includes(id), `${id} must exist`);
  }
  for (const id of [
    "edit-preset", "ambient-light", "ambient-noise", "environment-event-tick", "environment-event-kind",
    "environment-event-value", "add-environment-event", "scheduled-event-list", "add-protect-objective",
    "add-separation-objective", "objective-list", "observation-overlay",
  ]) assert.ok(ids.includes(id), `${id} must exist`);
  for (const tool of ["select", "pan", "spawn", "obstacle", "light", "noise", "cover", "navigation", "exit"]) {
    assert.match(html, new RegExp(`data-tool="${tool}"`, "u"), `${tool} authoring tool must exist`);
  }
  assert.match(html, /Preset library · read only/u);
  assert.match(html, /Edit a copy/u);
  assert.match(html, /Show observations and uncertainty/u);
  for (const label of ["Readiness", "Resolve", "Initial fear"]) assert.match(html, new RegExp(`aria-label="${label}"`, "u"));
  assert.match(html, /Educational software—not training, legal advice, safety certification, or a predictor/u);
});

test("core palette meets WCAG AA normal-text contrast", () => {
  assert.ok(contrast("edf4f2", "091216") >= 4.5);
  assert.ok(contrast("8fa6a3", "101c20") >= 4.5);
  assert.ok(contrast("5ee0d4", "101c20") >= 4.5);
  assert.ok(contrast("f5b35b", "101c20") >= 4.5);
});

test("client source implements keyboard, autosave, validation, replay, branch, and comparison flows", async () => {
  const source = await readFile(jsUrl, "utf8");
  for (const evidence of [
    "event.metaKey", "living-here-draft", "/v1/validate", "runScenario", "replayActorsAt",
    "branchFromReplay", "runComparison", "firstTrueDivergence", "metricSummary", "aria-selected", "renderAuthoringMode",
    "renderScheduledEvents", "renderObjectives", "addEnvironmentZone", "mapPointFromEvent",
    "observationTrace", "observation-cone", "uncertainty-ring", "observation-link", "Export selected replay bundle",
  ]) assert.ok(source.includes(evidence), `client must include ${evidence}`);
  const css = await readFile(cssUrl, "utf8");
  assert.match(css, /@media \(max-width: 760px\)/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /:focus-visible/u);
  assert.match(css, /\.map-zone\.light/u);
  assert.match(css, /\.map-navigation/u);
  assert.match(css, /\.observation-cone/u);
  assert.match(css, /\.uncertainty-ring/u);
});
