import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApiServer, listenLocal } from "../apps/api/src/server.ts";
import { checksum, runSimulation } from "../packages/engine/src/index.ts";
import {
  ExperimentService, IdempotencyConflictError, experimentCsv, type ExperimentRequest,
} from "../packages/service/src/index.ts";
import type { ScenarioSpec } from "../packages/schema/src/index.ts";
import {
  ArtifactRepository, createBackup, MetadataRepository, restoreBackup, verifyBackup,
} from "../packages/storage/src/index.ts";

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "living-here-storage-"));
  const metadata = new MetadataRepository(join(root, "metadata.sqlite"));
  const artifacts = new ArtifactRepository(join(root, "artifact-store"), metadata);
  await artifacts.initialize();
  return { root, metadata, artifacts };
}

async function scenario(): Promise<ScenarioSpec> {
  return JSON.parse(await readFile(new URL("../packages/scenarios/fixtures/morale-cascade-1v3.json", import.meta.url), "utf8")) as ScenarioSpec;
}

test("content-addressed artifacts remain project-authorized and crash-consistent", async () => {
  const store = await workspace();
  try {
    store.metadata.createProject("one", "One");
    store.metadata.createProject("two", "Two");
    const bytes = Buffer.from("shared immutable bytes");
    const hash = await store.artifacts.publish("one", bytes, "test");
    assert.deepEqual(Buffer.from(await store.artifacts.read("one", hash)), bytes);
    await assert.rejects(() => store.artifacts.read("two", hash), /not authorized/);
    assert.equal(await store.artifacts.publish("two", bytes, "test"), hash);
    assert.deepEqual(Buffer.from(await store.artifacts.read("two", hash)), bytes);

    await assert.rejects(() => store.artifacts.publish("one", Buffer.from("orphan"), "test", "after-rename"), /injected crash/);
    assert.equal((await store.artifacts.garbageCollectOrphans()).length, 1);
    await assert.rejects(() => store.artifacts.publish("one", Buffer.from("temporary"), "test", "after-temp-sync"), /injected crash/);
    await store.artifacts.initialize();
    assert.deepEqual(await store.artifacts.garbageCollectOrphans(), []);
  } finally {
    store.metadata.close();
    await rm(store.root, { recursive: true, force: true });
  }
});

test("job idempotency, lease expiry, retry, heartbeat, and cancellation are durable", async () => {
  const store = await workspace();
  try {
    store.metadata.createProject("project", "Project", 1);
    const first = store.metadata.enqueueJob({ id: "job-a", projectId: "project", kind: "experiment", payload: { a: 1 }, idempotencyKey: "same" }, 10);
    const duplicate = store.metadata.enqueueJob({ id: "job-b", projectId: "project", kind: "experiment", payload: { a: 2 }, idempotencyKey: "same" }, 11);
    assert.equal(duplicate.id, first.id);
    assert.equal(store.metadata.leaseNextJob("worker-a", 100, 1000)!.attempts, 1);
    assert.equal(store.metadata.leaseNextJob("worker-b", 200, 1000), undefined);
    assert.equal(store.metadata.recoverExpiredJobs(1100), 1);
    const retry = store.metadata.leaseNextJob("worker-b", 1100, 1000)!;
    assert.equal(retry.attempts, 2);
    assert.equal(store.metadata.heartbeat(retry.id, "worker-b", 1200, 1000), true);
    store.metadata.requestCancellation(retry.id, 1300);
    store.metadata.finishJob(retry.id, "worker-b", "cancelled", undefined, undefined, 1400);
    assert.equal(store.metadata.getJob(retry.id)!.status, "cancelled");
    assert.equal(store.metadata.integrityCheck(), "ok");
  } finally {
    store.metadata.close();
    await rm(store.root, { recursive: true, force: true });
  }
});

