import type { ActorState, PhysicsRules, Point, ScenarioSpec } from "../../schema/src/index.ts";
import type { ActorObservation } from "./sensing.ts";
import { angleDifference, bearing, distance, resolveMovement } from "./geometry.ts";
import { persistedNumber, persistedPoint } from "./numeric.ts";
import { UniformGridIndex } from "./spatial-index.ts";

export interface MechanicsRng {
  nextFloat(): number;
}

export interface EffectivePhysicsRules {
  enabled: boolean;
  interruptMargin: number;
  tempoNoise: number;
  contactNoise: number;
  recoveryPerPulse: number;
  impairmentRecoveryPerPulse: number;
  separationScaleM: number;
  neutralizationThreshold: number;
}

export interface CommitProfile {
  actorId: string;
  targetId: string;
  tempo: number;
  terms: Record<string, number>;
  noiseSample: number;
  noise: number;
  inRange: boolean;
  interrupted: boolean;
  interruptedBy?: string;
}

export interface EffectPacket {
  packetId: string;
  sourceId: string;
  targetId: string;
  contactQuality: number;
  severity: number;
  impulseNs: number;
  terms: Record<string, number>;
  noiseSample: number;
  noise: number;
  disruption: number;
  impairment: number;
  shock: number;
  separationM: number;
  neutralization: boolean;
  disarm: boolean;
}

export interface EffectApplication {
  targetId: string;
  packetIds: string[];
  deltas: Record<string, number>;
  neutralized: boolean;
  from: Point;
  to: Point;
  toolDisarmed: boolean;
}

export interface RecoveryApplication {
  actorId: string;
  changes: Record<string, number>;
}

export const DEFAULT_PHYSICS_RULES: EffectivePhysicsRules = Object.freeze({
  enabled: false,
  interruptMargin: 0.15,
  tempoNoise: 0.08,
  contactNoise: 0.12,
  recoveryPerPulse: 0.04,
  impairmentRecoveryPerPulse: 0.005,
  separationScaleM: 0.8,
  neutralizationThreshold: 0.9,
});

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  persistedNumber(Math.min(maximum, Math.max(minimum, value)));

export function physicsRules(scenario: ScenarioSpec): EffectivePhysicsRules {
  const configured: PhysicsRules | undefined = scenario.rules?.physics;
  return {
    enabled: configured?.enabled ?? DEFAULT_PHYSICS_RULES.enabled,
    interruptMargin: configured?.interruptMargin ?? DEFAULT_PHYSICS_RULES.interruptMargin,
    tempoNoise: configured?.tempoNoise ?? DEFAULT_PHYSICS_RULES.tempoNoise,
    contactNoise: configured?.contactNoise ?? DEFAULT_PHYSICS_RULES.contactNoise,
    recoveryPerPulse: configured?.recoveryPerPulse ?? DEFAULT_PHYSICS_RULES.recoveryPerPulse,
    impairmentRecoveryPerPulse: configured?.impairmentRecoveryPerPulse ?? DEFAULT_PHYSICS_RULES.impairmentRecoveryPerPulse,
    separationScaleM: configured?.separationScaleM ?? DEFAULT_PHYSICS_RULES.separationScaleM,
    neutralizationThreshold: configured?.neutralizationThreshold ?? DEFAULT_PHYSICS_RULES.neutralizationThreshold,
  };
}

function stanceTempoBonus(actor: ActorState): number {
  switch (actor.stance ?? "neutral") {
    case "committed": return 0.15;
    case "mobile": return 0.08;
    case "guarded": return 0.03;
    default: return 0;
  }
}

function contactReach(actor: ActorState, target: ActorState): number {
  const toolReach = actor.toolAvailable && actor.tool ? actor.tool.reachM * actor.toolReady : 0;
  return (actor.reachM ?? 0.75) + toolReach + (actor.radiusM ?? 0.3) + (target.radiusM ?? 0.3);
}

