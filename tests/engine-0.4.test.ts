import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_DEFINITIONS,
  applyEffectPackets,
  createInitialState,
  DEFAULT_PHYSICS_RULES,
  evaluateEngagement,
  resolveContacts,
  resolveMovement,
  resolveSupportActions,
  runSimulation,
  type CommitProfile,
  UniformGridIndex,
} from "../packages/engine/src/index.ts";
import { validateScenario, type ActorState, type ScenarioSpec } from "../packages/schema/src/index.ts";

const actor = (id: string, side: string, x: number, overrides: Partial<ScenarioSpec["actors"][number]> = {}) => ({
  id, side, position: { x, y: 5 }, readiness: 0.8, stamina: 1, resolve: 0.8, ...overrides,
});

test("the data-driven action registry completely describes the Version 1 vocabulary", () => {
  const expected = ["aid-ally", "commit", "communicate", "observe", "protect", "rally", "ready-tool", "reposition", "wait", "withdraw"];
  assert.deepEqual(ACTION_DEFINITIONS.map(definition => definition.kind).sort(), expected);
  assert.equal(new Set(ACTION_DEFINITIONS.map(definition => definition.kind)).size, expected.length);
  for (const definition of ACTION_DEFINITIONS) {
    assert.ok(definition.durationTicks >= 1);
    assert.ok(definition.staminaCost >= 0 && definition.staminaCost <= 1);
    assert.ok(expected.includes(definition.fallback));
    assert.ok(Array.isArray(definition.preconditions));
    assert.ok(Array.isArray(definition.possibleEffects));
  }
});

test("uniform-grid queries match brute-force radius searches in stable order", () => {
  const items = [
    { id: "delta", position: { x: 7, y: 7 } }, { id: "alpha", position: { x: 1, y: 1 } },
    { id: "charlie", position: { x: 3, y: 2 } }, { id: "bravo", position: { x: 2, y: 1 } },
  ];
  const index = new UniformGridIndex(items, 1.5);
  for (const [center, radius] of [[{ x: 2, y: 1 }, 1.1], [{ x: 3, y: 3 }, 3], [{ x: 7, y: 7 }, 0]] as const) {
    const expected = items.filter(item => Math.hypot(item.position.x - center.x, item.position.y - center.y) <= radius + 1e-12)
      .sort((left, right) => left.id.localeCompare(right.id));
    assert.deepEqual(index.queryRadius(center, radius), expected);
  }
});

test("arbitrary valid Version 1 intent sequences keep every persisted number finite and bounded", () => {
  const actions = ACTION_DEFINITIONS.map(definition => definition.kind);
  let state = 0x5eed1234;
  const random = () => { state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0; return state / 0x1_0000_0000; };
  const finite = value => typeof value === "number" ? Number.isFinite(value) : Array.isArray(value)
    ? value.every(finite) : value && typeof value === "object" ? Object.values(value).every(finite) : true;
  for (let caseIndex = 0; caseIndex < 80; caseIndex += 1) {
    const actors = Array.from({ length: 4 }, (_, index) => ({
      id: `actor-${index}`, side: index < 2 ? "blue" : "amber",
      position: { x: 1 + index * 1.5, y: 1 + random() * 2 }, facingDegrees: index < 2 ? 0 : 180,
      visionRange: 10, visionArcDegrees: 360, hearingRangeM: 10, attention: random(), soundSignature: random(),
      movementSpeed: .5 + random() * 2, massKg: 45 + random() * 75, radiusM: .2 + random() * .2,
      skill: random(), balance: random(), guard: random(), mobility: random(), surprise: random(), reachM: .3 + random(),
      protection: random(), readiness: random(), stamina: random(), resolve: random(), fear: random() * .4,
      threatened: true, policyId: "human-intent" as const, humanIntent: actions[Math.floor(random() * actions.length)]!,
      humanTargetActorId: `actor-${(index + 1) % 4}`, humanTargetPoint: { x: 2 + random() * 4, y: 1 + random() * 3 },
    }));
    const scenario: ScenarioSpec = {
      schemaVersion: "1.3.0", id: `fuzz-${caseIndex}`, name: "Deterministic intent fuzz", seed: caseIndex,
      pulseMs: 100, maxTicks: 6, map: { width: 10, height: 6, exits: [{ id: "safe", x: 9, y: 2, width: 1, height: 2 }] },
      threat: { active: true, endsAtTick: 6, severity: random(), immediacy: random(), retreatAvailable: true,
        threatenedActorIds: actors.map(actor => actor.id) },
      rules: { physics: { enabled: true }, morale: { enabled: true } },
      terminalConditions: [{ kind: "threat-ended" }], actors,
    };
    assert.deepEqual(validateScenario(scenario), { valid: true, errors: [] });
    const log = runSimulation(scenario);
    assert.ok(finite(log));
    for (const actor of log.finalState.actors) {
      for (const field of ["stamina", "resolve", "fear", "shock", "balance", "guard", "mobility", "impairment", "disruption", "awareness", "toolReady", "engagementHeadroom"]) {
        const value = Number(actor[field]); assert.ok(value >= 0 && value <= 1, `${field} out of bounds in case ${caseIndex}`);
      }
    }
  }
});