test("paired experiments resume idempotently and export reproducible JSON and CSV", async () => {
  const store = await workspace();
  try {
    store.metadata.createProject("project", "Project");
    const service = new ExperimentService(store.metadata, store.artifacts, "test-worker");
    const request: ExperimentRequest = {
      scenario: await scenario(),
      variants: [
        { id: "chen", policyId: "chen-inspired", actorIds: ["blue-one"] },
        { id: "sportive", policyId: "sportive", actorIds: ["blue-one"] },
      ],
      seeds: [2, 1],
    };
    const job = service.enqueue("project", "paired-one", request);
    assert.equal(service.enqueue("project", "paired-one", request).id, job.id);
    const conflict = structuredClone(request); conflict.seeds = [3];
    assert.throws(() => service.enqueue("project", "paired-one", conflict), IdempotencyConflictError);
    const completed = await service.runNext();
    assert.equal(completed!.status, "completed");
    assert.equal(store.metadata.episodes(job.id).length, 4);
    const result = await service.result(job.id);
    assert.equal(result.schemaVersion, "1.1.0");
    assert.equal(result.requestHash.length, 64);
    assert.equal(result.configurationHash.length, 64);
    assert.equal(result.seedSetHash.length, 64);
    assert.equal(result.policyVersions["chen-inspired"], "1.2.0");
    assert.equal(result.episodes.length, 4);
    assert.deepEqual(result.episodes.map(episode => [episode.variantId, episode.seed]),
      [["chen", 1], ["chen", 2], ["sportive", 1], ["sportive", 2]]);
    assert.ok(result.episodes.every(episode => episode.metrics.postThreatCommitments === 0));
    assert.ok(result.episodes.every(episode => episode.metrics.metricsVersion === "1.1.0"));
    assert.ok(result.episodes.every(episode => Number.isFinite(episode.metrics.objectiveCompletionRate)));
    assert.ok(result.episodes.every(episode => Object.keys(episode.metrics.sideStates).length >= 2));
    assert.ok(result.episodes.every(episode => episode.metrics.activeThreatExposureMs >= 0));
    assert.ok(result.episodes.every(episode => episode.metrics.moraleActorsAffected >= 0));
    const csv = experimentCsv(result);
    assert.equal(csv.trim().split("\n").length, 5);
    assert.match(csv, /"chen"/);
    assert.match(csv, /sideStates/);
    assert.doesNotMatch(csv, /\[object Object\]/);
    const telemetry = service.telemetry.snapshot();
    assert.ok(telemetry.some(record => record.kind === "experiment-started" && record.fields.jobId === job.id));
    assert.equal(telemetry.filter(record => record.kind === "experiment-episode").length, 4);
    assert.ok(telemetry.some(record => record.kind === "policy-decision" && Number(record.fields.durationMs) >= 0));
    assert.ok(telemetry.some(record => record.kind === "experiment-completed" && Number(record.fields.artifactBytes) > 0));
  } finally {
    store.metadata.close();
    await rm(store.root, { recursive: true, force: true });
  }
});

test("injected episode timeout fails the durable job and emits structured failure telemetry", async () => {
  const store = await workspace();
  try {
    store.metadata.createProject("timeout-project", "Timeout project");
    const service = new ExperimentService(store.metadata, store.artifacts, "timeout-worker", undefined, 0);
    const request: ExperimentRequest = {
      scenario: await scenario(),
      variants: [{ id: "timeout", policyId: "safety-first" }],
      seeds: [1],
    };
    const job = service.enqueue("timeout-project", "timeout-one", request);
    const result = await service.runNext();
    assert.equal(result?.status, "failed");
    assert.match(result?.error ?? "", /episode timeout/u);
    assert.ok(service.telemetry.snapshot("experiment-failed").some(record => record.fields.jobId === job.id));
  } finally {
    store.metadata.close();
    await rm(store.root, { recursive: true, force: true });
  }
});

test("backup, restore, project deletion, quarantine, and hard deletion preserve privacy semantics", async () => {
  const store = await workspace();
  const restoredRoot = await mkdtemp(join(tmpdir(), "living-here-restore-"));
  try {
    store.metadata.createProject("project", "Project");
    const hash = await store.artifacts.publish("project", Buffer.from("backup bytes"), "test");
    const backupRoot = join(store.root, "backup");
    const manifest = await createBackup(store.metadata, store.artifacts, backupRoot, 100);
    assert.deepEqual(manifest.artifactHashes, [hash]);
    assert.deepEqual((await verifyBackup(backupRoot)).artifactHashes, [hash]);
    await restoreBackup(backupRoot, join(restoredRoot, "metadata.sqlite"), join(restoredRoot, "artifacts"));
    const restoredMetadata = new MetadataRepository(join(restoredRoot, "metadata.sqlite"));
    const restoredArtifacts = new ArtifactRepository(join(restoredRoot, "artifacts"), restoredMetadata);
    await restoredArtifacts.initialize();
    assert.equal(Buffer.from(await restoredArtifacts.read("project", hash)).toString(), "backup bytes");
    restoredMetadata.close();

    assert.deepEqual(store.metadata.deleteProject("project", 200), [hash]);
    await store.artifacts.quarantine(hash, 200);
    assert.deepEqual(await store.artifacts.sweepQuarantine(200 + 86_400_000), [hash]);
    await store.artifacts.hardDelete(hash);
  } finally {
    store.metadata.close();
    await rm(store.root, { recursive: true, force: true });
    await rm(restoredRoot, { recursive: true, force: true });
  }
});

