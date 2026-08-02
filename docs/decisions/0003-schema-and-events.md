# ADR 0003: JSON Schema authority, compatibility, and event sourcing

- **Status:** accepted
- **Decision date:** 2026-07-29
- **Owner:** platform maintainers
- **Risk:** high

## Context

Handwritten interfaces and permissive validators can disagree about the wire format. Unknown fields also undermine fail-closed safety controls.

## Decision

- Versioned JSON Schema files under `packages/schema/schema/` are the wire-format authority for scenarios, events, and run logs.
- Scenario TypeScript types are generated from the authoritative scenario schema. `npm run schema:check` fails when generated output is stale.
- Every record-shaped schema object is closed by default. Unknown fields are rejected, not stripped or preserved. Event payload keys are closed by event type at the import boundary. Identifier-keyed collections such as objective progress, observation-memory ages, formula terms, gate predicates, effect deltas, and policy contributions are deliberate typed maps: their values remain schema-constrained data and never become executable configuration.
- Semantic checks that JSON Schema cannot express locally—map-relative bounds, unique IDs, and transition timing—run after structural validation.
- Every persisted document carries a semantic `schemaVersion`. Same-major additive changes require defaults and a minor version. Removal, meaning changes, or new required fields require a major version.
- Scenario migrations implement the `SchemaMigration` interface and must form an explicit, tested path to the current scenario version. Additive scenario versions 1.0 through 1.3 have an executable path. Historical run artifacts, states, events, traces, and continuations remain immutable and require their original schema and engine: synthesizing new PRNG or trace state would be false provenance, so the generic migration boundary rejects them.
- Schema 1.3 adds environment, navigation, abstract-tool, engagement, observation-memory, full PRNG-state, snapshot, and action/event structures. Continuations use their own closed 1.0 schema and embed exact Schema 1.3 documents.
- Events are append-only, sequence-numbered, and checksum-linked. A run retains the normalized scenario, initial state, final state, engine version, events, and final checksum.

## Alternatives considered

TypeScript-first schemas were rejected because TypeScript is not a wire validator. Preserving unknown fields was rejected because unsupported content could cross safety and export boundaries. In-place artifact mutation was rejected because it breaks provenance.

## Consequences and evidence

Schema generation, closed nested-object tests, incompatible-version tests, valid scenario-migration tests, immutable-run rejection, continuation validation, event-chain tests, and run-log import checks are mandatory. Evidence is in `scripts/generate-schema-types.ts`, `packages/schema/src/validate.ts`, and `tests/phase-zero.test.ts`.

## Review trigger

Review for every schema version, new event type, external API, third-party policy configuration, or exported artifact format.
