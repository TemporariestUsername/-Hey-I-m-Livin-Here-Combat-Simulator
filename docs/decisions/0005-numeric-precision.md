# ADR 0005: Numeric precision and persisted normalization

- **Status:** accepted
- **Decision date:** 2026-07-29
- **Owner:** engine maintainers
- **Risk:** high

## Context

JavaScript uses IEEE-754 binary64 numbers. Uncontrolled derived fractions, negative zero, and inconsistent local rounding make checksums and boundary behavior fragile.

## Decision

- Use binary64 for in-pulse calculations and integers for ticks, sequence numbers, seeds, and elapsed milliseconds.
- Normalize every finite number entering persisted engine state or an event payload to six decimal places with round-half-away-from-zero.
- Canonicalize `-0` to `0` and reject non-finite persisted values.
- Normalize scenario-authored numeric values when they enter a run artifact and initial state. The source file remains the authored record outside the engine; the run log contains its normalized executable representation.
- Normalize actor positions whether movement succeeds, is clamped, or is blocked. Compute collision and policy decisions from normalized state.
- Apply comparison thresholds to unrounded calculation values unless a formula specification explicitly says otherwise. Every new threshold needs below/equal/above tests, and every bounded curve needs edge tests.
- Compute event and state checksums only after normalization.

## Alternatives considered

Fixed-point integers everywhere were deferred because current units and formulas do not require their added conversion complexity. Unrounded binary64 persistence and scattered `toFixed` calls were rejected because they do not establish one compatibility boundary.

## Consequences and evidence

`packages/engine/src/numeric.ts` is the only persisted-number normalizer. Tests cover positive and negative half units, very small values, negative zero, non-finite rejection, scenario ingestion, stamina, map edges, and blocked movement. Changing precision or rounding mode is an engine compatibility break.

## Review trigger

Review before adding angular state, trigonometric state persistence, tempo/interrupt thresholds, accumulated energy, physics integration, native/WASM math, or fixed-point storage.
