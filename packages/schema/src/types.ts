export const SCHEMA_VERSION = "1.0.0" as const;

export type ActionKind =
  | "observe" | "communicate" | "reposition" | "protect" | "withdraw"
  | "ready-tool" | "commit" | "aid-ally" | "rally" | "wait";

export interface Point { x: number; y: number }

export interface ActorSpec {
  id: string;
  side: string;
  position: Point;
  readiness: number;
  stamina: number;
  resolve: number;
  threatened?: boolean;
}

export interface ScenarioSpec {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  seed: number;
  pulseMs: 100;
  maxTicks: number;
  map: { width: number; height: number };
  threat: { active: boolean; endsAtTick?: number };
  actors: ActorSpec[];
}

export interface ActorState extends ActorSpec {
  active: boolean;
  intent: ActionKind;
  shock: number;
}

export interface SimulationState {
  schemaVersion: typeof SCHEMA_VERSION;
  scenarioId: string;
  tick: number;
  elapsedMs: number;
  threatActive: boolean;
  done: boolean;
  actors: ActorState[];
}

export interface SimulationEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  sequence: number;
  tick: number;
  type: "simulation-started" | "threat-ended" | "intent-gated" | "intent-resolved" | "simulation-ended";
  payload: Record<string, unknown>;
  priorChecksum: string;
  checksum: string;
}

export interface RunLog {
  schemaVersion: typeof SCHEMA_VERSION;
  engineVersion: string;
  scenario: ScenarioSpec;
  initialState: SimulationState;
  events: SimulationEvent[];
  finalState: SimulationState;
  finalChecksum: string;
}
