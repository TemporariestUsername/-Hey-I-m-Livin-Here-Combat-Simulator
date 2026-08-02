# Engine 0.3 doctrine and morale configuration

- **Status:** accepted synthetic game calibration
- **Engine version:** 0.3.0
- **Schema version:** 1.2.0
- **Date:** 2026-08-02

## Model boundary

The sportive and Chen-inspired policies are contrasting game doctrines, not authenticated teachings, combat instruction, biomechanical prediction, or claims about real-world outcomes. They select abstract actions from bounded state features. Engine-owned gates always override commitment after the configured threat ends and override actor intent when morale is frozen or routing.

Every doctrine coefficient is tagged `reference-derived`, `inferred`, `assumed`, or `calibrated` in `packages/policies/src/index.ts`. Reference-derived tags mean a broad source trait informed the game abstraction; they do not mean the coefficient itself came from a source.

## Morale model

Contact shock can produce distance-decayed same-side signals. Signals are accumulated from a stable actor snapshot, capped per actor and pulse, and propagated through a configured finite cascade depth. Leaders receive configurable resistance. Fear uses ordered thresholds and routing hysteresis:

`recover < shaken < frozen < route`

Routing forces withdrawal toward a declared exit. Frozen actors wait. Squad cohesion moves by at most 0.1 per pulse toward a bounded aggregate of average fear, routed fraction, and leader availability. All actors, signals, exits, squads, and ties use stable identifier ordering.

## Initial defaults

| Parameter | Default | Purpose |
|---|---:|---|
| Shock radius | 8 m | Local social propagation boundary |
| Ally shock scale | 0.65 | First-order transfer strength |
| Cascade depth | 2 | Prevents unbounded propagation |
| Per-pulse cap | 0.45 | Prevents instantaneous global routing |
| Shaken / frozen / route | 0.30 / 0.55 / 0.78 | Qualitatively distinct control states |
| Recover threshold | 0.22 | Hysteresis below the shaken threshold |
| Fear recovery | 0.025/pulse | Resolve-scaled return toward steady state |

These values are provisional and must be recalibrated through the Phase 6 paired-seed and sensitivity suite. The Phase 3 acceptance target is qualitative: bounded cascades occur, leaders resist more than comparable peers, squad cohesion responds, routing reaches declared exits, doctrines remain distinct, and no adapter bypasses safety gates.
