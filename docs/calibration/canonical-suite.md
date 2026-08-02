# Canonical Scenario Suite 1.0

**Review date:** 2026-08-02
**Schema:** Scenario 1.3.0
**Engine:** 0.4.0
**Safety boundary:** Every effect is an abstract model state. The suite must not be used as real-world training, legal advice, or a prediction of injury or survival.

All fixtures share the complete Version 1 action vocabulary. Built-in policies may propose only `observe`, `communicate`, `reposition`, `protect`, `withdraw`, `ready-tool`, `commit`, `aid-ally`, `rally`, or `wait`; the active-threat and morale gates remain authoritative. “Success” below means a model acceptance signal, not victory or real-world effectiveness.

## Suite register

| ID and fixture | Learning purpose | Assumptions and initial state | Scripted transition | Success condition and duration | Expected qualitative signature |
|---|---|---|---|---|---|
| `open-regulated-duel` — `open-regulated-duel.json` | Establish the documented formal-duel mismatch and policy contrast. | Two equal, fully mutually visible guarded actors; no obstacles, surprise, squad, or environmental leverage. | Threat clears at pulse 12. | Reach the threat-clear terminal state within 12 pulses with no post-threat commitment. | Chen-inspired target withdraws while sportive target sustains the symmetric exchange; the Chen crisis-relative metric therefore starts from a lower duel baseline. |
| `sudden-crisis-physics` — `sudden-crisis-physics.json` | Exercise short-range surprise, tempo, contact, recovery, and abstract threat termination. | One surprised committed protected actor and one immediate threat begin within abstract reach; physics is enabled. | Objective or side-neutralized conditions may terminate before 20 pulses. | Produce finite, reproducible physics traces and no action after terminal state. | The Chen-inspired target’s duel deficit disappears under strong asymmetry; higher mechanics surprise/reach/angle inputs are non-decreasing in isolated sensitivity sweeps. |
| `morale-cascade-1v3` — `morale-cascade-1v3.json` | Exercise constrained lanes, a one-to-three relation, leadership, bounded morale propagation, and exit routing. | One highly surprised blue actor faces a three-person red squad around lane obstacles; a west exit is available. | Threat clears at pulse 10; evacuation, side routing, or threat end may terminate by pulse 12. | Emit a bounded visible-effect morale cascade and preserve the per-pulse/depth caps. | Every fixed-cohort episode emits morale signals with depth no greater than the configured cap; post-threat commitments remain zero. |
| `threat-ends` — `threat-ends.json` | Prove effect-triggered threat termination and the hard safety discontinuity afterward. | Two visible actors begin within abstract reach; the protected actor uses random-valid and the declared threat uses safety-first; deterministic physics is enabled. | The first decisive abstract effect that satisfies the explicit `side-neutralized` terminal condition clears the threat in the same pulse. | `effects-applied` precedes `threat-ended` at pulse 1, terminal state follows, and separate policy-gate cases prove no later commitment. | The fixture terminates from modeled effect rather than a fixed clock; Chen-inspired, sportive, safety-first, random-valid, and human-intent commitments remain stopped by the engine gate after any threat transition. |
| `crowd-broken-sightlines` — `crowd-broken-sightlines.json` | Exercise uncertain crowd pressure and occlusion-driven intermittent observations without identifying or modeling bystanders as targets. | Two pairs occupy a map with three vision/movement screens; the focus actor has a restricted vision arc and a mobile stance. Obstacles and actor motion are the Version 1 proxy for changing crowd sightlines; ambient sound is not treated as authoritative hidden state. | Threat clears at pulse 18. | Preserve valid observations, bounded morale, and deterministic terminal state through 18 pulses. | Observation membership changes only through geometry and movement; no policy receives hidden actors, and results remain actor-order invariant. |
| `four-person-escort` — `four-person-escort.json` | Exercise a four-person protective formation against scattered pressure, cohesion, screens, and a safe-zone exit. | Four blue members, including a protected member and leader, face three spatially scattered amber actors; morale and physics are enabled. | Threat clears at pulse 16; objective completion may terminate earlier; maximum is 20 pulses. | Preserve the protected side objective, finite state, bounded cohesion, and immediate post-threat disengagement. | The leader’s doctrine produces explicit multi-term explanations; visible abstract effects may propagate morale while the safety-first formation members favor separation. |

## Fixture-level interpretation controls

- Do not call an episode a real fight, a historical reconstruction, or evidence that a named tradition “wins.”
- Do not translate disruption, impairment, shock, separation, rout, or neutralization into anatomical outcomes.
- Do not compare model percentages with crime, medical, policing, military, or legal statistics.
- Do not infer a recommended real-world response from any selected action. The model omits human judgment, law, terrain detail, communication, and many physical variables.
- Do not treat the “crowd” fixture as surveillance data or as a model of identifiable bystanders. It is a geometry/occlusion stress case.
- Do not tune to a desired win rate. The accepted signatures concern deterministic safety gates, relative policy behavior, monotonic mechanics, and bounded cascades.

## Approval rule

The machine-verifiable signature bands are recorded in `canonical-results.json` and `tests/calibration.test.ts`. Any coefficient or fixture change that crosses a band requires a new paired cohort, a new report revision, and renewed source-trait/safety review. Independent human product approval is recorded separately in `docs/calibration/source-trait-review.md`; engineering evidence must never be relabeled as human approval.
