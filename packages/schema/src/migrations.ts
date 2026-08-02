import { SCHEMA_VERSION } from "./types.ts";

export interface SchemaMigration {
  readonly documentKind: "scenario";
  readonly fromVersion: string;
  readonly toVersion: string;
  migrate(document: unknown): unknown;
}

function updateVersionTags(value: unknown, fromVersion: string, toVersion: string): unknown {
  if (Array.isArray(value)) return value.map(item => updateVersionTags(item, fromVersion, toVersion));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key === "schemaVersion" && item === fromVersion
        ? toVersion
        : updateVersionTags(item, fromVersion, toVersion),
    ]));
  }
  return value;
}

export const schemaMigrations: readonly SchemaMigration[] = Object.freeze([
  {
    documentKind: "scenario",
    fromVersion: "1.0.0",
    toVersion: "1.1.0",
    migrate(document: unknown): unknown {
      if (!document || typeof document !== "object") throw new TypeError("versioned document must be an object");
      return updateVersionTags(structuredClone(document), "1.0.0", "1.1.0");
    },
  },
  {
    documentKind: "scenario",
    fromVersion: "1.1.0",
    toVersion: "1.2.0",
    migrate(document: unknown): unknown {
      if (!document || typeof document !== "object") throw new TypeError("versioned document must be an object");
      return updateVersionTags(structuredClone(document), "1.1.0", "1.2.0");
    },
  },
  {
    documentKind: "scenario",
    fromVersion: "1.2.0",
    toVersion: "1.3.0",
    migrate(document: unknown): unknown {
      if (!document || typeof document !== "object") throw new TypeError("versioned document must be an object");
      return updateVersionTags(structuredClone(document), "1.2.0", "1.3.0");
    },
  },
]);

export function migrateToCurrentSchema(document: unknown): unknown {
  if (!document || typeof document !== "object") throw new TypeError("versioned document must be an object");
  let current = structuredClone(document) as Record<string, unknown>;
  if (current.engineVersion !== undefined || current.events !== undefined) {
    throw new Error("run artifacts are immutable and require their original schema and engine version");
  }
  if (!(current.map && current.threat && Array.isArray(current.actors))) {
    throw new Error("only scenario documents have a safe schema migration path");
  }
  const visited = new Set<string>();
  while (current.schemaVersion !== SCHEMA_VERSION) {
    const version = typeof current.schemaVersion === "string" ? current.schemaVersion : "<missing>";
    if (visited.has(version)) throw new Error(`schema migration cycle at ${version}`);
    visited.add(version);
    const migration = schemaMigrations.find(candidate => candidate.fromVersion === version);
    if (!migration) throw new Error(`no migration path from schema version ${version} to ${SCHEMA_VERSION}`);
    current = migration.migrate(current) as Record<string, unknown>;
    current.schemaVersion = migration.toVersion;
  }
  return current;
}
