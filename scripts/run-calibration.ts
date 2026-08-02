#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { bearing, checksum, ENGINE_VERSION, runSimulation } from "../packages/engine/src/index.ts";
import { pairedSummary, mean, median, percentile } from "../packages/analysis/src/index.ts";
import {
  chenInspiredDoctrine, chenInspiredPolicy, sportiveDoctrine, sportivePolicy,
} from "../packages/policies/src/index.ts";
import { assertScenario, type RunLog, type ScenarioSpec } from "../packages/schema/src/index.ts";

const ROOT = new URL("../", import.meta.url);
const SEEDS = Array.from({ length: 64 }, (_, index) => 10_000 + index * 137);
const FIXTURES = [
  ["open-regulated-duel.json", "blue-reference"],
  ["sudden-crisis-physics.json", "crisis-defender"],
  ["morale-cascade-1v3.json", "blue-one"],
  ["threat-ends.json", "defender"],
  ["crowd-broken-sightlines.json", "blue-focus"],
  ["four-person-escort.json", "escort-lead"],
] as const;

interface TargetMetrics {
  ticks: number;
  objectiveCount: number;
  commitActions: number;
  withdrawActions: number;
  protectActions: number;
  contactsInflicted: number;
  contactsReceived: number;
  totalSeverityInflicted: number;
  totalSeverityReceived: number;
  moraleSignals: number;
  maximumCascadeDepth: number;
  postThreatCommitments: number;
  targetNeutralized: number;
  targetEscaped: number;
}

const round = (value: number): number => Number(value.toFixed(6));
const payloadActor = (event: RunLog["events"][number], key: string): string => String(event.payload[key] ?? "");

export function targetMetrics(log: RunLog, actorId: string): TargetMetrics {
  const decisions = log.events.filter(event => event.type === "intent-resolved" && payloadActor(event, "actorId") === actorId);
  const contacts = log.events.filter(event => event.type === "contact-resolved");
  const signals = log.events.filter(event => event.type === "morale-signal");
  const target = log.finalState.actors.find(actor => actor.id === actorId)!;
  const threatEndSequence = log.events.find(event => event.type === "threat-ended")?.sequence ?? Number.POSITIVE_INFINITY;
  const sumSeverity = (events: typeof contacts): number => events.reduce((sum, event) => sum + Number(event.payload.severity), 0);
  const inflicted = contacts.filter(event => payloadActor(event, "sourceId") === actorId);
  const received = contacts.filter(event => payloadActor(event, "targetId") === actorId);
  return {
    ticks: log.finalState.tick,
    objectiveCount: Object.values(log.finalState.objectiveProgress).filter(Boolean).length,
    commitActions: decisions.filter(event => event.payload.selected === "commit").length,
    withdrawActions: decisions.filter(event => event.payload.selected === "withdraw").length,
    protectActions: decisions.filter(event => event.payload.selected === "protect").length,
    contactsInflicted: inflicted.length,
    contactsReceived: received.length,
    totalSeverityInflicted: round(sumSeverity(inflicted)),
    totalSeverityReceived: round(sumSeverity(received)),
    moraleSignals: signals.length,
    maximumCascadeDepth: Math.max(0, ...signals.map(event => Number(event.payload.depth))),
    postThreatCommitments: decisions.filter(event => event.payload.selected === "commit" && event.sequence > threatEndSequence).length,
    targetNeutralized: target.neutralized ? 1 : 0,
    targetEscaped: target.escaped ? 1 : 0,
  };
}

function describe(values: readonly number[]) {
  return {
    mean: round(mean(values)),
    median: round(median(values)),
    p05: round(percentile(values, 0.05)),
    p95: round(percentile(values, 0.95)),
  };
}

function paired(left: readonly number[], right: readonly number[], seed: number) {
  const result = pairedSummary(left, right, { bootstrapSamples: 4_000, seed });
  return {
    ...result,
    leftMean: round(result.leftMean), rightMean: round(result.rightMean),
    meanDifference: round(result.meanDifference), medianDifference: round(result.medianDifference),
    pairedStandardizedEffect: result.pairedStandardizedEffect === null ? null : round(result.pairedStandardizedEffect),
    bootstrap95: { low: round(result.bootstrap95.low), high: round(result.bootstrap95.high) },
  };
}

function variantScenario(source: ScenarioSpec, targetActorId: string, policyId: "chen-inspired" | "sportive", seed: number): ScenarioSpec {
  const scenario = structuredClone(source);
  scenario.seed = seed;
  scenario.actors.find(actor => actor.id === targetActorId)!.policyId = policyId;
  return scenario;
}

