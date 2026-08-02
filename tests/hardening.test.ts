import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createApiServer, listenLocal } from "../apps/api/src/server.ts";
import { buildReplayCache, replayActorsAtCache } from "../apps/web/replay-cache.js";
import { runSimulation } from "../packages/engine/src/index.ts";
import { ExperimentService, MAX_EXPERIMENT_PULSES, validateExperiment } from "../packages/service/src/index.ts";
import { validateScenario, type ScenarioSpec } from "../packages/schema/src/index.ts";
import { ArtifactRepository, MetadataRepository } from "../packages/storage/src/index.ts";

const fixture = async (name: string): Promise<ScenarioSpec> => JSON.parse(await readFile(
  new URL(`../packages/scenarios/fixtures/${name}`, import.meta.url), "utf8",
)) as ScenarioSpec;

test("editor semantics reject overlapping obstacles, actor-obstacle overlap, and unreachable exits", async () => {
  const source = await fixture("threat-ends.json");
  const overlapping = structuredClone(source);
  overlapping.map.obstacles = [
    { id: "first", x: 1, y: 1, width: 2, height: 2, blocksMovement: true },
    { id: "second", x: 2, y: 2, width: 2, height: 2, blocksMovement: true },
  ];
  overlapping.actors[0]!.position = { x: 1.5, y: 1.5 };
  const overlapErrors = validateScenario(overlapping).errors.join("\n");
  assert.match(overlapErrors, /obstacles\[0\].*obstacles\[1\].*must not overlap/u);
  assert.match(overlapErrors, /must not overlap movement obstacle/u);

  const unreachable = structuredClone(source);
  unreachable.map.obstacles = [{ id: "wall", x: 4, y: 0, width: 1, height: 10, blocksMovement: true }];
  unreachable.map.exits = [{ id: "right", x: 9, y: 4, width: 1, height: 2 }];
  unreachable.actors.forEach((actor, index) => { actor.position = { x: 1 + index, y: 4 + index }; });
  assert.match(validateScenario(unreachable).errors.join("\n"), /exit reachable/u);
});

test("experiment allocation rejects combinatorial workloads before execution", async () => {
  const scenario = await fixture("threat-ends.json");
  scenario.maxTicks = 36_000;
  const variants = Array.from({ length: 16 }, (_, index) => ({ id: `v-${index}`, policyId: "safety-first" as const }));
  const seeds = Array.from({ length: 10 }, (_, index) => index);
  assert.ok(variants.length * seeds.length * scenario.maxTicks > MAX_EXPERIMENT_PULSES);
  assert.throws(() => validateExperiment({ scenario, variants, seeds }), /pulse allocation limit/u);
});

test("SQLite migration 1 to 2 is transactional, idempotent, and integrity-preserving", async () => {
  const root = await mkdtemp(join(tmpdir(), "living-here-migration-"));
  const path = join(root, "legacy.sqlite");
  try {
    const legacy = new DatabaseSync(path);
    legacy.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL); INSERT INTO schema_migrations VALUES(1,1);");
    legacy.close();
    const migrated = new MetadataRepository(path);
    assert.deepEqual(migrated.schemaVersions(), [1, 2]);
    assert.equal(migrated.integrityCheck(), "ok");
    migrated.close();
    const reopened = new MetadataRepository(path);
    assert.deepEqual(reopened.schemaVersions(), [1, 2]);
    assert.equal(reopened.integrityCheck(), "ok");
    reopened.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local HTTP boundary enforces host/origin, JSON media type, rate limit, and response headers", async () => {
  const root = await mkdtemp(join(tmpdir(), "living-here-security-"));
  const metadata = new MetadataRepository(join(root, "metadata.sqlite"));
  const artifacts = new ArtifactRepository(join(root, "artifacts"), metadata);
  await artifacts.initialize();
  const experiments = new ExperimentService(metadata, artifacts, "security-worker");
  const server = createApiServer({ metadata, artifacts, experiments, requestLimitPerMinute: 2 });
  try {
    const address = await listenLocal(server);
    const origin = `http://${address.host}:${address.port}`;
    const health = await fetch(`${origin}/v1/health`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
    assert.equal(health.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal((await fetch(`${origin}/v1/projects`, { method: "POST", body: "{}" })).status, 415);
    assert.equal((await fetch(`${origin}/v1/health`)).status, 429);
    assert.equal((await fetch(`${origin}/v1/health`, { headers: { origin: "https://attacker.invalid" } })).status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    metadata.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("supported replay cache seeks exactly to final actors and remains below the 200 ms budget", async () => {
  const scenario = JSON.parse(await readFile(new URL("../benchmarks/fixtures/benchmark-32-actors.json", import.meta.url), "utf8")) as ScenarioSpec;
  const log = runSimulation(scenario);
  const cache = buildReplayCache(log, 25);
  assert.deepEqual(replayActorsAtCache(cache, log.finalState.tick), log.finalState.actors);
  let maximumMs = 0;
  for (const tick of [0, 1, 24, 25, 127, 255, 511, 599, 600]) {
    const started = performance.now();
    replayActorsAtCache(cache, tick);
    maximumMs = Math.max(maximumMs, performance.now() - started);
  }
  assert.ok(maximumMs < 200, `maximum cached replay seek was ${maximumMs.toFixed(3)} ms`);
});

test("a 128-episode local batch load stays finite and completes within a generous release ceiling", async () => {
  const scenario = await fixture("threat-ends.json");
  const started = performance.now();
  for (let seed = 0; seed < 128; seed += 1) {
    const episode = structuredClone(scenario); episode.seed = seed;
    const log = runSimulation(episode);
    assert.ok(log.events.length > 0 && Number.isFinite(log.finalState.elapsedMs));
  }
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 5_000, `128-episode local batch took ${elapsed.toFixed(1)} ms`);
});
