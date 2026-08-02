# Phase 3 closure record

- **Closure date:** 2026-08-02
- **Engine version:** 0.3.0
- **Scenario schema:** 1.2.0
- **Status:** complete

## Deliverable evidence

| Deliverable | Evidence | Result |
|---|---|---|
| Engagement gates and threat transitions | Engine-owned active-threat gate plus scheduled transition tests | Complete |
| Individual morale | Fear, hysteretic steady/shaken/frozen/routing/recovering states and recovery | Complete |
| Squad cohesion | Versioned squad configuration/state, leader status, routed count and bounded cohesion updates | Complete |
| Bounded cascades | Stable-snapshot, distance-falloff, capped, finite-depth same-side signal propagation | Complete |
| Exits and routing | Closed exit schema, stable nearest-exit choice, routing override, escape state and evacuation objective | Complete |
| Five policy adapters | Safety-first, random-valid, sportive, Chen-inspired and human-intent adapters | Complete |
| Provenance-tagged weights | Doctrine weights carry source/inference/assumption/calibration provenance and notes | Complete |
| Complete explanations | Selected policy contributions, random samples, physics terms and effect IDs in each actor/pulse trace | Complete |

## Exit-criterion evidence

- `tests/doctrines.test.ts` proves sportive/Chen-inspired distinctiveness, crisis behavior, post-threat disengagement and coefficient provenance.
- `tests/morale.test.ts` proves bounded cascade depth, leader resistance, squad-cohesion response, actor-order independence, replay, routing/escape, evacuation and human-intent gate enforcement.
- `packages/scenarios/fixtures/morale-cascade-1v3.json` exercises the integrated one-versus-three physics, policy, morale, squad and trace pipeline.
- Schema 1.2 remains closed, retains explicit 1.0→1.1→1.2 migration paths, and validates new state/event shapes.

Run `npm run verify:phase3` to re-establish closure. Closure is invalidated if qualitative tests, full replay validation, input-order equality, schema freshness, Phase 0/2 regressions, or the deterministic benchmark gate fails.
