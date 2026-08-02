#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { performance } from "node:perf_hooks";
import { checksum, runSimulation } from "../packages/engine/src/index.ts";
import { assertScenario, parseJsonDocument, type ScenarioSpec } from "../packages/schema/src/index.ts";

const fixtureUrl = new URL("./fixtures/benchmark-32-actors.json", import.meta.url);
const sampleArg = process.argv.find(argument => argument.startsWith("--samples="));
const sampleCount = sampleArg ? Number(sampleArg.split("=")[1]) : 10;
if (!Number.isInteger(sampleCount) || sampleCount < 5 || sampleCount > 100) {
  throw new RangeError("--samples must be an integer from 5 to 100");
}

const parsed = parseJsonDocument(await readFile(fixtureUrl, "utf8"));
assertScenario(parsed);
const scenario: ScenarioSpec = parsed;

function timedRun(): { durationMs: number; artifactHash: string; eventCount: number; traceCount: number; finalChecksum: string } {
  const started = performance.now();
  const log = runSimulation(scenario);
  const durationMs = performance.now() - started;
  return {
    durationMs,
    artifactHash: checksum(log),
    eventCount: log.events.length,
    traceCount: log.traces.length,
    finalChecksum: log.finalChecksum,
  };
}

timedRun();
const samples = Array.from({ length: sampleCount }, () => timedRun());
const artifactHashes = new Set(samples.map(sample => sample.artifactHash));
const eventCounts = new Set(samples.map(sample => sample.eventCount));
const traceCounts = new Set(samples.map(sample => sample.traceCount));
const finalChecksums = new Set(samples.map(sample => sample.finalChecksum));
if (artifactHashes.size !== 1 || eventCounts.size !== 1 || traceCounts.size !== 1 || finalChecksums.size !== 1) {
  throw new Error("benchmark runs diverged");
}

const durations = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
const percentile = (fraction: number): number => durations[Math.ceil(durations.length * fraction) - 1]!;
const medianMs = percentile(0.5);
const p95Ms = percentile(0.95);
const result = {
  schemaVersion: "1.0.0",
  fixture: "benchmarks/fixtures/benchmark-32-actors.json",
  actors: scenario.actors.length,
  pulses: scenario.maxTicks,
  physicsEnabled: scenario.rules?.physics?.enabled === true,
  samples: sampleCount,
  warmups: 1,
  eventCount: samples[0]!.eventCount,
  traceCount: samples[0]!.traceCount,
  artifactHash: samples[0]!.artifactHash,
  finalChecksum: samples[0]!.finalChecksum,
  medianMs: Number(medianMs.toFixed(3)),
  p95Ms: Number(p95Ms.toFixed(3)),
  minMs: Number(durations[0]!.toFixed(3)),
  maxMs: Number(durations.at(-1)!.toFixed(3)),
  phase2TargetMs: 1000,
  budgetMet: p95Ms < 1000,
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpu: cpus()[0]?.model ?? "unknown",
  },
  methodology: "One warm-up followed by independent full runs; median and nearest-rank p95. Artifact hash, event count, and final checksum must agree.",
};

console.log(JSON.stringify(result, null, 2));
