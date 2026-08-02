#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { checksum, ENGINE_VERSION, runSimulation } from "../packages/engine/src/index.ts";
import { parseJsonDocument, validateScenario, type ScenarioSpec } from "../packages/schema/src/index.ts";

const requiredFiles = [
  "docs/decisions/0001-deterministic-runtime.md",
  "docs/decisions/0002-prng.md",
  "docs/decisions/0003-schema-and-events.md",
  "docs/decisions/0004-safety-abstraction.md",
  "docs/decisions/0005-numeric-precision.md",
  "docs/decisions/0006-persistence.md",
  "docs/security/threat-model.md",
  "docs/security/prohibited-content-policy.md",
  "docs/phase-0-decision-register.md",
  "docs/phase-0-closure.md",
  ".github/workflows/ci.yml",
  "packages/schema/schema/scenario-1.3.0.schema.json",
  "packages/schema/schema/simulation-state-1.3.0.schema.json",
  "packages/schema/schema/simulation-event-1.3.0.schema.json",
  "packages/schema/schema/trace-record-1.3.0.schema.json",
  "packages/schema/schema/run-log-1.3.0.schema.json",
  "packages/schema/schema/continuation-1.0.0.schema.json",
  "packages/schema/src/content-policy.ts",
  "packages/schema/src/import-limits.ts",
  "scripts/generate-schema-types.ts",
  "benchmarks/fixtures/benchmark-32-actors.json",
  "benchmarks/run-benchmark.ts",
  "docs/benchmarks/phase-0-reference.json",
];
await Promise.all(requiredFiles.map(path => access(new URL(`../${path}`, import.meta.url))));

for (const path of requiredFiles.filter(path => path.startsWith("docs/decisions/"))) {
  const document = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  for (const field of ["Status", "Decision date", "Owner", "Risk"]) {
    assert.match(document, new RegExp(`- \\*\\*${field}:\\*\\*?`, "i"), `${path} must record ${field}`);
  }
  for (const section of ["Context", "Decision", "Alternatives considered", "Consequences", "Review trigger"]) {
    assert.match(document, new RegExp(`^## ${section}`, "im"), `${path} must include ${section}`);
  }
}

const register = await readFile(new URL("../docs/phase-0-decision-register.md", import.meta.url), "utf8");
assert.doesNotMatch(register, /\|\s*Open\s*\|/i, "decision register must not contain open entries");
assert.match(register, /There are no open Phase 0 design choices\./);
const decisionRows = register.split("\n").filter(line => /^\| D-\d{3} \|/u.test(line));
assert.ok(decisionRows.length >= 12, "decision register must enumerate every accepted Phase 0 choice");
for (const row of decisionRows) {
  const cells = row.split("|").slice(1, -1).map(cell => cell.trim());
  assert.equal(cells.length, 7, `decision row must contain all required fields: ${row}`);
  assert.ok(cells.every(Boolean), `decision row must not contain an empty field: ${row}`);
  assert.equal(cells[6], "Closed", `decision row must be closed: ${cells[0]}`);
  assert.match(cells[4]!, /^\d{4}-\d{2}-\d{2}$/u, `decision row must contain an ISO decision date: ${cells[0]}`);
}

