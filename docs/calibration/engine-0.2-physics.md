# Engine 0.2 physics configuration

- **Configuration status:** assumed reference implementation
- **Recorded:** 2026-08-02
- **Owner:** engine and calibration maintainers
- **Source relationship:** architecture inferred from the supplied Chen Hegao reference; numeric coefficients are implementation assumptions

Engine 0.2 is a deterministic abstract-body model, not a biomechanical predictor. It uses physical quantities where they improve internal coherence—mass in kilograms, speed in metres per second, reduced mass, impulse in newton-seconds, 2D distance, facing, reach, radius, balance, and separation—then maps them through bounded synthetic curves to non-anatomical game effects.

## Formula structure

Tempo combines readiness, stance, surprise, shock/impairment stress, mobility/stamina encumbrance, and bounded named-stream noise. A reciprocal commitment interrupts when its tempo is at least the configured margin above the competing profile; equality is deliberately inclusive.

Contact quality combines weighted skill, angle, available reach, normalized impulse, surprise, readiness, guard, and source shock. Severity then subtracts target stability and abstract protection. The monotonic output curve produces disruption, impairment, shock, separation, recovery time, and possible neutralization. Effect packets from the same pulse aggregate against an immutable snapshot before any target is mutated.

Impulse is calculated as:

```text
reducedMass = attackerMass * targetMass / (attackerMass + targetMass)
closingSpeed = movementSpeed * mobility * staminaFactor * stanceFactor
impulseNs = reducedMass * closingSpeed * 0.35
```

The `0.35` contact-duration/coupling coefficient and all normalization weights are assumed game parameters. They do not claim to measure real people or reconstruct an official Chen ruleset.

## Default provenance

| Parameter family | Provenance | Rationale |
|---|---|---|
| 100 ms pulse and simultaneous declaration | Reference-derived architecture | Captures sudden commitment while retaining deterministic inspection |
| Mass, reduced mass, velocity, impulse, position, reach, radius | Physics-derived structure | Provides coherent directional and momentum relationships |
| Stance, surprise, guard, stability, shock, recovery terms | Reference-inferred abstraction | Represents crisis asymmetry and short-horizon disruption without move/anatomy modeling |
| Term weights, noise bounds, thresholds, recovery rates | Assumed | Initial game balance values pending Phase 6 calibration and sensitivity analysis |
| Non-anatomical effect categories | Safety requirement | Preserves game consequences without instructional targeting detail |

## Required invariants

- Increasing mass or closing speed with all else fixed cannot lower impulse or severity.
- State values remain finite and bounded.
- Equal-pulse effects are input-order independent and may be mutual.
- Neutralized actors cannot receive policy decisions or act.
- Recovery consumes multiple pulses and cannot erase a new effect immediately.
- Complete traces retain formula terms, bounded samples, effect IDs, and actor-state checksums.

These invariants are executable in `tests/mechanics.test.ts`. Any coefficient change requires updated golden artifacts, benchmark evidence, and a calibration note explaining whether the change is assumed, calibrated, inferred, or reference-derived.
