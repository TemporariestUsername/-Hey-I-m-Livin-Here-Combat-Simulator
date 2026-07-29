# ADR 0003: Schema authority and event sourcing

- **Status:** accepted
- **Date:** 2026-07-29
- **Owner:** platform maintainers
- **Risk:** high

## Decision

Persisted scenarios, events, and run logs carry semantic schema versions. Validation rejects unknown versions and out-of-range values before simulation. Events are append-only, sequence-numbered, and linked by checksums; normalized scenario and final state are retained in each run artifact.

## Consequence

Minor schema additions require defaults. Breaking changes require migrations and golden replay evidence. Replay verifies the full chain and independently reruns the scenario rather than trusting the stored final state.
