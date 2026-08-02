import { randomUUID } from "node:crypto";
import { checksum, ENGINE_VERSION, persistedNumber, runSimulationWithTelemetry } from "../../engine/src/index.ts";
import { getBuiltInPolicy } from "../../policies/src/index.ts";
import type { RunLog, ScenarioSpec } from "../../schema/src/index.ts";
import { assertScenario } from "../../schema/src/index.ts";
import type { ArtifactRepository, JobRecord, MetadataRepository } from "../../storage/src/index.ts";
import { TelemetrySink } from "./telemetry.ts";

export interface ExperimentVariant {
  id: string;
  policyId: NonNullable<ScenarioSpec["actors"][number]["policyId"]>;
  actorIds?: string[];
}

export interface ExperimentRequest {
  scenario: ScenarioSpec;
  variants: ExperimentVariant[];
  seeds: number[];
}

export interface EpisodeMetrics {
  metricsVersion: "1.1.0";
  variantId: string;
  seed: number;
  ticks: number;
  terminalReason: string;
  contacts: number;
  neutralized: number;
  escaped: number;
  routed: number;
  moraleSignals: number;
  maximumCascadeDepth: number;
  completedObjectives: number;
  postThreatCommitments: number;
  commitActions: number;
  withdrawActions: number;
  protectActions: number;
  firstSelectedAction: string;
  objectiveCompletionRate: number;
  protectedActorCount: number;
  protectedActorsSafe: number;
  protectedPartySafetyRate: number | null;
  successfulWithdrawals: number;
  completedSeparations: number;
  threatTerminationTick: number | null;
  threatTerminationMs: number | null;
  activeThreatExposureTicks: number;
  activeThreatExposureMs: number;
  escalationCount: number;
  moraleCascadeOccurred: boolean;
  moraleActorsAffected: number;
  averageSquadCohesionLoss: number;
  averageSquadCohesionRecovery: number;
  sideStates: Record<string, {
    actorCount: number;
    meanDisruption: number;
    meanImpairment: number;
    meanShock: number;
    routedRate: number;
    neutralizedRate: number;
    escapedRate: number;
  }>;
}

export interface ExperimentResult {
  schemaVersion: "1.1.0";
  engineVersion: string;
  scenarioId: string;
  scenarioHash: string;
  requestHash: string;
  configurationHash: string;
  seedSetHash: string;
  policyVersions: Record<string, string>;
  platform: { node: string; os: string; architecture: string };
  episodes: Array<{ variantId: string; seed: number; artifactHash: string; metrics: EpisodeMetrics }>;
}

export const MAX_EXPERIMENT_PULSES = 5_000_000;
export const EPISODE_METRICS_VERSION = "1.1.0";

export class IdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency-Key was reused with a different experiment request");
    this.name = "IdempotencyConflictError";
  }
}

export class ExperimentService {
  readonly metadata: MetadataRepository;
  readonly artifacts: ArtifactRepository;
  readonly workerId: string;
  readonly telemetry: TelemetrySink;
  readonly episodeTimeoutMs: number;
  private draining?: Promise<void>;

  constructor(metadata: MetadataRepository, artifacts: ArtifactRepository, workerId = `worker-${randomUUID()}`, telemetry = new TelemetrySink(), episodeTimeoutMs = 30_000) {
    this.metadata = metadata;
    this.artifacts = artifacts;
    this.workerId = workerId;
    this.telemetry = telemetry;
    if (!Number.isFinite(episodeTimeoutMs) || episodeTimeoutMs < 0) throw new RangeError("episodeTimeoutMs must be finite and non-negative");
    this.episodeTimeoutMs = episodeTimeoutMs;
  }

  enqueue(projectId: string, idempotencyKey: string, request: ExperimentRequest): JobRecord {
    if (!this.metadata.projectExists(projectId)) throw new Error(`unknown project ${projectId}`);
    validateExperiment(request);
    const job = this.metadata.enqueueJob({
      id: randomUUID(), projectId, kind: "experiment", payload: request, idempotencyKey,
    });
    if (job.kind !== "experiment" || checksum(job.payload) !== checksum(request)) throw new IdempotencyConflictError();
    return job;
  }

