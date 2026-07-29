# Architecture decision register

Phase 0 decisions are closed when they have an owner, risk, decision date, and testable consequence. Implementation evidence may mature in later phases, but changing an accepted decision requires a superseding ADR.

| Decision | Status | Owner | Risk | Date | Testable consequence |
|---|---|---|---|---|---|
| [Deterministic runtime](0001-deterministic-runtime.md) | Accepted | Engine maintainers | High | 2026-07-29 | Fresh-process golden logs and actor-order checks |
| [PRNG and named substreams](0002-prng.md) | Accepted | Engine maintainers | High | 2026-07-29 | Published vectors and stream-isolation tests |
| [Schema authority and events](0003-schema-and-events.md) | Accepted | Platform maintainers | High | 2026-07-29 | Validation, migration, and replay-chain tests |
| [Safety abstraction](0004-safety-abstraction.md) | Accepted | Safety and product maintainers | Critical | 2026-07-29 | Engagement-gate and prohibited-content tests |
| [Numeric precision](0005-numeric-precision.md) | Accepted | Engine maintainers | High | 2026-07-29 | Formula-boundary and persisted-rounding tests |
| [Persistence and artifacts](0006-persistence-and-artifacts.md) | Accepted | Platform maintainers | High | 2026-07-29 | Adapter, crash-consistency, and migration contract tests |
| [Threat model](../security/threat-model.md) | Reviewed | Security and platform maintainers | Critical | 2026-07-29 | Mitigation checks linked from the threat register |
| [Prohibited-content policy](../safety/prohibited-content-policy.md) | Accepted | Safety and product maintainers | Critical | 2026-07-29 | Recursive lint and negative fixtures |
| [Benchmark baseline](../performance/benchmark-baseline.md) | Accepted | Engine maintainers | High | 2026-07-29 | Repeatable 32-actor, 600-pulse benchmark |

There are no open Phase 0 design choices. Later discoveries are recorded as new proposed ADRs with an owner, risk, target date, and proposed verification before implementation proceeds.
