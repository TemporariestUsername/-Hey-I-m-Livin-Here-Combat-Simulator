# Threat Model Review — Release Candidate

- **Review ID:** TM-2026-08-02-02
- **Scope:** CLI/browser imports, local web UI, loopback JSON API, SQLite metadata, immutable artifacts, durable jobs, built-in policies, exports, backup/restore, replay, and Engine 0.4 continuation state
- **Review date:** 2026-08-02
- **Risk owner:** safety and platform maintainers
- **Engineering reviewer:** Codex implementation review
- **Disposition:** accepted for a single-user loopback-only release candidate; public, proxied, multi-user, remote-asset, and untrusted-policy deployment is not approved

## Method and security objectives

The review traced hostile bytes and browser requests through host/origin/media/size checks, JSON parsing, structural/content validation, engine execution, job allocation, SQLite transactions, artifact publication, export, backup, restore, and replay. It also repeated the prohibited-language review over UI and documentation surfaces.

Security objectives are deterministic artifact integrity, availability under bounded local load, project-scoped artifact authorization, recoverable persistence, non-executable imports, and preservation of the non-instructional safety abstraction. The application stores no credentials or personal data by default and emits no external telemetry; bounded structured operations records remain process-local and exclude scenario text.

## Trust boundaries

1. Imported bytes → bounded JSON parser.
2. Parsed documents → closed schema, semantic checks, and content policy.
3. Browser/site → loopback HTTP listener and same-origin API.
4. Accepted scenario → built-in policy and deterministic engine.
5. API → durable job allocation and project-scoped repositories.
6. Engine/job → staged immutable artifact publication and SQLite reference transaction.
7. Data root → versioned backup, restore, migration, quarantine, and deletion.
8. Run log/continuation → closed compatibility schemas, exact engine version, checksum chain, full continuation checksum, bounded PRNG state, and deterministic replay/resume validation.
9. Engine/API → bounded process-local operational telemetry containing hashes, IDs, timings, counts, status, and generic failures.
10. Absent boundaries: external policy code, remote assets, authentication/multiple users, reverse proxy, external telemetry, and public networking.

## Threats and disposition

| ID | Threat | Implemented control/evidence | Residual disposition |
|---|---|---|---|
| T-01 | Oversized/deep/expensive input exhausts the process | 1 MiB body/import, depth 64, closed count/range caps, and a 5,000,000 variant×seed×pulse allocation ceiling | A permitted maximum single episode can still be expensive. Accepted only for one local user with cancellation between episodes. |
| T-02 | Markup, script, or remote content executes | Data-only JSON, no dynamic evaluation, closed schemas, URL/markup/content lint, textContent rendering, CSP, no remote assets | Natural-language lint cannot infer every euphemism; new content packs need human review. |
| T-03 | Harmful procedural or anatomical content enters outputs | Safety ADR, schema/location content policy, category negative fixtures, run-log lint, abstract effect vocabulary, disclaimers | Human copy review remains required for new authorable fields. |
| T-04 | Policy bypasses threat termination or morale route | Engine-owned gates override every built-in and human-intent adapter; tests cover all adapters | New actions/policies reopen the gate review. |
| T-05 | Runtime/order/resume drift changes comparisons | Stable IDs/tie-breaks, named PCG32 streams, exact stream snapshots, six-decimal persistence, versioned logs, actor-order tests, every-pulse continuation equality, golden artifacts, OS CI matrix | Platform support is conditional on green matrix evidence. |
| T-06 | Modified/corrupt run log, continuation, or artifact is trusted | Closed import, SHA-256 content address, project authorization, event chain, exact engine-version check, full continuation checksum, deterministic final replay/resume | Artifacts are unsigned; authenticity outside the local store is not claimed. |
| T-07 | Cross-project artifact/hash access | Project reference authorization; hashes are not capabilities; identical-byte cross-project tests | There are no user identities. Project IDs separate local workspaces, not hostile co-tenants. |
| T-08 | Partial write, worker death, or migration corrupts state | fsync/temp/atomic rename, transactional references/migrations, WAL/FULL sync, leases/heartbeats/idempotent episodes, GC, failure injection | Filesystem/OS catastrophic failure requires a verified backup. |
| T-09 | Backup is incomplete or rollback overwrites live state | Online SQLite backup, Version 2 manifest, DB/schema/artifact hashes, integrity check, empty-root restore refusal, rehearsal | Operators must manage separate backup retention and filesystem access. |
| T-10 | Malicious site drives local API (CSRF/DNS rebinding) | Loopback bind, loopback Host allowlist, same-origin Origin and Fetch-Metadata rejection, JSON-only POST, no CORS, CSP/frame denial | Non-browser local processes can call the API; this is expected for the single-user local tool. |
| T-11 | Request flooding or combinatorial batch harms availability | Per-address 1,200/min quota, Retry-After, body/depth/count/allocation limits, durable cancellation | The in-process worker is intentionally serial and offers no hostile-tenant fairness. |
| T-12 | Imported text or secrets leak through logs/errors | Telemetry is process-local, bounded, structured, and excludes scenario text; API errors are generic at internal boundaries; records use hashes/IDs/status/counts/timings; operations guidance forbids free-text incident logging | Project names remain local SQLite data and may appear in the UI. Do not enter sensitive data; external telemetry remains prohibited. |
| T-13 | Untrusted policy code executes | Version 1 resolves only signed-in-source built-in policy IDs | External policy loading remains prohibited until out-of-process CPU/memory/time/network isolation is designed and reviewed. |
| T-14 | UI replay becomes slow or inconsistent | 25-pulse browser snapshot cache, engine-owned final snapshot, supported-size exact-final and <200 ms seek test | Intermediate UI state is for visualization; authoritative verification remains engine replay. |

## Review findings and changes

The release review found that the older review still described API/persistence/UI boundaries as absent, browser requests had no Host/Origin/media/rate guard, batch limits did not cap the multiplicative workload, editor validation omitted obstacle overlap/reachability, backup manifests did not hash the database/schema versions, and browser seeks rescanned the full event list.

The release candidate adds the controls and tests listed above, a numbered SQLite Version 2 migration, exact replay snapshots, checksummed Engine 0.4 continuations, bounded/validated PCG state, operations/user guides, a rollback rehearsal, and versioned example artifacts. No automated critical or high finding remains open within the approved local-only scope.

## Acceptance and triggers

Residual risks are accepted only for a dependency-free single-user process bound to loopback with built-in policies. The independent human source-trait gate is complete and remains separate from this security disposition. Repeat this review before any non-loopback bind, reverse proxy, authentication, multiple users, remote asset, external policy, external telemetry or new telemetry fields containing authored content, new content/effect category, continuation trust-boundary change, schema authority change, or public distribution claim.
