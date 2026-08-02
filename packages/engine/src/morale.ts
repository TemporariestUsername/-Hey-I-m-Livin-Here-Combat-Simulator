import type {
  ActorState, ExitZone, MoraleRules, ScenarioSpec, SimulationState, SquadState,
} from "../../schema/src/index.ts";
import type { EffectPacket } from "./mechanics.ts";
import type { ActorObservation } from "./sensing.ts";
import { distance } from "./geometry.ts";
import { persistedNumber } from "./numeric.ts";

export interface EffectiveMoraleRules {
  enabled: boolean;
  shockRadiusM: number;
  shockFalloff: number;
  allyShockScale: number;
  leaderResistance: number;
  cascadeDepth: number;
  perPulseCap: number;
  shakenThreshold: number;
  frozenThreshold: number;
  routeThreshold: number;
  recoverThreshold: number;
  recoveryPerPulse: number;
}

export interface MoraleSignal {
  sourceActorId: string;
  targetActorId: string;
  depth: number;
  amount: number;
  distanceM: number;
}

export interface MoraleUpdate {
  actorId: string;
  fearBefore: number;
  fearAfter: number;
  stateBefore: ActorState["moraleState"];
  stateAfter: ActorState["moraleState"];
}

export interface SquadUpdate {
  squadId: string;
  cohesionBefore: number;
  cohesionAfter: number;
  routedCount: number;
}

export interface MoraleContext {
  observations?: readonly ActorObservation[];
  exits?: readonly ExitZone[];
  communicationActorIds?: readonly string[];
}

export const DEFAULT_MORALE_RULES: EffectiveMoraleRules = Object.freeze({
  enabled: false,
  shockRadiusM: 8,
  shockFalloff: 1.4,
  allyShockScale: 0.65,
  leaderResistance: 0.25,
  cascadeDepth: 2,
  perPulseCap: 0.45,
  shakenThreshold: 0.3,
  frozenThreshold: 0.55,
  routeThreshold: 0.78,
  recoverThreshold: 0.22,
  recoveryPerPulse: 0.025,
});

const clamp = (value: number): number => persistedNumber(Math.min(1, Math.max(0, value)));

export function moraleRules(scenario: ScenarioSpec): EffectiveMoraleRules {
  const configured: MoraleRules | undefined = scenario.rules?.morale;
  return {
    enabled: configured?.enabled ?? DEFAULT_MORALE_RULES.enabled,
    shockRadiusM: configured?.shockRadiusM ?? DEFAULT_MORALE_RULES.shockRadiusM,
    shockFalloff: configured?.shockFalloff ?? DEFAULT_MORALE_RULES.shockFalloff,
    allyShockScale: configured?.allyShockScale ?? DEFAULT_MORALE_RULES.allyShockScale,
    leaderResistance: configured?.leaderResistance ?? DEFAULT_MORALE_RULES.leaderResistance,
    cascadeDepth: configured?.cascadeDepth ?? DEFAULT_MORALE_RULES.cascadeDepth,
    perPulseCap: configured?.perPulseCap ?? DEFAULT_MORALE_RULES.perPulseCap,
    shakenThreshold: configured?.shakenThreshold ?? DEFAULT_MORALE_RULES.shakenThreshold,
    frozenThreshold: configured?.frozenThreshold ?? DEFAULT_MORALE_RULES.frozenThreshold,
    routeThreshold: configured?.routeThreshold ?? DEFAULT_MORALE_RULES.routeThreshold,
    recoverThreshold: configured?.recoverThreshold ?? DEFAULT_MORALE_RULES.recoverThreshold,
    recoveryPerPulse: configured?.recoveryPerPulse ?? DEFAULT_MORALE_RULES.recoveryPerPulse,
  };
}

function nextMoraleState(actor: ActorState, fear: number, rules: EffectiveMoraleRules): ActorState["moraleState"] {
  if (actor.neutralized || actor.escaped) return actor.moraleState;
  if (actor.moraleState === "routing" && fear > rules.recoverThreshold) return "routing";
  if (actor.moraleState === "routing") return "recovering";
  if (fear >= rules.routeThreshold) return "routing";
  if (fear >= rules.frozenThreshold) return "frozen";
  if (fear >= rules.shakenThreshold) return "shaken";
  if (actor.moraleState === "recovering" && fear > rules.recoverThreshold) return "recovering";
  return "steady";
}

