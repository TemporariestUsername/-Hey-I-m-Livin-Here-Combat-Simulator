import assert from "node:assert/strict";
import test from "node:test";
import { buildTempoProfile, INTERRUPT_MARGIN, resolveInterrupts } from "../packages/engine/src/index.ts";
import type { ActorState } from "../packages/schema/src/index.ts";

const actor = (id: string, readiness: number): ActorState => ({
  id, side: id === "alpha" ? "a" : "b", position: { x: 1, y: 1 }, readiness,
  stamina: 1, resolve: 1, active: true, intent: "commit", shock: 0,
});

test("tempo exposes its deterministic terms and bounded noise", () => {
  const profile = buildTempoProfile(actor("alpha", 0.8), 0.75);
  assert.deepEqual(profile, {
    actorId: "alpha", tempo: 1.025, randomSample: 0.75,
    terms: { readiness: 0.8, stamina: 0.2, shock: 0, boundedNoise: 0.025 },
  });
  assert.throws(() => buildTempoProfile(actor("alpha", 0.8), 1), /Tempo random sample/);
});

test("interrupts require mutual visibility, opposing commitments, and the configured margin", () => {
  const actors = [actor("bravo", 0.4), actor("alpha", 0.9)];
  const visible = new Map<string, readonly string[]>([["alpha", ["bravo"]], ["bravo", ["alpha"]]]);
  const tempos = new Map(actors.map(item => [item.id, buildTempoProfile(item, 0.5)]));
  assert.deepEqual(resolveInterrupts(actors, visible, tempos), [
    { actorId: "alpha", targetId: "bravo", eligible: true, margin: 0.5, requiredMargin: INTERRUPT_MARGIN },
    { actorId: "bravo", targetId: "alpha", eligible: false, margin: -0.5, requiredMargin: INTERRUPT_MARGIN },
  ]);
  assert.deepEqual(resolveInterrupts(actors, new Map([["alpha", ["bravo"]]]), tempos), []);
});
