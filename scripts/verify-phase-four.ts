#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { ExperimentService, experimentCsv, type ExperimentRequest } from "../packages/service/src/index.ts";
import type { ScenarioSpec } from "../packages/schema/src/index.ts";
import { ArtifactRepository, createBackup, MetadataRepository, verifyBackup } from "../packages/storage/src/index.ts";

const requiredFiles = [
  "apps/api/src/server.ts", "apps/api/src/index.ts", "packages/storage/src/metadata.ts",
  "packages/storage/src/artifacts.ts", "packages/storage/src/backup.ts", "packages/service/src/experiments.ts",
  "tests/persistence.test.ts", "docs/api-v1.md", "docs/phase-4-closure.md",
];
await Promise.all(requiredFiles.map(path => access(new URL(`../${path}`, import.meta.url))));
const root = await mkdtemp(join(tmpdir(), "living-here-phase4-"));
const metadata = new MetadataRepository(join(root, "metadata.sqlite"));
const artifacts = new ArtifactRepository(join(root, "artifacts"), metadata);
try {
  await artifacts.initialize();
  metadata.createProject("verify", "Phase 4 verification");
  const scenario = JSON.parse(await readFile(
    new URL("../packages/scenarios/fixtures/morale-cascade-1v3.json", import.meta.url), "utf8",
  )) as ScenarioSpec;
  const request: ExperimentRequest = {
    scenario,
    variants: [
      { id: "chen", policyId: "chen-inspired", actorIds: ["blue-one"] },
      { id: "sportive", policyId: "sportive", actorIds: ["blue-one"] },
    ],
    seeds: [11, 12],
  };
  const service = new ExperimentService(metadata, artifacts, "verification-worker");
  const job = service.enqueue("verify", "phase4", request);
  assert.equal(service.enqueue("verify", "phase4", request).id, job.id);
  assert.equal((await service.runNext())!.status, "completed");
  const result = await service.result(job.id);
  assert.equal(result.episodes.length, 4);
  assert.ok(result.episodes.every(episode => episode.metrics.postThreatCommitments === 0));
  assert.equal(experimentCsv(result).trim().split("\n").length, 5);
  const backupRoot = join(root, "backup");
  await createBackup(metadata, artifacts, backupRoot);
  assert.equal((await verifyBackup(backupRoot)).artifactHashes.length, 5);
  assert.equal(metadata.integrityCheck(), "ok");
  console.log(`Phase 4 verification passed: ${requiredFiles.length} artifacts, four paired episodes, five immutable artifacts, durable idempotency, exports, and verified backup.`);
} finally {
  metadata.close();
  await rm(root, { recursive: true, force: true });
}
