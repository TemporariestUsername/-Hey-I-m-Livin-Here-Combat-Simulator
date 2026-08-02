import { lintProhibitedContent } from "./content-policy.ts";
import { CONTINUATION_JSON_SCHEMA, EVENT_JSON_SCHEMA, RUN_LOG_JSON_SCHEMA, SCENARIO_JSON_SCHEMA, STATE_JSON_SCHEMA, TRACE_JSON_SCHEMA, validateAgainstJsonSchema } from "./json-schema.ts";
import { SCHEMA_VERSION, type RunLog, type ScenarioSpec, type SimulationContinuation } from "./types.ts";

export interface ValidationResult { valid: boolean; errors: string[] }

function rejectUnknownKeys(value: unknown, allowed: readonly string[], path: string): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path} must be an object`];
  const accepted = new Set(allowed);
  return Object.keys(value).filter(key => !accepted.has(key)).map(key => `${path}.${key} is not allowed`);
}

function contentErrors(input: unknown): string[] {
  return lintProhibitedContent(input).map(finding => `${finding.path}: ${finding.message} [${finding.category}]`);
}

function rectanglesOverlap(left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x &&
    left.y < right.y + right.height && left.y + left.height > right.y;
}

function circleIntersectsRectangle(position: { x: number; y: number }, radius: number,
  rectangle: { x: number; y: number; width: number; height: number }): boolean {
  const nearestX = Math.max(rectangle.x, Math.min(position.x, rectangle.x + rectangle.width));
  const nearestY = Math.max(rectangle.y, Math.min(position.y, rectangle.y + rectangle.height));
  return Math.hypot(position.x - nearestX, position.y - nearestY) + 1e-9 < radius;
}

function exitReachable(value: ScenarioSpec, actorIndex: number): boolean {
  const exits = value.map.exits ?? [];
  if (exits.length === 0) return false;
  const columns = Math.min(128, Math.max(16, Math.ceil(value.map.width / Math.max(value.map.width, value.map.height) * 128)));
  const rows = Math.min(128, Math.max(16, Math.ceil(value.map.height / Math.max(value.map.width, value.map.height) * 128)));
  const cellWidth = value.map.width / columns;
  const cellHeight = value.map.height / rows;
  const clearance = Math.max(...value.actors.map(actor => actor.radiusM ?? 0.3));
  const blocked = new Uint8Array(columns * rows);
  for (const obstacle of value.map.obstacles ?? []) {
    if (obstacle.blocksMovement === false) continue;
    const left = Math.max(0, Math.floor((obstacle.x - clearance) / cellWidth));
    const right = Math.min(columns - 1, Math.floor((obstacle.x + obstacle.width + clearance) / cellWidth));
    const top = Math.max(0, Math.floor((obstacle.y - clearance) / cellHeight));
    const bottom = Math.min(rows - 1, Math.floor((obstacle.y + obstacle.height + clearance) / cellHeight));
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) blocked[y * columns + x] = 1;
  }
  if ((value.map.navigableAreas?.length ?? 0) > 0) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const point = { x: (column + 0.5) * cellWidth, y: (row + 0.5) * cellHeight };
        if (!value.map.navigableAreas!.some(area => point.x >= area.x && point.x <= area.x + area.width &&
            point.y >= area.y && point.y <= area.y + area.height)) blocked[row * columns + column] = 1;
      }
    }
  }
  const cell = (x: number, y: number) => {
    const column = Math.max(0, Math.min(columns - 1, Math.floor(x / cellWidth)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor(y / cellHeight)));
    return row * columns + column;
  };
  const targets = new Set(exits.map(exit => cell(exit.x + exit.width / 2, exit.y + exit.height / 2)));
  const start = cell(value.actors[actorIndex]!.position.x, value.actors[actorIndex]!.position.y);
  if (blocked[start]) return false;
  const queue = new Int32Array(columns * rows);
  const visited = new Uint8Array(columns * rows);
  let head = 0; let tail = 0;
  queue[tail++] = start; visited[start] = 1;
  while (head < tail) {
    const current = queue[head++]!;
    if (targets.has(current)) return true;
    const x = current % columns; const y = Math.floor(current / columns);
    for (const next of [x > 0 ? current - 1 : -1, x + 1 < columns ? current + 1 : -1,
      y > 0 ? current - columns : -1, y + 1 < rows ? current + columns : -1]) {
      if (next >= 0 && !blocked[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
    }
  }
  return false;
}

export function validateScenario(input: unknown): ValidationResult {
  const errors = [
    ...validateAgainstJsonSchema(input, SCENARIO_JSON_SCHEMA),
    ...contentErrors(input),
  ];
  if (errors.length > 0) return { valid: false, errors };

  const value = input as ScenarioSpec;
  if (!Number.isSafeInteger(value.seed)) errors.push("$.seed must be a safe integer");
  if (value.threat.endsAtTick !== undefined && value.threat.endsAtTick > value.maxTicks) {
    errors.push("$.threat.endsAtTick must not exceed $.maxTicks");
  }

  const obstacleIds = new Set<string>();
  for (const [index, obstacle] of (value.map.obstacles ?? []).entries()) {
    if (obstacleIds.has(obstacle.id)) errors.push(`$.map.obstacles[${index}].id must be unique`);
    obstacleIds.add(obstacle.id);
    if (obstacle.x + obstacle.width > value.map.width || obstacle.y + obstacle.height > value.map.height) {
      errors.push(`$.map.obstacles[${index}] must be inside the map`);
    }
  }
  const obstacles = value.map.obstacles ?? [];
  for (let leftIndex = 0; leftIndex < obstacles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < obstacles.length; rightIndex += 1) {
      if (rectanglesOverlap(obstacles[leftIndex]!, obstacles[rightIndex]!)) {
        errors.push(`$.map.obstacles[${leftIndex}] and $.map.obstacles[${rightIndex}] must not overlap`);
      }
    }
  }
  const exitIds = new Set<string>();
  for (const [index, exit] of (value.map.exits ?? []).entries()) {
    if (exitIds.has(exit.id)) errors.push(`$.map.exits[${index}].id must be unique`);
    exitIds.add(exit.id);
    if (exit.x + exit.width > value.map.width || exit.y + exit.height > value.map.height) {
      errors.push(`$.map.exits[${index}] must be inside the map`);
    }
  }
  const areaIds = new Set<string>();
  for (const [index, area] of (value.map.navigableAreas ?? []).entries()) {
    if (areaIds.has(area.id)) errors.push(`$.map.navigableAreas[${index}].id must be unique`);
    areaIds.add(area.id);
    if (area.x + area.width > value.map.width || area.y + area.height > value.map.height) {
      errors.push(`$.map.navigableAreas[${index}] must be inside the map`);
    }
  }
  const zoneIds = new Set<string>();
  for (const [index, zone] of (value.map.environmentZones ?? []).entries()) {
    if (zoneIds.has(zone.id)) errors.push(`$.map.environmentZones[${index}].id must be unique`);
    zoneIds.add(zone.id);
    if (zone.x + zone.width > value.map.width || zone.y + zone.height > value.map.height) {
      errors.push(`$.map.environmentZones[${index}] must be inside the map`);
    }
  }

  const actorIds = new Set<string>();
  for (const [index, actor] of value.actors.entries()) {
    if (actorIds.has(actor.id)) errors.push(`$.actors[${index}].id must be unique`);
    actorIds.add(actor.id);
    if (actor.position.x > value.map.width || actor.position.y > value.map.height) {
      errors.push(`$.actors[${index}].position must be inside the map`);
    }
    if ((value.map.navigableAreas?.length ?? 0) > 0 && !value.map.navigableAreas!.some(area =>
      actor.position.x >= area.x && actor.position.x <= area.x + area.width &&
      actor.position.y >= area.y && actor.position.y <= area.y + area.height)) {
      errors.push(`$.actors[${index}].position must be inside a navigable area`);
    }
    for (const [obstacleIndex, obstacle] of obstacles.entries()) {
      if (obstacle.blocksMovement !== false && circleIntersectsRectangle(actor.position, actor.radiusM ?? 0.3, obstacle)) {
        errors.push(`$.actors[${index}] must not overlap movement obstacle $.map.obstacles[${obstacleIndex}]`);
      }
    }
  }
  for (let leftIndex = 0; leftIndex < value.actors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < value.actors.length; rightIndex += 1) {
      const left = value.actors[leftIndex]!;
      const right = value.actors[rightIndex]!;
      const separation = Math.hypot(left.position.x - right.position.x, left.position.y - right.position.y);
      if (separation + 1e-9 < (left.radiusM ?? 0.3) + (right.radiusM ?? 0.3)) {
        errors.push(`$.actors[${leftIndex}] and $.actors[${rightIndex}] must not overlap`);
      }
    }
  }

  const sides = new Set(value.actors.map(actor => actor.side));
  const squadIds = new Set<string>();
  for (const [index, squad] of (value.squads ?? []).entries()) {
    if (squadIds.has(squad.id)) errors.push(`$.squads[${index}].id must be unique`);
    squadIds.add(squad.id);
    if (!sides.has(squad.side)) errors.push(`$.squads[${index}].side must identify an actor side`);
    if (squad.leaderId) {
      const leader = value.actors.find(actor => actor.id === squad.leaderId);
      if (!leader || leader.side !== squad.side || leader.squadId !== squad.id) {
        errors.push(`$.squads[${index}].leaderId must identify a member on the squad side`);
      }
    }
  }
  for (const [index, actor] of value.actors.entries()) {
    if (actor.squadId && !squadIds.has(actor.squadId)) errors.push(`$.actors[${index}].squadId must identify a squad`);
    if (actor.humanTargetActorId && !actorIds.has(actor.humanTargetActorId)) {
      errors.push(`$.actors[${index}].humanTargetActorId must identify an actor`);
    }
    if (actor.humanTargetPoint && (actor.humanTargetPoint.x > value.map.width || actor.humanTargetPoint.y > value.map.height)) {
      errors.push(`$.actors[${index}].humanTargetPoint must be inside the map`);
    }
    if (actor.humanTargetPoint && (value.map.navigableAreas?.length ?? 0) > 0 && !value.map.navigableAreas!.some(area =>
      actor.humanTargetPoint!.x >= area.x && actor.humanTargetPoint!.x <= area.x + area.width &&
      actor.humanTargetPoint!.y >= area.y && actor.humanTargetPoint!.y <= area.y + area.height)) {
      errors.push(`$.actors[${index}].humanTargetPoint must be inside a navigable area`);
    }
  }
  for (const [index, id] of (value.threat.threatenedActorIds ?? []).entries()) {
    if (!actorIds.has(id)) errors.push(`$.threat.threatenedActorIds[${index}] must identify an actor`);
  }
  const scheduledIds = new Set<string>();
  for (const [index, scheduled] of (value.scheduledEvents ?? []).entries()) {
    if (scheduledIds.has(scheduled.id)) errors.push(`$.scheduledEvents[${index}].id must be unique`);
    scheduledIds.add(scheduled.id);
    if (scheduled.tick > value.maxTicks) errors.push(`$.scheduledEvents[${index}].tick must not exceed $.maxTicks`);
    if (scheduled.kind === "threat-state" && scheduled.active === undefined) {
      errors.push(`$.scheduledEvents[${index}].active is required for a threat-state event`);
    }
    if (scheduled.kind === "environment" && scheduled.ambientLight === undefined && scheduled.ambientNoise === undefined &&
        scheduled.visibilityScale === undefined) {
      errors.push(`$.scheduledEvents[${index}] must change at least one environment value`);
    }
  }
  const morale = value.rules?.morale;
  if (morale?.enabled && exitIds.size === 0) errors.push("$.map.exits must contain an exit when morale is enabled");
  if (exitIds.size > 0 && obstacles.length <= 256 && !value.actors.some((_actor, index) => exitReachable(value, index))) {
    errors.push("$.map.exits must include an exit reachable from at least one actor with largest-actor clearance");
  }
  if (morale) {
    const recover = morale.recoverThreshold ?? 0.22;
    const shaken = morale.shakenThreshold ?? 0.3;
    const frozen = morale.frozenThreshold ?? 0.55;
    const route = morale.routeThreshold ?? 0.78;
    if (!(recover < shaken && shaken < frozen && frozen < route)) {
      errors.push("$.rules.morale thresholds must satisfy recover < shaken < frozen < route");
    }
  }
  const objectiveIds = new Set<string>();
  for (const [index, objective] of (value.objectives ?? []).entries()) {
    if (objectiveIds.has(objective.id)) errors.push(`$.objectives[${index}].id must be unique`);
    objectiveIds.add(objective.id);
    if ((objective.kind === "protect-side" || objective.kind === "neutralize-side" || objective.kind === "evacuate-side") &&
        (!objective.side || !sides.has(objective.side))) {
      errors.push(`$.objectives[${index}].side must identify an actor side`);
    }
    if (objective.kind === "separation") {
      const [first, second] = objective.actorIds ?? [];
      if (!first || !second || first === second || !actorIds.has(first) || !actorIds.has(second)) {
        errors.push(`$.objectives[${index}].actorIds must identify two distinct actors`);
      }
      if (objective.minimumDistanceM === undefined) {
        errors.push(`$.objectives[${index}].minimumDistanceM is required for separation`);
      }
    }
  }
  for (const [index, condition] of (value.terminalConditions ?? []).entries()) {
    if ((condition.kind === "side-neutralized" || condition.kind === "side-routed") && (!condition.side || !sides.has(condition.side))) {
      errors.push(`$.terminalConditions[${index}].side must identify an actor side`);
    }
    if (condition.kind === "objective-complete" &&
        (!condition.objectiveId || !objectiveIds.has(condition.objectiveId))) {
      errors.push(`$.terminalConditions[${index}].objectiveId must identify an objective`);
    }
  }
  if (value.rules?.physics?.enabled && (value.terminalConditions?.length ?? 0) === 0) {
    errors.push("$.terminalConditions must contain at least one condition when physics is enabled");
  }
  return { valid: errors.length === 0, errors };
}

export function validateRunLog(input: unknown): ValidationResult {
  const errors = [
    ...validateAgainstJsonSchema(input, RUN_LOG_JSON_SCHEMA),
    ...contentErrors(input),
  ];
  if (errors.length > 0) return { valid: false, errors };

  const value = input as RunLog;
  const scenarioResult = validateScenario(value.scenario);
  errors.push(...scenarioResult.errors.map(error => `$.scenario: ${error}`));
  value.events.forEach((event, index) => {
    errors.push(...validateAgainstJsonSchema(event, EVENT_JSON_SCHEMA).map(error => `$.events[${index}]: ${error}`));
    if (!event || typeof event !== "object") return;
    const payloadKeys: Record<string, readonly string[]> = {
      "simulation-started": ["scenarioId", "seed"],
      "threat-ended": ["reason"],
      "observation-built": ["observerId", "visibleActorIds", "heardActorIds", "rememberedActorIds", "uncertainty", "rngSamples"],
      "policy-decided": ["actorId", "policyId", "policyVersion", "selected", "candidates", "rationale", "rngSamples"],
      "intent-gated": ["actorId", "proposed", "selected", "failedPredicate", "failedPredicates", "predicates"],
      "intent-resolved": ["actorId", "selected", "stamina"],
      "movement-resolved": ["actorId", "from", "to", "blocked"],
      "tempo-resolved": ["actorId", "targetId", "tempo", "terms", "noise", "interrupted", "interruptedBy"],
      "contact-resolved": ["packetId", "sourceId", "targetId", "contactQuality", "severity", "impulseNs", "terms", "noise", "disruption", "impairment", "shock", "separationM", "neutralization", "disarm"],
      "effects-applied": ["targetId", "packetIds", "deltas", "neutralized", "from", "to"],
      "recovery-applied": ["actorId", "changes"],
      "morale-signal": ["sourceActorId", "targetActorId", "depth", "amount", "distanceM"],
      "morale-updated": ["actorId", "fearBefore", "fearAfter", "stateBefore", "stateAfter"],
      "squad-updated": ["squadId", "cohesionBefore", "cohesionAfter", "routedCount"],
      "route-progress": ["actorId", "exitId", "reachedExit", "position"],
      "objective-updated": ["objectiveId", "complete"],
      "terminal-reached": ["reason"],
      "simulation-ended": ["reason"],
      "environment-changed": ["eventId", "ambientLight", "ambientNoise", "visibilityScale"],
      "action-resolved": ["actorId", "action", "targetId", "changes"],
      "tool-state-changed": ["actorId", "toolAvailable", "toolReady", "reason"],
    };
    errors.push(...rejectUnknownKeys(event.payload, payloadKeys[event.type] ?? [], `$.events[${index}].payload`));
    if (event.type === "policy-decided" && Array.isArray(event.payload.candidates)) {
      event.payload.candidates.forEach((candidate, candidateIndex) => {
        errors.push(...rejectUnknownKeys(candidate, ["action", "eligible", "score", "contributions"], `$.events[${index}].payload.candidates[${candidateIndex}]`));
      });
    }
    if (event.type === "movement-resolved" || event.type === "effects-applied") {
      errors.push(...rejectUnknownKeys(event.payload.from, ["x", "y"], `$.events[${index}].payload.from`));
      errors.push(...rejectUnknownKeys(event.payload.to, ["x", "y"], `$.events[${index}].payload.to`));
    }
    if (event.type === "route-progress") {
      errors.push(...rejectUnknownKeys(event.payload.position, ["x", "y"], `$.events[${index}].payload.position`));
    }
  });
  const actorKeys = [
    "id", "side", "position", "facingDegrees", "visionRange", "visionArcDegrees", "movementSpeed",
    "massKg", "radiusM", "skill", "balance", "guard", "mobility", "surprise", "reachM", "protection", "stance",
    "readiness", "stamina", "resolve", "threatened", "policyId", "active", "intent", "shock",
    "impairment", "disruption", "recoveryTicks", "neutralized", "fear", "aggression", "squadId", "leader",
    "humanIntent", "humanTargetActorId", "humanTargetPoint", "role", "attention", "hearingRangeM", "soundSignature",
    "awareness", "tags", "tool", "moraleState", "escaped", "routeExitId", "memoryActorIds", "memoryAges",
    "toolReady", "toolAvailable", "engagementHeadroom",
  ];
  for (const [label, state] of [["initialState", value.initialState], ["finalState", value.finalState]] as const) {
    errors.push(...validateAgainstJsonSchema(state, STATE_JSON_SCHEMA).map(error => `$.${label}: ${error}`));
    errors.push(...rejectUnknownKeys(state, ["schemaVersion", "scenarioId", "tick", "elapsedMs", "threatActive", "done", "terminalReason", "objectiveProgress", "squads", "actors", "environment", "randomStreams"], `$.${label}`));
    if (state.schemaVersion !== SCHEMA_VERSION) errors.push(`$.${label}.schemaVersion must equal ${SCHEMA_VERSION}`);
    if (state.scenarioId !== value.scenario.id) errors.push(`$.${label}.scenarioId must match the scenario`);
    if (!Array.isArray(state.actors)) errors.push(`$.${label}.actors must be an array`);
    else state.actors.forEach((actor, actorIndex) => {
      errors.push(...rejectUnknownKeys(actor, actorKeys, `$.${label}.actors[${actorIndex}]`));
      errors.push(...rejectUnknownKeys(actor.position, ["x", "y"], `$.${label}.actors[${actorIndex}].position`));
    });
  }
  value.traces.forEach((trace, index) => {
    errors.push(...validateAgainstJsonSchema(trace, TRACE_JSON_SCHEMA).map(error => `$.traces[${index}]: ${error}`));
  });
  value.snapshots.forEach((snapshot, index) => {
    errors.push(...rejectUnknownKeys(snapshot, ["tick", "state", "eventSequence", "traceCount"], `$.snapshots[${index}]`));
    errors.push(...validateAgainstJsonSchema(snapshot.state, STATE_JSON_SCHEMA).map(error => `$.snapshots[${index}].state: ${error}`));
    if (snapshot.tick !== snapshot.state.tick) errors.push(`$.snapshots[${index}].tick must match its state tick`);
    if (snapshot.eventSequence > value.events.length || snapshot.traceCount > value.traces.length) {
      errors.push(`$.snapshots[${index}] indices must remain inside the run log`);
    }
  });
  return { valid: errors.length === 0, errors };
}

export function assertScenario(input: unknown): asserts input is ScenarioSpec {
  const result = validateScenario(input);
  if (!result.valid) throw new Error(`Invalid scenario:\n- ${result.errors.join("\n- ")}`);
}

export function assertRunLog(input: unknown): asserts input is RunLog {
  const result = validateRunLog(input);
  if (!result.valid) throw new Error(`Invalid run log:\n- ${result.errors.join("\n- ")}`);
}

export function validateContinuation(input: unknown): ValidationResult {
  const errors = [...validateAgainstJsonSchema(input, CONTINUATION_JSON_SCHEMA), ...contentErrors(input)];
  if (errors.length > 0) return { valid: false, errors };
  const value = input as SimulationContinuation;
  errors.push(...validateScenario(value.scenario).errors.map(error => `$.scenario: ${error}`));
  for (const [label, state] of [["initialState", value.initialState], ["state", value.state]] as const) {
    errors.push(...validateAgainstJsonSchema(state, STATE_JSON_SCHEMA).map(error => `$.${label}: ${error}`));
  }
  value.events.forEach((event, index) => errors.push(...validateAgainstJsonSchema(event, EVENT_JSON_SCHEMA)
    .map(error => `$.events[${index}]: ${error}`)));
  value.traces.forEach((trace, index) => errors.push(...validateAgainstJsonSchema(trace, TRACE_JSON_SCHEMA)
    .map(error => `$.traces[${index}]: ${error}`)));
  if (value.state.tick < 0 || value.state.done || value.state.scenarioId !== value.scenario.id) {
    errors.push("$.state must be a non-terminal state for the continuation scenario");
  }
  return { valid: errors.length === 0, errors };
}

export function assertContinuation(input: unknown): asserts input is SimulationContinuation {
  const result = validateContinuation(input);
  if (!result.valid) throw new Error(`Invalid continuation:\n- ${result.errors.join("\n- ")}`);
}
