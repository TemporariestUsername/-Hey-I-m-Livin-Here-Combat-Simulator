# Phase 0 decision register

- **Register owner:** platform maintainers
- **Original closure date:** 2026-07-29
- **Engine 0.4 reconfirmation date:** 2026-08-02
- **Status:** closed

The roadmap exit criterion requires every Phase 0 design choice to have an owner, risk level, decision date, and testable consequence. The register below is the closure authority; linked ADRs contain context, alternatives, and review triggers.

| ID | Design choice and decision | Owner | Risk | Decision date | Testable consequence and evidence | Status |
|---|---|---|---|---|---|---|
| D-001 | Pure 100 ms deterministic runtime, stable ID ordering, canonical SHA-256 artifacts | Engine maintainers | High | 2026-07-29 | Fresh-process equality, order independence, golden artifact and replay tests; ADR 0001 | Closed |
| D-002 | Binary64 calculations with six-decimal half-away-from-zero persisted normalization | Engine maintainers | High | 2026-07-29 | Numeric boundary, ingestion, map-edge and blocked-movement tests; ADR 0005 | Closed |
| D-003 | PCG32 with fixed named substream IDs and checksummed exact-state continuation snapshots | Engine maintainers | High | 2026-08-02 | Golden vectors, extra-draw isolation, snapshot-next-vector, pulse-by-pulse resume, and tamper tests; ADR 0002 | Closed |
| D-004 | JSON Schema 1.3 is wire authority; generated scenario types; unknown fields rejected; continuations use a separate closed 1.0 schema | Platform maintainers | High | 2026-08-02 | Schema freshness, nested unknown-field, continuation, semantic validation, and fixture tests; ADR 0003 | Closed |
| D-005 | Additive scenario migrations only; historical run artifacts remain immutable and exact-engine | Platform maintainers | High | 2026-08-02 | Valid 1.0→1.3 scenario migration, unsafe run-migration rejection, missing-path, and incompatible-engine tests; ADR 0003 | Closed |
| D-006 | SQLite metadata plus project-authorized, content-addressed immutable artifacts | Platform maintainers | High | 2026-07-29 | Phase 4 repository, crash, authorization, lease, backup, and deletion gates; ADR 0006 | Closed |
| D-007 | Abstract defensive outcomes and engine-owned post-threat engagement gate | Safety and product maintainers | Critical | 2026-07-29 | Gate fallback/failed-predicate and policy-bypass regression tests; ADR 0004 | Closed |
| D-008 | Closed schemas plus targeted reusable content lint at every import/export boundary | Safety and product maintainers | Critical | 2026-07-29 | Positive fixture and category-specific negative fixtures; policy document | Closed |
| D-009 | Current CLI imports capped at 1 MiB, depth 64, 256 actors, 36,000 ticks | Platform maintainers | High | 2026-07-29 | Byte, depth, actor, tick, map, and obstacle validation tests; threat model | Closed |
| D-010 | Built-in policies only until an isolated extension host exists | Safety and platform maintainers | Critical | 2026-07-29 | Unknown policy rejection now; isolation/provenance is a release gate for extensions; threat model | Closed |
| D-011 | Stable 32-actor/600-pulse benchmark with ten samples, complete artifact identity, and a regression ceiling distinct from the Phase 2 target | Engine maintainers | Medium | 2026-08-02 | Benchmark harness, honest committed Engine 0.4 reference result, deterministic hash test, and explicit later-phase target disposition | Closed |
| D-012 | Supported determinism matrix is Node 22.22+/24 on maintained macOS/Linux/Windows arm64/x64 | Engine maintainers | High | 2026-07-29 | CI platform/runtime matrix and golden artifact test; ADR 0001 | Closed |

## Closure statement

There are no open Phase 0 design choices. Future API, persistence, physics, policy-extension, and UI work has explicit review triggers and test gates; those are implementation tasks under accepted decisions, not unresolved Phase 0 architecture.
