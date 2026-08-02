# ADR 0004: Safety abstraction and engagement gates

- **Status:** accepted
- **Decision date:** 2026-07-29
- **Owner:** safety and product maintainers
- **Risk:** critical

## Context

The simulator may compare defensive decisions, but it must not become a source of anatomy-specific harm guidance, procedural techniques, or real-world optimization instructions.

## Decision

- Model contact only with abstract disruption, impairment, shock, separation, disarm, routing, recovery, and neutralization values.
- Treat protection, communication, creating distance, reaching an exit, and disengagement as successful outcomes.
- Do not accept anatomical targets, injury mechanisms, weapon-use procedures, technique steps, active markup, remote resources, or real-world optimization fields.
- Apply closed JSON Schema validation and the prohibited-content linter at scenario and run-log import boundaries. Built-in policies are reviewed source code; future configurable policies and all exports must use the same lint boundary.
- Represent threat as explicit state. Offensive `commit` intent requires an active threat; after threat termination the engine replaces it with `withdraw` and logs the failed predicate.
- Keep the product disclaimer explicit: it is educational software, not legal advice, safety certification, training instruction, or a predictor of real encounters.

## Alternatives considered

A short exact-key denylist alone was rejected because aliases and unknown structures bypass it. Broad keyword blocking alone was rejected because it overblocks benign safety language. The selected layered control combines closed schemas, structural field rules, targeted text checks, and reviewed positive fixtures.

## Consequences and evidence

Every restricted category has a committed negative fixture, and a benign fixture prevents obvious overblocking. Unknown structures fail closed. The post-threat gate remains engine-owned so a policy cannot bypass it. Evidence is in `packages/scenarios/fixtures/negative/`, `packages/schema/src/content-policy.ts`, and `tests/phase-zero.test.ts`.

## Review trigger

Review for every new authorable string or object, policy configuration format, content pack, UI editor, import/export path, effect category, or external distribution channel.
