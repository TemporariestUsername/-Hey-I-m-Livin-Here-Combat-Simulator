import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checksum, runSimulation } from "../packages/engine/src/index.ts";
import { builtInPolicyIds } from "../packages/policies/src/index.ts";
import { assertScenario, type ScenarioSpec } from "../packages/schema/src/index.ts";

const root = new URL("../", import.meta.url);
const files = [
  "open-regulated-duel.json", "sudden-crisis-physics.json", "morale-cascade-1v3.json",
  "threat-ends.json", "crowd-broken-sightlines.json", "four-person-escort.json",
];
const load = async (file: string): Promise<ScenarioSpec> => JSON.parse(await readFile(
  new URL(`packages/scenarios/fixtures/${file}`, root), "utf8",
)) as ScenarioSpec;
const allNumbersFinite = (value: unknown): boolean => typeof value === "number"
  ? Number.isFinite(value)
  : Array.isArray(value)
    ? value.every(allNumbersFinite)
    : Boolean(value) && typeof value === "object"
      ? Object.values(value as Record<string, unknown>).every(allNumbersFinite)
      : true;

test("all six canonical fixtures are closed-schema valid, finite, and reproducible", async () => {
  const ids = new Set<string>();
  for (const file of files) {
    const scenario = await load(file);
    assertScenario(scenario);
    assert.ok(!ids.has(scenario.id));
    ids.add(scenario.id);
    const first = runSimulation(scenario);
    const second = runSimulation(scenario);
    assert.equal(first.finalChecksum, second.finalChecksum);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.ok(allNumbersFinite(first));
  }
  assert.equal(ids.size, 6);
});

test("the engine prevents every built-in policy from committing after the threat ends", async () => {
  const source = await load("threat-ends.json");
  for (const policyId of builtInPolicyIds()) {
    const scenario = structuredClone(source);
    const actor = scenario.actors.find(item => item.id === "defender")!;
    actor.policyId = policyId as NonNullable<typeof actor.policyId>;
    if (policyId === "human-intent") actor.humanIntent = "commit";
    const log = runSimulation(scenario);
    const threatEndSequence = log.events.find(event => event.type === "threat-ended")?.sequence ?? Number.POSITIVE_INFINITY;
    const postThreatCommit = log.events.some(event => event.type === "intent-resolved" && event.sequence > threatEndSequence &&
      event.payload.actorId === actor.id && event.payload.selected === "commit");
    assert.equal(postThreatCommit, false, policyId);
  }
});

test("committed calibration evidence matches fixtures and accepted qualitative bands", async () => {
  const result = JSON.parse(await readFile(new URL("docs/calibration/canonical-results.json", root), "utf8"));
  assert.equal(result.cohort.count, 64);
  assert.equal(result.scenarios.length, 6);
  for (const scenarioResult of result.scenarios) {
    const scenario = await load(scenarioResult.fixture);
    assert.equal(scenarioResult.scenarioHash, checksum(scenario));
    assert.equal(scenarioResult.metrics.postThreatCommitments.chen.mean, 0);
    assert.equal(scenarioResult.metrics.postThreatCommitments.sportive.mean, 0);
  }
  const duel = result.scenarios.find((scenario: { scenarioId: string }) => scenario.scenarioId === "open-regulated-duel");
  const crisis = result.scenarios.find((scenario: { scenarioId: string }) => scenario.scenarioId === "sudden-crisis-physics");
  const morale = result.scenarios.find((scenario: { scenarioId: string }) => scenario.scenarioId === "morale-cascade-1v3");
  const duelDifference = duel.metrics.totalSeverityInflicted.chenMinusSportive.meanDifference;
  const crisisDifference = crisis.metrics.totalSeverityInflicted.chenMinusSportive.meanDifference;
  assert.ok(duelDifference <= -0.15);
  assert.ok(crisisDifference >= -0.02);
  assert.ok(crisisDifference - duelDifference >= 0.13);
  assert.ok(Math.abs(duel.actionDistribution.chen.withdraw - duel.actionDistribution.sportive.withdraw) >= 512);
  assert.ok(morale.metrics.moraleSignals.chen.p05 >= 1);
  assert.ok(morale.metrics.maximumCascadeDepth.chen.p95 <= 2);
  for (const comparison of Object.values(result.sensitivity.increasedFactorMinusBaseline) as Array<{ bootstrap95: { low: number } }>) {
    assert.ok(comparison.bootstrap95.low >= 0);
  }
  assert.equal(result.coefficientAudit.unexplainedWeightCount, 0);
  assert.ok(result.coefficientAudit.maximumAbsoluteContributionShareAmongMultiTermDecisions < 0.6);
});