  async runNext(now = Date.now()): Promise<JobRecord | undefined> {
    const job = this.metadata.leaseNextJob(this.workerId, now);
    if (!job) return undefined;
    this.telemetry.record("experiment-started", { jobId: job.id, projectId: job.projectId, queueDelayMs: Math.max(0, now - job.createdAt) });
    try {
      const result = await this.execute(job);
      const afterExecution = this.metadata.getJob(job.id)!;
      if (afterExecution.cancelRequested) {
        this.metadata.finishJob(job.id, this.workerId, "cancelled");
        this.telemetry.record("experiment-cancelled", { jobId: job.id, episodeCount: this.metadata.episodes(job.id).length });
        return this.metadata.getJob(job.id);
      }
      const bytes = Buffer.from(JSON.stringify(result));
      const resultHash = await this.artifacts.publish(job.projectId, bytes, "experiment-result");
      this.metadata.finishJob(job.id, this.workerId, "completed", resultHash);
      this.telemetry.record("experiment-completed", { jobId: job.id, resultHash, episodeCount: result.episodes.length, artifactBytes: bytes.byteLength });
    } catch (error) {
      const current = this.metadata.getJob(job.id);
      this.metadata.finishJob(job.id, this.workerId, current?.cancelRequested ? "cancelled" : "failed", undefined,
        error instanceof Error ? error.message : String(error));
      this.telemetry.record(current?.cancelRequested ? "experiment-cancelled" : "experiment-failed", {
        jobId: job.id, error: error instanceof Error ? error.message : String(error),
      });
    }
    return this.metadata.getJob(job.id);
  }

  drain(): Promise<void> {
    if (!this.draining) {
      this.draining = (async () => {
        while (await this.runNext()) { /* drain the durable queue serially */ }
      })().finally(() => { this.draining = undefined; });
    }
    return this.draining;
  }

  private async execute(job: JobRecord): Promise<ExperimentResult> {
    const request = job.payload as ExperimentRequest;
    validateExperiment(request);
    const policyIds = [...new Set(request.variants.map(variant => variant.policyId))].sort();
    const policyVersions = Object.fromEntries(policyIds.map(id => [id, getBuiltInPolicy(id).version]));
    const result: ExperimentResult = {
      schemaVersion: "1.1.0",
      engineVersion: ENGINE_VERSION,
      scenarioId: request.scenario.id,
      scenarioHash: checksum(request.scenario),
      requestHash: checksum(request),
      configurationHash: checksum({ variants: request.variants, policyVersions }),
      seedSetHash: checksum([...request.seeds].sort((a, b) => a - b)),
      policyVersions,
      platform: { node: process.version, os: process.platform, architecture: process.arch },
      episodes: [],
    };
    for (const variant of [...request.variants].sort((a, b) => a.id.localeCompare(b.id))) {
      for (const seed of [...request.seeds].sort((a, b) => a - b)) {
        const current = this.metadata.getJob(job.id)!;
        if (current.cancelRequested) return result;
        this.metadata.heartbeat(job.id, this.workerId);
        const episodeScenario = scenarioForEpisode(request.scenario, variant, seed);
        const episodeKey = checksum({
          scenario: episodeScenario, variant: variant.id, engineVersion: ENGINE_VERSION, metricsVersion: EPISODE_METRICS_VERSION,
        });
        const previous = this.metadata.episodes(job.id).find(episode => episode.episodeKey === episodeKey && episode.status === "completed");
        if (previous?.artifactHash && previous.metrics) {
          result.episodes.push({ variantId: variant.id, seed, artifactHash: previous.artifactHash, metrics: previous.metrics as EpisodeMetrics });
          continue;
        }
        this.metadata.upsertEpisode(job.id, episodeKey, variant.id, seed, "running");
        try {
          const started = globalThis.performance.now();
          const log = runSimulationWithTelemetry(episodeScenario, (kind, fields) => this.telemetry.record(kind, fields));
          const durationMs = globalThis.performance.now() - started;
          if (durationMs > this.episodeTimeoutMs) throw new Error(`episode timeout exceeded ${this.episodeTimeoutMs} ms`);
          const artifactBytes = Buffer.from(JSON.stringify(log));
          const artifactHash = await this.artifacts.publish(job.projectId, artifactBytes, "run-log");
          const metrics = episodeMetrics(log, variant.id, seed);
          this.telemetry.record("experiment-episode", {
            jobId: job.id, variantId: variant.id, seed, artifactHash, artifactBytes: artifactBytes.byteLength,
            pulses: log.finalState.tick, durationMs: persistedNumber(durationMs),
            pulsesPerSecond: durationMs === 0 ? 0 : persistedNumber(log.finalState.tick / durationMs * 1000),
          });
          this.metadata.upsertEpisode(job.id, episodeKey, variant.id, seed, "completed", artifactHash, metrics);
          result.episodes.push({ variantId: variant.id, seed, artifactHash, metrics });
        } catch (error) {
          this.metadata.upsertEpisode(job.id, episodeKey, variant.id, seed, "failed", undefined, undefined,
            error instanceof Error ? error.message : String(error));
          throw error;
        }
      }
    }
    return result;
  }

