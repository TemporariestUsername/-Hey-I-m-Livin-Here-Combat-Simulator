import type { ActorState } from "../../schema/src/index.ts";

export const INTERRUPT_MARGIN = 0.15;

export interface TempoProfile {
  actorId: string;
  tempo: number;
  terms: {
    readiness: number;
    stamina: number;
    shock: number;
    boundedNoise: number;
  };
  randomSample: number;
}

export interface InterruptResult {
  actorId: string;
  targetId: string;
  eligible: boolean;
  margin: number;
  requiredMargin: number;
}

const fixed = (value: number): number => Number(value.toFixed(6));

/** Builds an explainable tempo value from a bounded random sample in [0, 1). */
export function buildTempoProfile(actor: Readonly<ActorState>, randomSample: number): TempoProfile {
  if (randomSample < 0 || randomSample >= 1 || !Number.isFinite(randomSample)) throw new Error("Tempo random sample must be from 0 (inclusive) to 1 (exclusive)");
  const terms = {
    readiness: fixed(actor.readiness),
    stamina: fixed(actor.stamina * 0.2),
    shock: fixed(-actor.shock * 0.5),
    boundedNoise: fixed((randomSample - 0.5) * 0.1),
  };
  return {
    actorId: actor.id,
    tempo: fixed(terms.readiness + terms.stamina + terms.shock + terms.boundedNoise),
    terms,
    randomSample: fixed(randomSample),
  };
}

/**
 * Resolves interrupt eligibility without mutating actors. Only mutually visible,
 * opposing actors that both committed create interrupt windows.
 */
export function resolveInterrupts(
  actors: readonly Readonly<ActorState>[],
  visibleByActor: ReadonlyMap<string, readonly string[]>,
  tempos: ReadonlyMap<string, TempoProfile>,
): InterruptResult[] {
  const ordered = [...actors].sort((a, b) => a.id.localeCompare(b.id));
  const results: InterruptResult[] = [];
  for (const actor of ordered) {
    if (actor.intent !== "commit") continue;
    for (const targetId of [...(visibleByActor.get(actor.id) ?? [])].sort()) {
      const target = ordered.find(candidate => candidate.id === targetId);
      if (!target || target.side === actor.side || target.intent !== "commit") continue;
      if (!(visibleByActor.get(target.id) ?? []).includes(actor.id)) continue;
      const margin = fixed(tempos.get(actor.id)!.tempo - tempos.get(target.id)!.tempo);
      results.push({ actorId: actor.id, targetId, eligible: margin >= INTERRUPT_MARGIN, margin, requiredMargin: INTERRUPT_MARGIN });
    }
  }
  return results;
}
