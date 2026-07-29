# ADR 0001: Deterministic runtime

- **Status:** accepted
- **Date:** 2026-07-29
- **Owner:** engine maintainers
- **Risk:** high

## Decision

Use 100 ms integer ticks, stable actor-ID ordering, JSON-safe state, and SHA-256 checksums over canonically key-sorted JSON. The engine reads no wall clock, network, filesystem, or ambient randomness. Arithmetic stored in state is rounded explicitly when needed.

## Consequence

Two fresh processes given the same versioned scenario must produce byte-identical JSON logs. Golden replay tests and actor-order tests enforce this contract; a change to numeric behavior requires an engine version change.
