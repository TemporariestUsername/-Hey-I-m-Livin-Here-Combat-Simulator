import assert from "node:assert/strict";
import test from "node:test";
import { buildObservations, createInitialState, hasLineOfSight, resolveMovement } from "../packages/engine/src/index.ts";
import type { Rectangle, ScenarioSpec } from "../packages/schema/src/index.ts";

const wall: Rectangle = { id: "wall", x: 4, y: 2, width: 1, height: 6 };

test("line of sight detects occlusion and respects non-blocking obstacles", () => {
  assert.equal(hasLineOfSight({ x: 2, y: 5 }, { x: 8, y: 5 }, [wall]), false);
  assert.equal(hasLineOfSight({ x: 2, y: 1 }, { x: 8, y: 1 }, [wall]), true);
  assert.equal(hasLineOfSight({ x: 20, y: 2 }, { x: 30, y: 2 }, [wall]), true);
  assert.equal(hasLineOfSight({ x: 2, y: 5 }, { x: 8, y: 5 }, [{ ...wall, blocksVision: false }]), true);
});

test("swept movement cannot tunnel through walls and remains in bounds", () => {
  assert.deepEqual(resolveMovement({ x: 2, y: 5 }, { x: 8, y: 5 }, { width: 10, height: 10, obstacles: [wall] }), { x: 2, y: 5 });
  assert.deepEqual(resolveMovement({ x: 2, y: 1 }, { x: -3, y: 12 }, { width: 10, height: 10 }), { x: 0, y: 10 });
});

test("observations enforce range, facing, occlusion, and stable ordering", () => {
  const scenario: ScenarioSpec = {
    schemaVersion: "1.3.0", id: "sensing", name: "Sensing", seed: 1, pulseMs: 100, maxTicks: 1,
    map: { width: 10, height: 10, obstacles: [wall] }, threat: { active: true },
    actors: [
      { id: "observer", side: "a", position: { x: 2, y: 5 }, facingDegrees: 0, visionRange: 10, visionArcDegrees: 120, readiness: 1, stamina: 1, resolve: 1 },
      { id: "visible", side: "b", position: { x: 3, y: 5 }, readiness: 1, stamina: 1, resolve: 1 },
      { id: "occluded", side: "b", position: { x: 8, y: 5 }, readiness: 1, stamina: 1, resolve: 1 },
      { id: "behind", side: "b", position: { x: 1, y: 5 }, readiness: 1, stamina: 1, resolve: 1 },
    ],
  };
  const observations = buildObservations(createInitialState(scenario).actors, scenario.map.obstacles);
  assert.deepEqual(observations.find(item => item.observerId === "observer")?.visibleActorIds, ["visible"]);
  assert.deepEqual(observations.map(item => item.observerId), ["behind", "observer", "occluded", "visible"]);
});
