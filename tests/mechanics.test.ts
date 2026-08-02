import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_PHYSICS_RULES,
  applyEffectPackets,
  applyRecovery,
  buildCommitProfiles,
  evaluateObjectives,
  replay,
  resolveContacts,
  resolveCrowding,
  runSimulation,
  terminalReason,
  type CommitProfile,
  type EffectivePhysicsRules,
} from "../packages/engine/src/index.ts";
import { validateRunLog, validateScenario, type ActorState, type ScenarioSpec } from "../packages/schema/src/index.ts";

const constantRng = { nextFloat: () => 0.5 };
const rules: EffectivePhysicsRules = {
  ...DEFAULT_PHYSICS_RULES,
  enabled: true,
  tempoNoise: 0,
  contactNoise: 0,
};

function actor(id: string, side: string, x: number, overrides: Partial<ActorState> = {}): ActorState {
  return {
    id,
    side,
    position: { x, y: 1 },
    facingDegrees: side === "a" ? 0 : 180,
    movementSpeed: 1.4,
    massKg: 75,
    radiusM: 0.3,
    skill: 0.7,
    reachM: 0.8,
    readiness: 0.5,
    stamina: 1,
    resolve: 0.8,
    active: true,
    intent: "commit",
    shock: 0,
    balance: 1,
    guard: 0.5,
    mobility: 1,
    impairment: 0,
    disruption: 0,
    recoveryTicks: 0,
    neutralized: false,
    ...overrides,
  };
}

function reciprocalObservations() {
  return [
    { observerId: "a", visibleActorIds: ["b"] },
    { observerId: "b", visibleActorIds: ["a"] },
  ];
}

test("interrupt threshold is exact below, equal, and above the configured margin", () => {
  for (const [readiness, expected] of [
    [0.649999, false],
    [0.65, true],
    [0.650001, true],
  ] as const) {
    const actors = [actor("a", "a", 1), actor("b", "b", 1.7, { readiness })];
    const profiles = buildCommitProfiles(actors, reciprocalObservations(), rules, constantRng);
    assert.equal(profiles.find(profile => profile.actorId === "a")?.interrupted, expected);
  }
});

test("equal-tempo contacts apply mutual effects simultaneously and ignore actor input order", () => {
  const original = [actor("a", "a", 1), actor("b", "b", 1.7)];
  function resolve(input: ActorState[]) {
    const profiles = buildCommitProfiles(input, reciprocalObservations(), rules, constantRng);
    assert.equal(profiles.filter(profile => profile.interrupted).length, 0);
    const packets = resolveContacts(input, profiles, rules, constantRng, 1);
    assert.equal(packets.length, 2);
    const state = structuredClone(input);
    applyEffectPackets(state, packets, { width: 10, height: 10 }, rules);
    return state.sort((left, right) => left.id.localeCompare(right.id));
  }
  assert.deepEqual(resolve(structuredClone(original)), resolve(structuredClone(original).reverse()));
});

test("greater mass and closing speed monotonically increase impulse and severity", () => {
  const target = actor("target", "b", 1.7);
  const profile: CommitProfile = {
    actorId: "source",
    targetId: "target",
    tempo: 1,
    terms: {},
    noiseSample: 0.5,
    noise: 0,
    inRange: true,
    interrupted: false,
  };
  const low = resolveContacts(
    [actor("source", "a", 1, { massKg: 40, movementSpeed: 0.8 }), target],
    [profile],
    rules,
    constantRng,
    1,
  )[0]!;
  const high = resolveContacts(
    [actor("source", "a", 1, { massKg: 120, movementSpeed: 2 }), target],
    [profile],
    rules,
    constantRng,
    1,
  )[0]!;
  assert.ok(high.impulseNs > low.impulseNs);
  assert.ok(high.severity > low.severity);
});

test("recovery spans pulses and never clears all accumulated effects at once", () => {
  const affected = actor("a", "a", 1, {
    disruption: 0.6,
    impairment: 0.2,
    shock: 0.5,
    balance: 0.6,
    guard: 0.4,
    stamina: 0.5,
    recoveryTicks: 5,
  });
  const applications = applyRecovery([affected], rules);
  assert.equal(applications.length, 1);
  assert.equal(affected.recoveryTicks, 4);
  assert.ok(affected.disruption > 0 && affected.disruption < 0.6);
  assert.ok(affected.impairment > 0 && affected.impairment < 0.2);
  assert.ok(affected.shock > 0 && affected.shock < 0.5);
  assert.ok(affected.balance > 0.6);
});

test("simultaneous crowding rejects overlapping proposals for every mover", () => {
  const actors = [actor("a", "a", 1), actor("b", "b", 2)];
  const proposals = resolveCrowding([
    { actorId: "a", position: { x: 1.5, y: 1 }, blocked: false },
    { actorId: "b", position: { x: 1.5, y: 1 }, blocked: false },
  ], actors);
  assert.deepEqual(proposals, [
    { actorId: "a", position: { x: 1, y: 1 }, blocked: true },
    { actorId: "b", position: { x: 2, y: 1 }, blocked: true },
  ]);
});

