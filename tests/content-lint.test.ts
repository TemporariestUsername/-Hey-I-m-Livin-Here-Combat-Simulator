import assert from "node:assert/strict";
import test from "node:test";
import { lintProhibitedContent, validateScenario } from "../packages/schema/src/index.ts";

test("content lint rejects prohibited fields recursively and normalizes field names", () => {
  const result = lintProhibitedContent({ actors: [{ configuration: { "Technique-Steps": [] } }] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["actors[0].configuration.Technique-Steps is prohibited by the content policy"]);
});

test("scenario validation fails closed when prohibited fields accompany valid data", () => {
  const scenario = {
    schemaVersion: "1.0.0", id: "unsafe", name: "Rejected structure", seed: 1, pulseMs: 100, maxTicks: 1,
    map: { width: 10, height: 10 }, threat: { active: true },
    actors: [{ id: "a", side: "a", position: { x: 1, y: 1 }, readiness: 1, stamina: 1, resolve: 1 }],
    metadata: { anatomicalTarget: "not accepted" },
  };
  const result = validateScenario(scenario);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("metadata.anatomicalTarget is prohibited by the content policy"));
});

test("content lint rejects markup and remote references", () => {
  assert.equal(lintProhibitedContent({ name: "<script>ignored()</script>" }).valid, false);
  assert.equal(lintProhibitedContent({ asset: "https://example.invalid/image" }).valid, false);
});