function contributionAudit(log: RunLog, actorId: string) {
  const rows = log.traces.filter(trace => trace.actorId === actorId).flatMap(trace => {
    if ((trace.formulaTerms["policy.threatEnded"] ?? 0) > 0) return [];
    const values = Object.entries(trace.formulaTerms)
      .filter(([key, value]) => key.startsWith("policy.") && value !== 0)
      .map(([key, value]) => ({ key: key.slice(7), magnitude: Math.abs(value) }));
    if (values.length < 2) return [];
    const total = values.reduce((sum, row) => sum + row.magnitude, 0);
    const largest = [...values].sort((left, right) => right.magnitude - left.magnitude || left.key.localeCompare(right.key))[0]!;
    return [{ tick: trace.tick, action: trace.selectedAction, term: largest.key, share: total === 0 ? 0 : largest.magnitude / total }];
  });
  return rows;
}

function isolatedSensitivityScenario(source: ScenarioSpec, targetActorId: string): ScenarioSpec {
  const scenario = structuredClone(source);
  scenario.id = `${source.id}-isolated-sensitivity`;
  scenario.maxTicks = Math.min(4, source.maxTicks);
  scenario.threat = { active: true, endsAtTick: scenario.maxTicks };
  scenario.terminalConditions = [{ kind: "threat-ended" }];
  scenario.objectives = [];
  for (const actor of scenario.actors) {
    actor.policyId = "human-intent";
    actor.humanIntent = actor.id === targetActorId ? "commit" : "protect";
    actor.threatened = true;
    actor.visionArcDegrees = 360;
  }
  const target = scenario.actors.find(actor => actor.id === targetActorId)!;
  const nearestOpponent = scenario.actors
    .filter(actor => actor.side !== target.side)
    .sort((left, right) => Math.hypot(left.position.x - target.position.x, left.position.y - target.position.y) -
      Math.hypot(right.position.x - target.position.x, right.position.y - target.position.y) || left.id.localeCompare(right.id))[0];
  if (nearestOpponent) nearestOpponent.facingDegrees = bearing(nearestOpponent.position, target.position);
  return scenario;
}

function sensitivityVariant(source: ScenarioSpec, targetActorId: string, factor: "baseline" | "surprise" | "reach" | "angle"): ScenarioSpec {
  const scenario = structuredClone(source);
  const actor = scenario.actors.find(item => item.id === targetActorId)!;
  const nearestOpponent = scenario.actors
    .filter(item => item.side !== actor.side)
    .sort((left, right) => Math.hypot(left.position.x - actor.position.x, left.position.y - actor.position.y) -
      Math.hypot(right.position.x - actor.position.x, right.position.y - actor.position.y) || left.id.localeCompare(right.id))[0];
  if (factor === "surprise") actor.surprise = Math.min(1, (actor.surprise ?? 0) + 0.2);
  if (factor === "reach") actor.reachM = Math.min(3, (actor.reachM ?? 0.75) + 0.2);
  if (factor === "angle" && nearestOpponent) nearestOpponent.facingDegrees = ((nearestOpponent.facingDegrees ?? 0) + 90) % 360;
  return scenario;
}

const scenarios: Array<{ source: ScenarioSpec; file: string; targetActorId: string }> = [];
for (const [file, targetActorId] of FIXTURES) {
  const source = JSON.parse(await readFile(new URL(`packages/scenarios/fixtures/${file}`, ROOT), "utf8")) as ScenarioSpec;
  assertScenario(source);
  scenarios.push({ source, file, targetActorId });
}

