import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { namedStream, replay, runSimulation } from "../packages/engine/src/index.ts";
import { randomValidPolicy, safetyFirstPolicy } from "../packages/policies/src/index.ts";
import { validateScenario, type ScenarioSpec } from "../packages/schema/src/index.ts";

const scenario = JSON.parse(await readFile(new URL("../packages/scenarios/fixtures/threat-ends.json", import.meta.url), "utf8")) as ScenarioSpec;
const execute = promisify(execFile);

test("fixture validates", () => assert.deepEqual(validateScenario(scenario), { valid: true, errors: [] }));
test("named PRNG stream has a stable vector", () => {
  const rng = namedStream(42, "contact");
  assert.deepEqual(Array.from({ length: 5 }, () => rng.nextUint32()), [1594523791, 976819194, 2272355874, 730483650, 4115037165]);
});
test("all named PRNG streams have stable, isolated vectors", () => {
  const expected = {
    sensing: [1307692281, 3850602322, 1491967504], movement: [4286966985, 1306841846, 1928016788],
    contact: [1594523791, 976819194, 2272355874], morale: [206217550, 3649653371, 129171216],
    policy: [3549395445, 1363058717, 380401836],
  } as const;
  for (const [name, vector] of Object.entries(expected)) {
    const rng = namedStream(42, name as keyof typeof expected);
    assert.deepEqual(Array.from({ length: 3 }, () => rng.nextUint32()), vector);
  }
});
test("fresh CLI processes produce byte-identical artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "combat-determinism-"));
  try {
    const fixture = new URL("../packages/scenarios/fixtures/threat-ends.json", import.meta.url).pathname;
    const first = join(directory, "first.json");
    const second = join(directory, "second.json");
    const cli = new URL("../apps/cli/src/index.ts", import.meta.url).pathname;
    await execute(process.execPath, [cli, "run", fixture, first]);
    await execute(process.execPath, [cli, "run", fixture, second]);
    assert.equal(await readFile(first, "utf8"), await readFile(second, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("identical inputs create byte-identical logs", () => assert.equal(JSON.stringify(runSimulation(scenario)), JSON.stringify(runSimulation(scenario))));
test("tempo traces use the contact stream and remain stable when actor input order changes", () => {
  const original = runSimulation(scenario);
  const reordered = runSimulation({ ...scenario, actors: [...scenario.actors].reverse() });
  const tempoEvents = (log: ReturnType<typeof runSimulation>) => log.events.filter(event => event.type === "tempo-resolved").map(event => event.payload);
  assert.deepEqual(tempoEvents(original), tempoEvents(reordered));
  assert.ok(tempoEvents(original).every(payload => typeof payload.tempo === "number" && typeof payload.randomSample === "number"));
});
test("replay verifies the event chain and final state", () => { const log = runSimulation(scenario); assert.deepEqual(replay(log), log.finalState); });
test("commitment is gated after the threat ends", () => {
  const log = runSimulation(scenario);
  assert.ok(log.events.some(event => event.type === "intent-gated" && event.payload.failedPredicate === "active-threat-required"));
  assert.equal(log.finalState.actors.find(actor => actor.id === "defender")?.intent, "withdraw");
});
test("actors are routed through their bound policy with an explanation", () => {
  const log = runSimulation(scenario);
  const safetyDecision = log.events.find(event => event.type === "policy-decided" && event.payload.actorId === "aggressor");
  assert.equal(safetyDecision?.payload.policyId, "safety-first");
  assert.equal(safetyDecision?.payload.policyVersion, safetyFirstPolicy.version);
  assert.equal(safetyDecision?.payload.selected, "withdraw");
  assert.deepEqual(safetyDecision?.payload.rngSamples, []);

  const randomDecision = log.events.find(event => event.type === "policy-decided" && event.payload.actorId === "defender");
  assert.equal(randomDecision?.payload.policyId, randomValidPolicy.id);
  assert.ok(Array.isArray(randomDecision?.payload.candidates));
  assert.equal((randomDecision?.payload.rngSamples as number[]).length, 1);
});
test("scenario validation rejects unknown policy bindings", () => {
  const invalid = structuredClone(scenario) as ScenarioSpec & { actors: Array<ScenarioSpec["actors"][number] & { policyId?: string }> };
  invalid.actors[0]!.policyId = "missing-policy";
  const result = validateScenario(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("actors[0].policyId must identify a built-in policy"));
});
test("withdraw movement uses observations and resolves during the pulse", () => {
  const log = runSimulation(scenario);
  const defender = log.finalState.actors.find(actor => actor.id === "defender")!;
  assert.ok(defender.position.x < scenario.actors.find(actor => actor.id === "defender")!.position.x);
  assert.ok(log.events.some(event => event.type === "observation-built" && event.payload.observerId === "defender"));
  assert.ok(log.events.some(event => event.type === "movement-resolved" && event.payload.actorId === "defender"));
});
