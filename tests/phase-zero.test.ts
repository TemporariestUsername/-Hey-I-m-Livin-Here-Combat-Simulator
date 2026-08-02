import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  checksum,
  captureContinuation,
  advanceContinuation,
  namedStream,
  Pcg32,
  persistedNumber,
  replay,
  resolveMovement,
  resumeSimulation,
  runSimulation,
} from "../packages/engine/src/index.ts";
import {
  DEFAULT_IMPORT_LIMITS,
  CONTINUATION_JSON_SCHEMA,
  migrateToCurrentSchema,
  parseJsonDocument,
  RUN_LOG_JSON_SCHEMA,
  validateAgainstJsonSchema,
  validateContinuation,
  validateRunLog,
  validateScenario,
  type ScenarioSpec,
} from "../packages/schema/src/index.ts";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = fileURLToPath(new URL("../packages/scenarios/fixtures/threat-ends.json", import.meta.url));
const scenario = JSON.parse(await readFile(fixture, "utf8")) as ScenarioSpec;
const continuationFixture = fileURLToPath(new URL("../packages/scenarios/fixtures/safety-positive.json", import.meta.url));
const continuationScenario = JSON.parse(await readFile(continuationFixture, "utf8")) as ScenarioSpec;

const vectors = {
  sensing: [1307692281, 3850602322, 1491967504, 4091771729, 3882238836],
  movement: [4286966985, 1306841846, 1928016788, 384721191, 361147096],
  contact: [1594523791, 976819194, 2272355874, 730483650, 4115037165],
  morale: [206217550, 3649653371, 129171216, 477240175, 4144742439],
  policy: [3549395445, 1363058717, 380401836, 3740939513, 2712762813],
} as const;

test("every named PRNG stream has a golden vector", () => {
  for (const [name, expected] of Object.entries(vectors)) {
    const stream = namedStream(42, name as keyof typeof vectors);
    assert.deepEqual(Array.from({ length: expected.length }, () => stream.nextUint32()), expected);
  }
});

test("extra draws in one PRNG stream do not perturb another", () => {
  const baseline = namedStream(42, "policy");
  const expected = Array.from({ length: 8 }, () => baseline.nextUint32());
  const contact = namedStream(42, "contact");
  const policy = namedStream(42, "policy");
  const actual = Array.from({ length: 8 }, () => {
    for (let index = 0; index < 17; index += 1) contact.nextUint32();
    return policy.nextUint32();
  });
  assert.deepEqual(actual, expected);
});

test("PCG32 snapshots restore the exact next value and reject invalid state", () => {
  const stream = namedStream(42, "sensing");
  Array.from({ length: 37 }, () => stream.nextUint32());
  const snapshot = stream.snapshot();
  const expected = Array.from({ length: 16 }, () => stream.nextUint32());
  const restored = Pcg32.fromSnapshot(snapshot);
  assert.deepEqual(Array.from({ length: 16 }, () => restored.nextUint32()), expected);
  assert.equal(restored.snapshot().draws, snapshot.draws + 16);
  assert.throws(() => Pcg32.fromSnapshot({ ...snapshot, increment: "0000000000000002" }), /invalid/);
});

test("captured continuations resume byte-identically and fail closed when tampered", () => {
  const expected = runSimulation(continuationScenario);
  for (let tick = 0; tick < continuationScenario.maxTicks; tick += 1) {
    const continuation = captureContinuation(continuationScenario, tick);
    assert.deepEqual(validateContinuation(continuation), { valid: true, errors: [] });
    assert.deepEqual(resumeSimulation(continuation), expected, `continuation diverged at tick ${tick}`);
  }
  const tampered = captureContinuation(continuationScenario, 2);
  tampered.state.randomStreams.policy.state = "0000000000000000";
  assert.throws(() => resumeSimulation(tampered), /checksum mismatch/);
});

test("one-pulse continuation stepping converges on the uninterrupted artifact", () => {
  const expected = runSimulation(continuationScenario);
  let current: ReturnType<typeof captureContinuation> | typeof expected = captureContinuation(continuationScenario, 0);
  while (!("finalState" in current)) current = advanceContinuation(current, 1);
  assert.deepEqual(current, expected);
  assert.throws(() => advanceContinuation(captureContinuation(continuationScenario, 0), 0), /1 to 1000/);
});