test("scheduled light and noise transitions produce visible, then remembered, observations", () => {
  const scenario: ScenarioSpec = {
    schemaVersion: "1.3.0", id: "environment-memory", name: "Environment memory boundary", seed: 19,
    pulseMs: 100, maxTicks: 3, map: { width: 10, height: 10 },
    environment: { ambientLight: 0, ambientNoise: 1, visibilityScale: 0.1 },
    scheduledEvents: [
      { id: "lights-up", tick: 2, kind: "environment", ambientLight: 1, ambientNoise: 0, visibilityScale: 1 },
      { id: "lights-out", tick: 3, kind: "environment", ambientLight: 0, ambientNoise: 1, visibilityScale: 0.1 },
    ],
    threat: { active: true },
    actors: [
      actor("observer", "blue", 2, { facingDegrees: 0, visionRange: 10, visionArcDegrees: 120,
        attention: 1, hearingRangeM: 0, policyId: "human-intent", humanIntent: "observe" }),
      actor("signal", "amber", 4, { policyId: "human-intent", humanIntent: "wait", soundSignature: 0 }),
    ],
  };
  assert.deepEqual(validateScenario(scenario), { valid: true, errors: [] });
  const log = runSimulation(scenario);
  const observations = log.events.filter(event => event.type === "observation-built" && event.payload.observerId === "observer");
  assert.deepEqual(observations.map(event => ({
    tick: event.tick,
    visible: event.payload.visibleActorIds,
    heard: event.payload.heardActorIds,
    remembered: event.payload.rememberedActorIds,
  })), [
    { tick: 1, visible: [], heard: [], remembered: [] },
    { tick: 2, visible: ["signal"], heard: [], remembered: [] },
    { tick: 3, visible: [], heard: [], remembered: ["signal"] },
  ]);
  assert.equal(log.events.filter(event => event.type === "environment-changed").length, 2);
  assert.equal(log.finalState.randomStreams.sensing.draws, 6);
  assert.deepEqual(runSimulation(scenario), log);
});

test("hearing reveals IDs without hidden positions and uncertainty remains bounded", () => {
  const scenario: ScenarioSpec = {
    schemaVersion: "1.3.0", id: "hearing", name: "Hearing only", seed: 23, pulseMs: 100, maxTicks: 1,
    map: { width: 20, height: 10, obstacles: [{ id: "screen", x: 4, y: 0, width: 1, height: 10, blocksVision: true, blocksMovement: false }] },
    environment: { ambientLight: 1, ambientNoise: 0, visibilityScale: 1 }, threat: { active: true },
    actors: [
      actor("listener", "blue", 2, { facingDegrees: 0, visionRange: 20, visionArcDegrees: 360,
        attention: 1, hearingRangeM: 20, policyId: "human-intent", humanIntent: "observe" }),
      actor("source", "amber", 7, { soundSignature: 1, policyId: "human-intent", humanIntent: "wait" }),
    ],
  };
  const event = runSimulation(scenario).events.find(item => item.type === "observation-built" && item.payload.observerId === "listener")!;
  assert.deepEqual(event.payload.visibleActorIds, []);
  assert.deepEqual(event.payload.heardActorIds, ["source"]);
  assert.equal(Object.hasOwn(event.payload, "positions"), false);
  assert.ok(Number(event.payload.uncertainty) >= 0 && Number(event.payload.uncertainty) <= 1);
});

