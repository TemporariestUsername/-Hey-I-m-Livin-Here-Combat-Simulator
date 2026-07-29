import { SCHEMA_VERSION, type ActorSpec, type ScenarioSpec } from "./types.ts";
import { lintProhibitedContent } from "./content-lint.ts";

export interface ValidationResult { valid: boolean; errors: string[] }

const finiteIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export function validateScenario(input: unknown): ValidationResult {
  const errors: string[] = [...lintProhibitedContent(input).errors];
  if (!input || typeof input !== "object") return { valid: false, errors: ["scenario must be an object"] };
  const value = input as Partial<ScenarioSpec>;
  if (value.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (typeof value.id !== "string" || value.id.length === 0) errors.push("id must be a non-empty string");
  if (typeof value.name !== "string" || value.name.length === 0) errors.push("name must be a non-empty string");
  if (!Number.isSafeInteger(value.seed) || (value.seed ?? -1) < 0) errors.push("seed must be a non-negative safe integer");
  if (value.pulseMs !== 100) errors.push("pulseMs must be 100");
  if (!Number.isInteger(value.maxTicks) || (value.maxTicks ?? 0) < 1 || (value.maxTicks ?? 0) > 36000) errors.push("maxTicks must be an integer from 1 to 36000");
  if (!value.map || !finiteIn(value.map.width, 1, 1000) || !finiteIn(value.map.height, 1, 1000)) errors.push("map dimensions must be finite values from 1 to 1000 metres");
  else if (value.map.obstacles !== undefined) {
    if (!Array.isArray(value.map.obstacles)) errors.push("map.obstacles must be an array");
    else {
      const obstacleIds = new Set<string>();
      value.map.obstacles.forEach((obstacle, index) => {
        const at = `map.obstacles[${index}]`;
        if (!obstacle || typeof obstacle.id !== "string" || obstacle.id.length === 0) errors.push(`${at}.id must be non-empty`);
        else if (obstacleIds.has(obstacle.id)) errors.push(`${at}.id must be unique`); else obstacleIds.add(obstacle.id);
        if (!finiteIn(obstacle?.x, 0, value.map!.width) || !finiteIn(obstacle?.y, 0, value.map!.height) ||
            !finiteIn(obstacle?.width, Number.EPSILON, value.map!.width) || !finiteIn(obstacle?.height, Number.EPSILON, value.map!.height) ||
            obstacle.x + obstacle.width > value.map!.width || obstacle.y + obstacle.height > value.map!.height) errors.push(`${at} must be a positive rectangle inside the map`);
        for (const field of ["blocksVision", "blocksMovement"] as const) if (obstacle?.[field] !== undefined && typeof obstacle[field] !== "boolean") errors.push(`${at}.${field} must be boolean`);
      });
    }
  }
  if (!value.threat || typeof value.threat.active !== "boolean") errors.push("threat.active must be boolean");
  if (!Array.isArray(value.actors) || value.actors.length < 1 || value.actors.length > 256) {
    errors.push("actors must contain 1 to 256 entries");
  } else {
    const ids = new Set<string>();
    value.actors.forEach((actor, index) => validateActor(actor, index, value, ids, errors));
  }
  return { valid: errors.length === 0, errors };
}

function validateActor(actor: ActorSpec, index: number, scenario: Partial<ScenarioSpec>, ids: Set<string>, errors: string[]): void {
  const at = `actors[${index}]`;
  if (!actor || typeof actor !== "object" || typeof actor.id !== "string" || actor.id.length === 0) errors.push(`${at}.id must be non-empty`);
  else if (ids.has(actor.id)) errors.push(`${at}.id must be unique`); else ids.add(actor.id);
  if (typeof actor?.side !== "string" || actor.side.length === 0) errors.push(`${at}.side must be non-empty`);
  if (!actor?.position || !finiteIn(actor.position.x, 0, scenario.map?.width ?? -1) || !finiteIn(actor.position.y, 0, scenario.map?.height ?? -1)) errors.push(`${at}.position must be inside the map`);
  for (const field of ["readiness", "stamina", "resolve"] as const) if (!finiteIn(actor?.[field], 0, 1)) errors.push(`${at}.${field} must be from 0 to 1`);
  if (actor?.facingDegrees !== undefined && !finiteIn(actor.facingDegrees, 0, 360)) errors.push(`${at}.facingDegrees must be from 0 to 360`);
  if (actor?.visionRange !== undefined && !finiteIn(actor.visionRange, 0, 1000)) errors.push(`${at}.visionRange must be from 0 to 1000 metres`);
  if (actor?.visionArcDegrees !== undefined && !finiteIn(actor.visionArcDegrees, 0, 360)) errors.push(`${at}.visionArcDegrees must be from 0 to 360`);
  if (actor?.movementSpeed !== undefined && !finiteIn(actor.movementSpeed, 0, 10)) errors.push(`${at}.movementSpeed must be from 0 to 10 metres per second`);
  if (actor?.policyId !== undefined && actor.policyId !== "safety-first" && actor.policyId !== "random-valid") errors.push(`${at}.policyId must identify a built-in policy`);
}

export function assertScenario(input: unknown): asserts input is ScenarioSpec {
  const result = validateScenario(input);
  if (!result.valid) throw new Error(`Invalid scenario:\n- ${result.errors.join("\n- ")}`);
}