export function buildCommitProfiles(
  actors: readonly ActorState[],
  observations: readonly ActorObservation[],
  rules: EffectivePhysicsRules,
  rng: MechanicsRng,
): CommitProfile[] {
  const actorById = new Map(actors.map(actor => [actor.id, actor]));
  const observationById = new Map(observations.map(observation => [observation.observerId, observation]));
  const profiles: CommitProfile[] = [];
  for (const actor of [...actors].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!actor.active || actor.neutralized || actor.recoveryTicks > 0 || actor.intent !== "commit") continue;
    const targets = (observationById.get(actor.id)?.visibleActorIds ?? [])
      .flatMap(id => {
        const target = actorById.get(id);
        return target && target.active && !target.neutralized && target.side !== actor.side ? [target] : [];
      })
      .sort((a, b) => distance(actor.position, a.position) - distance(actor.position, b.position) || a.id.localeCompare(b.id));
    const target = targets[0];
    if (!target) continue;

    const noiseSample = rng.nextFloat();
    const noise = persistedNumber((noiseSample * 2 - 1) * rules.tempoNoise);
    const terms = {
      readiness: actor.readiness,
      stanceBonus: stanceTempoBonus(actor),
      surpriseBonus: (actor.surprise ?? 0) * 0.35,
      stressPenalty: actor.shock * 0.35 + actor.impairment * 0.25,
      encumbrancePenalty: (1 - actor.mobility) * 0.2 + (1 - actor.stamina) * 0.15,
      toolReadiness: actor.toolAvailable && actor.tool ? actor.toolReady * actor.tool.readiness * 0.08 : 0,
    };
    const tempo = persistedNumber(
      terms.readiness + terms.stanceBonus + terms.surpriseBonus -
      terms.toolReadiness - terms.stressPenalty - terms.encumbrancePenalty + noise,
    );
    const separation = distance(actor.position, target.position);
    profiles.push({
      actorId: actor.id,
      targetId: target.id,
      tempo,
      terms: Object.fromEntries(Object.entries(terms).map(([key, value]) => [key, persistedNumber(value)])),
      noiseSample: persistedNumber(noiseSample),
      noise,
      inRange: separation <= contactReach(actor, target),
      interrupted: false,
    });
  }

  const byActor = new Map(profiles.map(profile => [profile.actorId, profile]));
  return profiles.map(profile => {
    const reciprocal = byActor.get(profile.targetId);
    if (reciprocal?.targetId === profile.actorId && reciprocal.tempo >= profile.tempo + rules.interruptMargin) {
      return { ...profile, interrupted: true, interruptedBy: reciprocal.actorId };
    }
    return profile;
  });
}