test("navigation areas reject gap crossing and invalid authored destinations", () => {
  const map = {
    width: 10, height: 10,
    navigableAreas: [
      { id: "left", x: 0, y: 0, width: 4, height: 10 },
      { id: "right", x: 6, y: 0, width: 4, height: 10 },
    ],
  };
  assert.deepEqual(resolveMovement({ x: 2, y: 5 }, { x: 3.5, y: 5 }, map), { x: 3.5, y: 5 });
  assert.deepEqual(resolveMovement({ x: 2, y: 5 }, { x: 8, y: 5 }, map), { x: 2, y: 5 });
  const invalid: ScenarioSpec = {
    schemaVersion: "1.3.0", id: "bad-destination", name: "Bad destination", seed: 1, pulseMs: 100, maxTicks: 1,
    map, threat: { active: true }, actors: [actor("mover", "blue", 2, {
      policyId: "human-intent", humanIntent: "reposition", humanTargetPoint: { x: 5, y: 5 },
    })],
  };
  assert.match(validateScenario(invalid).errors.join("\n"), /humanTargetPoint must be inside a navigable area/u);
});

test("support actions apply complete per-target simultaneous effects without input-order bias", () => {
  const scenario: ScenarioSpec = {
    schemaVersion: "1.3.0", id: "support-actions", name: "Support actions", seed: 2, pulseMs: 100, maxTicks: 1,
    map: { width: 10, height: 10 }, threat: { active: true },
    squads: [{ id: "blue-team", side: "blue", leaderId: "alpha", initialCohesion: 0.4 }],
    actors: [
      actor("alpha", "blue", 2, { squadId: "blue-team", leader: true }),
      actor("bravo", "blue", 3, { squadId: "blue-team", humanTargetActorId: "charlie" }),
      actor("charlie", "blue", 4, { squadId: "blue-team", tool: {
        id: "signal-tool", class: "signal", reachM: 0, readiness: 0.75, concealment: 0.8,
        durability: 0.6, defensiveUtility: 0.1, intimidation: 0,
      } }),
    ],
  };
  const initial = createInitialState(scenario);
  const prepare = (actors: ActorState[]) => {
    actors.find(item => item.id === "alpha")!.intent = "communicate";
    actors.find(item => item.id === "bravo")!.intent = "aid-ally";
    actors.find(item => item.id === "charlie")!.intent = "ready-tool";
    const charlie = actors.find(item => item.id === "charlie")!;
    Object.assign(charlie, { fear: 0.5, shock: 0.4, disruption: 0.4, impairment: 0.2, toolReady: 0.2 });
  };
  prepare(initial.actors);
  const resolutions = resolveSupportActions(initial.actors, initial.squads);
  assert.ok(resolutions.some(item => item.actorId === "alpha" && item.targetId === "blue-team" && item.changes.cohesion! > 0));
  assert.ok(resolutions.some(item => item.actorId === "alpha" && item.targetId === "charlie" && item.changes.fear! < 0));
  assert.equal(resolutions.filter(item => item.actorId === "bravo" && item.targetId === "charlie").length, 3);
  assert.ok(resolutions.some(item => item.actorId === "charlie" && item.targetId === "charlie" && item.changes.toolReady! > 0));
  assert.ok(initial.squads[0]!.cohesion > 0.4);
  assert.ok(initial.actors.find(item => item.id === "charlie")!.shock < 0.4);
  assert.ok(initial.actors.find(item => item.id === "charlie")!.toolReady > 0.2);

  const reversedState = createInitialState(scenario);
  reversedState.actors.reverse();
  prepare(reversedState.actors);
  assert.deepEqual(resolveSupportActions(reversedState.actors, reversedState.squads), resolutions);
  const normalized = (actors: ActorState[]) => [...actors].sort((left, right) => left.id.localeCompare(right.id));
  assert.deepEqual(normalized(reversedState.actors), normalized(initial.actors));
  assert.deepEqual(reversedState.squads, initial.squads);
});

