import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createInitialState } from "../packages/engine/src/index.ts";
import {
  builtInPolicyIds,
  chenInspiredDoctrine,
  chenInspiredPolicy,
  sportiveDoctrine,
  sportivePolicy,
  type PolicyInput,
} from "../packages/policies/src/index.ts";
import type { ScenarioSpec } from "../packages/schema/src/index.ts";

const scenario = JSON.parse(
  await readFile(new URL("../packages/scenarios/fixtures/sudden-crisis-physics.json", import.meta.url), "utf8"),
) as ScenarioSpec;
const baseActor = createInitialState(scenario).actors.find(actor => actor.id === "crisis-defender")!;
const rng = { nextFloat: () => 0.5 };

function input(overrides: Partial<PolicyInput["actor"]>, visibleActorIds = ["immediate-threat"], threatActive = true): PolicyInput {
  return {
    actor: { ...baseActor, ...overrides },
    observation: { observerId: baseActor.id, visibleActorIds },
    threatActive,
  };
}

test("sportive and Chen-inspired policies diverge in an open symmetric exchange", () => {
  const openDuel = input({ surprise: 0, stance: "neutral" });
  assert.equal(sportivePolicy.decide(openDuel, rng).selected, "commit");
  assert.equal(chenInspiredPolicy.decide(openDuel, rng).selected, "withdraw");
});

test("Chen-inspired policy commits in a short high-surprise active-threat window", () => {
  const crisis = input({ surprise: 0.9, stance: "committed" });
  const decision = chenInspiredPolicy.decide(crisis, rng);
  assert.equal(decision.selected, "commit");
  const candidate = decision.candidates.find(item => item.action === "commit")!;
  assert.ok(candidate.contributions.asymmetry! > 0);
  assert.equal(candidate.contributions.symmetricDuelPenalty, 0);
});

test("both doctrines disengage after the threat ends", () => {
  const ended = input({ surprise: 1, stance: "committed" }, ["immediate-threat"], false);
  assert.equal(sportivePolicy.decide(ended, rng).selected, "withdraw");
  assert.equal(chenInspiredPolicy.decide(ended, rng).selected, "withdraw");
});

test("doctrine weights carry explicit source provenance", () => {
  for (const doctrine of [sportiveDoctrine, chenInspiredDoctrine]) {
    assert.match(doctrine.version, /^\d+\.\d+\.\d+$/);
    assert.ok(Object.keys(doctrine.weights).length > 0);
    for (const weight of Object.values(doctrine.weights)) {
      assert.ok(weight.value >= 0 && weight.value <= 1);
      assert.ok(["reference-derived", "inferred", "assumed", "calibrated"].includes(weight.provenance));
      assert.ok(weight.note.length > 0);
    }
  }
  assert.deepEqual(builtInPolicyIds(), ["chen-inspired", "human-intent", "random-valid", "safety-first", "sportive"]);
});