const threatModel = await readFile(new URL("../docs/security/threat-model.md", import.meta.url), "utf8");
for (const field of ["Review ID", "Scope", "Review date", "Risk owner", "Engineering reviewer", "Disposition"]) {
  assert.match(threatModel, new RegExp(`- \\*\\*${field}:\\*\\* \\S`, "i"), `threat model must record ${field}`);
}
for (let id = 1; id <= 14; id += 1) assert.match(threatModel, new RegExp(`\\| T-${String(id).padStart(2, "0")} \\|`));
assert.match(threatModel, /^## Review findings and changes$/m);
assert.match(threatModel, /^## Acceptance and triggers$/m);

const policy = await readFile(new URL("../docs/security/prohibited-content-policy.md", import.meta.url), "utf8");
for (const field of ["Status", "Policy date", "Owner", "Risk", "Applies to"]) {
  assert.match(policy, new RegExp(`- \\*\\*${field}:\\*\\* \\S`, "i"), `content policy must record ${field}`);
}
for (let category = 1; category <= 9; category += 1) assert.match(policy, new RegExp(`^${category}\\. `, "m"));

const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
for (const token of ["ubuntu-latest", "windows-latest", "macos-latest", "node: [22, 24]"]) {
  assert.ok(ci.includes(token), `CI determinism matrix must include ${token}`);
}

for (const path of [
  "packages/scenarios/fixtures/threat-ends.json",
  "packages/scenarios/fixtures/safety-positive.json",
  "benchmarks/fixtures/benchmark-32-actors.json",
]) {
  const input = parseJsonDocument(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
  assert.deepEqual(validateScenario(input), { valid: true, errors: [] }, `${path} must validate`);
}

const negativeCases: Record<string, string> = {
  "unknown-field": "is not allowed",
  "prohibited-field": "[prohibited-field]",
  "active-markup": "[active-markup]",
  "remote-resource": "[remote-resource]",
  "procedural-instruction": "[procedural-instruction]",
  "anatomical-harm": "[anatomical-harm]",
  "injury-mechanism-field": "[prohibited-field]",
  "real-world-optimization-field": "[prohibited-field]",
  "weapon-use-field": "[prohibited-field]",
  "certification-claim": "[certification-claim]",
};
for (const [name, expectedError] of Object.entries(negativeCases)) {
  const path = `packages/scenarios/fixtures/negative/${name}.json`;
  const input = parseJsonDocument(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
  const validation = validateScenario(input);
  assert.equal(validation.valid, false, `${path} must fail closed`);
  assert.ok(validation.errors.some(error => error.includes(expectedError)), `${path} must fail for ${expectedError}`);
}

for (const path of requiredFiles.filter(path => path.endsWith(".schema.json"))) {
  const schema = parseJsonDocument(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
  const pending: Array<{ value: unknown; location: string }> = [{ value: schema, location: "$" }];
  while (pending.length > 0) {
    const { value, location } = pending.pop()!;
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (record.type === "object" && record.$ref === undefined) {
      assert.ok(Object.hasOwn(record, "additionalProperties"), `${path} ${location} must declare its unknown-field policy`);
      assert.notEqual(record.additionalProperties, true, `${path} ${location} must not accept unconstrained unknown fields`);
    }
    for (const [key, child] of Object.entries(record)) {
      if (child && typeof child === "object") pending.push({ value: child, location: `${location}.${key}` });
    }
  }
}

const benchmark = parseJsonDocument(await readFile(new URL("../benchmarks/fixtures/benchmark-32-actors.json", import.meta.url), "utf8")) as ScenarioSpec;
const baseline = parseJsonDocument(await readFile(new URL("../docs/benchmarks/phase-0-reference.json", import.meta.url), "utf8")) as {
  recordedAt: string;
  engineVersion: string;
  actors: number;
  pulses: number;
  samples: number;
  warmups: number;
  artifactHash: string;
  finalChecksum: string;
  eventCount: number;
  traceCount: number;
  budgetMet: boolean;
  p95Ms: number;
  phase2TargetMs: number;
  sameEnvironmentRegressionThresholdMs: number;
  environment: { node: string; platform: string; release: string; architecture: string; cpu: string };
  methodology: string;
  uncertainty: string;
};
const log = runSimulation(benchmark);
assert.match(baseline.recordedAt, /^\d{4}-\d{2}-\d{2}$/u);
assert.equal(baseline.engineVersion, ENGINE_VERSION);
assert.equal(baseline.actors, benchmark.actors.length);
assert.equal(baseline.pulses, benchmark.maxTicks);
assert.ok(baseline.samples >= 10 && baseline.warmups >= 1, "baseline must retain the accepted sampling method");
assert.equal(checksum(log), baseline.artifactHash, "benchmark artifact hash must match the committed baseline");
assert.equal(log.finalChecksum, baseline.finalChecksum, "benchmark final checksum must match the committed baseline");
assert.equal(log.events.length, baseline.eventCount, "benchmark event count must match the committed baseline");
assert.equal(log.traces.length, baseline.traceCount, "benchmark trace count must match the committed baseline");
assert.equal(baseline.traceCount, baseline.actors * baseline.pulses, "benchmark must trace every actor-pulse");
assert.equal(baseline.budgetMet, baseline.p95Ms < baseline.phase2TargetMs, "budget flag must honestly reflect the Phase 2 target");
assert.ok(baseline.p95Ms < baseline.sameEnvironmentRegressionThresholdMs, "reference baseline must remain inside its separate regression ceiling");
assert.ok(Object.values(baseline.environment).every(value => typeof value === "string" && value.length > 0), "baseline must name its reference environment");
assert.ok(baseline.methodology.length > 40 && baseline.uncertainty.length > 40, "baseline must record methodology and uncertainty");

console.log(`Phase 0 verification passed: ${requiredFiles.length} required artifacts, 3 positive fixtures, 10 negative fixtures, ${decisionRows.length} closed decisions, and benchmark identity ${baseline.artifactHash}.`);
