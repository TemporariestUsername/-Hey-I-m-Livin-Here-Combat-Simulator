#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { checksum, ENGINE_VERSION } from "../packages/engine/src/index.ts";
import { chenInspiredPolicy, sportivePolicy } from "../packages/policies/src/index.ts";

const root = new URL("../", import.meta.url);
const required = [
  "docs/calibration/canonical-suite.md", "docs/calibration/canonical-results.json",
  "docs/calibration/report-0.6.md", "docs/calibration/source-trait-review.md",
  "docs/calibration/source-review-manifest.json", "docs/calibration/source-review-approval.json",
  "tests/calibration.test.ts", "tests/statistics.test.ts", "tests/source-review.test.ts",
  "packages/analysis/src/statistics.ts", "packages/analysis/src/source-review.ts",
];
await Promise.all(required.map(path => access(new URL(path, root))));
const results = JSON.parse(await readFile(new URL("docs/calibration/canonical-results.json", root), "utf8"));
assert.equal(results.engineVersion, ENGINE_VERSION);
assert.equal(results.cohort.count, 64);
assert.equal(results.scenarios.length, 6);
assert.equal(results.policies.find((policy: { id: string }) => policy.id === "chen-inspired")?.version, chenInspiredPolicy.version);
assert.equal(results.policies.find((policy: { id: string }) => policy.id === "sportive")?.version, sportivePolicy.version);
for (const row of results.scenarios) {
  const scenario = JSON.parse(await readFile(new URL(`packages/scenarios/fixtures/${row.fixture}`, root), "utf8"));
  assert.equal(row.scenarioHash, checksum(scenario), `${row.fixture} changed without regenerating calibration`);
  assert.equal(row.metrics.postThreatCommitments.chen.mean, 0);
  assert.equal(row.metrics.postThreatCommitments.sportive.mean, 0);
}
assert.equal(results.coefficientAudit.unexplainedWeightCount, 0);
assert.ok(results.coefficientAudit.maximumAbsoluteContributionShareAmongMultiTermDecisions < 0.6);
for (const comparison of Object.values(results.sensitivity.increasedFactorMinusBaseline) as Array<{ bootstrap95: { low: number } }>) {
  assert.ok(comparison.bootstrap95.low >= 0);
}
const approval = JSON.parse(await readFile(new URL("docs/calibration/source-review-approval.json", root), "utf8"));
assert.equal(approval.reviewPackageId, "source-trait-review-1.0");
assert.ok(["pending", "approved", "rejected"].includes(approval.status));
assert.match(approval.reviewPackageHash, /^[a-f0-9]{64}$/u);
console.log(`Phase 6 engineering verification passed: six fixtures, 64 paired seeds, bootstrap bands, monotonic sensitivity, threat disengagement, and coefficient provenance. Human review status: ${approval.status}.`);