  async result(jobId: string): Promise<ExperimentResult> {
    const job = this.metadata.getJob(jobId);
    if (!job?.resultHash) throw new Error("job has no completed result");
    return JSON.parse(Buffer.from(await this.artifacts.read(job.projectId, job.resultHash)).toString("utf8")) as ExperimentResult;
  }
}

export function validateExperiment(request: ExperimentRequest): void {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("experiment request must be an object");
  const requestKeys = Object.keys(request as unknown as Record<string, unknown>);
  if (requestKeys.some(key => !["scenario", "variants", "seeds"].includes(key))) {
    throw new Error("experiment request contains an unknown field");
  }
  assertScenario(request.scenario);
  if (!Array.isArray(request.variants) || request.variants.length < 1 || request.variants.length > 16) {
    throw new Error("experiment variants must contain 1–16 entries");
  }
  if (!Array.isArray(request.seeds) || request.seeds.length < 1 || request.seeds.length > 10_000) {
    throw new Error("experiment seeds must contain 1–10,000 entries");
  }
  const variantIds = new Set<string>();
  for (const variant of request.variants) {
    if (!variant || typeof variant !== "object" || Array.isArray(variant) ||
        Object.keys(variant as unknown as Record<string, unknown>).some(key => !["id", "policyId", "actorIds"].includes(key))) {
      throw new Error("experiment variant contains an unknown field");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(variant.id)) throw new Error("experiment variant ID is invalid");
    if (variantIds.has(variant.id)) throw new Error("experiment variant IDs must be unique");
    variantIds.add(variant.id);
    try { getBuiltInPolicy(variant.policyId); }
    catch { throw new Error(`unknown built-in policy ${String(variant.policyId)}`); }
    const targets = variant.actorIds ?? request.scenario.actors.map(actor => actor.id);
    if (!Array.isArray(targets) || new Set(targets).size !== targets.length) throw new Error("variant actorIds must be a unique array");
    if (targets.some(id => !request.scenario.actors.some(actor => actor.id === id))) throw new Error("variant actorIds must identify scenario actors");
  }
  if (new Set(request.seeds).size !== request.seeds.length || request.seeds.some(seed => !Number.isSafeInteger(seed) || seed < 0)) {
    throw new Error("experiment seeds must be unique non-negative safe integers");
  }
  const estimatedPulses = request.variants.length * request.seeds.length * request.scenario.maxTicks;
  if (!Number.isSafeInteger(estimatedPulses) || estimatedPulses > MAX_EXPERIMENT_PULSES) {
    throw new Error(`experiment exceeds the ${MAX_EXPERIMENT_PULSES.toLocaleString("en-US")} pulse allocation limit`);
  }
}

export function scenarioForEpisode(scenario: ScenarioSpec, variant: ExperimentVariant, seed: number): ScenarioSpec {
  const next = structuredClone(scenario);
  next.seed = seed;
  const actorIds = new Set(variant.actorIds ?? next.actors.map(actor => actor.id));
  for (const actor of next.actors) if (actorIds.has(actor.id)) actor.policyId = variant.policyId;
  return next;
}

