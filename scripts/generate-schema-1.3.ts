#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

type Schema = Record<string, any>;
const root = new URL("../packages/schema/schema/", import.meta.url);
const load = async (name: string): Promise<Schema> => JSON.parse(await readFile(new URL(name, root), "utf8"));
const save = async (name: string, schema: Schema): Promise<void> => writeFile(new URL(name, root), `${JSON.stringify(schema, null, 2)}\n`);
const clone = <T>(value: T): T => structuredClone(value);
const version = (schema: Schema, kind: string): Schema => {
  schema.$id = `https://living-here.example/schema/${kind}-1.3.0.schema.json`;
  schema.title = String(schema.title).replace("1.2.0", "1.3.0");
  schema.properties.schemaVersion = { const: "1.3.0" };
  return schema;
};
const idRef = { $ref: "#/$defs/id" };
const pointRef = { $ref: "#/$defs/point" };
const unit = { type: "number", minimum: 0, maximum: 1 };
const documentRef = (kind: string, schemaVersion = "1.3.0") => ({
  $ref: `https://living-here.example/schema/${kind}-${schemaVersion}.schema.json`,
});

const scenario = version(await load("scenario-1.2.0.schema.json"), "scenario");
scenario.$defs.navigationArea = {
  type: "object", additionalProperties: false, required: ["id", "x", "y", "width", "height"],
  properties: {
    id: idRef, x: { type: "number", minimum: 0, maximum: 1000 }, y: { type: "number", minimum: 0, maximum: 1000 },
    width: { type: "number", exclusiveMinimum: 0, maximum: 1000 }, height: { type: "number", exclusiveMinimum: 0, maximum: 1000 },
  },
};
scenario.$defs.environmentZone = {
  type: "object", additionalProperties: false, required: ["id", "kind", "x", "y", "width", "height", "value"],
  properties: {
    id: idRef, kind: { enum: ["cover", "light", "noise"] },
    x: { type: "number", minimum: 0, maximum: 1000 }, y: { type: "number", minimum: 0, maximum: 1000 },
    width: { type: "number", exclusiveMinimum: 0, maximum: 1000 }, height: { type: "number", exclusiveMinimum: 0, maximum: 1000 }, value: unit,
  },
};
scenario.$defs.environment = {
  type: "object", additionalProperties: false,
  properties: { ambientLight: unit, ambientNoise: unit, visibilityScale: unit },
};
scenario.$defs.scheduledEvent = {
  type: "object", additionalProperties: false, required: ["id", "tick", "kind"],
  properties: {
    id: idRef, tick: { type: "integer", minimum: 1, maximum: 36000 },
    kind: { enum: ["threat-state", "environment"] }, active: { type: "boolean" },
    ambientLight: unit, ambientNoise: unit, visibilityScale: unit,
  },
};
scenario.$defs.abstractTool = {
  type: "object", additionalProperties: false,
  required: ["id", "class", "reachM", "readiness", "concealment", "durability", "defensiveUtility", "intimidation"],
  properties: {
    id: idRef, class: { enum: ["none", "barrier", "signal", "short-reach", "long-reach"] },
    reachM: { type: "number", minimum: 0, maximum: 3 }, readiness: unit, concealment: unit,
    durability: unit, defensiveUtility: unit, intimidation: unit,
  },
};
scenario.$defs.engagementRules = {
  type: "object", additionalProperties: false,
  properties: {
    minimumSeverity: unit, minimumImmediacy: unit, requireThreatenedParty: { type: "boolean" },
    permitCommit: { type: "boolean" }, permitProtect: { type: "boolean" }, permitWithdrawal: { type: "boolean" },
  },
};
scenario.properties.environment = { $ref: "#/$defs/environment" };
scenario.properties.scheduledEvents = { type: "array", maxItems: 256, items: { $ref: "#/$defs/scheduledEvent" } };
scenario.properties.map.properties.navigableAreas = { type: "array", maxItems: 256, items: { $ref: "#/$defs/navigationArea" } };
scenario.properties.map.properties.environmentZones = { type: "array", maxItems: 256, items: { $ref: "#/$defs/environmentZone" } };
Object.assign(scenario.properties.threat.properties, {
  severity: unit, immediacy: unit, retreatAvailable: { type: "boolean" },
  threatenedActorIds: { type: "array", maxItems: 256, items: idRef },
});
scenario.properties.rules.properties.engagement = { $ref: "#/$defs/engagementRules" };
Object.assign(scenario.$defs.actor.properties, {
  role: { type: "string", minLength: 1, maxLength: 80 }, attention: unit,
  hearingRangeM: { type: "number", minimum: 0, maximum: 1000 }, soundSignature: unit, awareness: unit,
  tags: { type: "array", maxItems: 32, items: idRef }, tool: { $ref: "#/$defs/abstractTool" },
  humanTargetActorId: idRef, humanTargetPoint: pointRef,
});
await save("scenario-1.3.0.schema.json", scenario);

