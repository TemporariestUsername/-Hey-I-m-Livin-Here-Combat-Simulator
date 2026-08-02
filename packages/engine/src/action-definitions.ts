import type { ActionKind } from "../../schema/src/index.ts";

export type ActionCategory = "observe" | "support" | "movement" | "contact" | "recovery" | "idle";

export interface ActionDefinition {
  kind: ActionKind;
  category: ActionCategory;
  preconditions: readonly string[];
  durationTicks: number;
  staminaCost: number;
  interruptible: boolean;
  fallback: ActionKind;
  possibleEffects: readonly string[];
}

/** Version 1 action vocabulary. Mechanics consume this registry instead of duplicating action metadata. */
export const ACTION_DEFINITIONS: readonly ActionDefinition[] = Object.freeze([
  { kind: "observe", category: "observe", preconditions: ["actor-active"], durationTicks: 1, staminaCost: 0.005, interruptible: true, fallback: "wait", possibleEffects: ["awareness"] },
  { kind: "communicate", category: "support", preconditions: ["actor-active"], durationTicks: 1, staminaCost: 0.005, interruptible: true, fallback: "observe", possibleEffects: ["awareness", "fear-reduction", "cohesion"] },
  { kind: "reposition", category: "movement", preconditions: ["actor-active", "movement-path"], durationTicks: 1, staminaCost: 0.005, interruptible: true, fallback: "observe", possibleEffects: ["position"] },
  { kind: "protect", category: "support", preconditions: ["actor-active", "protection-permitted"], durationTicks: 1, staminaCost: 0.005, interruptible: true, fallback: "withdraw", possibleEffects: ["guard"] },
  { kind: "withdraw", category: "movement", preconditions: ["actor-active", "retreat-available"], durationTicks: 1, staminaCost: 0.005, interruptible: false, fallback: "protect", possibleEffects: ["position", "escape"] },
  { kind: "ready-tool", category: "support", preconditions: ["actor-active", "tool-available"], durationTicks: 1, staminaCost: 0.005, interruptible: true, fallback: "protect", possibleEffects: ["tool-readiness"] },
  { kind: "commit", category: "contact", preconditions: ["actor-active", "active-threat", "engagement-permitted", "visible-target"], durationTicks: 1, staminaCost: 0.02, interruptible: true, fallback: "withdraw", possibleEffects: ["disruption", "impairment", "shock", "separation", "neutralization", "disarm"] },
  { kind: "aid-ally", category: "recovery", preconditions: ["actor-active", "nearby-ally"], durationTicks: 1, staminaCost: 0.005, interruptible: true, fallback: "protect", possibleEffects: ["shock-recovery", "disruption-recovery", "impairment-recovery"] },
  { kind: "rally", category: "support", preconditions: ["actor-active", "nearby-ally"], durationTicks: 1, staminaCost: 0.005, interruptible: true, fallback: "communicate", possibleEffects: ["fear-reduction", "cohesion"] },
  { kind: "wait", category: "idle", preconditions: [], durationTicks: 1, staminaCost: 0, interruptible: false, fallback: "wait", possibleEffects: [] },
] satisfies readonly ActionDefinition[]);

const ACTION_BY_KIND = new Map(ACTION_DEFINITIONS.map(definition => [definition.kind, definition]));

export function actionDefinition(kind: ActionKind): ActionDefinition {
  const definition = ACTION_BY_KIND.get(kind);
  if (!definition) throw new Error(`Unknown action definition: ${kind}`);
  return definition;
}

export function isSupportAction(kind: ActionKind): boolean {
  return ["observe", "support", "recovery"].includes(actionDefinition(kind).category);
}
