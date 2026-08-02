export type TelemetryKind =
  | "api-request" | "simulation-run" | "policy-decision" | "experiment-started"
  | "experiment-episode" | "experiment-completed" | "experiment-failed" | "experiment-cancelled"
  | "replay-mismatch";

export interface TelemetryRecord {
  timestamp: string;
  kind: TelemetryKind;
  fields: Record<string, string | number | boolean | null>;
}

/** Bounded, process-local structured operations telemetry. It never enters deterministic artifacts or leaves loopback. */
export class TelemetrySink {
  readonly maximumRecords: number;
  #records: TelemetryRecord[] = [];

  constructor(maximumRecords = 10_000) {
    this.maximumRecords = maximumRecords;
  }

  record(kind: TelemetryKind, fields: TelemetryRecord["fields"]): void {
    this.#records.push({ timestamp: new Date().toISOString(), kind, fields: structuredClone(fields) });
    if (this.#records.length > this.maximumRecords) this.#records.splice(0, this.#records.length - this.maximumRecords);
  }

  snapshot(kind?: TelemetryKind): TelemetryRecord[] {
    return this.#records.filter(record => !kind || record.kind === kind).map(record => structuredClone(record));
  }
}