const state = version(await load("simulation-state-1.2.0.schema.json"), "simulation-state");
state.required.push("environment", "randomStreams");
state.$defs.abstractTool = clone(scenario.$defs.abstractTool);
state.$defs.environmentState = {
  type: "object", additionalProperties: false, required: ["ambientLight", "ambientNoise", "visibilityScale"],
  properties: { ambientLight: unit, ambientNoise: unit, visibilityScale: unit },
};
state.$defs.randomStreamState = {
  type: "object", additionalProperties: false, required: ["state", "increment", "draws"],
  properties: {
    state: { type: "string", pattern: "^[a-f0-9]{16}$" }, increment: { type: "string", pattern: "^[a-f0-9]{15}[13579bdf]$" },
    draws: { type: "integer", minimum: 0, maximum: 100000000 },
  },
};
state.properties.environment = { $ref: "#/$defs/environmentState" };
state.properties.randomStreams = {
  type: "object", additionalProperties: false, required: ["sensing", "movement", "contact", "morale", "policy"],
  properties: Object.fromEntries(["sensing", "movement", "contact", "morale", "policy"].map(name => [name, { $ref: "#/$defs/randomStreamState" }])),
};
state.$defs.actorState.properties = {
  ...clone(scenario.$defs.actor.properties), ...state.$defs.actorState.properties,
  awareness: unit,
  memoryActorIds: { type: "array", maxItems: 256, items: idRef },
  memoryAges: { type: "object", additionalProperties: { type: "integer", minimum: 0, maximum: 100 } },
  toolReady: unit, toolAvailable: { type: "boolean" }, engagementHeadroom: unit,
};
for (const field of ["awareness", "memoryActorIds", "memoryAges", "toolReady", "toolAvailable", "engagementHeadroom"]) {
  if (!state.$defs.actorState.required.includes(field)) state.$defs.actorState.required.push(field);
}
await save("simulation-state-1.3.0.schema.json", state);

const trace = version(await load("trace-record-1.2.0.schema.json"), "trace-record");
trace.required.push("heardActorIds", "rememberedActorIds", "observationUncertainty", "gatePredicates");
trace.properties.heardActorIds = clone(trace.properties.visibleActorIds);
trace.properties.rememberedActorIds = clone(trace.properties.visibleActorIds);
trace.properties.observationUncertainty = unit;
trace.properties.gatePredicates = { type: "object", additionalProperties: { type: "boolean" } };
await save("trace-record-1.3.0.schema.json", trace);

const event = version(await load("simulation-event-1.2.0.schema.json"), "simulation-event");
event.properties.type.enum.push("environment-changed", "action-resolved", "tool-state-changed");
const observation = event.properties.payload.oneOf.find((item: Schema) => item.required?.includes("observerId"));
observation.required.push("heardActorIds", "rememberedActorIds", "uncertainty", "rngSamples");
Object.assign(observation.properties, {
  heardActorIds: clone(observation.properties.visibleActorIds), rememberedActorIds: clone(observation.properties.visibleActorIds),
  uncertainty: unit, rngSamples: { type: "array", maxItems: 256, items: unit },
});
const gate = event.properties.payload.oneOf.find((item: Schema) => item.required?.includes("failedPredicate"));
gate.properties.failedPredicates = { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 80 } };
gate.properties.predicates = { type: "object", additionalProperties: { type: "boolean" } };
const contact = event.properties.payload.oneOf.find((item: Schema) => item.required?.includes("packetId"));
contact.required.push("disarm"); contact.properties.disarm = { type: "boolean" };
event.properties.payload.oneOf.push(
  {
    type: "object", additionalProperties: false, required: ["eventId", "ambientLight", "ambientNoise", "visibilityScale"],
    properties: { eventId: idRef, ambientLight: unit, ambientNoise: unit, visibilityScale: unit },
  },
  {
    type: "object", additionalProperties: false, required: ["actorId", "action", "targetId", "changes"],
    properties: { actorId: idRef, action: { $ref: "#/$defs/action" }, targetId: idRef, changes: { $ref: "#/$defs/numericMap" } },
  },
  {
    type: "object", additionalProperties: false, required: ["actorId", "toolAvailable", "toolReady", "reason"],
    properties: { actorId: idRef, toolAvailable: { type: "boolean" }, toolReady: unit, reason: { type: "string", minLength: 1, maxLength: 80 } },
  },
);
await save("simulation-event-1.3.0.schema.json", event);

const runLog = version(await load("run-log-1.2.0.schema.json"), "run-log");
runLog.required.push("snapshots");
runLog.properties.scenario = documentRef("scenario");
runLog.properties.initialState = documentRef("simulation-state");
runLog.properties.events.items = documentRef("simulation-event");
runLog.properties.traces.items = documentRef("trace-record");
runLog.properties.finalState = documentRef("simulation-state");
runLog.properties.snapshots = {
  type: "array", maxItems: 1441,
  items: {
    type: "object", additionalProperties: false, required: ["tick", "state", "eventSequence", "traceCount"],
    properties: {
      tick: { type: "integer", minimum: 0, maximum: 36000 }, state: documentRef("simulation-state"),
      eventSequence: { type: "integer", minimum: 0, maximum: 1000000 }, traceCount: { type: "integer", minimum: 0, maximum: 1000000 },
    },
  },
};
await save("run-log-1.3.0.schema.json", runLog);
const continuation = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://living-here.example/schema/continuation-1.0.0.schema.json",
  title: "Living Here Simulation Continuation 1.0.0",
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "engineVersion", "scenario", "initialState", "state", "events", "traces", "snapshots", "checksum"],
  properties: {
    schemaVersion: { const: "1.0.0" }, engineVersion: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
    scenario: documentRef("scenario"), initialState: documentRef("simulation-state"), state: documentRef("simulation-state"),
    events: { type: "array", maxItems: 1000000, items: documentRef("simulation-event") },
    traces: { type: "array", maxItems: 1000000, items: documentRef("trace-record") },
    snapshots: clone(runLog.properties.snapshots), checksum: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
};
await save("continuation-1.0.0.schema.json", continuation);
console.log("Generated Schema 1.3.0 documents from the immutable 1.2.0 compatibility set.");