test("local HTTP contracts enforce idempotency, project scope, cancellation, and exports", { timeout: 10_000 }, async () => {
  const store = await workspace();
  const service = new ExperimentService(store.metadata, store.artifacts, "api-worker");
  const server = createApiServer({ metadata: store.metadata, artifacts: store.artifacts, experiments: service, autoRun: false });
  try {
    const address = await listenLocal(server);
    const origin = `http://${address.host}:${address.port}`;
    const web = await fetch(`${origin}/`);
    assert.equal(web.status, 200);
    assert.match(await web.text(), /Living Here — Scenario Lab/);
    assert.equal((await fetch(`${origin}/app.js`)).status, 200);
    assert.equal((await fetch(`${origin}/presets/sudden-crisis-physics.json`)).status, 200);
    const validation = await fetch(`${origin}/v1/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await scenario()) }).then(response => response.json()) as { valid: boolean };
    assert.equal(validation.valid, true);
    const projectResponse = await fetch(`${origin}/v1/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "API" }) });
    assert.equal(projectResponse.status, 201);
    const project = await projectResponse.json() as { id: string };
    const request: ExperimentRequest = {
      scenario: await scenario(), variants: [{ id: "chen", policyId: "chen-inspired", actorIds: ["blue-one"] }], seeds: [3],
    };
    const queuedResponse = await fetch(`${origin}/v1/projects/${project.id}/experiments`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "api-one" }, body: JSON.stringify(request),
    });
    assert.equal(queuedResponse.status, 202);
    const queued = await queuedResponse.json() as { id: string };
    const duplicate = await fetch(`${origin}/v1/projects/${project.id}/experiments`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "api-one" }, body: JSON.stringify(request),
    }).then(response => response.json()) as { id: string };
    assert.equal(duplicate.id, queued.id);
    await service.runNext();
    const job = await fetch(`${origin}/v1/projects/${project.id}/jobs/${queued.id}`).then(response => response.json()) as { status: string; resultHash: string };
    assert.equal(job.status, "completed");
    const csv = await fetch(`${origin}/v1/projects/${project.id}/jobs/${queued.id}/export?format=csv`);
    assert.equal(csv.status, 200);
    assert.match(await csv.text(), /variantId,seed/);
    const cancelResponse = await fetch(`${origin}/v1/projects/${project.id}/experiments`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "api-cancel" }, body: JSON.stringify(request),
    });
    const cancellable = await cancelResponse.json() as { id: string };
    const cancelled = await fetch(`${origin}/v1/projects/${project.id}/jobs/${cancellable.id}`, { method: "DELETE" })
      .then(response => response.json()) as { status: string };
    assert.equal(cancelled.status, "cancelled");
    const runResponse = await fetch(`${origin}/v1/projects/${project.id}/runs`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": "api-run" },
      body: JSON.stringify({ scenario: request.scenario }),
    });
    const runJob = await runResponse.json() as { id: string };
    await service.runNext();
    const runResult = await service.result(runJob.id);
    const runArtifact = JSON.parse(Buffer.from(await store.artifacts.read(project.id, runResult.episodes[0]!.artifactHash)).toString("utf8"));
    assert.equal(checksum(runArtifact), checksum(runSimulation(request.scenario)));
    const firstPage = await fetch(`${origin}/v1/projects/${project.id}/jobs?limit=2`).then(response => response.json()) as { items: unknown[]; nextCursor: string };
    assert.equal(firstPage.items.length, 2);
    assert.ok(firstPage.nextCursor);
    const secondPage = await fetch(`${origin}/v1/projects/${project.id}/jobs?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`)
      .then(response => response.json()) as { items: unknown[] };
    assert.equal(secondPage.items.length, 1);
    assert.equal((await fetch(`${origin}/v1/health`, { headers: { "x-api-version": "99" } })).status, 406);
    const secondProject = await fetch(`${origin}/v1/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Other" }) })
      .then(response => response.json()) as { id: string };
    assert.equal((await fetch(`${origin}/v1/projects/${secondProject.id}/artifacts/${job.resultHash}`)).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.metadata.close();
    await rm(store.root, { recursive: true, force: true });
  }
});
