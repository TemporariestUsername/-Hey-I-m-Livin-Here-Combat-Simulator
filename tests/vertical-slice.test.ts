import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { namedStream, replay, runSimulation } from "../packages/engine/src/index.ts";
import { randomValidPolicy, safetyFirstPolicy } from "../packages/policies/src/index.ts";
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
  const gated = structuredClone(scenario);
  gated.maxTicks = 2;
  delete gated.rules;
  delete gated.objectives;
  gated.terminalConditions = [{ kind: "threat-ended" }];
  gated.threat.endsAtTick = 1;
  const defender = gated.actors.find(actor => actor.id === "defender")!;
  defender.policyId = "human-intent";
  defender.humanIntent = "commit";
  const log = runSimulation(gated);
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
  assert.ok(result.errors.some(error => error.includes("$.actors[0].policyId must be one of")));
});
test("withdraw movement uses observations and resolves during the pulse", () => {
  const log = runSimulation(scenario);
  const aggressor = log.finalState.actors.find(actor => actor.id === "aggressor")!;
  assert.ok(aggressor.position.x > scenario.actors.find(actor => actor.id === "aggressor")!.position.x);
  assert.ok(log.events.some(event => event.type === "observation-built" && event.payload.observerId === "defender"));
  assert.ok(log.events.some(event => event.type === "movement-resolved" && event.payload.actorId === "aggressor"));
});

test("the canonical threat ends in the same pulse as its first decisive effect", () => {
  const log = runSimulation(scenario);
  const decisive = log.events.find(event => event.type === "effects-applied" && event.payload.neutralized === true)!;
  const ended = log.events.find(event => event.type === "threat-ended")!;
  assert.ok(decisive);
  assert.equal(ended.tick, decisive.tick);
  assert.ok(ended.sequence > decisive.sequence);
  assert.match(String(ended.payload.reason), /^decisive-effect-side-neutralized-/u);
  assert.equal(log.finalState.threatActive, false);
});