export function episodeMetrics(log: RunLog, variantId: string, seed: number): EpisodeMetrics {
  const signals = log.events.filter(event => event.type === "morale-signal");
  const decisions = log.events.filter(event => event.type === "intent-resolved");
  const completedObjectives = Object.values(log.finalState.objectiveProgress).filter(Boolean).length;
  const objectiveCount = Object.keys(log.finalState.objectiveProgress).length;
  const protectedSides = new Set((log.scenario.objectives ?? [])
    .filter(objective => objective.kind === "protect-side" && objective.side).map(objective => objective.side!));
  const protectedActors = log.finalState.actors.filter(actor => protectedSides.has(actor.side));
  const protectedActorsSafe = protectedActors.filter(actor => !actor.neutralized && (actor.active || actor.escaped)).length;
  const threatTermination = log.events.find(event => event.type === "threat-ended");
  const activeThreatExposureTicks = log.scenario.threat.active ? (threatTermination?.tick ?? log.finalState.tick) : 0;
  const affectedMoraleActors = new Set(signals.map(event => String(event.payload.targetActorId)));
  const initialSquad = new Map(log.initialState.squads.map(squad => [squad.id, squad.cohesion]));
  const minimumSquad = new Map(initialSquad);
  for (const event of log.events.filter(event => event.type === "squad-updated")) {
    const id = String(event.payload.squadId);
    const after = Number(event.payload.cohesionAfter);
    minimumSquad.set(id, Math.min(minimumSquad.get(id) ?? after, after));
  }
  const cohesionLosses = log.finalState.squads.map(squad => Math.max(0, (initialSquad.get(squad.id) ?? squad.cohesion) -
    (minimumSquad.get(squad.id) ?? squad.cohesion)));
  const cohesionRecoveries = log.finalState.squads.map(squad => Math.max(0, squad.cohesion -
    (minimumSquad.get(squad.id) ?? squad.cohesion)));
  const average = (values: readonly number[]) => values.length === 0 ? 0 : persistedNumber(values.reduce((sum, value) => sum + value, 0) / values.length);
  const sideStates = Object.fromEntries([...new Set(log.finalState.actors.map(actor => actor.side))].sort().map(side => {
    const actors = log.finalState.actors.filter(actor => actor.side === side);
    const rate = (predicate: (actor: typeof actors[number]) => boolean) => persistedNumber(actors.filter(predicate).length / actors.length);
    return [side, {
      actorCount: actors.length,
      meanDisruption: average(actors.map(actor => actor.disruption)),
      meanImpairment: average(actors.map(actor => actor.impairment)),
      meanShock: average(actors.map(actor => actor.shock)),
      routedRate: rate(actor => actor.moraleState === "routing" || actor.escaped),
      neutralizedRate: rate(actor => actor.neutralized),
      escapedRate: rate(actor => actor.escaped),
    }];
  }));
  const escalationCount = decisions.filter(event => event.payload.selected === "commit").length;
  const threatEndSequence = threatTermination?.sequence ?? Number.POSITIVE_INFINITY;
  return {
    metricsVersion: "1.1.0",
    variantId,
    seed,
    ticks: log.finalState.tick,
    terminalReason: log.finalState.terminalReason ?? "maximum-duration",
    contacts: log.events.filter(event => event.type === "contact-resolved").length,
    neutralized: log.finalState.actors.filter(actor => actor.neutralized).length,
    escaped: log.finalState.actors.filter(actor => actor.escaped).length,
    routed: log.finalState.actors.filter(actor => actor.moraleState === "routing" || actor.escaped).length,
    moraleSignals: signals.length,
    maximumCascadeDepth: Math.max(0, ...signals.map(event => Number(event.payload.depth))),
    completedObjectives,
    postThreatCommitments: decisions.filter(event => event.payload.selected === "commit" && event.sequence > threatEndSequence).length,
    commitActions: decisions.filter(event => event.payload.selected === "commit").length,
    withdrawActions: decisions.filter(event => event.payload.selected === "withdraw").length,
    protectActions: decisions.filter(event => event.payload.selected === "protect").length,
    firstSelectedAction: String(decisions[0]?.payload.selected ?? "wait"),
    objectiveCompletionRate: objectiveCount === 0 ? 0 : persistedNumber(completedObjectives / objectiveCount),
    protectedActorCount: protectedActors.length,
    protectedActorsSafe,
    protectedPartySafetyRate: protectedActors.length === 0 ? null : persistedNumber(protectedActorsSafe / protectedActors.length),
    successfulWithdrawals: log.finalState.actors.filter(actor => actor.escaped).length,
    completedSeparations: (log.scenario.objectives ?? []).filter(objective => objective.kind === "separation" &&
      log.finalState.objectiveProgress[objective.id]).length,
    threatTerminationTick: threatTermination?.tick ?? null,
    threatTerminationMs: threatTermination ? threatTermination.tick * log.scenario.pulseMs : null,
    activeThreatExposureTicks,
    activeThreatExposureMs: activeThreatExposureTicks * log.scenario.pulseMs,
    escalationCount,
    moraleCascadeOccurred: signals.length > 0,
    moraleActorsAffected: affectedMoraleActors.size,
    averageSquadCohesionLoss: average(cohesionLosses),
    averageSquadCohesionRecovery: average(cohesionRecoveries),
    sideStates,
  };
}

export function experimentCsv(result: ExperimentResult): string {
  const columns: Array<keyof EpisodeMetrics> = ["metricsVersion", "variantId", "seed", "ticks", "terminalReason", "contacts", "neutralized",
    "escaped", "routed", "moraleSignals", "maximumCascadeDepth", "completedObjectives", "postThreatCommitments",
    "commitActions", "withdrawActions", "protectActions", "firstSelectedAction", "objectiveCompletionRate", "protectedActorCount",
    "protectedActorsSafe", "protectedPartySafetyRate", "successfulWithdrawals", "completedSeparations", "threatTerminationTick",
    "threatTerminationMs", "activeThreatExposureTicks", "activeThreatExposureMs", "escalationCount", "moraleCascadeOccurred",
    "moraleActorsAffected", "averageSquadCohesionLoss", "averageSquadCohesionRecovery", "sideStates"];
  const quote = (value: unknown): string => {
    const serialized = value !== null && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
    return `"${serialized.replaceAll('"', '""')}"`;
  };
  return [columns.join(","), ...result.episodes.map(episode => columns.map(column => quote(episode.metrics[column])).join(","))].join("\n") + "\n";
}
