# ADR 0006: Local persistence, durable jobs, and immutable artifacts

- **Status:** accepted
- **Decision date:** 2026-07-29
- **Owner:** platform maintainers
- **Risk:** high

## Context

Phase 4 needs recoverable local metadata, resumable jobs, and large reproducible artifacts without forcing database concerns into the pure engine.

## Decision

- Use SQLite in WAL mode for local metadata, project references, idempotency records, migrations, job state, leases, and artifact manifests. Pin and test the SQLite driver/version when Phase 4 begins.
- Use an `ArtifactRepository` interface for content-addressed immutable files and a `MetadataRepository` interface for transactions and queries. The engine depends on neither.
- Hash normalized artifact bytes with SHA-256. Store files by hash, but authorize access through project-scoped database references; possession of a hash is not authorization.
- Publish crash-consistently: write and sync a temporary file, atomically rename it to its hash, then commit the manifest/reference transaction. Startup removes unreferenced temporary files. A file published without a committed reference is an orphan eligible for garbage collection.
- Run one Version 1 worker process with SQLite's single-writer semantics. Jobs use a 30-second lease and 10-second heartbeat. Expired running jobs return to queued state. Episode keys and artifact hashes make retries idempotent.
- Retain user projects until explicit deletion. Deletion removes authorization references transactionally; unreferenced artifacts enter a 24-hour quarantine and are then removed. A hard-delete path bypasses quarantine for privacy requests. Logs contain identifiers and hashes, not imported free text.
- Create backups from a WAL checkpoint plus a manifest of referenced artifact hashes. Restoration is complete only after database integrity and every referenced artifact hash verify.
- CLI-only ephemeral runs remain supported without SQLite. Durable browser-only persistence is out of scope for Version 1; a browser client uses the service boundary.

## Alternatives considered

PostgreSQL was rejected for the initial local-first deployment because it adds operational cost. Storing large logs as SQLite blobs was rejected because immutable file publication and streaming are simpler. An in-memory queue was rejected because process restarts would lose jobs. Hash-as-capability access was rejected because cross-project identical artifacts would leak.

## Consequences and testable requirements

Phase 4 must provide repository contract tests, transactional migrations, lease expiry/recovery tests, duplicate-retry tests, crash points before and after rename/commit, authorization tests for identical hashes across projects, backup/restore verification, and deletion/garbage-collection tests. Those are implementation gates, not open architectural choices.

## Review trigger

Review before multi-process writers, remote object storage, multi-tenant hosting, a browser-only deployment, encryption-at-rest requirements, or retention-policy changes.
