import {
  SCHEMA_VERSION,
  assertRunLog,
  assertContinuation,
  assertScenario,
  type ActionKind,
  type RunLog,
  type ScenarioSpec,
  type SimulationEvent,
  type SimulationState,
  type TraceRecord,
  type RunSnapshot,
  type SimulationContinuation,
} from "../../schema/src/index.ts";
import { getBuiltInPolicy } from "../../policies/src/index.ts";
import { checksum, GENESIS_CHECKSUM } from "./checksum.ts";
import { distance, resolveMovement } from "./geometry.ts";
import {
  applyEffectPackets,
  applyRecovery,
  buildCommitProfiles,
  evaluateObjectives,
  physicsRules,
  resolveContacts,
  resolveCrowding,
  terminalReason,
} from "./mechanics.ts";
import { persistedNumber, persistedPoint, persistedValue } from "./numeric.ts";
import { applyMorale, moraleRules } from "./morale.ts";
import { initialStreamSnapshots, Pcg32 } from "./prng.ts";
import { buildObservations } from "./sensing.ts";
import { engagementRules, evaluateEngagement } from "./engagement.ts";
import { resolveSupportActions } from "./actions.ts";
import { actionDefinition } from "./action-definitions.ts";

export const ENGINE_VERSION = "0.4.0";

function normalizeScenario(scenario: ScenarioSpec): ScenarioSpec {
  const normalized = persistedValue(structuredClone(scenario));
  normalized.actors.sort((a, b) => a.id.localeCompare(b.id));
  normalized.map.obstacles?.sort((a, b) => a.id.localeCompare(b.id));
  normalized.map.exits?.sort((a, b) => a.id.localeCompare(b.id));
  normalized.map.navigableAreas?.sort((a, b) => a.id.localeCompare(b.id));
  normalized.map.environmentZones?.sort((a, b) => a.id.localeCompare(b.id));
  normalized.scheduledEvents?.sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
  normalized.squads?.sort((a, b) => a.id.localeCompare(b.id));
  normalized.objectives?.sort((a, b) => a.id.localeCompare(b.id));
  return normalized;
}

export function createInitialState(scenario: ScenarioSpec): SimulationState {
  const normalized = normalizeScenario(scenario);
  return {
    schemaVersion: SCHEMA_VERSION,
    scenarioId: normalized.id,
    tick: 0,
    elapsedMs: 0,
    threatActive: normalized.threat.active,
    done: false,
    environment: {
      ambientLight: normalized.environment?.ambientLight ?? 1,
      ambientNoise: normalized.environment?.ambientNoise ?? 0,
      visibilityScale: normalized.environment?.visibilityScale ?? 1,
    },
    randomStreams: initialStreamSnapshots(normalized.seed),
    objectiveProgress: Object.fromEntries((normalized.objectives ?? []).map(objective => [objective.id, false])),
    squads: (normalized.squads ?? []).map(squad => ({
      id: squad.id,
      side: squad.side,
      ...(squad.leaderId ? { leaderId: squad.leaderId } : {}),
      cohesion: squad.initialCohesion,
      routedCount: 0,
    })),
    actors: normalized.actors.map(actor => ({
      ...actor,
      position: persistedPoint(actor.position),
      active: true,
      intent: "observe",
      shock: 0,
      balance: actor.balance ?? 1,
      guard: actor.guard ?? 0.6,
      mobility: actor.mobility ?? 1,
      impairment: 0,
      disruption: 0,
      recoveryTicks: 0,
      neutralized: false,
      fear: actor.fear ?? 0,
      moraleState: "steady",
      escaped: false,
      awareness: actor.awareness ?? 0.5,
      memoryActorIds: [],
      memoryAges: {},
      toolReady: actor.tool?.readiness ?? 0,
      toolAvailable: Boolean(actor.tool && actor.tool.class !== "none"),
      engagementHeadroom: 0,
    })),
  };
}

function append(events: SimulationEvent[], tick: number, type: SimulationEvent["type"], payload: Record<string, unknown>): void {
  const priorChecksum = events.at(-1)?.checksum ?? GENESIS_CHECKSUM;
  const base = {
    schemaVersion: SCHEMA_VERSION,
    sequence: events.length,
    tick,
    type,
    payload: persistedValue(payload),
    priorChecksum,
  };
  events.push({ ...base, checksum: checksum(base) });
}

interface ExecutionOptions {
  stopAtTick?: number;
  resume?: Omit<SimulationContinuation, "schemaVersion" | "engineVersion" | "scenario" | "checksum">;
  measure?: (kind: "policy-decision", fields: Record<string, string | number>) => void;
}

