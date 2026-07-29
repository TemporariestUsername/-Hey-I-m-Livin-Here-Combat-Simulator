import type { ActionKind, ActorState } from "../../schema/src/index.ts";

export interface PolicyObservation {
  observerId: string;
  visibleActorIds: readonly string[];
}

export interface PolicyInput {
  actor: Readonly<ActorState>;
  observation: Readonly<PolicyObservation>;
  threatActive: boolean;
}

export interface PolicyRng {
  nextFloat(): number;
}

export interface PolicyCandidate {
  action: ActionKind;
  eligible: boolean;
  score: number;
  contributions: Readonly<Record<string, number>>;
}

export interface PolicyDecision {
  selected: ActionKind;
  candidates: readonly PolicyCandidate[];
  rationale: string;
  rngSamples: readonly number[];
}

export interface Policy {
  readonly id: string;
  readonly version: string;
  decide(input: Readonly<PolicyInput>, rng: PolicyRng): PolicyDecision;
}

export const safetyFirstPolicy: Policy = {
  id: "safety-first",
  version: "1.0.0",
  decide(input) {
    const visibleRisk = input.observation.visibleActorIds.length > 0 ? 1 : 0;
    return {
      selected: "withdraw",
      candidates: [
        { action: "withdraw", eligible: true, score: 0.8, contributions: { safety: 0.8, visibleRisk } },
        { action: "observe", eligible: true, score: 0.2, contributions: { safety: 0.2 } },
        { action: "commit", eligible: false, score: 0, contributions: { safety: -1 } },
      ],
      rationale: "Prefer separation and disengagement whenever withdrawal is available.",
      rngSamples: [],
    };
  },
};

export const randomValidPolicy: Policy = {
  id: "random-valid",
  version: "1.0.0",
  decide(input, rng) {
    const sample = rng.nextFloat();
    const commitEligible = Boolean(input.actor.threatened);
    const selected: ActionKind = commitEligible && sample >= 0.2 ? "commit" : "withdraw";
    return {
      selected,
      candidates: [
        { action: "withdraw", eligible: true, score: commitEligible ? 1 - sample : 1, contributions: { randomSample: 1 - sample } },
        { action: "commit", eligible: commitEligible, score: commitEligible ? sample : 0, contributions: { randomSample: sample, threatened: commitEligible ? 1 : 0 } },
      ],
      rationale: "Select between valid baseline actions using the named policy random stream.",
      rngSamples: [sample],
    };
  },
};

const BUILT_IN_POLICIES = new Map<string, Policy>([
  [safetyFirstPolicy.id, safetyFirstPolicy],
  [randomValidPolicy.id, randomValidPolicy],
]);

export function getBuiltInPolicy(id: string): Policy {
  const policy = BUILT_IN_POLICIES.get(id);
  if (!policy) throw new Error(`Unknown policy: ${id}`);
  return policy;
}

export function builtInPolicyIds(): string[] {
  return [...BUILT_IN_POLICIES.keys()].sort();
}
