import assert from "node:assert/strict";
import test from "node:test";
import {
  deterministicBootstrapMeanInterval, mean, median, pairedSummary, percentile, sampleStandardDeviation,
} from "../packages/analysis/src/statistics.ts";

test("descriptive statistics handle ordered and unordered finite cohorts", () => {
  assert.equal(mean([4, 1, 3, 2]), 2.5);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(percentile([0, 10, 20], 0.25), 5);
  assert.equal(sampleStandardDeviation([2, 2, 2]), 0);
  assert.throws(() => mean([]));
  assert.throws(() => percentile([1], 1.1));
});

test("bootstrap confidence intervals are deterministic and cover a constant mean", () => {
  const first = deterministicBootstrapMeanInterval([1, 2, 3, 4, 5], { samples: 2_000, seed: 91 });
  const second = deterministicBootstrapMeanInterval([1, 2, 3, 4, 5], { samples: 2_000, seed: 91 });
  assert.deepEqual(first, second);
  assert.deepEqual(deterministicBootstrapMeanInterval([7, 7, 7], { samples: 200 }), { low: 7, high: 7 });
  assert.ok(first.low < 3 && first.high > 3);
});

test("paired summaries preserve pairing and report standardized effects", () => {
  const result = pairedSummary([4, 5, 8, 9], [2, 4, 4, 7], { bootstrapSamples: 1_000, seed: 7 });
  assert.equal(result.count, 4);
  assert.equal(result.meanDifference, 2.25);
  assert.ok((result.pairedStandardizedEffect ?? 0) > 1);
  assert.ok(result.bootstrap95.low > 0);
  assert.throws(() => pairedSummary([1], [1, 2]));
});