function executeSimulation(scenario: ScenarioSpec, options: ExecutionOptions = {}): RunLog {
  assertScenario(scenario);
  const normalizedScenario = normalizeScenario(scenario);
  const initialState = structuredClone(options.resume?.initialState ?? createInitialState(normalizedScenario));
  const state = structuredClone(options.resume?.state ?? initialState);
  const events: SimulationEvent[] = structuredClone(options.resume?.events ?? []);
  const traces: TraceRecord[] = structuredClone(options.resume?.traces ?? []);
  const snapshots: RunSnapshot[] = structuredClone(options.resume?.snapshots ??
    [{ tick: 0, state: structuredClone(initialState), eventSequence: 0, traceCount: 0 }]);
  if (!options.resume) append(events, 0, "simulation-started", { scenarioId: normalizedScenario.id, seed: normalizedScenario.seed });
  const sensingRng = Pcg32.fromSnapshot(state.randomStreams.sensing);
  const movementRng = Pcg32.fromSnapshot(state.randomStreams.movement);
  const contactRng = Pcg32.fromSnapshot(state.randomStreams.contact);
  const moraleRng = Pcg32.fromSnapshot(state.randomStreams.morale);
  const policyRng = Pcg32.fromSnapshot(state.randomStreams.policy);
  const rules = physicsRules(normalizedScenario);
  const morale = moraleRules(normalizedScenario);
  const engagement = engagementRules(normalizedScenario);

  while (!state.done && (options.stopAtTick === undefined || state.tick < options.stopAtTick)) {
    state.tick += 1;
    state.elapsedMs = state.tick * normalizedScenario.pulseMs;
    for (const scheduled of [...(normalizedScenario.scheduledEvents ?? [])]
      .filter(event => event.tick === state.tick).sort((left, right) => left.id.localeCompare(right.id))) {
      if (scheduled.kind === "threat-state" && scheduled.active !== undefined) {
        const prior = state.threatActive;
        state.threatActive = scheduled.active;
        if (prior && !state.threatActive) append(events, state.tick, "threat-ended", { reason: `scheduled-event-${scheduled.id}` });
      }
      if (scheduled.kind === "environment") {
        state.environment = {
          ambientLight: scheduled.ambientLight ?? state.environment.ambientLight,
          ambientNoise: scheduled.ambientNoise ?? state.environment.ambientNoise,
          visibilityScale: scheduled.visibilityScale ?? state.environment.visibilityScale,
        };
        append(events, state.tick, "environment-changed", { eventId: scheduled.id, ...state.environment });
      }
    }
    if (state.threatActive && normalizedScenario.threat.endsAtTick === state.tick) {
      state.threatActive = false;
      append(events, state.tick, "threat-ended", { reason: "scheduled-transition" });
    }

    if (rules.enabled) {
      for (const recovery of applyRecovery(state.actors, rules)) {
        append(events, state.tick, "recovery-applied", recovery);
      }
    }

    const stochasticSensing = normalizedScenario.environment !== undefined ||
      (normalizedScenario.map.environmentZones?.length ?? 0) > 0 ||
      normalizedScenario.actors.some(actor => actor.attention !== undefined || actor.hearingRangeM !== undefined ||
        actor.soundSignature !== undefined || actor.awareness !== undefined);
    const observations = buildObservations(state.actors, normalizedScenario.map.obstacles, {
      environment: state.environment,
      zones: normalizedScenario.map.environmentZones,
      ...(stochasticSensing ? { rng: sensingRng } : {}),
    });
    const observationByActor = new Map(observations.map(observation => [observation.observerId, observation]));
    const actorById = new Map(state.actors.map(actor => [actor.id, actor]));
    for (const observation of observations) {
      const actor = actorById.get(observation.observerId)!;
      actor.memoryAges = Object.fromEntries(Object.entries(actor.memoryAges)
        .map(([id, age]) => [id, age + 1]).filter(([, age]) => age <= 5));
      for (const id of [...observation.visibleActorIds, ...observation.heardActorIds]) actor.memoryAges[id] = 0;
      actor.memoryActorIds = Object.keys(actor.memoryAges).sort();
      actor.awareness = persistedNumber(Math.min(1, Math.max(0, actor.awareness +
        (observation.visibleActorIds.length + observation.heardActorIds.length > 0 ? 0.025 : -0.01))));
      append(events, state.tick, "observation-built", { ...observation });
    }

    const policySamples = new Map<string, number[]>();
    const policyTerms = new Map<string, Record<string, number>>();
    const gatePredicates = new Map<string, Record<string, boolean>>();
    for (const actor of state.actors) {
      if (!actor.active || actor.neutralized) {
        actor.intent = "wait";
        append(events, state.tick, "intent-resolved", { actorId: actor.id, selected: "wait", stamina: actor.stamina });
        continue;
      }
      const observation = observationByActor.get(actor.id)!;
      const policy = getBuiltInPolicy(actor.policyId ?? "random-valid");
      let decision;
      if (options.measure) {
        const policyStarted = globalThis.performance.now();
        decision = policy.decide({ actor, observation, threatActive: state.threatActive }, policyRng);
        options.measure("policy-decision", {
          scenarioId: normalizedScenario.id, tick: state.tick, actorId: actor.id, policyId: policy.id,
          durationMs: persistedNumber(globalThis.performance.now() - policyStarted),
        });
      } else {
        decision = policy.decide({ actor, observation, threatActive: state.threatActive }, policyRng);
      }
      policySamples.set(actor.id, [...decision.rngSamples]);
      const selectedCandidate = decision.candidates.find(candidate => candidate.action === decision.selected);
      policyTerms.set(actor.id, Object.fromEntries(
        Object.entries(selectedCandidate?.contributions ?? {}).map(([key, value]) => [`policy.${key}`, persistedNumber(value)]),
      ));
      const proposed: ActionKind = decision.selected;
      append(events, state.tick, "policy-decided", {
        actorId: actor.id,
        policyId: policy.id,
        policyVersion: policy.version,
        selected: decision.selected,
        candidates: decision.candidates,
        rationale: decision.rationale,
        rngSamples: decision.rngSamples,
      });
      const gate = evaluateEngagement(actor, proposed, state.threatActive, normalizedScenario, engagement);
      actor.engagementHeadroom = gate.headroom;
      gatePredicates.set(actor.id, gate.predicates);
      let selected: ActionKind = gate.selected;
      let failedPredicate = gate.failedPredicates[0];
      if (actor.moraleState === "routing") {
        selected = "withdraw";
        failedPredicate = "morale-routing-override";
      } else if (actor.moraleState === "frozen") {
        selected = "wait";
        failedPredicate = "morale-frozen-override";
      }
      if (selected !== proposed) {
        append(events, state.tick, "intent-gated", {
          actorId: actor.id,
          proposed,
          selected,
          failedPredicate: failedPredicate ?? "engagement-rule",
          failedPredicates: gate.failedPredicates.length > 0 ? gate.failedPredicates : [failedPredicate ?? "engagement-rule"],
          predicates: gate.predicates,
        });
      }
      actor.intent = selected;
      actor.stamina = persistedNumber(Math.max(0, actor.stamina - actionDefinition(selected).staminaCost));
      append(events, state.tick, "intent-resolved", { actorId: actor.id, selected, stamina: actor.stamina });
    }

    const supportResolutions = resolveSupportActions(state.actors, state.squads);
    for (const resolution of supportResolutions) {
      append(events, state.tick, "action-resolved", resolution);
    }

    // All movement proposals are collected before any position is applied, so
    // direct actor references form a stable read snapshot for this pass.
    const snapshot = actorById;
    const rawProposals = state.actors.map(actor => {
      if (!actor.active || actor.neutralized || (actor.intent !== "withdraw" && actor.intent !== "reposition")) {
        return { actorId: actor.id, position: { ...actor.position }, blocked: false };
      }
      const routing = actor.moraleState === "routing";
      const exits = normalizedScenario.map.exits ?? [];
      const routeExit = routing
        ? [...exits].sort((left, right) => {
            const leftCenter = { x: left.x + left.width / 2, y: left.y + left.height / 2 };
            const rightCenter = { x: right.x + right.width / 2, y: right.y + right.height / 2 };
            return distance(actor.position, leftCenter) - distance(actor.position, rightCenter) || left.id.localeCompare(right.id);
          })[0]
        : undefined;
      if (routing && routeExit) actor.routeExitId = routeExit.id;
      const visible = observationByActor.get(actor.id)?.visibleActorIds ?? [];
      const opponents = visible.flatMap(id => {
        const target = snapshot.get(id);
        return target && target.active && target.side !== actor.side ? [target] : [];
      });
      const nearest = opponents.sort((a, b) =>
        distance(actor.position, a.position) - distance(actor.position, b.position) ||
        a.id.localeCompare(b.id))[0];
      const authoredPoint = actor.intent === "reposition" ? actor.humanTargetPoint : undefined;
      if (!routeExit && !nearest && !authoredPoint) return { actorId: actor.id, position: { ...actor.position }, blocked: false };
      const target = routeExit
        ? { x: routeExit.x + routeExit.width / 2, y: routeExit.y + routeExit.height / 2 }
        : authoredPoint ?? nearest!.position;
      const direction = routeExit ? 1 : -1;
      let dx = (target.x - actor.position.x) * direction;
      let dy = (target.y - actor.position.y) * direction;
      if (actor.intent === "reposition" && !authoredPoint && nearest) {
        const side = actor.id.localeCompare(nearest.id) <= 0 ? 1 : -1;
        [dx, dy] = [-dy * side, dx * side];
      } else if (actor.intent === "reposition" && authoredPoint) {
        dx = target.x - actor.position.x; dy = target.y - actor.position.y;
      }
      const magnitude = Math.hypot(dx, dy);
      if (magnitude === 0) return { actorId: actor.id, position: { ...actor.position }, blocked: false };
      const step = (actor.movementSpeed ?? 1.4) * actor.mobility * normalizedScenario.pulseMs / 1000;
      const proposed = {
        x: actor.position.x + dx / magnitude * step,
        y: actor.position.y + dy / magnitude * step,
      };
      const position = resolveMovement(actor.position, proposed, normalizedScenario.map);
      return {
        actorId: actor.id,
        position,
        blocked: position.x === actor.position.x && position.y === actor.position.y,
      };
    });
    const proposals = resolveCrowding(rawProposals, state.actors);
    for (const proposal of proposals) {
      const actor = actorById.get(proposal.actorId)!;
      const from = { ...actor.position };
      actor.position = proposal.position;
      append(events, state.tick, "movement-resolved", {
        actorId: actor.id,
        from,
        to: { ...actor.position },
        blocked: proposal.blocked,
      });
      if (actor.moraleState === "routing" && actor.routeExitId) {
        const exit = normalizedScenario.map.exits?.find(item => item.id === actor.routeExitId);
        const reachedExit = Boolean(exit && actor.position.x >= exit.x && actor.position.x <= exit.x + exit.width &&
          actor.position.y >= exit.y && actor.position.y <= exit.y + exit.height);
        if (reachedExit) {
          actor.escaped = true;
          actor.active = false;
        }
        append(events, state.tick, "route-progress", {
          actorId: actor.id,
          exitId: actor.routeExitId,
          reachedExit,
          position: { ...actor.position },
        });
      }
    }

    const profiles = rules.enabled ? buildCommitProfiles(state.actors, observations, rules, contactRng) : [];
    for (const profile of profiles) {
      append(events, state.tick, "tempo-resolved", {
        actorId: profile.actorId,
        targetId: profile.targetId,
        tempo: profile.tempo,
        terms: profile.terms,
        noise: profile.noise,
        interrupted: profile.interrupted,
        ...(profile.interruptedBy ? { interruptedBy: profile.interruptedBy } : {}),
      });
    }

    const packets = rules.enabled
      ? resolveContacts(state.actors, profiles, rules, contactRng, state.tick)
      : [];
    for (const packet of packets) {
      append(events, state.tick, "contact-resolved", {
        packetId: packet.packetId,
        sourceId: packet.sourceId,
        targetId: packet.targetId,
        contactQuality: packet.contactQuality,
        severity: packet.severity,
        impulseNs: packet.impulseNs,
        terms: packet.terms,
        noise: packet.noise,
        disruption: packet.disruption,
        impairment: packet.impairment,
        shock: packet.shock,
        separationM: packet.separationM,
        neutralization: packet.neutralization,
        disarm: packet.disarm,
      });
    }

    const applications = rules.enabled
      ? applyEffectPackets(state.actors, packets, normalizedScenario.map, rules)
      : [];
    for (const application of applications) {
      const { toolDisarmed, ...effectApplication } = application;
      append(events, state.tick, "effects-applied", effectApplication);
      if (toolDisarmed) {
        const actor = actorById.get(application.targetId)!;
        append(events, state.tick, "tool-state-changed", {
          actorId: actor.id, toolAvailable: actor.toolAvailable, toolReady: actor.toolReady, reason: "abstract-disarm",
        });
      }
    }

    // A scenario may explicitly declare a side-neutralized terminal condition.
    // When the first decisive effect satisfies that condition, the threat ends
    // in the same pulse instead of relying on an unrelated fixed-time script.
    if (state.threatActive && applications.some(application => application.neutralized)) {
      const endedSide = [...(normalizedScenario.terminalConditions ?? [])]
        .filter(condition => condition.kind === "side-neutralized" && condition.side)
        .map(condition => condition.side!)
        .sort()
        .find(side => {
          const members = state.actors.filter(actor => actor.side === side);
          return members.length > 0 && members.every(actor => actor.neutralized);
        });
      if (endedSide) {
        state.threatActive = false;
        append(events, state.tick, "threat-ended", { reason: `decisive-effect-side-neutralized-${endedSide}` });
      }
    }

    const moraleResult = applyMorale(state.actors, state.squads, packets, state.threatActive, morale, {
      observations,
      exits: normalizedScenario.map.exits,
      communicationActorIds: state.actors.filter(actor => actor.intent === "communicate" || actor.intent === "rally").map(actor => actor.id),
    });
    for (const signal of moraleResult.signals) append(events, state.tick, "morale-signal", signal);
    for (const update of moraleResult.updates) append(events, state.tick, "morale-updated", update);
    for (const update of moraleResult.squadUpdates) append(events, state.tick, "squad-updated", update);

    const nextProgress = evaluateObjectives(state, normalizedScenario);
    for (const objectiveId of Object.keys(nextProgress).sort()) {
      if (state.objectiveProgress[objectiveId] !== nextProgress[objectiveId]) {
        append(events, state.tick, "objective-updated", {
          objectiveId,
          complete: nextProgress[objectiveId],
        });
      }
    }
    state.objectiveProgress = nextProgress;

    const profileByActor = new Map(profiles.map(profile => [profile.actorId, profile]));
    for (const actor of state.actors) {
      const profile = profileByActor.get(actor.id);
      const actorPackets = packets.filter(packet => packet.sourceId === actor.id || packet.targetId === actor.id);
      const contactPacket = actorPackets.find(packet => packet.sourceId === actor.id);
      const observation = observationByActor.get(actor.id);
      const formulaTerms: Record<string, number> = { ...(policyTerms.get(actor.id) ?? {}) };
      if (profile) {
        formulaTerms.tempo = profile.tempo;
        for (const [key, value] of Object.entries(profile.terms)) formulaTerms[`tempo.${key}`] = value;
      }
      if (contactPacket) {
        formulaTerms.contactQuality = contactPacket.contactQuality;
        formulaTerms.severity = contactPacket.severity;
        formulaTerms.impulseNs = contactPacket.impulseNs;
        for (const [key, value] of Object.entries(contactPacket.terms)) formulaTerms[`contact.${key}`] = value;
      }
      traces.push({
        schemaVersion: SCHEMA_VERSION,
        tick: state.tick,
        actorId: actor.id,
        visibleActorIds: [...(observation?.visibleActorIds ?? [])],
        heardActorIds: [...(observation?.heardActorIds ?? [])],
        rememberedActorIds: [...(observation?.rememberedActorIds ?? [])],
        observationUncertainty: observation?.uncertainty ?? 1,
        selectedAction: actor.intent,
        formulaTerms,
        randomSamples: [
          ...(policySamples.get(actor.id) ?? []),
          ...(observation?.rngSamples ?? []),
          ...(profile ? [profile.noiseSample] : []),
          ...actorPackets.filter(packet => packet.sourceId === actor.id).map(packet => packet.noiseSample),
        ].map(persistedNumber),
        effectPacketIds: actorPackets.map(packet => packet.packetId).sort(),
        actorStateChecksum: checksum(actor),
        gatePredicates: gatePredicates.get(actor.id) ?? {},
      });
    }

    const reached = terminalReason(state, normalizedScenario);
    if (reached) {
      state.done = true;
      state.terminalReason = reached;
      append(events, state.tick, "terminal-reached", { reason: reached });
    } else if (state.tick >= normalizedScenario.maxTicks) {
      state.done = true;
      state.terminalReason = "maximum-duration";
    }
    state.randomStreams = {
      sensing: sensingRng.snapshot(), movement: movementRng.snapshot(), contact: contactRng.snapshot(),
      morale: moraleRng.snapshot(), policy: policyRng.snapshot(),
    };
    if (state.tick % 25 === 0 || state.done) {
      snapshots.push({ tick: state.tick, state: structuredClone(state), eventSequence: events.length, traceCount: traces.length });
    }
  }

  if (state.done) append(events, state.tick, "simulation-ended", { reason: state.terminalReason ?? "maximum-duration" });
  if (state.done) {
    const finalSnapshot = { tick: state.tick, state: structuredClone(state), eventSequence: events.length, traceCount: traces.length };
    if (snapshots.at(-1)?.tick === state.tick) snapshots[snapshots.length - 1] = finalSnapshot;
    else snapshots.push(finalSnapshot);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    scenario: normalizedScenario,
    initialState,
    events,
    traces,
    snapshots,
    finalState: state,
    finalChecksum: checksum(state),
  };
}