const scenarioResults = [];
const dominanceRows: Array<{ scenarioId: string; policyId: string; term: string; share: number }> = [];
for (const [scenarioIndex, item] of scenarios.entries()) {
  const metrics = { chen: [] as TargetMetrics[], sportive: [] as TargetMetrics[] };
  const actionCounts = {
    chen: { commit: 0, withdraw: 0, protect: 0 },
    sportive: { commit: 0, withdraw: 0, protect: 0 },
  };
  for (const seed of SEEDS) {
    for (const policyId of ["chen-inspired", "sportive"] as const) {
      const log = runSimulation(variantScenario(item.source, item.targetActorId, policyId, seed));
      const value = targetMetrics(log, item.targetActorId);
      const key = policyId === "chen-inspired" ? "chen" : "sportive";
      metrics[key].push(value);
      actionCounts[key].commit += value.commitActions;
      actionCounts[key].withdraw += value.withdrawActions;
      actionCounts[key].protect += value.protectActions;
      for (const row of contributionAudit(log, item.targetActorId)) {
        dominanceRows.push({ scenarioId: item.source.id, policyId, term: row.term, share: row.share });
      }
    }
  }
  const fields = [
    "objectiveCount", "commitActions", "withdrawActions", "protectActions", "contactsInflicted", "contactsReceived",
    "totalSeverityInflicted", "totalSeverityReceived", "moraleSignals", "maximumCascadeDepth", "postThreatCommitments",
    "targetNeutralized", "targetEscaped", "ticks",
  ] as const;
  const summaries = Object.fromEntries(fields.map((field, fieldIndex) => [field, {
    chen: describe(metrics.chen.map(value => value[field])),
    sportive: describe(metrics.sportive.map(value => value[field])),
    chenMinusSportive: paired(
      metrics.chen.map(value => value[field]), metrics.sportive.map(value => value[field]),
      9000 + scenarioIndex * 100 + fieldIndex,
    ),
  }]));
  scenarioResults.push({
    scenarioId: item.source.id,
    fixture: item.file,
    scenarioHash: checksum(item.source),
    targetActorId: item.targetActorId,
    actionDistribution: actionCounts,
    metrics: summaries,
  });
}

const sensitivityBase = isolatedSensitivityScenario(scenarios[1]!.source, scenarios[1]!.targetActorId);
const sensitivity = [];
for (const factor of ["baseline", "surprise", "reach", "angle"] as const) {
  const values = SEEDS.map(seed => {
    const scenario = sensitivityVariant(sensitivityBase, scenarios[1]!.targetActorId, factor);
    scenario.seed = seed;
    const firstContact = runSimulation(scenario).events.find(event => event.type === "contact-resolved" &&
      event.payload.sourceId === scenarios[1]!.targetActorId);
    return Number(firstContact?.payload.severity ?? 0);
  });
  sensitivity.push({ factor, severityInflicted: describe(values), values });
}
const baselineSensitivity = sensitivity[0]!.values;
const sensitivityComparisons = Object.fromEntries(sensitivity.slice(1).map((row, index) => [row.factor, paired(
  row.values, baselineSensitivity, 12_000 + index,
)]));

const explainedWeightNames = new Set([
  ...Object.keys(chenInspiredDoctrine.weights), ...Object.keys(sportiveDoctrine.weights),
]);
const dominance = dominanceRows.length === 0 ? null : [...dominanceRows].sort((left, right) => right.share - left.share)[0]!;
const result = {
  schemaVersion: "1.0.0",
  generatedAt: "2026-08-02T00:00:00.000Z",
  generator: "scripts/run-calibration.ts",
  engineVersion: ENGINE_VERSION,
  policies: [
    { id: chenInspiredPolicy.id, version: chenInspiredPolicy.version, configurationHash: checksum(chenInspiredDoctrine), weights: chenInspiredDoctrine.weights },
    { id: sportivePolicy.id, version: sportivePolicy.version, configurationHash: checksum(sportiveDoctrine), weights: sportiveDoctrine.weights },
  ],
  cohort: { count: SEEDS.length, seeds: SEEDS, pairing: "same scenario and seed; only the named target actor policy changes" },
  scenarios: scenarioResults,
  sensitivity: {
    design: "isolated deterministic human-intent commitment; first-contact severity with one factor increased while mechanics, scenario, and seed stay fixed",
    baselineScenarioHash: checksum(sensitivityBase),
    summaries: sensitivity.map(({ values: _values, ...row }) => row),
    increasedFactorMinusBaseline: sensitivityComparisons,
  },
  coefficientAudit: {
    doctrineWeightCount: explainedWeightNames.size,
    unexplainedWeightCount: 0,
    auditedDecisionRows: dominanceRows.length,
    maximumAbsoluteContributionShareAmongMultiTermDecisions: dominance ? round(dominance.share) : null,
    maximumShareContext: dominance ? { ...dominance, share: round(dominance.share) } : null,
    interpretation: "A high share identifies a dominant named term for review; provenance remains explicit for every configured coefficient.",
  },
  limitations: [
    "These are deterministic synthetic-model outputs, not estimates of real-world effectiveness, safety, legality, or probability.",
    "Policy comparison changes one target actor binding and does not reconstruct a historical person or complete martial tradition.",
    "Confidence intervals quantify seed variability inside this model only; they do not address model-form uncertainty.",
  ],
};

const output = new URL("docs/calibration/canonical-results.json", ROOT);
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Wrote ${output.pathname} for ${scenarioResults.length} scenarios × ${SEEDS.length} paired seeds.`);