test("numeric normalization defines half-away-from-zero boundaries and canonical zero", () => {
  assert.equal(persistedNumber(0.0000004), 0);
  assert.equal(persistedNumber(0.0000005), 0.000001);
  assert.equal(persistedNumber(-0.0000005), -0.000001);
  assert.deepEqual(
    [1.23456749, 1.2345675, 1.23456751, -1.23456749, -1.2345675, -1.23456751].map(persistedNumber),
    [1.234567, 1.234568, 1.234568, -1.234567, -1.234568, -1.234568],
  );
  assert.equal(Object.is(persistedNumber(-0), -0), false);
  assert.throws(() => persistedNumber(Number.POSITIVE_INFINITY), /finite/);
});

test("scenario-authored state and blocked movement are normalized on ingestion", () => {
  const precise = structuredClone(scenario);
  precise.actors[0]!.position.x = 2.123456789;
  precise.actors[0]!.stamina = 0.99999949;
  const log = runSimulation(precise);
  const actor = log.initialState.actors.find(item => item.id === precise.actors[0]!.id)!;
  assert.equal(actor.position.x, 2.123457);
  assert.equal(actor.stamina, 0.999999);
  assert.deepEqual(
    resolveMovement(
      { x: 2.123456789, y: 5.0000004 },
      { x: 8, y: 5 },
      { width: 10, height: 10, obstacles: [{ id: "wall", x: 4, y: 2, width: 1, height: 6 }] },
    ),
    { x: 2.123457, y: 5 },
  );
});

test("actor and obstacle input order cannot change normalized artifacts", () => {
  const reversed = structuredClone(scenario);
  reversed.actors.reverse();
  reversed.map.obstacles?.reverse();
  assert.deepEqual(runSimulation(reversed), runSimulation(scenario));
});

