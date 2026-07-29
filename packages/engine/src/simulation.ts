import { SCHEMA_VERSION, assertScenario, type ActionKind, type RunLog, type ScenarioSpec, type SimulationEvent, type SimulationState } from "../../schema/src/index.ts";
import { getBuiltInPolicy } from "../../policies/src/index.ts";
import { checksum, GENESIS_CHECKSUM } from "./checksum.ts";
import { distance, resolveMovement } from "./geometry.ts";
import { namedStream } from "./prng.ts";
import { buildObservations } from "./sensing.ts";

export const ENGINE_VERSION = "0.1.0";

export function createInitialState(scenario: ScenarioSpec): SimulationState {
  return { schemaVersion: SCHEMA_VERSION, scenarioId: scenario.id, tick: 0, elapsedMs: 0, threatActive: scenario.threat.active, done: false,
    actors: [...scenario.actors].sort((a, b) => a.id.localeCompare(b.id)).map(actor => ({ ...actor, position: { ...actor.position }, active: true, intent: "observe", shock: 0 })) };
}

function append(events: SimulationEvent[], tick: number, type: SimulationEvent["type"], payload: Record<string, unknown>): void {
  const priorChecksum = events.at(-1)?.checksum ?? GENESIS_CHECKSUM;
  const base = { schemaVersion: SCHEMA_VERSION, sequence: events.length, tick, type, payload, priorChecksum };
  events.push({ ...base, checksum: checksum(base) });
}

export function runSimulation(scenario: ScenarioSpec): RunLog {
  assertScenario(scenario);
  const initialState = createInitialState(scenario);
  const state = structuredClone(initialState);
  const events: SimulationEvent[] = [];
  append(events, 0, "simulation-started", { scenarioId: scenario.id, seed: scenario.seed });
  const policyRng = namedStream(scenario.seed, "policy");
  while (!state.done) {
    state.tick += 1;
    state.elapsedMs = state.tick * scenario.pulseMs;
    if (state.threatActive && scenario.threat.endsAtTick === state.tick) {
      state.threatActive = false;
      append(events, state.tick, "threat-ended", { reason: "scheduled-transition" });
    }
    const observations = buildObservations(state.actors, scenario.map.obstacles);
    for (const observation of observations) append(events, state.tick, "observation-built", { ...observation });
    for (const actor of state.actors) {
      const observation = observations.find(item => item.observerId === actor.id)!;
      const policy = getBuiltInPolicy(actor.policyId ?? "random-valid");
      const decision = policy.decide({ actor, observation, threatActive: state.threatActive }, policyRng);
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
      const selected = proposed === "commit" && !state.threatActive ? "withdraw" : proposed;
      if (selected !== proposed) append(events, state.tick, "intent-gated", { actorId: actor.id, proposed, selected, failedPredicate: "active-threat-required" });
      actor.intent = selected;
      actor.stamina = Math.max(0, Number((actor.stamina - (selected === "commit" ? 0.02 : 0.005)).toFixed(6)));
      append(events, state.tick, "intent-resolved", { actorId: actor.id, selected, stamina: actor.stamina });
    }
    const snapshot = new Map(state.actors.map(actor => [actor.id, structuredClone(actor)]));
    const proposals = state.actors.map(actor => {
      if (actor.intent !== "withdraw") return { actorId: actor.id, position: { ...actor.position }, blocked: false };
      const visible = observations.find(item => item.observerId === actor.id)?.visibleActorIds ?? [];
      const opponents = visible.flatMap(id => {
        const target = snapshot.get(id);
        return target && target.side !== actor.side ? [target] : [];
      });
      const nearest = opponents.sort((a, b) => distance(actor.position, a.position) - distance(actor.position, b.position) || a.id.localeCompare(b.id))[0];
      if (!nearest) return { actorId: actor.id, position: { ...actor.position }, blocked: false };
      const dx = actor.position.x - nearest.position.x;
      const dy = actor.position.y - nearest.position.y;
      const magnitude = Math.hypot(dx, dy);
      if (magnitude === 0) return { actorId: actor.id, position: { ...actor.position }, blocked: false };
      const step = (actor.movementSpeed ?? 1.4) * scenario.pulseMs / 1000;
      const proposed = { x: actor.position.x + dx / magnitude * step, y: actor.position.y + dy / magnitude * step };
      const position = resolveMovement(actor.position, proposed, scenario.map);
      return { actorId: actor.id, position, blocked: position.x === actor.position.x && position.y === actor.position.y };
    });
    for (const proposal of proposals) {
      const actor = state.actors.find(item => item.id === proposal.actorId)!;
      const from = { ...actor.position };
      actor.position = proposal.position;
      append(events, state.tick, "movement-resolved", { actorId: actor.id, from, to: { ...actor.position }, blocked: proposal.blocked });
    }
    state.done = state.tick >= scenario.maxTicks;
  }
  append(events, state.tick, "simulation-ended", { reason: "maximum-duration" });
  return { schemaVersion: SCHEMA_VERSION, engineVersion: ENGINE_VERSION, scenario: structuredClone(scenario), initialState, events, finalState: state, finalChecksum: checksum(state) };
}

export function replay(log: RunLog): SimulationState {
  let prior = GENESIS_CHECKSUM;
  for (const [index, event] of log.events.entries()) {
    if (event.sequence !== index || event.priorChecksum !== prior) throw new Error(`Broken event chain at sequence ${index}`);
    const { checksum: recorded, ...base } = event;
    if (checksum(base) !== recorded) throw new Error(`Invalid event checksum at sequence ${index}`);
    prior = recorded;
  }
  const reproduced = runSimulation(log.scenario);
  if (reproduced.finalChecksum !== log.finalChecksum || reproduced.events.at(-1)?.checksum !== prior) throw new Error("Replay diverged from recorded run");
  return reproduced.finalState;
}
