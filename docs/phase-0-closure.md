# Phase 0 closure record

- **Original closure date:** 2026-07-29
- **Engine 0.4 reconfirmation date:** 2026-08-02
- **Roadmap phase:** Decisions and safety baseline
- **Status:** complete
- **Closure owner:** repository maintainers

## Deliverable evidence

| Required deliverable | Evidence | Result |
|---|---|---|
| Determinism ADR | ADR 0001; fresh-process, order, replay, platform-matrix, and golden-artifact tests | Complete |
| Numeric-precision ADR | ADR 0005; centralized normalizer and boundary/ingestion/movement tests | Complete |
| PRNG ADR | ADR 0002; all-stream golden vectors, isolation, exact snapshot/restore, pulse-by-pulse continuation equality, tamper rejection | Complete |
| Schema-versioning ADR | ADR 0003; authoritative Schema 1.3 documents, generated types, closed validation, safe scenario migrations, immutable historical runs, closed continuation schema | Complete |
| Persistence ADR | ADR 0006; storage, transaction, lease, authorization, retention, GC, backup, and recovery decisions | Complete |
| Safety-abstraction ADR | ADR 0004; engine gate and content controls | Complete |
| Threat-model review | `docs/security/threat-model.md`, with findings, implementation status, residual risk, acceptance scope, and triggers | Complete |
| Prohibited-content policy | `docs/security/prohibited-content-policy.md`, positive fixture, ten category-specific negative fixtures, reusable linter | Complete |
| Benchmark fixture | Stable 32-actor/600-pulse fixture, harness, deterministic identity test, honest committed ten-sample Engine 0.4 baseline | Complete |

## Exit-criterion evidence

`docs/phase-0-decision-register.md` records every Phase 0 choice with its owner, risk, decision date, testable consequence, evidence, and closed status. No Phase 0 choice is left open.

## Verification commands

- `npm run verify:phase0`
- `npm run validate -- packages/scenarios/fixtures/threat-ends.json`
- `npm run validate -- packages/scenarios/fixtures/safety-positive.json`
- `npm run validate -- benchmarks/fixtures/benchmark-32-actors.json`
- `npm run benchmark`
- `git diff --check`

Closure is invalidated if any command fails, generated schema types are stale, a negative fixture validates, artifact identity diverges, or a new Phase 0-level design choice is introduced without updating the register.

The Engine 0.4 reference p95 is 948.659 ms: below the 1,000 ms Phase 2 target and the separate 1,300 ms same-machine regression ceiling. The spatial-index fast paths preserve the committed event count, trace count, final checksum, and complete artifact hash.
