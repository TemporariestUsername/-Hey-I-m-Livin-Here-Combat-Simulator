import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checksum, replay, runSimulation } from "../packages/engine/src/index.ts";
import { applyMorale, moraleRules } from "../packages/engine/src/morale.ts";
import type { ActorState, ScenarioSpec, SquadState } from "../packages/schema/src/index.ts";
import { validateRunLog, validateScenario } from "../packages/schema/src/index.ts";

const fixtureUrl = new URL("../packages/scenarios/fixtures/morale-cascade-1v3.json", import.meta.url);

function actor(id: string, x: number, leader = false): ActorState {
  return {
    id, side: "red", position: { x, y: 1 }, readiness: 0.5, stamina: 1, resolve: 0.3,
    squadId: "red", leader, active: true, intent: "observe", shock: 0, balance: 1, guard: 0.5,
    mobility: 1, impairment: 0, disruption: 0, recoveryTicks: 0, neutralized: false,
    fear: 0, moraleState: "steady", escaped: false,
  };
}

test("morale shock cascades simultaneously with bounded depth and leader resistance", () => {
  const actors = [actor("front", 1), actor("leader", 2, true), actor("rear", 3)];
  const squads: SquadState[] = [{ id: "red", side: "red", leaderId: "leader", cohesion: 1, routedCount: 0 }];
  const scenario = {
    rules: { morale: { enabled: true, shockRadiusM: 5, shockFalloff: 1, allyShockScale: 1,
      leaderResistance: 0.5, cascadeDepth: 1, perPulseCap: 0.6, recoverThreshold: 0.05,
      shakenThreshold: 0.1, frozenThreshold: 0.2, routeThreshold: 0.3, recoveryPerPulse: 0 } },
  } as ScenarioSpec;
  const packet = {
    packetId: "p", sourceId: "blue", targetId: "front", contactQuality: 1, severity: 1,
    impulseNs: 10, terms: {}, noiseSample: 0.5, noise: 0, disruption: 0, impairment: 0,
    shock: 0.5, separationM: 0, neutralization: false,
  };
  const result = applyMorale(actors, squads, [packet], true, moraleRules(scenario));
  assert.ok(result.signals.some(signal => signal.depth === 1));
  assert.ok(actors.find(item => item.id === "rear")!.fear > 0);
  assert.ok(actors.find(item => item.id === "leader")!.fear < actors.find(item => item.id === "rear")!.fear);
  assert.ok(squads[0]!.cohesion < 1);
  assert.ok(result.signals.every(signal => signal.depth <= 1));
});

test("morale context accounts for isolation, escape access, attention, relationship, and formation", () => {
  const scenario = {
    rules: { morale: { enabled: true, shockRadiusM: 5, shockFalloff: 1, allyShockScale: 1,
      leaderResistance: 0, cascadeDepth: 0, perPulseCap: 0.6, recoverThreshold: 0.05,
      shakenThreshold: 0.1, frozenThreshold: 0.2, routeThreshold: 0.3, recoveryPerPulse: 0 } },
  } as ScenarioSpec;
  const rules = moraleRules(scenario);
  const isolated = actor("isolated", 1);
  isolated.squadId = undefined;
  const opponent = { ...actor("opponent", 4), side: "blue", squadId: undefined };
  applyMorale([isolated, opponent], [], [], true, rules, {
    observations: [{ observerId: "isolated", visibleActorIds: ["opponent"], heardActorIds: [], rememberedActorIds: [], uncertainty: 0, rngSamples: [] }],
  });
  const supported = actor("supported", 1);
  supported.squadId = "red";
  const ally = actor("ally", 1.5);
  applyMorale([supported, ally, opponent], [{ id: "red", side: "red", cohesion: 0.8, routedCount: 0 }], [], true, rules, {
    observations: [{ observerId: "supported", visibleActorIds: ["opponent"], heardActorIds: [], rememberedActorIds: [], uncertainty: 0, rngSamples: [] }],
    exits: [{ id: "safe", x: 1, y: 0, width: 1, height: 2 }],
    communicationActorIds: ["ally"],
  });
  assert.ok(isolated.fear > supported.fear, "isolation pressure must exceed nearby-ally and exit relief");

  const source = actor("source", 1);
  source.attention = 1;
  const related = actor("related", 2);
  related.attention = 1;
  const distantRelation = actor("other-squad", 2);
  distantRelation.squadId = "other";
  distantRelation.attention = 0.2;
  const packet = { packetId: "context", sourceId: "blue", targetId: "source", contactQuality: 1, severity: 1,
    impulseNs: 10, terms: {}, noiseSample: 0.5, noise: 0, disruption: 0, impairment: 0, shock: 0.5,
    separationM: 0, neutralization: false };
  const result = applyMorale([source, related, distantRelation], [], [packet], true, rules);
  const relatedSignal = result.signals.find(signal => signal.sourceActorId === "source" && signal.targetActorId === "related")!;
  const distantSignal = result.signals.find(signal => signal.sourceActorId === "source" && signal.targetActorId === "other-squad")!;
  assert.ok(relatedSignal.amount > distantSignal.amount, "attention and squad relationship must modulate observed shock");
});

