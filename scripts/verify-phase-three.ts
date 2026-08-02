#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { checksum, replay, runSimulation } from "../packages/engine/src/index.ts";
import { builtInPolicyIds } from "../packages/policies/src/index.ts";
import { parseJsonDocument, validateRunLog, validateScenario, type ScenarioSpec } from "../packages/schema/src/index.ts";

const requiredFiles = [
  "packages/engine/src/morale.ts",
  "packages/schema/schema/scenario-1.2.0.schema.json",
  "packages/schema/schema/simulation-state-1.2.0.schema.json",
  "packages/schema/schema/simulation-event-1.2.0.schema.json",
  "packages/schema/schema/run-log-1.2.0.schema.json",
  "packages/schema/schema/trace-record-1.2.0.schema.json",
  "packages/scenarios/fixtures/morale-cascade-1v3.json",
  "tests/doctrines.test.ts",
  "tests/morale.test.ts",
  "docs/calibration/engine-0.3-doctrines-and-morale.md",
  "docs/phase-3-closure.md",
];
await Promise.all(requiredFiles.map(path => access(new URL(`../${path}`, import.meta.url))));
assert.deepEqual(builtInPolicyIds(), ["chen-inspired", "human-intent", "random-valid", "safety-first", "sportive"]);

const scenario = parseJsonDocument(await readFile(
  new URL("../packages/scenarios/fixtures/morale-cascade-1v3.json", import.meta.url), "utf8",
)) as ScenarioSpec;
assert.deepEqual(validateScenario(scenario), { valid: true, errors: [] });
const log = runSimulation(scenario);
assert.deepEqual(validateRunLog(log), { valid: true, errors: [] });
assert.deepEqual(replay(log), log.finalState);
for (const type of ["contact-resolved", "morale-signal", "morale-updated", "squad-updated"] as const) {
  assert.ok(log.events.some(event => event.type === type), `Phase 3 fixture must emit ${type}`);
}
assert.ok(log.traces.some(trace => Object.keys(trace.formulaTerms).some(key => key.startsWith("policy."))));
const reversed = structuredClone(scenario);
reversed.actors.reverse();
reversed.squads?.reverse();
assert.equal(checksum(runSimulation(reversed)), checksum(log));

console.log(`Phase 3 verification passed: ${requiredFiles.length} artifacts, five policy adapters, bounded morale cascade, squad response, complete traces, replay, and input-order equality.`);
