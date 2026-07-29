# ADR 0006: Persistence and artifact boundaries

- **Status:** accepted
- **Date:** 2026-07-29
- **Owner:** platform maintainers
- **Risk:** high

## Decision

The pure engine remains unaware of storage. Platform code will depend on repository interfaces for scenario metadata, run manifests, experiments, idempotency records, and job leases. Local development will use SQLite with transactional migrations and an in-process durable job table. Immutable event logs, snapshots, and reports are content-addressed artifacts; the relational store holds their hashes, sizes, media types, schema versions, and locations.

An idempotency key is scoped to principal and operation and stores the request hash plus durable result reference. Reusing a key with a different request is rejected. Artifact publication writes to a temporary name, verifies size and SHA-256, then atomically promotes it before committing its database reference. Repository and artifact-store interfaces must permit managed replacements without importing them into the engine.

## Consequence

Persistence contract tests must run against every adapter. Migration, crash-before-publish, crash-after-publish, duplicate-request, retry, deletion, and backup/restore tests are required before Phase 4 exits. No implementation may store an event log without its schema version, engine version, scenario hash, and content checksum.