export function resolveContacts(
  actors: readonly ActorState[],
  profiles: readonly CommitProfile[],
  rules: EffectivePhysicsRules,
  rng: MechanicsRng,
  tick: number,
): EffectPacket[] {
  const actorById = new Map(actors.map(actor => [actor.id, actor]));
  const packets: EffectPacket[] = [];
  for (const profile of [...profiles].sort((a, b) => a.actorId.localeCompare(b.actorId))) {
    if (profile.interrupted || !profile.inRange) continue;
    const actor = actorById.get(profile.actorId);
    const target = actorById.get(profile.targetId);
    if (!actor || !target) continue;

    const noiseSample = rng.nextFloat();
    const noise = persistedNumber((noiseSample * 2 - 1) * rules.contactNoise);
    const attackerMass = actor.massKg ?? 75;
    const targetMass = target.massKg ?? 75;
    const reducedMass = attackerMass * targetMass / (attackerMass + targetMass);
    const stanceVelocity = actor.stance === "committed" ? 1.15 : actor.stance === "mobile" ? 1.05 : 1;
    const closingSpeed = (actor.movementSpeed ?? 1.4) * actor.mobility * (0.5 + actor.stamina * 0.5) * stanceVelocity;
    const impulseNs = persistedNumber(reducedMass * closingSpeed * 0.35);
    const impulseScore = clamp(impulseNs / 60);
    const separation = distance(actor.position, target.position);
    const angleAdvantage = clamp(angleDifference(bearing(target.position, actor.position), target.facingDegrees ?? 0) / 180);
    const reachAdvantage = clamp(
      (contactReach(actor, target) - separation) / Math.max(actor.reachM ?? 0.75, 0.2),
      -1,
      1,
    );
    const skill = actor.skill ?? actor.readiness;
    const terms = {
      skill: skill * 0.32,
      angleAdvantage: angleAdvantage * 0.18,
      reachAdvantage: reachAdvantage * 0.12,
      impulse: impulseScore * 0.22,
      surprise: (actor.surprise ?? 0) * 0.18,
      readiness: actor.readiness * 0.1,
      guardPenalty: target.guard * 0.22,
      sourceShockPenalty: actor.shock * 0.12,
      targetStabilityPenalty: target.balance * (1 - target.impairment) * 0.22,
      protectionPenalty: (target.protection ?? 0) * 0.3,
      toolReadiness: actor.toolAvailable && actor.tool ? actor.toolReady * actor.tool.readiness * 0.06 : 0,
      targetDefensiveUtility: target.toolAvailable && target.tool ? target.toolReady * target.tool.defensiveUtility * 0.12 : 0,
    };
    const contactQuality = persistedNumber(
      terms.skill + terms.angleAdvantage + terms.reachAdvantage + terms.impulse +
      terms.surprise + terms.readiness + terms.toolReadiness - terms.guardPenalty - terms.sourceShockPenalty -
      terms.targetDefensiveUtility + noise,
    );
    const severityInput = contactQuality + impulseScore * 0.25 -
      terms.targetStabilityPenalty - terms.protectionPenalty;
    const severity = clamp((severityInput - 0.05) / 0.95);
    packets.push({
      packetId: `effect-${tick}-${actor.id}-${target.id}`,
      sourceId: actor.id,
      targetId: target.id,
      contactQuality,
      severity,
      impulseNs,
      terms: Object.fromEntries(Object.entries(terms).map(([key, value]) => [key, persistedNumber(value)])),
      noiseSample: persistedNumber(noiseSample),
      noise,
      disruption: clamp(severity * 0.75),
      impairment: clamp(Math.max(0, severity - 0.25) * 0.45),
      shock: clamp(severity * 0.8 + (actor.surprise ?? 0) * 0.2 + (actor.tool?.intimidation ?? 0) * 0.08),
      separationM: clamp(severity * rules.separationScaleM, 0, rules.separationScaleM),
      neutralization: severity >= rules.neutralizationThreshold,
      disarm: Boolean(target.toolAvailable && target.tool && severity >= Math.max(0.55, target.tool.durability * 0.85)),
    });
  }
  return packets;
}

export function applyEffectPackets(
  actors: ActorState[],
  packets: readonly EffectPacket[],
  map: ScenarioSpec["map"],
  rules: EffectivePhysicsRules,
): EffectApplication[] {
  const snapshot = new Map(actors.map(actor => [actor.id, structuredClone(actor)]));
  const packetsByTarget = new Map<string, EffectPacket[]>();
  for (const packet of packets) {
    const targetPackets = packetsByTarget.get(packet.targetId) ?? [];
    targetPackets.push(packet);
    packetsByTarget.set(packet.targetId, targetPackets);
  }

  const applications: EffectApplication[] = [];
  for (const targetId of [...packetsByTarget.keys()].sort()) {
    const target = actors.find(actor => actor.id === targetId)!;
    const before = snapshot.get(targetId)!;
    const targetPackets = packetsByTarget.get(targetId)!.sort((a, b) => a.packetId.localeCompare(b.packetId));
    const disruption = clamp(targetPackets.reduce((sum, packet) => sum + packet.disruption, 0));
    const impairment = clamp(targetPackets.reduce((sum, packet) => sum + packet.impairment, 0));
    const shock = clamp(targetPackets.reduce((sum, packet) => sum + packet.shock, 0));
    let displacementX = 0;
    let displacementY = 0;
    for (const packet of targetPackets) {
      const source = snapshot.get(packet.sourceId)!;
      let dx = before.position.x - source.position.x;
      let dy = before.position.y - source.position.y;
      const magnitude = Math.hypot(dx, dy);
      if (magnitude === 0) {
        dx = packet.sourceId.localeCompare(packet.targetId) < 0 ? 1 : -1;
        dy = 0;
      } else {
        dx /= magnitude;
        dy /= magnitude;
      }
      displacementX += dx * packet.separationM;
      displacementY += dy * packet.separationM;
    }
    const proposed = persistedPoint({ x: before.position.x + displacementX, y: before.position.y + displacementY });
    const nextPosition = resolveMovement(before.position, proposed, map);
    target.disruption = clamp(before.disruption + disruption);
    target.impairment = clamp(before.impairment + impairment);
    target.shock = clamp(before.shock + shock);
    target.balance = clamp(before.balance - disruption * 0.35);
    target.guard = clamp(before.guard - disruption * 0.25);
    target.stamina = clamp(before.stamina - disruption * 0.15);
    target.recoveryTicks = Math.max(before.recoveryTicks, Math.ceil(disruption * 6 + impairment * 12));
    target.position = nextPosition;
    target.neutralized = targetPackets.some(packet => packet.neutralization) ||
      target.impairment >= rules.neutralizationThreshold ||
      (target.shock >= rules.neutralizationThreshold && target.balance <= 0.2);
    if (target.neutralized) target.active = false;
    const toolDisarmed = targetPackets.some(packet => packet.disarm);
    if (toolDisarmed) { target.toolAvailable = false; target.toolReady = 0; }
    applications.push({
      targetId,
      packetIds: targetPackets.map(packet => packet.packetId),
      deltas: {
        disruption,
        impairment,
        shock,
        balance: persistedNumber(target.balance - before.balance),
        guard: persistedNumber(target.guard - before.guard),
        stamina: persistedNumber(target.stamina - before.stamina),
      },
      neutralized: target.neutralized,
      from: persistedPoint(before.position),
      to: persistedPoint(nextPosition),
      toolDisarmed,
    });
  }
  return applications;
}