export function runSimulation(scenario: ScenarioSpec): RunLog {
  return executeSimulation(scenario);
}

export function runSimulationWithTelemetry(
  scenario: ScenarioSpec,
  measure: NonNullable<ExecutionOptions["measure"]>,
): RunLog {
  return executeSimulation(scenario, { measure });
}

function continuationBase(run: RunLog): Omit<SimulationContinuation, "checksum"> {
  return {
    schemaVersion: "1.0.0", engineVersion: run.engineVersion, scenario: run.scenario,
    initialState: run.initialState, state: run.finalState, events: run.events, traces: run.traces, snapshots: run.snapshots,
  };
}

export function captureContinuation(scenario: ScenarioSpec, tick: number): SimulationContinuation {
  if (!Number.isInteger(tick) || tick < 0 || tick >= scenario.maxTicks) throw new Error("continuation tick must be an integer before maximum duration");
  const partial = executeSimulation(scenario, { stopAtTick: tick });
  if (partial.finalState.done) throw new Error("cannot capture a continuation at or after a terminal state");
  const base = continuationBase(partial);
  return { ...base, checksum: checksum(base) };
}

function checkedContinuation(continuation: SimulationContinuation): Omit<SimulationContinuation, "checksum"> {
  assertContinuation(continuation);
  if (continuation.schemaVersion !== "1.0.0" || continuation.engineVersion !== ENGINE_VERSION) {
    throw new Error("unsupported continuation version");
  }
  const { checksum: recorded, ...base } = continuation;
  if (checksum(base) !== recorded) throw new Error("continuation checksum mismatch");
  if (continuation.state.done || continuation.state.scenarioId !== continuation.scenario.id) {
    throw new Error("continuation state is not resumable");
  }
  return base;
}

