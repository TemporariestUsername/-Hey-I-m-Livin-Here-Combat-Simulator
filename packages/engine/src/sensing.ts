import type { ActorState, Rectangle } from "../../schema/src/index.ts";
import { angleDifference, bearing, distance, hasLineOfSight } from "./geometry.ts";

export interface ActorObservation {
  observerId: string;
  visibleActorIds: string[];
}

/** Builds observations in stable actor-ID order without exposing non-visible state. */
export function buildObservations(actors: readonly ActorState[], obstacles: readonly Rectangle[] = []): ActorObservation[] {
  const ordered = [...actors].sort((a, b) => a.id.localeCompare(b.id));
  return ordered.map(observer => {
    const range = observer.visionRange ?? 20;
    const arc = observer.visionArcDegrees ?? 120;
    const facing = observer.facingDegrees ?? 0;
    const visibleActorIds = ordered.filter(target => target.id !== observer.id && target.active)
      .filter(target => distance(observer.position, target.position) <= range)
      .filter(target => angleDifference(bearing(observer.position, target.position), facing) <= arc / 2)
      .filter(target => hasLineOfSight(observer.position, target.position, obstacles))
      .map(target => target.id);
    return { observerId: observer.id, visibleActorIds };
  });
}