test("engagement thresholds, threatened sides, retreat availability, and headroom are explicit", () => {
  const scenario: ScenarioSpec = {
    schemaVersion: "1.3.0", id: "engagement", name: "Engagement gate", seed: 3, pulseMs: 100, maxTicks: 1,
    map: { width: 10, height: 10 },
    threat: { active: true, severity: 0.6, immediacy: 0.9, retreatAvailable: false, threatenedActorIds: ["a", "b"] },
    rules: { engagement: { minimumSeverity: 0.7, minimumImmediacy: 0.8, requireThreatenedParty: true } },
    actors: [actor("a", "blue", 1), actor("b", "amber", 3), actor("c", "amber", 5)],
  };
  const state = createInitialState(scenario);
  const c = state.actors.find(item => item.id === "c")!;
  const commitment = evaluateEngagement(c, "commit", true, scenario);
  assert.equal(commitment.predicates.threatenedParty, true, "all explicitly threatened sides must qualify");
  assert.equal(commitment.selected, "protect", "unavailable retreat must not be selected as fallback");
  assert.deepEqual(commitment.failedPredicates, ["minimum-severity-required"]);
  assert.ok(commitment.headroom > 0 && commitment.headroom < 1);
  const withdrawal = evaluateEngagement(c, "withdraw", true, scenario);
  assert.equal(withdrawal.selected, "protect");
  assert.deepEqual(withdrawal.failedPredicates, ["retreat-unavailable"]);

  const equal = structuredClone(scenario);
  equal.threat.severity = 0.7;
  equal.threat.retreatAvailable = true;
  assert.equal(evaluateEngagement(c, "commit", true, equal).selected, "commit");
  const zero = structuredClone(equal);
  zero.rules!.engagement!.minimumSeverity = 0;
  zero.rules!.engagement!.minimumImmediacy = 0;
  zero.threat.severity = 0;
  zero.threat.immediacy = 0;
  assert.equal(evaluateEngagement(c, "commit", true, zero).headroom, 1);
});

test("abstract tools affect reach and protection, and disarm removes tool availability", () => {
  const tool = {
    id: "long-control", class: "long-reach" as const, reachM: 1, readiness: 1, concealment: 0.2,
    durability: 0.4, defensiveUtility: 0, intimidation: 0.2,
  };
  const barrier = {
    id: "barrier", class: "barrier" as const, reachM: 0, readiness: 1, concealment: 0.1,
    durability: 0.4, defensiveUtility: 1, intimidation: 0,
  };
  const scenario = (sourceTool?: typeof tool, targetTool?: typeof barrier): ScenarioSpec => ({
    schemaVersion: "1.3.0", id: "tools", name: "Abstract tools", seed: 4, pulseMs: 100, maxTicks: 1,
    map: { width: 10, height: 10 }, threat: { active: true },
    actors: [
      actor("source", "blue", 2, { movementSpeed: 1, massKg: 70, skill: 0.5, reachM: 0.5, surprise: 0,
        guard: 0.5, balance: 0.8, tool: sourceTool }),
      actor("target", "amber", 3.2, { massKg: 70, guard: 0.5, balance: 0.8, tool: targetTool }),
    ],
  });
  const packet = (sourceTool?: typeof tool, targetTool?: typeof barrier) => {
    const actors = createInitialState(scenario(sourceTool, targetTool)).actors;
    const profile: CommitProfile = {
      actorId: "source", targetId: "target", tempo: 1, terms: {}, noiseSample: 0.5, noise: 0,
      inRange: true, interrupted: false,
    };
    return { actors, packet: resolveContacts(actors, [profile], DEFAULT_PHYSICS_RULES, { nextFloat: () => 0.5 }, 1)[0]! };
  };
  const base = packet();
  const extended = packet(tool);
  const defended = packet(tool, barrier);
  assert.ok(extended.packet.severity > base.packet.severity);
  assert.ok(defended.packet.severity < extended.packet.severity);
  const forcedDisarm = { ...defended.packet, disarm: true };
  const applications = applyEffectPackets(defended.actors, [forcedDisarm], scenario(tool, barrier).map, DEFAULT_PHYSICS_RULES);
  const target = defended.actors.find(item => item.id === "target")!;
  assert.equal(applications[0]!.toolDisarmed, true);
  assert.equal(target.toolAvailable, false);
  assert.equal(target.toolReady, 0);
});
