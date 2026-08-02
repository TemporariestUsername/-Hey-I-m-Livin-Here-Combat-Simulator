import type { ActorState, EnvironmentState, EnvironmentZone, Rectangle } from "../../schema/src/index.ts";
import { persistedNumber } from "./numeric.ts";
import { angleDifference, bearing, distance, environmentValueAt, hasLineOfSight } from "./geometry.ts";
import { UniformGridIndex } from "./spatial-index.ts";

export interface ActorObservation {
  observerId: string;
  visibleActorIds: string[];
  heardActorIds: string[];
  rememberedActorIds: string[];
  uncertainty: number;
  rngSamples: number[];
}

export interface SensingRng { nextFloat(): number }

export interface SensingContext {
  environment?: EnvironmentState;
  zones?: readonly EnvironmentZone[];
  rng?: SensingRng;
  memoryHorizonTicks?: number;
}

const bounded = (value: number): number => Math.min(1, Math.max(0, value));

/** Builds observations in stable actor-ID order without exposing non-visible state. */
export function buildObservations(actors: readonly ActorState[], obstacles: readonly Rectangle[] = [], context: SensingContext = {}): ActorObservation[] {
  const ordered = [...actors].sort((a, b) => a.id.localeCompare(b.id));
  const active = ordered.filter(actor => actor.active);
  const actorById = new Map(ordered.map(actor => [actor.id, actor]));
  // Small supported scenarios are faster with the exact reference scan; the
  // grid becomes beneficial once pairwise geometry dominates bookkeeping.
  const spatial = active.length > 64 ? new UniformGridIndex(active, 2) : null;
  return ordered.map(observer => {
    const range = observer.visionRange ?? 20;
    const arc = observer.visionArcDegrees ?? 120;
    const facing = observer.facingDegrees ?? 0;
    const ambientLight = context.environment?.ambientLight ?? 1;
    const ambientNoise = context.environment?.ambientNoise ?? 0;
    const visibilityScale = context.environment?.visibilityScale ?? 1;
    const attention = observer.attention ?? 1;
    const visibleActorIds: string[] = [];
    const heardActorIds: string[] = [];
    const rngSamples: number[] = [];
    const uncertainties: number[] = [];
    const processTarget = (target: ActorState, sample: number) => {
      const separation = distance(observer.position, target.position);
      const light = environmentValueAt(target.position, context.zones, "light", ambientLight);
      const cover = environmentValueAt(target.position, context.zones, "cover", 0);
      const movementSignature = target.intent === "commit" || target.intent === "reposition" || target.intent === "withdraw" ? 1 : 0.55;
      const sensingNoise = (sample * 2 - 1) * 0.12;
      const effectiveVision = range * visibilityScale * (0.3 + light * 0.7) * (0.45 + attention * 0.55) *
        (1 - cover * 0.55) * (0.75 + movementSignature * 0.25);
      const visualRatio = effectiveVision <= 0 ? Number.POSITIVE_INFINITY : separation / effectiveVision;
      const visible = visualRatio <= 1 + sensingNoise &&
        angleDifference(bearing(observer.position, target.position), facing) <= arc / 2 &&
        hasLineOfSight(observer.position, target.position, obstacles);
      const soundSignature = bounded((target.soundSignature ?? 0.5) + (movementSignature - 0.55) * 0.5);
      const localNoise = environmentValueAt(observer.position, context.zones, "noise", ambientNoise);
      const effectiveHearing = (observer.hearingRangeM ?? 10) * (0.25 + attention * 0.75) *
        (1 - localNoise * 0.8) * (0.35 + soundSignature * 0.65);
      const heard = separation <= effectiveHearing * (1 + sensingNoise * 0.5);
      if (visible) visibleActorIds.push(target.id);
      if (heard && !visible) heardActorIds.push(target.id);
      if (visible || heard) uncertainties.push(bounded((visible ? visualRatio : separation / Math.max(effectiveHearing, 0.001)) * 0.65 +
        (visible ? cover * 0.2 + (1 - light) * 0.15 : localNoise * 0.35)));
    };
    if (!spatial) {
      for (const target of active) {
        if (target.id === observer.id) continue;
        const sample = context.rng?.nextFloat() ?? 0.5;
        if (context.rng) rngSamples.push(persistedNumber(sample));
        processTarget(target, sample);
      }
    } else {
      // Preserve one stable sensing draw per active actor pair while using the
      // grid to avoid expensive geometry and occlusion work for distant actors.
      const sampleByTarget = new Map<string, number>();
      for (const target of active) {
        if (target.id === observer.id) continue;
        const sample = context.rng?.nextFloat() ?? 0.5;
        if (context.rng) rngSamples.push(persistedNumber(sample));
        sampleByTarget.set(target.id, sample);
      }
      const candidateRadius = Math.max(range * visibilityScale * 1.12, (observer.hearingRangeM ?? 10) * 1.06);
      for (const target of spatial.queryRadius(observer.position, candidateRadius)) {
        if (target.id !== observer.id) processTarget(target, sampleByTarget.get(target.id) ?? 0.5);
      }
    }
    const sensed = new Set([...visibleActorIds, ...heardActorIds]);
    const rememberedActorIds = [...(observer.memoryActorIds ?? [])]
      .filter(id => !sensed.has(id) && (observer.memoryAges?.[id] ?? Number.POSITIVE_INFINITY) <= (context.memoryHorizonTicks ?? 5))
      .filter(id => actorById.get(id)?.active)
      .sort();
    const uncertainty = uncertainties.length === 0
      ? (rememberedActorIds.length > 0 ? 0.9 : 1)
      : uncertainties.reduce((sum, value) => sum + value, 0) / uncertainties.length;
    return {
      observerId: observer.id,
      visibleActorIds,
      heardActorIds,
      rememberedActorIds,
      uncertainty: persistedNumber(uncertainty),
      rngSamples,
    };
  });
}
