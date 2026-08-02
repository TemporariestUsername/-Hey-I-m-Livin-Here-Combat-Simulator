# Phase 2 closure record

- **Closure date:** 2026-08-02
- **Engine version:** 0.4.0
- **Scenario schema:** 1.3.0
- **Roadmap phase:** Core individual engine
- **Status:** complete and reconfirmed for Engine 0.4

## Deliverable evidence

| Required deliverable | Implementation evidence | Verification evidence |
|---|---|---|
| Sensing | Stable range, facing, activity, and obstacle-occlusion observations | `tests/geometry.test.ts` and integration traces |
| Simultaneous intents | Policies decide from one immutable observation snapshot | actor-order and mutual-contact tests |
| Movement/collision | Bounded swept obstacle collision plus symmetric actor crowding | geometry and crowding tests |
| Tempo | Readiness, stance, surprise, stress, encumbrance, and bounded noise terms | exact below/equal/above threshold tests |
| Interrupts | Reciprocal commitment profiles with an inclusive configurable margin | interrupt-boundary and mutual-tempo tests |
| Abstract contact/effects | Mass/speed/reduced-mass impulse, angle, reach, guard, stability, simultaneous effect packets | monotonic impulse/severity and order-invariance tests |
| Recovery | Multi-pulse disruption, impairment, shock, balance, guard, and stamina recovery | recovery-span and disabled-actor tests |
| Objectives | Protect-side, neutralize-side, and separation progress | objective semantic and integrated fixture tests |
| Terminal conditions | Threat-ended, side-neutralized, objective-complete, and maximum-duration reasons | integrated terminal and schema-reference tests |
| Trace records | Per actor/pulse observations, action, formula terms, random samples, effect IDs, state checksum | trace completeness, schema validation, tamper/replay tests |

## Exit-criterion evidence

- Unit/property suite: `npm test` passes all current tests, including a 64-seed bounded-state cohort.
- No actor-order bias: both direct simultaneous effects and complete physics artifacts are invariant to reversed actor input.
- Supported-size performance: Engine 0.4 records p95 948.659 ms on the named reference machine, below the unchanged 1,000 ms target.
- Full workload identity: 78,077 events, 19,200 traces, artifact hash `afeb3d21118de64536f642c3aac1d5d9c0f1aa22cdc4ae7cd6213fb42df43bad`.

`npm run verify:phase2` is the closure authority. The performance change removes redundant actor cloning and lookup work while retaining the same immutable-pulse resolution order, benchmark workload, event count, trace count, final checksum, and full artifact hash.

## Scope boundary

Phase 2 closes the individual physical-resolution engine. Engine 0.4 also integrates later-phase morale, route, environment, tool, engagement, continuation, and policy features; their acceptance evidence remains owned by the corresponding later phase. Numeric coefficients are explicitly synthetic game parameters recorded in `docs/calibration/engine-0.2-physics.md`, not real-world effectiveness claims.
