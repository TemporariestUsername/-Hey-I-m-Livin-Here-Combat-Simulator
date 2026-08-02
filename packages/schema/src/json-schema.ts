import { readFileSync } from "node:fs";

type JsonSchema = {
  $id?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  oneOf?: JsonSchema[];
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
};

export const SCENARIO_JSON_SCHEMA = JSON.parse(
  readFileSync(new URL("../schema/scenario-1.3.0.schema.json", import.meta.url), "utf8"),
) as JsonSchema;

export const EVENT_JSON_SCHEMA = JSON.parse(
  readFileSync(new URL("../schema/simulation-event-1.3.0.schema.json", import.meta.url), "utf8"),
) as JsonSchema;

export const RUN_LOG_JSON_SCHEMA = JSON.parse(
  readFileSync(new URL("../schema/run-log-1.3.0.schema.json", import.meta.url), "utf8"),
) as JsonSchema;

export const STATE_JSON_SCHEMA = JSON.parse(
  readFileSync(new URL("../schema/simulation-state-1.3.0.schema.json", import.meta.url), "utf8"),
) as JsonSchema;

export const TRACE_JSON_SCHEMA = JSON.parse(
  readFileSync(new URL("../schema/trace-record-1.3.0.schema.json", import.meta.url), "utf8"),
) as JsonSchema;

export const CONTINUATION_JSON_SCHEMA = JSON.parse(
  readFileSync(new URL("../schema/continuation-1.0.0.schema.json", import.meta.url), "utf8"),
) as JsonSchema;

const SCHEMA_REGISTRY = new Map(
  [SCENARIO_JSON_SCHEMA, EVENT_JSON_SCHEMA, RUN_LOG_JSON_SCHEMA, STATE_JSON_SCHEMA, TRACE_JSON_SCHEMA, CONTINUATION_JSON_SCHEMA]
    .map(schema => [schema.$id!, schema] as const),
);

function resolveRef(root: JsonSchema, ref: string): { schema: JsonSchema; root: JsonSchema } {
  let targetRoot = root;
  let fragment = ref;
  if (!ref.startsWith("#")) {
    if (!root.$id) throw new Error(`Cannot resolve external schema reference without a base ID: ${ref}`);
    const resolved = new URL(ref, root.$id);
    fragment = resolved.hash;
    resolved.hash = "";
    const registered = SCHEMA_REGISTRY.get(resolved.href);
    if (!registered) throw new Error(`Unregistered schema reference: ${ref}`);
    targetRoot = registered;
  }
  if (fragment === "" || fragment === "#") return { schema: targetRoot, root: targetRoot };
  if (!fragment.startsWith("#/")) throw new Error(`Unsupported schema reference fragment: ${ref}`);
  let current: unknown = targetRoot;
  for (const segment of fragment.slice(2).split("/")) {
    current = (current as Record<string, unknown>)[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  if (!current || typeof current !== "object") throw new Error(`Unresolved schema reference: ${ref}`);
  return { schema: current as JsonSchema, root: targetRoot };
}

function actualType(value: unknown): JsonSchema["type"] | "null" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value as JsonSchema["type"];
}

export function validateAgainstJsonSchema(value: unknown, schema: JsonSchema, root = schema, path = "$"): string[] {
  if (schema.$ref) {
    const resolved = resolveRef(root, schema.$ref);
    return validateAgainstJsonSchema(value, resolved.schema, resolved.root, path);
  }
  const errors: string[] = [];
  if (schema.oneOf) {
    const matches = schema.oneOf.map(candidate => validateAgainstJsonSchema(value, candidate, root, path))
      .filter(candidateErrors => candidateErrors.length === 0);
    if (matches.length !== 1) return [`${path} must match exactly one allowed schema variant`];
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path} must be one of ${schema.enum.map(String).join(", ")}`);

  if (schema.type) {
    const type = actualType(value);
    const matches = schema.type === "number" ? (type === "number" || type === "integer") : type === schema.type;
    if (!matches) return [...errors, `${path} must be ${schema.type}`];
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(`${path} must be finite`);
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be at most ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${path} must be greater than ${schema.exclusiveMinimum}`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} must not be empty`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} must contain at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path} has an invalid format`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} must contain at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} must contain at most ${schema.maxItems} item(s)`);
    if (schema.items) value.forEach((item, index) => errors.push(...validateAgainstJsonSchema(item, schema.items!, root, `${path}[${index}]`)));
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(record, required)) errors.push(`${path}.${required} is required`);
    }
    for (const [key, item] of Object.entries(record)) {
      const child = schema.properties?.[key];
      if (child) errors.push(...validateAgainstJsonSchema(item, child, root, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...validateAgainstJsonSchema(item, schema.additionalProperties, root, `${path}.${key}`));
      }
    }
  }
  return errors;
}
