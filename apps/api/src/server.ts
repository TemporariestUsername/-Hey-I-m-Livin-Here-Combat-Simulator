import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import {
  experimentCsv, IdempotencyConflictError, type ExperimentRequest, ExperimentService, type TelemetryKind,
} from "../../../packages/service/src/index.ts";
import type { ArtifactRepository, MetadataRepository } from "../../../packages/storage/src/index.ts";
import {
  advanceContinuation, captureContinuation, checksum, ENGINE_VERSION, replay, resumeSimulation,
} from "../../../packages/engine/src/index.ts";
import { getBuiltInPolicy } from "../../../packages/policies/src/index.ts";
import {
  DEFAULT_IMPORT_LIMITS, lintProhibitedContent, parseJsonDocument, validateScenario,
  type RunLog, type ScenarioSpec, type SimulationContinuation,
} from "../../../packages/schema/src/index.ts";

export interface ApiContext {
  metadata: MetadataRepository;
  artifacts: ArtifactRepository;
  experiments: ExperimentService;
  autoRun?: boolean;
  requestLimitPerMinute?: number;
}

interface SimulationSession {
  id: string;
  createdAt: number;
  continuation?: SimulationContinuation;
  run?: RunLog;
  provenance: {
    scenarioHash: string;
    engineVersion: string;
    policyVersions: Record<string, string>;
    configurationHash: string;
    seed: number;
    platform: { node: string; os: string; architecture: string };
    parentSimulationId?: string;
    branchTick?: number;
  };
}

const MAX_INTERACTIVE_ACTOR_PULSES = 32 * 600;
const MAX_SIMULATION_SESSIONS = 128;
const LOCAL_EXPERIMENT_PROJECT_ID = "local-api-experiments-v1";

class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > DEFAULT_IMPORT_LIMITS.maxBytes) throw new ApiError(413, "request_too_large", "request exceeds the 1 MiB import limit");
    chunks.push(bytes);
  }
  try {
    return parseJsonDocument(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new ApiError(400, "invalid_json", error instanceof Error ? error.message : String(error));
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": bytes.byteLength });
  response.end(bytes);
}

function requireProject(context: ApiContext, projectId: string): void {
  if (!context.metadata.projectExists(projectId)) throw new ApiError(404, "project_not_found", "project does not exist");
}

function requestRecord(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(422, "validation_failed", "request body must be an object");
  const value = input as Record<string, unknown>;
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key));
  if (unexpected.length > 0) throw new ApiError(422, "validation_failed", `request field ${unexpected[0]} is not allowed`);
  return value;
}

function simulationView(session: SimulationSession, newEvents: RunLog["events"] = []) {
  const artifact = session.run ?? session.continuation!;
  const state = session.run?.finalState ?? session.continuation!.state;
  return {
    id: session.id,
    createdAt: session.createdAt,
    scenario: artifact.scenario,
    initialState: artifact.initialState,
    done: Boolean(session.run),
    tick: state.tick,
    state,
    eventCount: artifact.events.length,
    traceCount: artifact.traces.length,
    newEvents,
    provenance: session.provenance,
    ...(session.run ? { finalChecksum: session.run.finalChecksum } : {}),
  };
}

