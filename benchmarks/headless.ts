import { readFile } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
import { performance } from "node:perf_hooks";
import { runSimulation } from "../packages/engine/src/index.ts";
import type { ScenarioSpec } from "../packages/schema/src/index.ts";

const fixture = new URL("../packages/scenarios/fixtures/benchmark-32-actors.json", import.meta.url);
const scenario = JSON.parse(await readFile(fixture, "utf8")) as ScenarioSpec;
const warmups = 1;
const samples = 5;
for (let index = 0; index < warmups; index += 1) runSimulation(scenario);
const durations: number[] = [];
let expectedChecksum: string | undefined;
let expectedEvents: number | undefined;
for (let index = 0; index < samples; index += 1) {
  const started = performance.now();
  const log = runSimulation(scenario);
  durations.push(performance.now() - started);
  expectedChecksum ??= log.finalChecksum;
  expectedEvents ??= log.events.length;
  if (log.finalChecksum !== expectedChecksum || log.events.length !== expectedEvents) throw new Error("Benchmark runs diverged");
}
const ordered = [...durations].sort((a, b) => a - b);
const percentile = (fraction: number): number => ordered[Math.ceil(ordered.length * fraction) - 1]!;
const report = {
  fixture: scenario.id, actors: scenario.actors.length, pulses: scenario.maxTicks, warmups, samples,
  medianMs: Number(percentile(0.5).toFixed(3)), p95Ms: Number(percentile(0.95).toFixed(3)),
  budgetP95Ms: 1000, checksum: expectedChecksum, events: expectedEvents,
  runtime: process.version, platform: platform(), architecture: arch(), cpu: cpus()[0]?.model ?? "unknown",
};
console.log(JSON.stringify({ ...report, budgetMet: report.p95Ms < report.budgetP95Ms }, null, 2));
