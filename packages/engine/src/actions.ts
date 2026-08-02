import type { ActionKind, ActorState, SquadState } from "../../schema/src/index.ts";
import { distance } from "./geometry.ts";
import { persistedNumber } from "./numeric.ts";
import { isSupportAction } from "./action-definitions.ts";

export interface ActionResolution {
  actorId: string;
  action: ActionKind;
  targetId: string;
  changes: Record<string, number>;
}

const clamp = (value: number): number => persistedNumber(Math.min(1, Math.max(0, value)));

/** Resolves non-movement support actions from one immutable actor snapshot. */
export function resolveSupportActions(actors: ActorState[], squads: SquadState[]): ActionResolution[] {
  const sources = actors.filter(actor => actor.active && !actor.neutralized && isSupportAction(actor.intent));
  if (sources.length === 0) return [];

  // Actor values are read only until all contributions have been collected,
  // so the map itself is the immutable pulse snapshot; cloning every nested
  // actor field would add allocation without changing the resolution model.
  const snapshot = new Map(actors.map(actor => [actor.id, actor]));
  const actorDeltas = new Map<string, Record<string, number>>();
  const squadDeltas = new Map<string, number>();
  const resolutions: ActionResolution[] = [];
  const addActor = (source: ActorState, targetId: string, field: string, amount: number) => {
    const deltas = actorDeltas.get(targetId) ?? {};
    deltas[field] = (deltas[field] ?? 0) + amount;
    actorDeltas.set(targetId, deltas);
    resolutions.push({ actorId: source.id, action: source.intent, targetId, changes: { [field]: persistedNumber(amount) } });
  };
  const addSquad = (source: ActorState, targetId: string, amount: number) => {
    squadDeltas.set(targetId, (squadDeltas.get(targetId) ?? 0) + amount);
    resolutions.push({ actorId: source.id, action: source.intent, targetId, changes: { cohesion: persistedNumber(amount) } });
  };

  for (const actor of [...sources].sort((left, right) => left.id.localeCompare(right.id))) {
    const allies = [...snapshot.values()].filter(target => target.id !== actor.id && target.side === actor.side && target.active)
      .sort((left, right) => distance(actor.position, left.position) - distance(actor.position, right.position) || left.id.localeCompare(right.id));
    const authoredTarget = actor.humanTargetActorId ? snapshot.get(actor.humanTargetActorId) : undefined;
    const target = authoredTarget?.side === actor.side && authoredTarget.active ? authoredTarget : allies[0];
    switch (actor.intent) {
      case "observe":
        addActor(actor, actor.id, "awareness", 0.08);
        break;
      case "communicate": {
        addActor(actor, actor.id, "awareness", 0.03);
        for (const ally of allies.filter(item => distance(actor.position, item.position) <= 8)) {
          addActor(actor, ally.id, "fear", -0.025 * actor.resolve);
        }
        const squad = squads.find(item => item.id === actor.squadId);
        if (squad) addSquad(actor, squad.id, 0.02 * actor.resolve);
        break;
      }
      case "protect":
        addActor(actor, actor.id, "guard", 0.08 + (actor.toolAvailable ? (actor.tool?.defensiveUtility ?? 0) * 0.04 : 0));
        if (target && distance(actor.position, target.position) <= 2) addActor(actor, target.id, "guard", 0.03);
        break;
      case "ready-tool":
        if (actor.toolAvailable && actor.tool) addActor(actor, actor.id, "toolReady", 0.2 * actor.tool.readiness);
        break;
      case "aid-ally":
        if (target && distance(actor.position, target.position) <= 2) {
          addActor(actor, target.id, "shock", -0.03 * actor.resolve);
          addActor(actor, target.id, "disruption", -0.04 * actor.resolve);
          addActor(actor, target.id, "impairment", -0.015 * actor.resolve);
        }
        break;
      case "rally":
        for (const ally of allies.filter(item => distance(actor.position, item.position) <= 6)) {
          addActor(actor, ally.id, "fear", -0.05 * actor.resolve);
        }
        break;
    }
  }

  for (const [actorId, deltas] of [...actorDeltas].sort(([left], [right]) => left.localeCompare(right))) {
    const actor = actors.find(item => item.id === actorId)!;
    for (const [field, delta] of Object.entries(deltas).sort(([left], [right]) => left.localeCompare(right))) {
      const current = Number((actor as unknown as Record<string, unknown>)[field] ?? 0);
      (actor as unknown as Record<string, unknown>)[field] = clamp(current + delta);
    }
  }
  for (const [squadId, delta] of [...squadDeltas].sort(([left], [right]) => left.localeCompare(right))) {
    const squad = squads.find(item => item.id === squadId)!;
    squad.cohesion = clamp(squad.cohesion + delta);
  }
  return resolutions;
}
