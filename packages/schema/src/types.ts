import { SCHEMA_VERSION, type ActorSpec, type Point } from "./scenario-types.generated.ts";
export { SCHEMA_VERSION };
export type {
  AbstractToolSpec, ActorSpec, EngagementRules, EnvironmentSpec, EnvironmentZone, ExitZone,
  MoraleRules, NavigationArea, ObjectiveSpec, PhysicsRules, Point, Rectangle,
  ScenarioSpec, ScheduledEventSpec, SquadSpec, TerminalConditionSpec,
} from "./scenario-types.generated.ts";

export type ActionKind =
  | "observe" | "communicate" | "reposition" | "protect" | "withdraw"
  | "ready-tool" | "commit" | "aid-ally" | "rally" | "wait";

export interface ActionIntent {
  action: ActionKind;
  actorId: string;
  targetActorId?: string;
  targetPoint?: Point;
  commitment: number;
  protectiveSubjectId?: string;
  rationale: string;
}

export interface ActorState extends ActorSpec {
  active: boolean;
  intent: ActionKind;
  shock: number;
  balance: number;
  guard: number;
  mobility: number;
  impairment: number;
  disruption: number;
  recoveryTicks: number;
  neutralized: boolean;
  fear: number;
  moraleState: "steady" | "shaken" | "frozen" | "routing" | "recovering";
  escaped: boolean;
  routeExitId?: string;
  awareness: number;
  memoryActorIds: string[];
  memoryAges: Record<string, number>;
  toolReady: number;
  toolAvailable: boolean;
  engagementHeadroom: number;
}

export interface EnvironmentState {
  ambientLight: number;
  ambientNoise: number;
  visibilityScale: number;
}

export interface RandomStreamState {
  state: string;
  increment: string;
  draws: number;
}

export interface RandomStreamsState {
  sensing: RandomStreamState;
  movement: RandomStreamState;
  contact: RandomStreamState;
  morale: RandomStreamState;
  policy: RandomStreamState;
}

export interface SquadState {
  id: string;
  side: string;
  leaderId?: string;
  cohesion: number;
  routedCount: number;
}

export interface SimulationState {
  schemaVersion: typeof SCHEMA_VERSION;
  scenarioId: string;
  tick: number;
  elapsedMs: number;
  threatActive: boolean;
  done: boolean;
  terminalReason?: string;
  objectiveProgress: Record<string, boolean>;
  squads: SquadState[];
  actors: ActorState[];
  environment: EnvironmentState;
  randomStreams: RandomStreamsState;
}

export interface SimulationEvent {
  schemaVersion: typeof SCHEMA_VERSION;
  sequence: number;
  tick: number;
  type:
    | "simulation-started" | "threat-ended" | "observation-built" | "policy-decided"
    | "intent-gated" | "intent-resolved" | "movement-resolved"
    | "tempo-resolved" | "contact-resolved" | "effects-applied" | "recovery-applied"
    | "morale-signal" | "morale-updated" | "squad-updated" | "route-progress"
    | "objective-updated" | "terminal-reached" | "simulation-ended"
    | "environment-changed" | "action-resolved" | "tool-state-changed";
  payload: Record<string, unknown>;
  priorChecksum: string;
  checksum: string;
}

export interface TraceRecord {
  schemaVersion: typeof SCHEMA_VERSION;
  tick: number;
  actorId: string;
  visibleActorIds: string[];
  heardActorIds: string[];
  rememberedActorIds: string[];
  observationUncertainty: number;
  selectedAction: ActionKind;
  formulaTerms: Record<string, number>;
  randomSamples: number[];
  effectPacketIds: string[];
  actorStateChecksum: string;
  gatePredicates: Record<string, boolean>;
}

export interface RunSnapshot {
  tick: number;
  state: SimulationState;
  eventSequence: number;
  traceCount: number;
}

export interface RunLog {
  schemaVersion: typeof SCHEMA_VERSION;
  engineVersion: string;
  scenario: ScenarioSpec;
  initialState: SimulationState;
  events: SimulationEvent[];
  traces: TraceRecord[];
  snapshots: RunSnapshot[];
  finalState: SimulationState;
  finalChecksum: string;
}

export interface SimulationContinuation {
  schemaVersion: "1.0.0";
  engineVersion: string;
  scenario: ScenarioSpec;
  initialState: SimulationState;
  state: SimulationState;
  events: SimulationEvent[];
  traces: TraceRecord[];
  snapshots: RunSnapshot[];
  checksum: string;
}
