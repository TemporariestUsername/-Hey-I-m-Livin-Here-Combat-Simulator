# Local Operations Guide — 1.0.0

The Version 1 release candidate is a single-user, loopback-only application. It is not approved for public-network exposure or multi-user hosting. The service accepts only `127.0.0.1`/`localhost` Host headers, same-origin browser requests, built-in policies, and JSON data within the documented limits.

## Runtime and data

- Required runtime: Node.js 22.22 or newer on the CI-supported operating systems.
- Start: `npm run api`; health: `GET http://127.0.0.1:8787/v1/health`.
- Default port: 8787; override with `LIVING_HERE_PORT`.
- Default data root is selected by `apps/api/src/index.ts`; override with `LIVING_HERE_DATA` before starting.
- The data root contains `metadata.sqlite` plus `artifacts/objects`, `artifacts/tmp`, and `artifacts/quarantine`.
- Do not put credentials, personal data, surveillance data, or unreviewed content packs in projects. No external telemetry is emitted; `GET /v1/telemetry` exposes only the bounded process-local structured diagnostic buffer.

## Startup checks

1. Confirm `node --version` is within the supported range.
2. Run `npm run verify:phase7` for a release build.
3. Run `npm run ops -- migrate-check <data-root>`; require integrity `ok` and schema versions `[1,2]`.
4. Start the API and require health status `ok`.
5. Keep the listener on loopback. A reverse proxy or non-loopback bind is outside the approved threat model.

SQLite uses WAL mode, foreign keys, full synchronization, a five-second busy timeout, and transactional numbered migrations. Startup is the migration boundary. Make a verified backup before replacing application code.

## Backup

Stop job submission, allow the in-process queue to drain, then run:

```bash
npm run ops -- backup <data-root> <new-backup-directory>
npm run ops -- verify <new-backup-directory>
```

The Version 2 backup manifest records the SQLite migration versions, database SHA-256, and every referenced immutable artifact hash. Backup verification runs SQLite integrity checks and verifies database/reference/artifact hashes.

## Restore and rollback

Restore refuses to overwrite an existing `metadata.sqlite`:

```bash
npm run ops -- restore <verified-backup-directory> <empty-restore-root>
npm run ops -- migrate-check <empty-restore-root>
```

Start the release candidate against the restored root and verify health plus one known artifact. For application rollback, stop the process, preserve the failed data root, restore the pre-upgrade backup into a new empty root, and start the prior application version against that root. Never downgrade a live database in place.

The automated rehearsal creates a Version 1 metadata database, migrates it transactionally to Version 2, reopens it idempotently, performs a backup/restore, and re-reads an authorized artifact. The release suite also injects partial-artifact failures and expired worker leases.

## Jobs and resource controls

- Request body: 1 MiB; JSON nesting: 64.
- Scenario: at most 256 actors, 1,024 obstacles, 36,000 pulses.
- Experiment: at most 16 variants, 10,000 unique seeds, and 5,000,000 estimated variant×seed×pulse allocations.
- Local HTTP quota: 1,200 requests per remote address per minute; responses use `429` and `Retry-After` when exceeded.
- Jobs are leased for 30 seconds, heartbeat while running, and return to the queue after expiry. Episode keys make retries idempotent.
- Cancellation is cooperative between episodes. A single episode runs to a deterministic boundary.

If a queue appears stuck, stop the service, preserve the data root, restart it, and allow expired leases to recover. Inspect job status/error through the project-scoped API; imported names and scenario text are not written to service error responses.

## Incident response

For integrity mismatch, repeated 500 responses, unexpected public reachability, or prohibited content:

1. Stop the process and retain the affected data root read-only.
2. Record app version, engine version, request route, job ID, scenario hash, and timestamps—not imported free text.
3. Verify the latest backup without overwriting evidence.
4. Treat cross-project artifact access, checksum divergence, or harmful-content export as severity one and do not restart for normal use until resolved.
5. Rotate or remove any external proxy configuration; the application itself stores no credentials.

## Retention and deletion

Project deletion removes metadata references. Unreferenced immutable objects are quarantined before delayed sweep; explicit hard deletion removes both object and quarantine copies. Backups are separate copies and must be deleted under the operator’s retention policy. Document any retained backup that contains a deleted project’s artifacts.