export function applyRecovery(actors: ActorState[], rules: EffectivePhysicsRules): RecoveryApplication[] {
  const applications: RecoveryApplication[] = [];
  for (const actor of [...actors].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!actor.active || actor.neutralized) continue;
    if (actor.recoveryTicks === 0 && actor.disruption === 0 && actor.impairment === 0 && actor.shock === 0) continue;
    const before = {
      disruption: actor.disruption,
      impairment: actor.impairment,
      shock: actor.shock,
      balance: actor.balance,
      guard: actor.guard,
      stamina: actor.stamina,
      recoveryTicks: actor.recoveryTicks,
    };
    actor.recoveryTicks = Math.max(0, actor.recoveryTicks - 1);
    actor.disruption = clamp(actor.disruption - rules.recoveryPerPulse * (0.5 + actor.resolve * 0.5));
    actor.impairment = clamp(actor.impairment - rules.impairmentRecoveryPerPulse * actor.resolve);
    actor.shock = clamp(actor.shock - rules.recoveryPerPulse * 0.5 * actor.resolve);
    actor.balance = clamp(actor.balance + rules.recoveryPerPulse * 0.4 * actor.resolve);
    actor.guard = clamp(actor.guard + rules.recoveryPerPulse * 0.25 * actor.resolve);
    actor.stamina = clamp(actor.stamina + rules.recoveryPerPulse * 0.2);
    const changes = Object.fromEntries(
      Object.entries(before)
        .map(([key, value]) => [key, persistedNumber((actor as unknown as Record<string, number>)[key]! - value)])
        .filter(([, value]) => value !== 0),
    ) as Record<string, number>;
    if (Object.keys(changes).length > 0) applications.push({ actorId: actor.id, changes });
  }
  return applications;
}

