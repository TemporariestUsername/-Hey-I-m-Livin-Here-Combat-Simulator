import { Pcg32 } from "../../engine/src/prng.ts";

export interface Interval {
  low: number;
  high: number;
}

export interface PairedSummary {
  count: number;
  leftMean: number;
  rightMean: number;
  meanDifference: number;
  medianDifference: number;
  pairedStandardizedEffect: number | null;
  bootstrap95: Interval;
}

function finite(values: readonly number[]): void {
  if (values.length === 0 || values.some(value => !Number.isFinite(value))) {
    throw new Error("statistics require one or more finite values");
  }
}

export function mean(values: readonly number[]): number {
  finite(values);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: readonly number[]): number {
  finite(values);
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

export function percentile(values: readonly number[], probability: number): number {
  finite(values);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("percentile probability must be between zero and one");
  }
  const ordered = [...values].sort((left, right) => left - right);
  const index = (ordered.length - 1) * probability;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return ordered[lower]! + (ordered[Math.min(lower + 1, ordered.length - 1)]! - ordered[lower]!) * fraction;
}

export function sampleStandardDeviation(values: readonly number[]): number {
  finite(values);
  if (values.length < 2) return 0;
  const center = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1));
}

export function deterministicBootstrapMeanInterval(
  values: readonly number[],
  options: { samples?: number; seed?: number; confidence?: number } = {},
): Interval {
  finite(values);
  const samples = options.samples ?? 4_000;
  const confidence = options.confidence ?? 0.95;
  if (!Number.isSafeInteger(samples) || samples < 100) throw new Error("bootstrap samples must be an integer of at least 100");
  if (confidence <= 0 || confidence >= 1) throw new Error("bootstrap confidence must be between zero and one");
  const rng = new Pcg32(options.seed ?? 0x43414c, 23);
  const estimates: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(rng.nextFloat() * values.length)]!;
    }
    estimates.push(sum / values.length);
  }
  const tail = (1 - confidence) / 2;
  return { low: percentile(estimates, tail), high: percentile(estimates, 1 - tail) };
}

export function pairedSummary(
  left: readonly number[],
  right: readonly number[],
  options: { bootstrapSamples?: number; seed?: number } = {},
): PairedSummary {
  finite(left);
  finite(right);
  if (left.length !== right.length) throw new Error("paired samples must have equal lengths");
  const differences = left.map((value, index) => value - right[index]!);
  const deviation = sampleStandardDeviation(differences);
  const difference = mean(differences);
  return {
    count: left.length,
    leftMean: mean(left),
    rightMean: mean(right),
    meanDifference: difference,
    medianDifference: median(differences),
    pairedStandardizedEffect: deviation === 0 ? null : difference / deviation,
    bootstrap95: deterministicBootstrapMeanInterval(differences, {
      samples: options.bootstrapSamples,
      seed: options.seed,
    }),
  };
}
