import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { namedStream, replay, runSimulation } from "../packages/engine/src/index.ts";
import { validateScenario, type ScenarioSpec } from "../packages/schema/src/index.ts";

const scenario = JSON.parse(await readFile(new URL("../packages/scenarios/fixtures/threat-ends.json", import.meta.url), "utf8")) as ScenarioSpec;

test("fixture validates", () => assert.deepEqual(validateScenario(scenario), { valid: true, errors: [] }));
test("named PRNG stream has a stable vector", () => {
  const rng = namedStream(42, "contact");
  assert.deepEqual(Array.from({ length: 5 }, () => rng.nextUint32()), [1594523791, 976819194, 2272355874, 730483650, 4115037165]);
});
test("identical inputs create byte-identical logs", () => assert.equal(JSON.stringify(runSimulation(scenario)), JSON.stringify(runSimulation(scenario))));
test("replay verifies the event chain and final state", () => { const log = runSimulation(scenario); assert.deepEqual(replay(log), log.finalState); });
test("commitment is gated after the threat ends", () => {
  const log = runSimulation(scenario);
  assert.ok(log.events.some(event => event.type === "intent-gated" && event.payload.failedPredicate === "active-threat-required"));
  assert.equal(log.finalState.actors.find(actor => actor.id === "defender")?.intent, "withdraw");
});
test("withdraw movement uses observations and resolves during the pulse", () => {
  const log = runSimulation(scenario);
  const defender = log.finalState.actors.find(actor => actor.id === "defender")!;
  assert.ok(defender.position.x < scenario.actors.find(actor => actor.id === "defender")!.position.x);
  assert.ok(log.events.some(event => event.type === "observation-built" && event.payload.observerId === "defender"));
  assert.ok(log.events.some(event => event.type === "movement-resolved" && event.payload.actorId === "defender"));
});
