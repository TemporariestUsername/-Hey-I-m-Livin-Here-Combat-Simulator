import type { ActionKind, ActorState } from "../../schema/src/index.ts";

export interface PolicyObservation {
  observerId: string;
  visibleActorIds: readonly string[];
  heardActorIds: readonly string[];
  rememberedActorIds: readonly string[];
  uncertainty: number;
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

export type WeightProvenance = "reference-derived" | "inferred" | "assumed" | "calibrated";

export interface DoctrineWeight {
  value: number;
  provenance: WeightProvenance;
  note: string;
}

export interface DoctrineConfiguration {
  id: string;
  version: string;
  weights: Readonly<Record<string, DoctrineWeight>>;
}

export const sportiveDoctrine: DoctrineConfiguration = Object.freeze({
  id: "sportive",
  version: "1.1.0",
  weights: Object.freeze({
    sustainedExchange: { value: 0.45, provenance: "assumed", note: "Commit-score coefficient for continued symmetric engagement." },
    readiness: { value: 0.3, provenance: "assumed", note: "Commit-score readiness coefficient." },
    stamina: { value: 0.25, provenance: "assumed", note: "Commit-score stamina coefficient." },
    shockPenalty: { value: 0.25, provenance: "assumed", note: "Commit penalty and withdrawal contribution." },
    impairmentWithdrawal: { value: 0.35, provenance: "assumed", note: "Withdrawal contribution from current impairment." },
    withdrawalBase: { value: 0.2, provenance: "assumed", note: "Active-threat withdrawal baseline." },
    observeNoRisk: { value: 0.45, provenance: "assumed", note: "Observation score when no actor is visible." },
    disengageAfterThreat: { value: 1, provenance: "reference-derived", note: "Shared safety gate and legal boundary." },
  }),
});

export const chenInspiredDoctrine: DoctrineConfiguration = Object.freeze({
  id: "chen-inspired",
  version: "1.2.0",
  weights: Object.freeze({
    asymmetry: { value: 0.42, provenance: "reference-derived", note: "Commit-score coefficient for surprise/committed asymmetry." },
    readiness: { value: 0.22, provenance: "assumed", note: "Commit-score readiness coefficient." },
    mobility: { value: 0.12, provenance: "inferred", note: "Commit-score coefficient for continued angle-changing capacity." },
    groupOpportunity: { value: 0.14, provenance: "reference-derived", note: "Abstract group-shock opportunity coefficient." },
    resolve: { value: 0.1, provenance: "assumed", note: "Commit/protect resolve coefficient." },
    symmetricDuelTolerance: { value: 0.15, provenance: "reference-derived", note: "Encodes the documented formal-duel mismatch." },
    symmetricDuelPenalty: { value: 0.38, provenance: "reference-derived", note: "Commit penalty in a low-surprise symmetric exchange." },
    shockPenalty: { value: 0.28, provenance: "assumed", note: "Commit penalty from current shock." },
    impairmentPenalty: { value: 0.25, provenance: "assumed", note: "Commit penalty from current impairment." },
    withdrawalBase: { value: 0.3, provenance: "assumed", note: "Active-threat withdrawal baseline." },
    withdrawalSymmetry: { value: 0.35, provenance: "inferred", note: "Withdrawal contribution in a symmetric duel." },
    withdrawalShock: { value: 0.25, provenance: "assumed", note: "Withdrawal contribution from shock." },
    withdrawalImpairment: { value: 0.3, provenance: "assumed", note: "Withdrawal contribution from impairment." },
    protectBase: { value: 0.27, provenance: "calibrated", note: "Active-threat protection baseline reduced to keep one term below the predeclared 60% contribution ceiling." },
    protectLowSurprise: { value: 0.16, provenance: "inferred", note: "Protection contribution when asymmetry is absent." },
    observeNoRisk: { value: 0.5, provenance: "assumed", note: "Observation score when no actor is visible." },
    disengageAfterThreat: { value: 1, provenance: "reference-derived", note: "Sharp post-threat disengagement." },
  }),
});

const bounded = (value: number): number => Math.min(1, Math.max(0, value));
const negative = (value: number): number => value === 0 ? 0 : -value;
const coefficient = (doctrine: DoctrineConfiguration, name: string): number => doctrine.weights[name]!.value;

function pickBest(candidates: readonly PolicyCandidate[]): ActionKind {
  return [...candidates]
    .filter(candidate => candidate.eligible)
    .sort((left, right) => right.score - left.score || left.action.localeCompare(right.action))[0]?.action ?? "wait";
}

export const safetyFirstPolicy: Policy = {
  id: "safety-first",
  version: "1.0.0",
  decide(input) {
    const detectedRisk = input.observation.visibleActorIds.length + (input.observation.heardActorIds?.length ?? 0) > 0 ? 1 : 0;
    return {
      selected: "withdraw",
      candidates: [
        { action: "withdraw", eligible: true, score: 0.8, contributions: { safety: 0.8, detectedRisk } },
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
    const commitEligible = input.threatActive && Boolean(input.actor.threatened) && input.observation.visibleActorIds.length > 0;
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

export const sportivePolicy: Policy = {
  id: "sportive",
  version: sportiveDoctrine.version,
  decide(input) {
    const visibleRisk = input.observation.visibleActorIds.length > 0 ? 1 : 0;
    const detectedRisk = input.observation.visibleActorIds.length + (input.observation.heardActorIds?.length ?? 0) > 0 ? 1 : 0;
    const recentRisk = detectedRisk || (input.observation.rememberedActorIds?.length ?? 0) > 0 ? 1 : 0;
    const commitEligible = input.threatActive && Boolean(input.actor.threatened) && visibleRisk === 1;
    const exchange = coefficient(sportiveDoctrine, "sustainedExchange");
    const commitScore = bounded(
      exchange + input.actor.readiness * coefficient(sportiveDoctrine, "readiness") +
      input.actor.stamina * coefficient(sportiveDoctrine, "stamina") -
      input.actor.shock * coefficient(sportiveDoctrine, "shockPenalty"),
    );
    const withdrawScore = input.threatActive
      ? bounded(coefficient(sportiveDoctrine, "withdrawalBase") +
        input.actor.impairment * coefficient(sportiveDoctrine, "impairmentWithdrawal") +
        input.actor.shock * coefficient(sportiveDoctrine, "shockPenalty"))
      : 1;
    const candidates: PolicyCandidate[] = [
      {
        action: "commit",
        eligible: commitEligible,
        score: commitEligible ? commitScore : 0,
        contributions: {
          sustainedExchange: exchange,
          readiness: input.actor.readiness * coefficient(sportiveDoctrine, "readiness"),
          stamina: input.actor.stamina * coefficient(sportiveDoctrine, "stamina"),
          shock: negative(input.actor.shock * coefficient(sportiveDoctrine, "shockPenalty")),
        },
      },
      {
        action: "withdraw",
        eligible: true,
        score: withdrawScore,
        contributions: {
          threatEnded: input.threatActive ? 0 : 1,
          activeThreatBase: input.threatActive ? coefficient(sportiveDoctrine, "withdrawalBase") : 0,
          impairment: input.actor.impairment * coefficient(sportiveDoctrine, "impairmentWithdrawal"),
          shock: input.actor.shock * coefficient(sportiveDoctrine, "shockPenalty"),
        },
      },
      {
        action: "observe",
        eligible: recentRisk === 0,
        score: recentRisk ? 0 : coefficient(sportiveDoctrine, "observeNoRisk"),
        contributions: { noDetectedOrRememberedRisk: recentRisk ? 0 : coefficient(sportiveDoctrine, "observeNoRisk") },
      },
    ];
    const selected = pickBest(candidates);
    return {
      selected,
      candidates,
      rationale: selected === "commit"
        ? "Favor a sustained symmetric exchange while the configured threat remains active."
        : "Disengage when exchange eligibility or the active-threat predicate is absent.",
      rngSamples: [],
    };
  },
};

export const chenInspiredPolicy: Policy = {
  id: "chen-inspired",
  version: chenInspiredDoctrine.version,
  decide(input) {
    const visibleCount = input.observation.visibleActorIds.length;
    const visibleRisk = visibleCount > 0 ? 1 : 0;
    const detectedRisk = visibleCount + (input.observation.heardActorIds?.length ?? 0) > 0 ? 1 : 0;
    const recentRisk = detectedRisk || (input.observation.rememberedActorIds?.length ?? 0) > 0 ? 1 : 0;
    const surprise = input.actor.surprise ?? 0;
    const asymmetry = bounded(surprise + (input.actor.stance === "committed" ? 0.2 : 0));
    const groupOpportunity = bounded((visibleCount - 1) / 3);
    const symmetricPenalty = visibleCount === 1 && surprise < 0.25
      ? 1 - chenInspiredDoctrine.weights.symmetricDuelTolerance!.value
      : 0;
    const commitEligible = input.threatActive && Boolean(input.actor.threatened) && visibleRisk === 1;
    const commitScore = bounded(
      asymmetry * coefficient(chenInspiredDoctrine, "asymmetry") +
      input.actor.readiness * coefficient(chenInspiredDoctrine, "readiness") +
      input.actor.mobility * coefficient(chenInspiredDoctrine, "mobility") +
      groupOpportunity * coefficient(chenInspiredDoctrine, "groupOpportunity") +
      input.actor.resolve * coefficient(chenInspiredDoctrine, "resolve") -
      symmetricPenalty * coefficient(chenInspiredDoctrine, "symmetricDuelPenalty") -
      input.actor.shock * coefficient(chenInspiredDoctrine, "shockPenalty") -
      input.actor.impairment * coefficient(chenInspiredDoctrine, "impairmentPenalty"),
    );
    const withdrawScore = input.threatActive
      ? bounded(coefficient(chenInspiredDoctrine, "withdrawalBase") +
        symmetricPenalty * coefficient(chenInspiredDoctrine, "withdrawalSymmetry") +
        input.actor.shock * coefficient(chenInspiredDoctrine, "withdrawalShock") +
        input.actor.impairment * coefficient(chenInspiredDoctrine, "withdrawalImpairment"))
      : 1;
    const protectScore = input.threatActive && detectedRisk
      ? bounded(coefficient(chenInspiredDoctrine, "protectBase") +
        (1 - surprise) * coefficient(chenInspiredDoctrine, "protectLowSurprise") +
        input.actor.resolve * coefficient(chenInspiredDoctrine, "resolve"))
      : 0;
    const candidates: PolicyCandidate[] = [
      {
        action: "commit",
        eligible: commitEligible,
        score: commitEligible ? commitScore : 0,
        contributions: {
          asymmetry: asymmetry * coefficient(chenInspiredDoctrine, "asymmetry"),
          readiness: input.actor.readiness * coefficient(chenInspiredDoctrine, "readiness"),
          mobility: input.actor.mobility * coefficient(chenInspiredDoctrine, "mobility"),
          groupOpportunity: groupOpportunity * coefficient(chenInspiredDoctrine, "groupOpportunity"),
          resolve: input.actor.resolve * coefficient(chenInspiredDoctrine, "resolve"),
          symmetricDuelPenalty: negative(symmetricPenalty * coefficient(chenInspiredDoctrine, "symmetricDuelPenalty")),
          shock: negative(input.actor.shock * coefficient(chenInspiredDoctrine, "shockPenalty")),
          impairment: negative(input.actor.impairment * coefficient(chenInspiredDoctrine, "impairmentPenalty")),
        },
      },
      {
        action: "withdraw",
        eligible: true,
        score: withdrawScore,
        contributions: {
          threatEnded: input.threatActive ? 0 : 1,
          activeThreatBase: input.threatActive ? coefficient(chenInspiredDoctrine, "withdrawalBase") : 0,
          symmetricDuelPenalty: symmetricPenalty * coefficient(chenInspiredDoctrine, "withdrawalSymmetry"),
          shock: input.actor.shock * coefficient(chenInspiredDoctrine, "withdrawalShock"),
          impairment: input.actor.impairment * coefficient(chenInspiredDoctrine, "withdrawalImpairment"),
        },
      },
      {
        action: "protect",
        eligible: input.threatActive && detectedRisk === 1,
        score: protectScore,
        contributions: {
          activeThreatBase: input.threatActive && detectedRisk === 1
            ? coefficient(chenInspiredDoctrine, "protectBase")
            : 0,
          lowSurprise: (1 - surprise) * coefficient(chenInspiredDoctrine, "protectLowSurprise"),
          resolve: input.actor.resolve * coefficient(chenInspiredDoctrine, "resolve"),
        },
      },
      {
        action: "observe",
        eligible: recentRisk === 0,
        score: recentRisk === 0 ? coefficient(chenInspiredDoctrine, "observeNoRisk") : 0,
        contributions: { noDetectedOrRememberedRisk: recentRisk === 0 ? coefficient(chenInspiredDoctrine, "observeNoRisk") : 0 },
      },
    ];
    const selected = pickBest(candidates);
    return {
      selected,
      candidates,
      rationale: selected === "commit"
        ? "Use a short abstract crisis commitment because active threat and asymmetry terms outweigh the symmetric-exchange penalty."
        : selected === "protect"
          ? "Protect while the immediate threat is active but asymmetry is insufficient for commitment."
          : "Prefer separation when threat, asymmetry, or physical-state predicates do not support commitment.",
      rngSamples: [],
    };
  },
};

export const humanIntentPolicy: Policy = {
  id: "human-intent",
  version: "1.0.0",
  decide(input) {
    const selected = input.actor.humanIntent ?? "wait";
    return {
      selected,
      candidates: [{ action: selected, eligible: true, score: 1, contributions: { humanIntent: 1 } }],
      rationale: "Use the scenario-supplied human intent; engine safety and morale gates remain authoritative.",
      rngSamples: [],
    };
  },
};

const BUILT_IN_POLICIES = new Map<string, Policy>([
  [safetyFirstPolicy.id, safetyFirstPolicy],
  [randomValidPolicy.id, randomValidPolicy],
  [sportivePolicy.id, sportivePolicy],
  [chenInspiredPolicy.id, chenInspiredPolicy],
  [humanIntentPolicy.id, humanIntentPolicy],
]);

export function getBuiltInPolicy(id: string): Policy {
  const policy = BUILT_IN_POLICIES.get(id);
  if (!policy) throw new Error(`Unknown policy: ${id}`);
  return policy;
}

export function builtInPolicyIds(): string[] {
  return [...BUILT_IN_POLICIES.keys()].sort();
}
