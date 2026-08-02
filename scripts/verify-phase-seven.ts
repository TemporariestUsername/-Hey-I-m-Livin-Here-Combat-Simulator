#!/usr/bin/env node
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { checksum, ENGINE_VERSION, replay } from "../packages/engine/src/index.ts";
import { assertRunLog } from "../packages/schema/src/index.ts";

const root = new URL("../", import.meta.url);
const required = [
  "docs/security/threat-model.md", "docs/operations/operations-guide.md", "docs/operations/load-and-reliability.md",
  "docs/user-guide.md", "docs/release-checklist.md", "docs/phase-7-closure.md",
  "docs/examples/manifest.json", "docs/examples/threat-ends-run-v1.json", "tests/hardening.test.ts",
  "scripts/operations.ts", "apps/web/replay-cache.js", "scripts/generate-source-review-manifest.ts",
  "scripts/verify-source-review.ts", "docs/calibration/source-review-manifest.json",
  "docs/calibration/source-review-approval.json",
];
await Promise.all(required.map(path => access(new URL(path, root))));
const manifest = JSON.parse(await readFile(new URL("docs/examples/manifest.json", root), "utf8"));
const run = JSON.parse(await readFile(new URL("docs/examples/threat-ends-run-v1.json", root), "utf8"));
assertRunLog(run);
assert.equal(manifest.release, "1.0.0");
assert.equal(manifest.engineVersion, ENGINE_VERSION);
assert.equal(manifest.examples[0].artifactHash, checksum(run));
assert.equal(manifest.examples[0].finalChecksum, run.finalChecksum);
assert.deepEqual(replay(run), run.finalState);
const checklist = await readFile(new URL("docs/release-checklist.md", root), "utf8");
assert.match(checklist, /Approved for Version 1\.0\.0 local release/u);
const approval = JSON.parse(await readFile(new URL("docs/calibration/source-review-approval.json", root), "utf8"));
assert.equal(approval.status, "approved");
assert.equal(approval.decision, "approved");
const threatModel = await readFile(new URL("docs/security/threat-model.md", root), "utf8");
for (const control of ["loopback Host", "same-origin Origin", "5,000,000", "Version 2 manifest", "No automated critical or high finding remains open"]) {
  assert.ok(threatModel.includes(control), `threat model must record ${control}`);
}
console.log("Phase 7 verification passed: security, load, cached replay, migration, backup/rollback, operations, guides, versioned artifacts, and approved Version 1 release record.");
