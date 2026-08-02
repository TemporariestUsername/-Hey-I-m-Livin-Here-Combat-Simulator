#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { checksum, replay, runSimulation } from "../packages/engine/src/index.ts";
import { parseJsonDocument, validateRunLog, validateScenario, type ScenarioSpec } from "../packages/schema/src/index.ts";

const requiredFiles = [
  "packages/engine/src/mechanics.ts",
  "packages/schema/schema/scenario-1.1.0.schema.json",
  "packages/schema/schema/simulation-state-1.1.0.schema.json",
  "packages/schema/schema/simulation-event-1.1.0.schema.json",
  "packages/schema/schema/run-log-1.1.0.schema.json",
  "packages/schema/schema/trace-record-1.1.0.schema.json",
  "packages/scenarios/fixtures/sudden-crisis-physics.json",
  "tests/mechanics.test.ts",
  "docs/phase-2-closure.md",
];
await Promise.all(requiredFiles.map(path => access(new URL(`../${path}`, import.meta.url))));

const input = parseJsonDocument(
  await readFile(new URL("../packages/scenarios/fixtures/sudden-crisis-physics.json", import.meta.url), "utf8"),
) as ScenarioSpec;
assert.deepEqual(validateScenario(input), { valid: true, errors: [] });
const log = runSimulation(input);
assert.deepEqual(validateRunLog(log), { valid: true, errors: [] });
assert.deepEqual(replay(log), log.finalState);
for (const type of [
  "tempo-resolved",
  "contact-resolved",
  "effects-applied",
  "objective-updated",
  "terminal-reached",
]) {
  assert.ok(log.events.some(event => event.type === type), `physics fixture must emit ${type}`);
}
assert.equal(log.traces.length, input.actors.length * log.finalState.tick, "every actor/pulse must have a trace");
assert.ok(log.traces.every(trace => trace.actorStateChecksum.length === 64));
assert.equal(log.finalState.objectiveProgress["end-immediate-threat"], true);
assert.equal(log.finalState.terminalReason, "objective-complete-end-immediate-threat");

const reversed = structuredClone(input);
reversed.actors.reverse();
assert.equal(checksum(runSimulation(reversed)), checksum(log), "physics artifact must ignore actor input order");

const benchmark = parseJsonDocument(
  await readFile(new URL("../benchmarks/fixtures/benchmark-32-actors.json", import.meta.url), "utf8"),
) as ScenarioSpec;
const baseline = parseJsonDocument(
  await readFile(new URL("../docs/benchmarks/phase-0-reference.json", import.meta.url), "utf8"),
) as {
  physicsEnabled: boolean;
  p95Ms: number;
  phase2TargetMs: number;
  budgetMet: boolean;
  artifactHash: string;
  finalChecksum: string;
  eventCount: number;
  traceCount: number;
};
assert.equal(benchmark.rules?.physics?.enabled, true);
assert.equal(baseline.physicsEnabled, true);
assert.equal(baseline.budgetMet, true);
assert.ok(baseline.p95Ms < baseline.phase2TargetMs);
const benchmarkLog = runSimulation(benchmark);
assert.equal(checksum(benchmarkLog), baseline.artifactHash);
assert.equal(benchmarkLog.finalChecksum, baseline.finalChecksum);
assert.equal(benchmarkLog.events.length, baseline.eventCount);
assert.equal(benchmarkLog.traces.length, baseline.traceCount);
assert.ok(benchmarkLog.events.some(event => event.type === "contact-resolved"));

console.log(
  `Phase 2 verification passed: ${requiredFiles.length} artifacts, complete physics traces, actor-order independence, and physics benchmark p95 ${baseline.p95Ms} ms < ${baseline.phase2TargetMs} ms.`,
);
