# Phase 4 closure record

- **Closure date:** 2026-08-02
- **Service/package version:** 0.4.0
- **Engine version:** 0.3.0
- **Status:** complete for the local Version 1 boundary

## Deliverable evidence

| Deliverable | Evidence | Result |
|---|---|---|
| HTTP contracts | Loopback API with version negotiation, structured errors, limits, project scope and keyset pagination | Complete |
| Embedded persistence | SQLite WAL repository with transactional migration and integrity check | Complete |
| Idempotency | Project/key unique jobs and engine/version-aware episode keys | Complete |
| Asynchronous experiments | Durable serial queue, paired variants and stable seed ordering | Complete |
| Cancellation and retry | Queued/running cancellation, leases, heartbeat, expiry recovery and episode reuse | Complete |
| Metrics and manifests | Versioned result manifest with objective, effect, morale, route and safety metrics | Complete |
| CSV/JSON export | Authorized, self-contained experiment JSON and quoted CSV metrics | Complete |
| Immutable artifacts | SHA-256 content addressing, sync/rename/commit publication and project references | Complete |
| Lifecycle operations | Orphan cleanup, quarantine, privacy hard deletion, online backup and verified restore | Complete |

## Exit-criterion evidence

`tests/persistence.test.ts` covers repository contracts, two crash points, identical-hash cross-project authorization, job idempotency, lease expiry/recovery, heartbeat, cancellation, experiment execution, API/engine parity, pagination, version negotiation, structured exports, backup/restore, deletion, quarantine and hard deletion. `scripts/verify-phase-four.ts` repeats the non-network durable experiment and manifest checks after all Phase 0–3 gates.

The API deliberately binds only to loopback. Authentication, TLS, multi-user authorization, CSRF, distributed workers and public rate limiting remain outside this accepted local boundary and are release blockers before any internet-facing deployment.