export function applyMorale(
  actors: ActorState[],
  squads: SquadState[],
  packets: readonly EffectPacket[],
  threatActive: boolean,
  rules: EffectiveMoraleRules,
  context: MoraleContext = {},
): { signals: MoraleSignal[]; updates: MoraleUpdate[]; squadUpdates: SquadUpdate[] } {
  if (!rules.enabled) return { signals: [], updates: [], squadUpdates: [] };
  const ordered = [...actors].sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(ordered.map(actor => [actor.id, actor]));
  const direct = new Map<string, number>();
  for (const packet of packets) {
    direct.set(packet.targetId, (direct.get(packet.targetId) ?? 0) + packet.shock);
  }

  let wave = [...direct.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([actorId, amount]) => ({ actorId, amount: clamp(amount) }));
  const received = new Map<string, number>();
  const signals: MoraleSignal[] = [];
  for (let depth = 0; depth <= rules.cascadeDepth && wave.length > 0; depth += 1) {
    const next = new Map<string, number>();
    for (const source of wave) {
      const sourceActor = byId.get(source.actorId);
      if (!sourceActor) continue;
      for (const target of ordered) {
        if (target.id === source.actorId || target.side !== sourceActor.side || !target.active || target.neutralized) continue;
        const distanceM = distance(sourceActor.position, target.position);
        if (distanceM > rules.shockRadiusM) continue;
        const falloff = Math.pow(Math.max(0, 1 - distanceM / rules.shockRadiusM), rules.shockFalloff);
        const resistance = target.leader ? 1 - rules.leaderResistance : 1;
        const attention = 0.5 + (target.attention ?? 1) * 0.5;
        const relationship = sourceActor.squadId && sourceActor.squadId === target.squadId ? 1 : 0.75;
        const amount = persistedNumber(source.amount * rules.allyShockScale * falloff * resistance * attention * relationship * Math.pow(0.5, depth));
        if (amount <= 0) continue;
        signals.push({ sourceActorId: source.actorId, targetActorId: target.id, depth, amount, distanceM: persistedNumber(distanceM) });
        received.set(target.id, Math.min(rules.perPulseCap, (received.get(target.id) ?? 0) + amount));
        if (depth < rules.cascadeDepth) next.set(target.id, Math.max(next.get(target.id) ?? 0, amount));
      }
    }
    wave = [...next.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([actorId, amount]) => ({ actorId, amount }));
  }

  const updates: MoraleUpdate[] = [];
  const observationByActor = new Map((context.observations ?? []).map(observation => [observation.observerId, observation]));
  for (const actor of ordered) {
    if (actor.neutralized || actor.escaped) continue;
    const fearBefore = actor.fear;
    const stateBefore = actor.moraleState;
    const stimulus = Math.min(rules.perPulseCap, received.get(actor.id) ?? 0);
    const selfShock = Math.min(rules.perPulseCap, direct.get(actor.id) ?? 0) * 0.35;
    const allies = ordered.filter(candidate => candidate.id !== actor.id && candidate.side === actor.side && candidate.active && !candidate.neutralized);
    const nearestAlly = allies.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...allies.map(ally => distance(actor.position, ally.position)));
    const isolation = context.observations
      ? allies.length === 0 ? 1 : Math.min(1, nearestAlly / Math.max(rules.shockRadiusM, 0.001))
      : 0;
    const nearestExit = (context.exits ?? []).length === 0 ? Number.POSITIVE_INFINITY : Math.min(...(context.exits ?? []).map(exit =>
      distance(actor.position, { x: exit.x + exit.width / 2, y: exit.y + exit.height / 2 })));
    const escapeAccess = Number.isFinite(nearestExit) ? Math.max(0, 1 - nearestExit / Math.max(rules.shockRadiusM * 2, 0.001)) : 0;
    const observation = observationByActor.get(actor.id);
    const perceivedPressure = observation
      ? observation.visibleActorIds.length + observation.heardActorIds.length > 0 ? 1 : 0.35
      : 0;
    const isolationPressure = threatActive ? 0.012 * (1 - actor.resolve) * isolation * perceivedPressure : 0;
    const escapeRelief = threatActive ? 0.008 * actor.resolve * escapeAccess : 0;
    const recovery = stimulus === 0 && selfShock === 0
      ? rules.recoveryPerPulse * actor.resolve * (threatActive ? 0.35 : 1)
      : 0;
    actor.fear = clamp(fearBefore + stimulus + selfShock + isolationPressure - escapeRelief - recovery);
    actor.moraleState = nextMoraleState(actor, actor.fear, rules);
    if (actor.fear !== fearBefore || actor.moraleState !== stateBefore) {
      updates.push({ actorId: actor.id, fearBefore, fearAfter: actor.fear, stateBefore, stateAfter: actor.moraleState });
    }
  }

  const squadUpdates: SquadUpdate[] = [];
  const communicating = new Set(context.communicationActorIds ?? []);
  for (const squad of [...squads].sort((a, b) => a.id.localeCompare(b.id))) {
    const members = ordered.filter(actor => actor.squadId === squad.id);
    if (members.length === 0) continue;
    const cohesionBefore = squad.cohesion;
    const routedCount = members.filter(actor => actor.moraleState === "routing" || actor.escaped).length;
    const averageFear = members.reduce((sum, actor) => sum + actor.fear, 0) / members.length;
    const leader = squad.leaderId ? byId.get(squad.leaderId) : undefined;
    const leaderPenalty = leader && (!leader.active || leader.neutralized) ? 0.15 : 0;
    const center = {
      x: members.reduce((sum, actor) => sum + actor.position.x, 0) / members.length,
      y: members.reduce((sum, actor) => sum + actor.position.y, 0) / members.length,
    };
    const formationPressure = members.reduce((sum, actor) => sum + distance(actor.position, center), 0) /
      members.length / Math.max(rules.shockRadiusM, 0.001);
    const communicationBoost = members.filter(actor => communicating.has(actor.id)).length / members.length * 0.08;
    const target = clamp(1 - averageFear * 0.55 - routedCount / members.length * 0.3 - leaderPenalty -
      Math.min(0.15, formationPressure * 0.12) + communicationBoost);
    const step = Math.min(0.1, Math.abs(target - squad.cohesion));
    squad.cohesion = clamp(squad.cohesion + Math.sign(target - squad.cohesion) * step);
    squad.routedCount = routedCount;
    if (squad.cohesion !== cohesionBefore || routedCount > 0) {
      squadUpdates.push({ squadId: squad.id, cohesionBefore, cohesionAfter: squad.cohesion, routedCount });
    }
  }
  return { signals, updates, squadUpdates };
}

export function sideIsRouted(state: Pick<SimulationState, "actors">, side: string): boolean {
  const members = state.actors.filter(actor => actor.side === side && !actor.neutralized);
  return members.length > 0 && members.every(actor => actor.moraleState === "routing" || actor.escaped);
}
