#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { checksum, ENGINE_VERSION, runSimulation } from "../packages/engine/src/index.ts";
import type { ScenarioSpec } from "../packages/schema/src/index.ts";

const root = new URL("../", import.meta.url);
const scenario = JSON.parse(await readFile(new URL("packages/scenarios/fixtures/threat-ends.json", root), "utf8")) as ScenarioSpec;
const run = runSimulation(scenario);
const directory = new URL("docs/examples/", root);
await mkdir(directory, { recursive: true });
const runBytes = `${JSON.stringify(run, null, 2)}\n`;
await writeFile(new URL("threat-ends-run-v1.json", directory), runBytes);
const manifest = {
  schemaVersion: "1.0.0",
  release: "1.0.0",
  engineVersion: ENGINE_VERSION,
  examples: [{
    file: "threat-ends-run-v1.json",
    kind: "run-log",
    scenarioId: scenario.id,
    scenarioHash: checksum(scenario),
    artifactHash: checksum(run),
    finalChecksum: run.finalChecksum,
  }],
  limitations: "Synthetic game-model artifact; not training, legal advice, safety certification, or a predictor of real encounters.",
};
await writeFile(new URL("manifest.json", directory), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote release example ${manifest.examples[0].artifactHash}.`);