const physicsScenario = JSON.parse(
  await readFile(new URL("../packages/scenarios/fixtures/sudden-crisis-physics.json", import.meta.url), "utf8"),
) as ScenarioSpec;

test("physics fixture resolves contact, objective, terminal state, and complete traces", () => {
  assert.deepEqual(validateScenario(physicsScenario), { valid: true, errors: [] });
  const log = runSimulation(physicsScenario);
  assert.equal(log.finalState.tick, 1);
  assert.equal(log.finalState.terminalReason, "objective-complete-end-immediate-threat");
  assert.equal(log.finalState.objectiveProgress["end-immediate-threat"], true);
  assert.equal(log.finalState.actors.find(item => item.id === "immediate-threat")?.neutralized, true);
  for (const type of ["tempo-resolved", "contact-resolved", "effects-applied", "objective-updated", "terminal-reached"]) {
    assert.ok(log.events.some(event => event.type === type), `missing ${type}`);
  }
  assert.equal(log.traces.length, 2);
  const trace = log.traces.find(item => item.actorId === "crisis-defender")!;
  assert.ok(trace.formulaTerms.impulseNs! > 0);
  assert.ok(trace.formulaTerms.severity! > 0);
  assert.equal(trace.effectPacketIds.length, 1);
  assert.equal(trace.actorStateChecksum.length, 64);
  assert.deepEqual(validateRunLog(log), { valid: true, errors: [] });
});

test("physics artifacts remain input-order independent and replay verifies traces", () => {
  const reversed = structuredClone(physicsScenario);
  reversed.actors.reverse();
  assert.deepEqual(runSimulation(reversed), runSimulation(physicsScenario));
  const log = runSimulation(physicsScenario);
  assert.deepEqual(replay(log), log.finalState);
  const tampered = structuredClone(log);
  tampered.traces[0]!.formulaTerms.tempo = 999;
  assert.throws(() => replay(tampered), /Replay diverged/);
});

test("neutralized actors cannot receive a later policy decision or act", () => {
  const scenario = structuredClone(physicsScenario);
  scenario.maxTicks = 2;
  scenario.scheduledEvents = scenario.scheduledEvents?.filter(event => event.tick <= scenario.maxTicks);
  scenario.objectives!.push({
    id: "never-complete",
    kind: "separation",
    actorIds: ["crisis-defender", "immediate-threat"],
    minimumDistanceM: 1000,
  });
  scenario.terminalConditions = [{ kind: "objective-complete", objectiveId: "never-complete" }];
  const log = runSimulation(scenario);
  assert.equal(log.finalState.tick, 2);
  assert.equal(log.events.some(event =>
    event.tick === 2 && event.type === "policy-decided" && event.payload.actorId === "immediate-threat"), false);
  assert.ok(log.events.some(event =>
    event.tick === 2 && event.type === "intent-resolved" &&
    event.payload.actorId === "immediate-threat" && event.payload.selected === "wait"));
  assert.equal(log.events.some(event =>
    event.tick === 2 && event.type === "contact-resolved" && event.payload.sourceId === "immediate-threat"), false);
});

test("protect, separation, and terminal objective semantics are explicit", () => {
  const state = {
    actors: [actor("a", "protected", 1), actor("b", "threat", 8)],
    threatActive: false,
    objectiveProgress: {} as Record<string, boolean>,
  };
  const scenario = {
    ...structuredClone(physicsScenario),
    objectives: [
      { id: "protect", kind: "protect-side" as const, side: "protected" },
      { id: "separate", kind: "separation" as const, actorIds: ["a", "b"], minimumDistanceM: 5 },
    ],
    terminalConditions: [{ kind: "objective-complete" as const, objectiveId: "separate" }],
  };
  state.objectiveProgress = evaluateObjectives(state, scenario);
  assert.deepEqual(state.objectiveProgress, { protect: true, separate: true });
  assert.equal(terminalReason(state, scenario), "objective-complete-separate");
});

test("physics scenarios reject missing terminal conditions and invalid objective references", () => {
  const missingTerminal = structuredClone(physicsScenario);
  missingTerminal.terminalConditions = [];
  assert.ok(validateScenario(missingTerminal).errors.some(error => error.includes("terminalConditions")));
  const missingObjective = structuredClone(physicsScenario);
  missingObjective.terminalConditions = [{ kind: "objective-complete", objectiveId: "missing" }];
  assert.ok(validateScenario(missingObjective).errors.some(error => error.includes("identify an objective")));
});

test("physics state remains finite and bounded across a fixed seed cohort", () => {
  for (let seed = 0; seed < 64; seed += 1) {
    const scenario = structuredClone(physicsScenario);
    scenario.seed = seed;
    const log = runSimulation(scenario);
    for (const stateActor of log.finalState.actors) {
      for (const field of ["stamina", "resolve", "shock", "balance", "guard", "mobility", "impairment", "disruption"] as const) {
        assert.ok(Number.isFinite(stateActor[field]), `${field} must be finite`);
        assert.ok(stateActor[field] >= 0 && stateActor[field] <= 1, `${field} must be bounded`);
      }
    }
  }
});