function resumeOptions(continuation: SimulationContinuation): NonNullable<ExecutionOptions["resume"]> {
  return {
    initialState: continuation.initialState, state: continuation.state, events: continuation.events,
    traces: continuation.traces, snapshots: continuation.snapshots,
  };
}

export function advanceContinuation(continuation: SimulationContinuation, pulses = 1): SimulationContinuation | RunLog {
  checkedContinuation(continuation);
  if (!Number.isInteger(pulses) || pulses < 1 || pulses > 1_000) {
    throw new RangeError("continuation pulses must be an integer from 1 to 1000");
  }
  const stopAtTick = Math.min(continuation.scenario.maxTicks, continuation.state.tick + pulses);
  const partial = executeSimulation(continuation.scenario, { resume: resumeOptions(continuation), stopAtTick });
  if (partial.finalState.done) return partial;
  const base = continuationBase(partial);
  return { ...base, checksum: checksum(base) };
}

export function resumeSimulation(continuation: SimulationContinuation): RunLog {
  checkedContinuation(continuation);
  return executeSimulation(continuation.scenario, { resume: resumeOptions(continuation) });
}

export function replay(log: RunLog): SimulationState {
  assertRunLog(log);
  if (log.engineVersion !== ENGINE_VERSION) {
    throw new Error(`Unsupported engine version ${log.engineVersion}; expected ${ENGINE_VERSION}`);
  }
  let prior = GENESIS_CHECKSUM;
  for (const [index, event] of log.events.entries()) {
    if (event.sequence !== index || event.priorChecksum !== prior) {
      throw new Error(`Broken event chain at sequence ${index}`);
    }
    const { checksum: recorded, ...base } = event;
    if (checksum(base) !== recorded) throw new Error(`Invalid event checksum at sequence ${index}`);
    prior = recorded;
  }
  const reproduced = runSimulation(log.scenario);
  if (
    reproduced.finalChecksum !== log.finalChecksum ||
    reproduced.events.at(-1)?.checksum !== prior ||
    checksum(reproduced.traces) !== checksum(log.traces)
  ) {
    throw new Error("Replay diverged from recorded run");
  }
  return reproduced.finalState;
}