test("one-versus-three fixture produces a replayable morale cascade and doctrine traces", async () => {
  const scenario = JSON.parse(await readFile(fixtureUrl, "utf8")) as ScenarioSpec;
  assert.deepEqual(validateScenario(scenario), { valid: true, errors: [] });
  const log = runSimulation(scenario);
  assert.deepEqual(validateRunLog(log), { valid: true, errors: [] });
  assert.ok(log.events.some(event => event.type === "contact-resolved"));
  assert.ok(log.events.some(event => event.type === "morale-signal"));
  assert.ok(log.events.some(event => event.type === "morale-updated"));
  assert.ok(log.events.some(event => event.type === "squad-updated"));
  assert.ok(log.traces.some(trace => Object.keys(trace.formulaTerms).some(key => key.startsWith("policy."))));
  assert.equal(checksum(replay(log)), log.finalChecksum);
  const reversed = structuredClone(scenario);
  reversed.actors.reverse();
  reversed.squads?.reverse();
  assert.equal(checksum(runSimulation(reversed)), checksum(log));
});

test("human intent cannot bypass the post-threat commitment gate", () => {
  const scenario: ScenarioSpec = {
    schemaVersion: "1.3.0", id: "human-gate", name: "Human gate", seed: 10, pulseMs: 100, maxTicks: 1,
    map: { width: 5, height: 3 }, threat: { active: false },
    actors: [{ id: "operator", side: "red", position: { x: 1, y: 1 }, readiness: 1, stamina: 1,
      resolve: 1, threatened: true, policyId: "human-intent", humanIntent: "commit" }],
  };
  const log = runSimulation(scenario);
  assert.ok(log.events.some(event => event.type === "intent-gated" &&
    event.payload.failedPredicate === "active-threat-required" && event.payload.selected === "withdraw"));
  assert.equal(log.events.some(event => event.type === "contact-resolved"), false);
});

test("routing overrides human intent, reaches a declared exit, and completes evacuation", () => {
  const scenario: ScenarioSpec = {
    schemaVersion: "1.3.0", id: "routing", name: "Routing", seed: 9, pulseMs: 100, maxTicks: 10,
    map: { width: 5, height: 3, exits: [{ id: "safe", x: 2, y: 0.5, width: 1, height: 2 }] },
    threat: { active: true },
    rules: { morale: { enabled: true, recoveryPerPulse: 0, recoverThreshold: 0.1,
      shakenThreshold: 0.2, frozenThreshold: 0.4, routeThreshold: 0.6 } },
    objectives: [{ id: "evacuate", kind: "evacuate-side", side: "red" }],
    terminalConditions: [{ kind: "objective-complete", objectiveId: "evacuate" }],
    actors: [{ id: "runner", side: "red", position: { x: 1, y: 1.5 }, movementSpeed: 10,
      readiness: 0.5, stamina: 1, resolve: 0.2, fear: 0.9, policyId: "human-intent", humanIntent: "commit" }],
  };
  const log = runSimulation(scenario);
  const runner = log.finalState.actors[0]!;
  assert.equal(runner.escaped, true);
  assert.equal(runner.active, false);
  assert.equal(log.finalState.objectiveProgress.evacuate, true);
  assert.ok(log.events.some(event => event.type === "intent-gated" && event.payload.failedPredicate === "morale-routing-override"));
  assert.ok(log.events.some(event => event.type === "route-progress" && event.payload.reachedExit === true));
});