export function createApiServer(context: ApiContext) {
  const requestWindows = new Map<string, { startedAt: number; count: number }>();
  const simulations = new Map<string, SimulationSession>();
  const idempotency = new Map<string, { requestHash: string; status: number; value: unknown }>();
  const mutationKey = (request: IncomingMessage, path: string, input: unknown) => {
    const header = request.headers["idempotency-key"];
    if (typeof header !== "string" || header.length < 1 || header.length > 160) {
      throw new ApiError(400, "idempotency_key_required", "Idempotency-Key header is required");
    }
    const key = `${path}:${header}`;
    const requestHash = checksum(input);
    const prior = idempotency.get(key);
    if (prior && prior.requestHash !== requestHash) throw new ApiError(409, "idempotency_conflict", "Idempotency-Key was reused with a different request");
    return { key, requestHash, prior };
  };
  const rememberMutation = (key: string, requestHash: string, status: number, value: unknown) => {
    if (idempotency.size >= 4_096) idempotency.delete(idempotency.keys().next().value!);
    idempotency.set(key, { requestHash, status, value: structuredClone(value) });
  };
  const ensureLocalExperimentProject = () => {
    if (!context.metadata.projectExists(LOCAL_EXPERIMENT_PROJECT_ID)) {
      context.metadata.createProject(LOCAL_EXPERIMENT_PROJECT_ID, "Local API experiments");
    }
    return LOCAL_EXPERIMENT_PROJECT_ID;
  };
  const enqueueExperiment = (projectId: string, key: string, experiment: ExperimentRequest) => {
    try { return context.experiments.enqueue(projectId, key, experiment); }
    catch (error) {
      if (error instanceof IdempotencyConflictError) throw new ApiError(409, "idempotency_conflict", error.message);
      throw new ApiError(422, "validation_failed", error instanceof Error ? error.message : String(error));
    }
  };
  return createServer(async (request, response) => {
    const requestStarted = globalThis.performance.now();
    response.once("finish", () => context.experiments.telemetry.record("api-request", {
      method: request.method ?? "UNKNOWN", path: (request.url ?? "/").split("?")[0]!, status: response.statusCode,
      durationMs: Math.max(0, globalThis.performance.now() - requestStarted),
    }));
    try {
      response.setHeader("x-content-type-options", "nosniff");
      response.setHeader("cache-control", "no-store");
      response.setHeader("referrer-policy", "no-referrer");
      response.setHeader("cross-origin-opener-policy", "same-origin");
      response.setHeader("cross-origin-resource-policy", "same-origin");
      response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
      const host = request.headers.host ?? "";
      if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/u.test(host)) {
        throw new ApiError(400, "invalid_host", "the local service accepts only loopback Host headers");
      }
      const origin = request.headers.origin;
      if (typeof origin === "string" && origin !== `http://${host}`) {
        throw new ApiError(403, "cross_origin_request", "cross-origin requests are not accepted");
      }
      if (request.headers["sec-fetch-site"] === "cross-site") {
        throw new ApiError(403, "cross_site_request", "cross-site requests are not accepted");
      }
      const remote = request.socket.remoteAddress ?? "local";
      const now = Date.now();
      const window = requestWindows.get(remote);
      const current = !window || now - window.startedAt >= 60_000 ? { startedAt: now, count: 0 } : window;
      current.count += 1;
      requestWindows.set(remote, current);
      if (current.count > (context.requestLimitPerMinute ?? 1_200)) {
        response.setHeader("retry-after", "60");
        throw new ApiError(429, "rate_limited", "local request quota exceeded");
      }
      const requestedVersion = request.headers["x-api-version"];
      if (requestedVersion !== undefined && requestedVersion !== "1") {
        throw new ApiError(406, "unsupported_api_version", "supported API version is 1");
      }
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "POST" && url.pathname.startsWith("/v1/") &&
          !String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        throw new ApiError(415, "json_content_type_required", "POST requests require application/json");
      }
      const segments = url.pathname.split("/").filter(Boolean);
      const staticFiles: Record<string, { url: URL; type: string }> = {
        "/": { url: new URL("../../web/index.html", import.meta.url), type: "text/html; charset=utf-8" },
        "/styles.css": { url: new URL("../../web/styles.css", import.meta.url), type: "text/css; charset=utf-8" },
        "/app.js": { url: new URL("../../web/app.js", import.meta.url), type: "text/javascript; charset=utf-8" },
        "/replay-cache.js": { url: new URL("../../web/replay-cache.js", import.meta.url), type: "text/javascript; charset=utf-8" },
        "/presets/morale-cascade-1v3.json": { url: new URL("../../../packages/scenarios/fixtures/morale-cascade-1v3.json", import.meta.url), type: "application/json" },
        "/presets/sudden-crisis-physics.json": { url: new URL("../../../packages/scenarios/fixtures/sudden-crisis-physics.json", import.meta.url), type: "application/json" },
        "/presets/threat-ends.json": { url: new URL("../../../packages/scenarios/fixtures/threat-ends.json", import.meta.url), type: "application/json" },
        "/presets/open-regulated-duel.json": { url: new URL("../../../packages/scenarios/fixtures/open-regulated-duel.json", import.meta.url), type: "application/json" },
        "/presets/crowd-broken-sightlines.json": { url: new URL("../../../packages/scenarios/fixtures/crowd-broken-sightlines.json", import.meta.url), type: "application/json" },
        "/presets/four-person-escort.json": { url: new URL("../../../packages/scenarios/fixtures/four-person-escort.json", import.meta.url), type: "application/json" },
      };
      if (request.method === "GET" && staticFiles[url.pathname]) {
        const file = staticFiles[url.pathname];
        const bytes = await readFile(file.url);
        response.writeHead(200, {
          "content-type": file.type,
          "content-length": bytes.byteLength,
          "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        });
        return response.end(bytes);
      }
      if (request.method === "GET" && url.pathname === "/v1/health") {
        return json(response, 200, { status: "ok", database: context.metadata.integrityCheck() });
      }
      if (request.method === "GET" && url.pathname === "/v1/telemetry") {
        const kind = url.searchParams.get("kind") ?? undefined;
        const allowedKinds = new Set<TelemetryKind>(["api-request", "simulation-run", "policy-decision", "experiment-started", "experiment-episode", "experiment-completed", "experiment-failed", "experiment-cancelled", "replay-mismatch"]);
        if (kind && !allowedKinds.has(kind as TelemetryKind)) throw new ApiError(400, "invalid_telemetry_kind", "telemetry kind is not recognized");
        return json(response, 200, { items: context.experiments.telemetry.snapshot(kind as TelemetryKind | undefined), localOnly: true });
      }
      if (request.method === "POST" && (url.pathname === "/v1/validate" || url.pathname === "/v1/scenarios/validate")) {
        const input = await body(request);
        return json(response, 200, validateScenario(input));
      }
      if (request.method === "POST" && url.pathname === "/v1/replays/verify") {
        const input = await body(request);
        try {
          const state = replay(input as RunLog);
          return json(response, 200, { valid: true, tick: state.tick, finalChecksum: (input as RunLog).finalChecksum });
        } catch (error) {
          context.experiments.telemetry.record("replay-mismatch", {
            artifactHash: checksum(input), error: error instanceof Error ? error.message : String(error),
          });
          throw new ApiError(422, "replay_mismatch", error instanceof Error ? error.message : String(error));
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/simulations") {
        const input = requestRecord(await body(request), ["scenario"]);
        const mutation = mutationKey(request, url.pathname, input);
        if (mutation.prior) return json(response, mutation.prior.status, mutation.prior.value);
        const validation = validateScenario(input.scenario);
        if (!validation.valid) throw new ApiError(422, "validation_failed", validation.errors.join("; "));
        const scenario = input.scenario as ScenarioSpec;
        if (scenario.actors.length * scenario.maxTicks > MAX_INTERACTIVE_ACTOR_PULSES) {
          throw new ApiError(422, "simulation_too_large", "interactive simulations are limited to 19,200 actor-pulses; use a run job for larger work");
        }
        if (simulations.size >= MAX_SIMULATION_SESSIONS) throw new ApiError(429, "simulation_limit_reached", "too many in-memory simulation sessions");
        const simulationStarted = globalThis.performance.now();
        const continuation = captureContinuation(scenario, 0);
        const policyIds = [...new Set(continuation.scenario.actors.map(actor => actor.policyId ?? "random-valid"))].sort();
        const policyVersions = Object.fromEntries(policyIds.map(id => [id, getBuiltInPolicy(id).version]));
        const session: SimulationSession = {
          id: randomUUID(), createdAt: Date.now(), continuation,
          provenance: {
            scenarioHash: checksum(continuation.scenario), engineVersion: ENGINE_VERSION, policyVersions,
            configurationHash: checksum({ rules: continuation.scenario.rules ?? {}, policyVersions }),
            seed: continuation.scenario.seed,
            platform: { node: process.version, os: process.platform, architecture: process.arch },
          },
        };
        simulations.set(session.id, session);
        context.experiments.telemetry.record("simulation-run", {
          simulationId: session.id, scenarioHash: session.provenance.scenarioHash,
          configurationHash: session.provenance.configurationHash, pulses: 0,
          durationMs: Math.max(0, globalThis.performance.now() - simulationStarted), completed: false,
        });
        const value = simulationView(session);
        rememberMutation(mutation.key, mutation.requestHash, 201, value);
        return json(response, 201, value);
      }
      if (segments[0] === "v1" && segments[1] === "simulations" && segments[2]) {
        const session = simulations.get(segments[2]);
        if (!session) throw new ApiError(404, "simulation_not_found", "simulation does not exist");
        if (request.method === "GET" && segments.length === 3) return json(response, 200, simulationView(session));
        const artifact = session.run ?? session.continuation!;
        if (request.method === "GET" && segments[3] === "artifact" && segments.length === 4) {
          if (!session.run) throw new ApiError(409, "simulation_not_complete", "simulation has not completed");
          return json(response, 200, session.run);
        }
        if (request.method === "GET" && segments[3] === "events" && segments.length === 4) {
          return json(response, 200, { items: artifact.events, total: artifact.events.length });
        }
        if (request.method === "GET" && segments[3] === "traces" && segments[4] && segments.length === 5) {
          const tick = Number(segments[4]);
          if (!Number.isInteger(tick) || tick < 0) throw new ApiError(400, "invalid_tick", "trace tick must be a non-negative integer");
          const items = artifact.traces.filter(trace => trace.tick === tick);
          return json(response, 200, { tick, items });
        }
        if (request.method === "POST" && segments[3] === "steps" && segments.length === 4) {
          const input = requestRecord(await body(request), ["count"]);
          const mutation = mutationKey(request, url.pathname, input);
          if (mutation.prior) return json(response, mutation.prior.status, mutation.prior.value);
          if (session.run) throw new ApiError(409, "simulation_complete", "simulation has already completed");
          const count = input.count === undefined ? 1 : Number(input.count);
          if (!Number.isInteger(count) || count < 1 || count > 1_000) throw new ApiError(422, "validation_failed", "count must be an integer from 1 to 1000");
          const priorEventCount = session.continuation!.events.length;
          const priorTick = session.continuation!.state.tick;
          const simulationStarted = globalThis.performance.now();
          const advanced = advanceContinuation(session.continuation!, count);
          if ("finalState" in advanced) { session.run = advanced; delete session.continuation; }
          else session.continuation = advanced;
          const completedArtifact = session.run ?? session.continuation!;
          const value = simulationView(session, completedArtifact.events.slice(priorEventCount));
          context.experiments.telemetry.record("simulation-run", {
            simulationId: session.id, scenarioHash: session.provenance.scenarioHash,
            configurationHash: session.provenance.configurationHash, pulses: value.tick - priorTick,
            durationMs: Math.max(0, globalThis.performance.now() - simulationStarted), completed: value.done,
          });
          rememberMutation(mutation.key, mutation.requestHash, 200, value);
          return json(response, 200, value);
        }
        if (request.method === "POST" && segments[3] === "run" && segments.length === 4) {
          const input = requestRecord(await body(request), []);
          const mutation = mutationKey(request, url.pathname, input);
          if (mutation.prior) return json(response, mutation.prior.status, mutation.prior.value);
          const priorEventCount = artifact.events.length;
          const priorTick = session.continuation?.state.tick ?? session.run!.finalState.tick;
          const simulationStarted = globalThis.performance.now();
          if (!session.run) { session.run = resumeSimulation(session.continuation!); delete session.continuation; }
          const value = simulationView(session, session.run.events.slice(priorEventCount));
          context.experiments.telemetry.record("simulation-run", {
            simulationId: session.id, scenarioHash: session.provenance.scenarioHash,
            configurationHash: session.provenance.configurationHash, pulses: value.tick - priorTick,
            durationMs: Math.max(0, globalThis.performance.now() - simulationStarted), completed: true,
          });
          rememberMutation(mutation.key, mutation.requestHash, 200, value);
          return json(response, 200, value);
        }
        if (request.method === "POST" && segments[3] === "branches" && segments.length === 4) {
          const input = requestRecord(await body(request), ["tick"]);
          const mutation = mutationKey(request, url.pathname, input);
          if (mutation.prior) return json(response, mutation.prior.status, mutation.prior.value);
          const tick = Number(input.tick);
          const finalTick = session.run?.finalState.tick ?? session.continuation!.state.tick;
          if (!Number.isInteger(tick) || tick < 0 || tick >= finalTick) {
            throw new ApiError(422, "validation_failed", "branch tick must be a non-terminal pulse before the source simulation's current tick");
          }
          let continuation: SimulationContinuation;
          try { continuation = captureContinuation(artifact.scenario, tick); }
          catch (error) { throw new ApiError(422, "validation_failed", error instanceof Error ? error.message : String(error)); }
          if (simulations.size >= MAX_SIMULATION_SESSIONS) throw new ApiError(429, "simulation_limit_reached", "too many in-memory simulation sessions");
          const branch: SimulationSession = {
            id: randomUUID(), createdAt: Date.now(), continuation,
            provenance: { ...session.provenance, parentSimulationId: session.id, branchTick: tick },
          };
          simulations.set(branch.id, branch);
          const value = simulationView(branch);
          rememberMutation(mutation.key, mutation.requestHash, 201, value);
          return json(response, 201, value);
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/experiments") {
        const key = request.headers["idempotency-key"];
        if (typeof key !== "string" || key.length < 1 || key.length > 160) {
          throw new ApiError(400, "idempotency_key_required", "Idempotency-Key header is required");
        }
        const experiment = await body(request) as ExperimentRequest;
        const job = enqueueExperiment(ensureLocalExperimentProject(), key, experiment);
        if (context.autoRun !== false && job.status === "queued") queueMicrotask(() => { void context.experiments.drain(); });
        return json(response, 202, job);
      }
      if (request.method === "GET" && segments[0] === "v1" && segments[1] === "experiments" && segments[2]) {
        const job = context.metadata.getJob(segments[2]);
        if (!job || job.projectId !== LOCAL_EXPERIMENT_PROJECT_ID) {
          throw new ApiError(404, "experiment_not_found", "experiment does not exist");
        }
        if (segments.length === 3) {
          return json(response, 200, { ...job, episodes: context.metadata.episodes(job.id) });
        }
        if (segments.length === 4 && segments[3] === "artifacts") {
          if (job.status !== "completed" || !job.resultHash) throw new ApiError(409, "job_not_complete", "experiment is not complete");
          const result = await context.experiments.result(job.id);
          return json(response, 200, {
            experimentId: job.id,
            resultHash: job.resultHash,
            manifest: result,
            artifacts: result.episodes.map(episode => ({
              hash: episode.artifactHash, kind: "run-log", variantId: episode.variantId, seed: episode.seed,
            })),
          });
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/projects") {
        const input = await body(request) as Record<string, unknown>;
        const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : "Untitled project";
        if (name.length > 160 || lintProhibitedContent({ name }).length > 0) {
          throw new ApiError(422, "validation_failed", "project name is not accepted");
        }
        const id = randomUUID();
        context.metadata.createProject(id, name);
        return json(response, 201, { id, name });
      }
      if (segments[0] === "v1" && segments[1] === "projects" && segments[2]) {
        const projectId = segments[2];
        requireProject(context, projectId);
        if (request.method === "POST" && (segments[3] === "experiments" || segments[3] === "runs")) {
          const key = request.headers["idempotency-key"];
          if (typeof key !== "string" || key.length < 1 || key.length > 160) {
            throw new ApiError(400, "idempotency_key_required", "Idempotency-Key header is required");
          }
          const input = await body(request) as Record<string, unknown>;
          const experiment = segments[3] === "runs"
            ? (() => {
                const scenario = input.scenario as ScenarioSpec | undefined;
                if (!scenario || typeof scenario.seed !== "number") throw new ApiError(422, "validation_failed", "run requires a valid scenario");
                return { scenario, variants: [{ id: "run", policyId: "safety-first" as const, actorIds: [] }], seeds: [scenario.seed] };
              })()
            : input as unknown as ExperimentRequest;
          const job = enqueueExperiment(projectId, key, experiment);
          if (context.autoRun !== false && job.status === "queued") queueMicrotask(() => { void context.experiments.drain(); });
          return json(response, 202, job);
        }
        if (request.method === "GET" && segments[3] === "jobs" && !segments[4]) {
          const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
          let after: { createdAt: number; id: string } | undefined;
          const cursor = url.searchParams.get("cursor");
          if (cursor) {
            try {
              const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { createdAt: number; id: string };
              if (!Number.isFinite(parsed.createdAt) || typeof parsed.id !== "string") throw new Error();
              after = parsed;
            } catch { throw new ApiError(400, "invalid_cursor", "cursor is invalid"); }
          }
          const jobs = context.metadata.listJobs(projectId, limit + 1, after);
          const hasMore = jobs.length > limit;
          const items = jobs.slice(0, limit);
          const last = hasMore ? items.at(-1) : undefined;
          const nextCursor = last
            ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString("base64url")
            : undefined;
          return json(response, 200, { items, ...(nextCursor ? { nextCursor } : {}) });
        }
        if (segments[3] === "jobs" && segments[4]) {
          const job = context.metadata.getJob(segments[4]);
          if (!job || job.projectId !== projectId) throw new ApiError(404, "job_not_found", "job does not exist");
          if (request.method === "DELETE") {
            context.metadata.requestCancellation(job.id);
            return json(response, 202, context.metadata.getJob(job.id));
          }
          if (request.method === "GET" && segments[5] === "export") {
            if (job.status !== "completed") throw new ApiError(409, "job_not_complete", "job is not complete");
            const result = await context.experiments.result(job.id);
            if (url.searchParams.get("format") === "csv") {
              const bytes = Buffer.from(experimentCsv(result));
              response.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-length": bytes.byteLength });
              return response.end(bytes);
            }
            return json(response, 200, result);
          }
          if (request.method === "GET") return json(response, 200, { ...job, episodes: context.metadata.episodes(job.id) });
        }
        if (request.method === "GET" && segments[3] === "artifacts" && segments[4]) {
          try {
            const bytes = await context.artifacts.read(projectId, segments[4]);
            response.writeHead(200, { "content-type": "application/json", "content-length": bytes.byteLength });
            return response.end(bytes);
          } catch {
            throw new ApiError(404, "artifact_not_found", "artifact is absent or not authorized for this project");
          }
        }
      }
      throw new ApiError(404, "not_found", "route does not exist");
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError(500, "internal_error", "internal server error");
      json(response, apiError.status, { error: { code: apiError.code, message: apiError.message } });
    }
  });
}

export async function listenLocal(server: ReturnType<typeof createApiServer>, port = 0): Promise<{ host: string; port: number }> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return { host: "127.0.0.1", port: address.port };
}