export function resolveCrowding(
  proposals: Array<{ actorId: string; position: Point; blocked: boolean }>,
  actors: readonly ActorState[],
): Array<{ actorId: string; position: Point; blocked: boolean }> {
  const starts = new Map(actors.map(actor => [actor.id, actor.position]));
  const radii = new Map(actors.map(actor => [actor.id, actor.radiusM ?? 0.3]));
  const result = proposals.map(proposal => ({ ...proposal, position: persistedPoint(proposal.position) }));
  const blocked = new Set(result.filter(proposal => proposal.blocked).map(proposal => proposal.actorId));
  const maximumRadius = Math.max(0, ...radii.values());
  for (let pass = 0; pass < result.length; pass += 1) {
    let changed = false;
    const checkPair = (left: typeof result[number], right: typeof result[number]) => {
      const leftPosition = blocked.has(left.actorId) ? starts.get(left.actorId)! : left.position;
      const rightPosition = blocked.has(right.actorId) ? starts.get(right.actorId)! : right.position;
      if (distance(leftPosition, rightPosition) + 1e-9 >= radii.get(left.actorId)! + radii.get(right.actorId)!) return;
      for (const proposal of [left, right]) {
        const start = starts.get(proposal.actorId)!;
        if (!blocked.has(proposal.actorId) && distance(proposal.position, start) > 1e-9) {
          blocked.add(proposal.actorId);
          changed = true;
        }
      }
    };
    if (result.length <= 64) {
      for (let leftIndex = 0; leftIndex < result.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < result.length; rightIndex += 1) {
          checkPair(result[leftIndex]!, result[rightIndex]!);
        }
      }
      if (!changed) break;
      continue;
    }
    const positioned = result.map(proposal => ({
      id: proposal.actorId,
      position: blocked.has(proposal.actorId) ? starts.get(proposal.actorId)! : proposal.position,
      proposal,
    }));
    const spatial = new UniformGridIndex(positioned, Math.max(1, maximumRadius * 2));
    for (const leftItem of [...positioned].sort((left, right) => left.id.localeCompare(right.id))) {
      const left = leftItem.proposal;
      const neighbors = spatial.queryRadius(leftItem.position, radii.get(left.actorId)! + maximumRadius);
      for (const rightItem of neighbors) {
        if (rightItem.id.localeCompare(leftItem.id) <= 0) continue;
        const right = rightItem.proposal;
        checkPair(left, right);
      }
    }
    if (!changed) break;
  }
  return result.map(proposal => blocked.has(proposal.actorId)
    ? { actorId: proposal.actorId, position: persistedPoint(starts.get(proposal.actorId)!), blocked: true }
    : proposal);
}

export function evaluateObjectives(state: { actors: ActorState[]; threatActive: boolean }, scenario: ScenarioSpec): Record<string, boolean> {
  const progress: Record<string, boolean> = {};
  for (const objective of scenario.objectives ?? []) {
    switch (objective.kind) {
      case "protect-side":
        progress[objective.id] = !state.threatActive &&
          state.actors.filter(actor => actor.side === objective.side).every(actor => !actor.neutralized && (actor.active || actor.escaped));
        break;
      case "neutralize-side":
        progress[objective.id] = state.actors.filter(actor => actor.side === objective.side).every(actor => actor.neutralized);
        break;
      case "evacuate-side":
        progress[objective.id] = state.actors.filter(actor => actor.side === objective.side).every(actor => actor.escaped);
        break;
      case "separation": {
        const [firstId, secondId] = objective.actorIds ?? [];
        const first = state.actors.find(actor => actor.id === firstId);
        const second = state.actors.find(actor => actor.id === secondId);
        progress[objective.id] = Boolean(first && second &&
          distance(first.position, second.position) >= (objective.minimumDistanceM ?? 3));
        break;
      }
    }
  }
  return progress;
}

export function terminalReason(
  state: { actors: ActorState[]; threatActive: boolean; objectiveProgress: Record<string, boolean> },
  scenario: ScenarioSpec,
): string | undefined {
  for (const condition of scenario.terminalConditions ?? []) {
    if (condition.kind === "threat-ended" && !state.threatActive) return "threat-ended";
    if (condition.kind === "side-neutralized" && condition.side &&
        state.actors.filter(actor => actor.side === condition.side).every(actor => actor.neutralized)) {
      return `side-neutralized-${condition.side}`;
    }
    if (condition.kind === "side-routed" && condition.side) {
      const members = state.actors.filter(actor => actor.side === condition.side && !actor.neutralized);
      if (members.length > 0 && members.every(actor => actor.moraleState === "routing" || actor.escaped)) {
        return `side-routed-${condition.side}`;
      }
    }
    if (condition.kind === "objective-complete" && condition.objectiveId &&
        state.objectiveProgress[condition.objectiveId]) {
      return `objective-complete-${condition.objectiveId}`;
    }
  }
  return undefined;
}
