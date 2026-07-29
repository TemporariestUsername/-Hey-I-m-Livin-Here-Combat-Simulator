# ADR 0005: Numeric precision and comparison boundaries

- **Status:** accepted
- **Date:** 2026-07-29
- **Owner:** engine maintainers
- **Risk:** high

## Decision

The engine uses JavaScript `number` values only for finite, schema-bounded quantities and `bigint` only inside PCG32. Persisted derived scalar state and trace terms are rounded to six decimal places with `Number(value.toFixed(6))`. Positions are metres, time is integer milliseconds, angles are degrees normalized to the inclusive authoring range 0–360, and normalized actor attributes use 0–1. Calculations compare rounded derived values at rule boundaries; exact threshold equality is eligible. Checksums cover the rounded persisted representation, never an unrounded intermediate.

Geometry may use ECMAScript arithmetic, including `Math.hypot`, but only rounded positions may enter persisted state. Introducing a different precision, rounding point, numeric runtime, or comparison convention requires an engine-version change and refreshed golden evidence.

## Consequence

Golden formula tests must cover values below, equal to, and above thresholds. Replay and actor-order tests must compare persisted values and checksums. Validators reject non-finite values before the engine executes.
