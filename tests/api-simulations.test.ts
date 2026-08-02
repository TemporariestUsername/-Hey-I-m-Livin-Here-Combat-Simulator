import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApiServer, listenLocal } from "../apps/api/src/server.ts";
import { runSimulation } from "../packages/engine/src/index.ts";
import { ExperimentService, type ExperimentRequest } from "../packages/service/src/index.ts";
import type { ScenarioSpec } from "../packages/schema/src/index.ts";
import { ArtifactRepository, MetadataRepository } from "../packages/storage/src/index.ts";

test("minimum simulation API validates, steps, runs, exposes traces, and enforces idempotency", { timeout: 10_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "living-here-simulation-api-"));
  const metadata = new MetadataRepository(join(root, "metadata.sqlite"));
  const artifacts = new ArtifactRepository(join(root, "artifacts"), metadata);
  await artifacts.initialize();
  const experiments = new ExperimentService(metadata, artifacts, "simulation-api-worker");
  const server = createApiServer({ metadata, artifacts, experiments, autoRun: false });
  const scenario = JSON.parse(await readFile(
    new URL("../packages/scenarios/fixtures/threat-ends.json", import.meta.url), "utf8",
  )) as ScenarioSpec;
  delete scenario.rules;
  delete scenario.objectives;
  scenario.terminalConditions = [{ kind: "threat-ended" }];
  scenario.threat.endsAtTick = 3;
  const post = (origin: string, path: string, value: unknown, key?: string) => fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
    body: JSON.stringify(value),
  });
  try {
    const address = await listenLocal(server);
    const origin = `http://${address.host}:${address.port}`;
    const validation = await post(origin, "/v1/scenarios/validate", scenario).then(response => response.json()) as { valid: boolean };
    assert.equal(validation.valid, true);
    assert.equal((await post(origin, "/v1/simulations", { scenario })).status, 400);

    const createdResponse = await post(origin, "/v1/simulations", { scenario }, "create-one");
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as any;
    assert.equal(created.tick, 0);
    assert.equal(created.done, false);
    assert.equal(created.provenance.engineVersion, "0.4.0");
    assert.equal(created.provenance.scenarioHash.length, 64);
    assert.equal(created.provenance.configurationHash.length, 64);
    assert.equal(created.provenance.policyVersions["random-valid"], "1.0.0");
    assert.equal(created.scenario.id, scenario.id);

    const duplicate = await post(origin, "/v1/simulations", { scenario }, "create-one").then(response => response.json()) as any;
    assert.equal(duplicate.id, created.id);
    const changed = structuredClone(scenario); changed.seed += 1;
    assert.equal((await post(origin, "/v1/simulations", { scenario: changed }, "create-one")).status, 409);

    const firstStep = await post(origin, `/v1/simulations/${created.id}/steps`, { count: 2 }, "step-one").then(response => response.json()) as any;
    assert.equal(firstStep.tick, 2);
    assert.equal(firstStep.done, false);
    assert.ok(firstStep.newEvents.length > 0);
    const duplicateStep = await post(origin, `/v1/simulations/${created.id}/steps`, { count: 2 }, "step-one").then(response => response.json()) as any;
    assert.equal(duplicateStep.tick, 2);
    assert.deepEqual(duplicateStep.newEvents, firstStep.newEvents);

    const secondStep = await post(origin, `/v1/simulations/${created.id}/steps`, {}, "step-two").then(response => response.json()) as any;
    assert.equal(secondStep.tick, 3);
    const events = await fetch(`${origin}/v1/simulations/${created.id}/events`).then(response => response.json()) as any;
    assert.equal(events.items.length, secondStep.eventCount);
    const traces = await fetch(`${origin}/v1/simulations/${created.id}/traces/2`).then(response => response.json()) as any;
    assert.equal(traces.tick, 2);
    assert.equal(traces.items.length, scenario.actors.length);

    const completed = await post(origin, `/v1/simulations/${created.id}/run`, {}, "run-one").then(response => response.json()) as any;
    const expected = runSimulation(scenario);
    assert.equal(completed.done, true);
    assert.equal(completed.tick, expected.finalState.tick);
    assert.equal(completed.finalChecksum, expected.finalChecksum);
    assert.deepEqual(completed.state, expected.finalState);
    const artifact = await fetch(`${origin}/v1/simulations/${created.id}/artifact`).then(response => response.json()) as any;
    assert.deepEqual(artifact, expected);
    assert.equal((await post(origin, "/v1/replays/verify", artifact)).status, 200);
    const tamperedArtifact = structuredClone(artifact); tamperedArtifact.traces[0].formulaTerms.tampered = 1;
    assert.equal((await post(origin, "/v1/replays/verify", tamperedArtifact)).status, 422);
    const branchResponse = await post(origin, `/v1/simulations/${created.id}/branches`, { tick: 1 }, "branch-one");
    assert.equal(branchResponse.status, 201);
    const branch = await branchResponse.json() as any;
    assert.equal(branch.tick, 1);
    assert.equal(branch.provenance.parentSimulationId, created.id);
    assert.equal(branch.provenance.branchTick, 1);
    const completedBranch = await post(origin, `/v1/simulations/${branch.id}/run`, {}, "run-branch").then(response => response.json()) as any;
    assert.equal(completedBranch.finalChecksum, expected.finalChecksum);
    const branchArtifact = await fetch(`${origin}/v1/simulations/${branch.id}/artifact`).then(response => response.json()) as any;
    assert.deepEqual(branchArtifact, expected, "exact continuation branch must reproduce the source artifact");
    assert.equal((await post(origin, `/v1/simulations/${created.id}/branches`, { tick: completed.tick }, "terminal-branch")).status, 422);
    const fetched = await fetch(`${origin}/v1/simulations/${created.id}`).then(response => response.json()) as any;
    assert.equal(fetched.finalChecksum, expected.finalChecksum);
    assert.equal((await post(origin, `/v1/simulations/${created.id}/steps`, {}, "after-complete")).status, 409);

    assert.equal((await post(origin, "/v1/simulations", { scenario, unexpected: true }, "bad-shape")).status, 422);
    const tooLarge = structuredClone(scenario); tooLarge.maxTicks = 10_000;
    assert.equal((await post(origin, "/v1/simulations", { scenario: tooLarge }, "too-large")).status, 422);

    const experiment: ExperimentRequest = {
      scenario,
      variants: [{ id: "safety", policyId: "safety-first", actorIds: [scenario.actors[0]!.id] }],
      seeds: [scenario.seed],
    };
    assert.equal((await post(origin, "/v1/experiments", experiment)).status, 400);
    const queuedResponse = await post(origin, "/v1/experiments", experiment, "experiment-one");
    assert.equal(queuedResponse.status, 202);
    const queued = await queuedResponse.json() as any;
    const duplicateExperiment = await post(origin, "/v1/experiments", experiment, "experiment-one").then(response => response.json()) as any;
    assert.equal(duplicateExperiment.id, queued.id);
    const conflictingExperiment = structuredClone(experiment); conflictingExperiment.seeds = [scenario.seed + 1];
    assert.equal((await post(origin, "/v1/experiments", conflictingExperiment, "experiment-one")).status, 409);
    assert.equal((await fetch(`${origin}/v1/experiments/${queued.id}/artifacts`)).status, 409);
    assert.equal((await fetch(`${origin}/v1/experiments/${queued.id}`)).status, 200);
    await experiments.runNext();
    const experimentStatus = await fetch(`${origin}/v1/experiments/${queued.id}`).then(response => response.json()) as any;
    assert.equal(experimentStatus.status, "completed");
    assert.equal(experimentStatus.episodes.length, 1);
    const experimentArtifacts = await fetch(`${origin}/v1/experiments/${queued.id}/artifacts`).then(response => response.json()) as any;
    assert.equal(experimentArtifacts.experimentId, queued.id);
    assert.equal(experimentArtifacts.manifest.episodes.length, 1);
    assert.equal(experimentArtifacts.artifacts[0].hash, experimentArtifacts.manifest.episodes[0].artifactHash);
    assert.equal((await fetch(`${origin}/v1/experiments/missing`)).status, 404);
    assert.equal((await post(origin, "/v1/experiments", { ...experiment, unexpected: true }, "experiment-unknown")).status, 422);
    const invalidPolicy = structuredClone(experiment) as any; invalidPolicy.variants[0].policyId = "unknown";
    assert.equal((await post(origin, "/v1/experiments", invalidPolicy, "experiment-policy")).status, 422);
    const telemetry = await fetch(`${origin}/v1/telemetry`).then(response => response.json()) as any;
    assert.equal(telemetry.localOnly, true);
    assert.ok(telemetry.items.some((record: any) => record.kind === "api-request" && record.fields.status >= 200));
    assert.ok(telemetry.items.some((record: any) => record.kind === "simulation-run" && record.fields.scenarioHash.length === 64));
    assert.ok(telemetry.items.some((record: any) => record.kind === "experiment-episode" && record.fields.artifactBytes > 0));
    assert.ok(telemetry.items.some((record: any) => record.kind === "replay-mismatch" && record.fields.artifactHash.length === 64));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    metadata.close();
    await rm(root, { recursive: true, force: true });
  }
});