test("fresh CLI processes produce byte-identical complete artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "living-here-determinism-"));
  try {
    const first = join(directory, "first.json");
    const second = join(directory, "second.json");
    const cli = join(root, "apps/cli/src/index.ts");
    await execFileAsync(process.execPath, [cli, "run", fixture, first], { cwd: root });
    await execFileAsync(process.execPath, [cli, "run", fixture, second], { cwd: root });
    assert.equal(await readFile(first, "utf8"), await readFile(second, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("golden fixture retains its complete normalized artifact hash", () => {
  const log = runSimulation(scenario);
  assert.equal(log.events.length, 16);
  assert.equal(log.finalChecksum, "498e2821f8d0c99926e7fbc556757a6333145151b655397c21b45ada6c46103d");
  assert.equal(checksum(log), "336cdc66b00d845a53effa46361707493db131429477f38dc1c2a4087a859dca");
});

test("closed schema rejects unknown fields at every scenario object level", () => {
  for (const mutate of [
    (value: any) => { value.unexpected = true; },
    (value: any) => { value.map.unexpected = true; },
    (value: any) => { value.threat.unexpected = true; },
    (value: any) => { value.actors[0].unexpected = true; },
    (value: any) => { value.actors[0].position.unexpected = true; },
  ]) {
    const invalid = structuredClone(scenario);
    mutate(invalid);
    const result = validateScenario(invalid);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.endsWith("is not allowed")));
  }
});

test("reviewed positive content passes and every negative fixture fails closed", async () => {
  const positive = parseJsonDocument(await readFile(new URL("../packages/scenarios/fixtures/safety-positive.json", import.meta.url), "utf8"));
  assert.deepEqual(validateScenario(positive), { valid: true, errors: [] });
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
    const input = parseJsonDocument(await readFile(new URL(`../packages/scenarios/fixtures/negative/${name}.json`, import.meta.url), "utf8"));
    const result = validateScenario(input);
    assert.equal(result.valid, false, `${name} should fail validation`);
    assert.ok(result.errors.some(error => error.includes(expectedError)), `${name} should fail for ${expectedError}`);
  }
});

test("JSON imports enforce byte and nesting limits", () => {
  assert.throws(
    () => parseJsonDocument(JSON.stringify({ value: "x".repeat(DEFAULT_IMPORT_LIMITS.maxBytes) })),
    /exceeds .* bytes/,
  );
  let deep: Record<string, unknown> = {};
  const rootValue = deep;
  for (let index = 0; index < DEFAULT_IMPORT_LIMITS.maxDepth; index += 1) {
    deep.next = {};
    deep = deep.next as Record<string, unknown>;
  }
  assert.throws(() => parseJsonDocument(JSON.stringify(rootValue)), /nesting depth/);
});

test("run-log imports reject unknown structures and incompatible engine versions", () => {
  const log = runSimulation(scenario);
  const topLevel = structuredClone(log) as typeof log & { unexpected?: boolean };
  topLevel.unexpected = true;
  assert.equal(validateRunLog(topLevel).valid, false);
  const state = structuredClone(log) as typeof log & { initialState: typeof log.initialState & { unexpected?: boolean } };
  state.initialState.unexpected = true;
  assert.equal(validateRunLog(state).valid, false);
  const actor = structuredClone(log) as typeof log & { finalState: typeof log.finalState & { actors: Array<typeof log.finalState.actors[number] & { unexpected?: boolean }> } };
  actor.finalState.actors[0]!.unexpected = true;
  assert.equal(validateRunLog(actor).valid, false);
  const event = structuredClone(log);
  event.events[0]!.payload.unexpected = true;
  assert.equal(validateRunLog(event).valid, false);
  const incompatible = structuredClone(log);
  incompatible.engineVersion = "99.0.0";
  assert.throws(() => replay(incompatible), /Unsupported engine version/);
});

test("aggregate run-log and continuation schemas compose closed nested documents", () => {
  const log = runSimulation(scenario);
  const invalidLog = structuredClone(log) as typeof log & {
    finalState: typeof log.finalState & { actors: Array<typeof log.finalState.actors[number] & { unexpected?: boolean }> };
  };
  invalidLog.finalState.actors[0]!.unexpected = true;
  assert.ok(validateAgainstJsonSchema(invalidLog, RUN_LOG_JSON_SCHEMA).some(error => error.includes("unexpected is not allowed")));

  const continuation = captureContinuation(continuationScenario, 1) as ReturnType<typeof captureContinuation> & {
    state: ReturnType<typeof captureContinuation>["state"] & {
      actors: Array<ReturnType<typeof captureContinuation>["state"]["actors"][number] & { unexpected?: boolean }>;
    };
  };
  continuation.state.actors[0]!.unexpected = true;
  assert.ok(validateAgainstJsonSchema(continuation, CONTINUATION_JSON_SCHEMA).some(error => error.includes("unexpected is not allowed")));
});

test("migration boundary rejects versions without an explicit path", () => {
  assert.deepEqual(migrateToCurrentSchema(scenario), scenario);
  const prior = structuredClone(scenario) as unknown as Record<string, unknown>;
  prior.schemaVersion = "1.0.0";
  const migrated = migrateToCurrentSchema(prior);
  assert.equal((migrated as Record<string, unknown>).schemaVersion, "1.3.0");
  assert.deepEqual(validateScenario(migrated), { valid: true, errors: [] });
  const historicalRun = structuredClone(runSimulation(scenario)) as unknown as Record<string, unknown>;
  historicalRun.schemaVersion = "1.2.0";
  assert.throws(() => migrateToCurrentSchema(historicalRun), /run artifacts are immutable/);
  assert.throws(() => migrateToCurrentSchema({ ...scenario, schemaVersion: "0.9.0" }), /no migration path/);
});

test("benchmark fixture retains its deterministic artifact identity", async () => {
  const benchmark = parseJsonDocument(await readFile(new URL("../benchmarks/fixtures/benchmark-32-actors.json", import.meta.url), "utf8"));
  assert.deepEqual(validateScenario(benchmark), { valid: true, errors: [] });
  const log = runSimulation(benchmark as ScenarioSpec);
  assert.equal(log.events.length, 78077);
  assert.equal(log.traces.length, 19200);
  assert.equal(log.events.filter(event => event.type === "contact-resolved").length, 29);
  assert.equal(log.finalChecksum, "aeb1ce074b0e40c1d9893bf134c257871ffb971986c760975aca5d058c68d512");
  assert.equal(checksum(log), "afeb3d21118de64536f642c3aac1d5d9c0f1aa22cdc4ae7cd6213fb42df43bad");
});
