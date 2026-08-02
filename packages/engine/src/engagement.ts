import type { ActionKind, ActorState, EngagementRules, ScenarioSpec } from "../../schema/src/index.ts";
import { persistedNumber } from "./numeric.ts";

export interface EffectiveEngagementRules {
  minimumSeverity: number;
  minimumImmediacy: number;
  requireThreatenedParty: boolean;
  permitCommit: boolean;
  permitProtect: boolean;
  permitWithdrawal: boolean;
}

export interface GateEvaluation {
  proposed: ActionKind;
  selected: ActionKind;
  predicates: Record<string, boolean>;
  failedPredicates: string[];
  headroom: number;
}

export const DEFAULT_ENGAGEMENT_RULES: EffectiveEngagementRules = Object.freeze({
  minimumSeverity: 0.2,
  minimumImmediacy: 0.2,
  requireThreatenedParty: true,
  permitCommit: true,
  permitProtect: true,
  permitWithdrawal: true,
});

export function engagementRules(scenario: ScenarioSpec): EffectiveEngagementRules {
  const rules: EngagementRules | undefined = scenario.rules?.engagement;
  return {
    minimumSeverity: rules?.minimumSeverity ?? DEFAULT_ENGAGEMENT_RULES.minimumSeverity,
    minimumImmediacy: rules?.minimumImmediacy ?? DEFAULT_ENGAGEMENT_RULES.minimumImmediacy,
    requireThreatenedParty: rules?.requireThreatenedParty ?? DEFAULT_ENGAGEMENT_RULES.requireThreatenedParty,
    permitCommit: rules?.permitCommit ?? DEFAULT_ENGAGEMENT_RULES.permitCommit,
    permitProtect: rules?.permitProtect ?? DEFAULT_ENGAGEMENT_RULES.permitProtect,
    permitWithdrawal: rules?.permitWithdrawal ?? DEFAULT_ENGAGEMENT_RULES.permitWithdrawal,
  };
}

export function evaluateEngagement(actor: ActorState, proposed: ActionKind, threatActive: boolean,
  scenario: ScenarioSpec, rules = engagementRules(scenario)): GateEvaluation {
  const severity = scenario.threat.severity ?? 1;
  const immediacy = scenario.threat.immediacy ?? 1;
  const threatenedIds = new Set(scenario.threat.threatenedActorIds ?? []);
  const threatenedSides = new Set(scenario.actors.filter(item => threatenedIds.has(item.id)).map(item => item.side));
  const threatenedParty = Boolean(actor.threatened) || threatenedIds.has(actor.id) ||
    threatenedSides.has(actor.side);
  const retreatAvailable = scenario.threat.retreatAvailable ?? true;
  const predicates = {
    activeThreat: threatActive,
    severitySufficient: severity >= rules.minimumSeverity,
    immediacySufficient: immediacy >= rules.minimumImmediacy,
    threatenedParty: !rules.requireThreatenedParty || threatenedParty,
    commitmentPermitted: rules.permitCommit,
    protectionPermitted: rules.permitProtect,
    withdrawalPermitted: rules.permitWithdrawal,
    retreatAvailable,
  };
  const commitmentAllowed = predicates.activeThreat && predicates.severitySufficient && predicates.immediacySufficient &&
    predicates.threatenedParty && predicates.commitmentPermitted;
  const failureName: Record<string, string> = {
    activeThreat: "active-threat-required", severitySufficient: "minimum-severity-required",
    immediacySufficient: "minimum-immediacy-required", threatenedParty: "threatened-party-required",
    commitmentPermitted: "commitment-not-permitted", protectionPermitted: "protection-not-permitted",
    withdrawalPermitted: "withdrawal-not-permitted", retreatAvailable: "retreat-unavailable",
  };
  const failedPredicates = proposed === "commit"
    ? Object.entries(predicates).filter(([key, value]) => !value && key !== "protectionPermitted" &&
      key !== "withdrawalPermitted" && key !== "retreatAvailable").map(([key]) => failureName[key]!)
    : proposed === "protect" && !predicates.protectionPermitted
      ? [failureName.protectionPermitted!]
    : proposed === "withdraw" && (!predicates.withdrawalPermitted || !predicates.retreatAvailable)
        ? [!predicates.withdrawalPermitted ? failureName.withdrawalPermitted! : failureName.retreatAvailable!]
        : [];
  let selected = proposed;
  const canWithdraw = rules.permitWithdrawal && retreatAvailable;
  if (proposed === "commit" && !commitmentAllowed) selected = canWithdraw ? "withdraw" : rules.permitProtect ? "protect" : "observe";
  if (proposed === "protect" && !rules.permitProtect) selected = canWithdraw ? "withdraw" : "observe";
  if (proposed === "withdraw" && !canWithdraw) selected = rules.permitProtect ? "protect" : "observe";
  const thresholdRatio = (value: number, minimum: number): number => minimum <= 0 ? 1 : value / minimum;
  const headroom = threatActive ? Math.min(
    thresholdRatio(severity, rules.minimumSeverity),
    thresholdRatio(immediacy, rules.minimumImmediacy),
    threatenedParty ? 1 : 0,
    rules.permitCommit ? 1 : 0,
  ) : 0;
  return { proposed, selected, predicates, failedPredicates, headroom: persistedNumber(Math.min(1, Math.max(0, headroom))) };
}
