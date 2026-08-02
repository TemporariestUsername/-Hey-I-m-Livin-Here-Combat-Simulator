# Local API Version 1

The Version 1 service binds to `127.0.0.1` and is intended for the bundled web client. It validates loopback Host headers, rejects cross-origin/cross-site browser requests, requires `application/json` for POST routes, applies a per-address quota, and sends same-origin/CSP hardening headers. These controls are not authentication and do not approve reverse-proxy, multi-user, or internet exposure. Start it with `npm run api`; data defaults to `.living-here/` and can be relocated with `LIVING_HERE_DATA`.

Requests may send `X-API-Version: 1`. Unsupported versions receive `406`. Mutating simulation, run, and experiment requests require an `Idempotency-Key` header. Reusing a key with different normalized request content receives `409`. Bodies are limited to 1 MiB and accepted scenarios pass the same closed schema and content boundary as the CLI.

## Contracts

| Method | Route | Result |
|---|---|---|
| GET | `/v1/health` | Database integrity status |
| GET | `/v1/telemetry?kind=` | Bounded process-local structured operations records |
| POST | `/v1/scenarios/validate` | Shared closed-schema and content validation |
| POST | `/v1/replays/verify` | Validate and deterministically verify a complete run artifact |
| POST | `/v1/simulations` | Create a bounded in-memory stepping session |
| POST | `/v1/simulations/{id}/steps` | Advance 1–1,000 exact pulses |
| POST | `/v1/simulations/{id}/run` | Complete a stepping session |
| GET | `/v1/simulations/{id}` | Current state and complete provenance |
| GET | `/v1/simulations/{id}/artifact` | Completed self-contained run artifact |
| POST | `/v1/simulations/{id}/branches` | Create an exact non-terminal continuation branch at `tick` |
| GET | `/v1/simulations/{id}/events` | Events produced so far |
| GET | `/v1/simulations/{id}/traces/{tick}` | Per-actor explanation traces for one tick |
| POST | `/v1/experiments` | Queue an experiment in the local API workspace |
| GET | `/v1/experiments/{id}` | Experiment job state and episode records |
| GET | `/v1/experiments/{id}/artifacts` | Completed result manifest and run-artifact descriptors |
| POST | `/v1/projects` | Create a local project |
| POST | `/v1/projects/{project}/runs` | Queue one scenario run without changing actor policy bindings |
| POST | `/v1/projects/{project}/experiments` | Queue a paired variant/seed experiment |
| GET | `/v1/projects/{project}/jobs?limit=&cursor=` | Stable keyset-paginated jobs |
| GET | `/v1/projects/{project}/jobs/{job}` | Job state and episodes |
| DELETE | `/v1/projects/{project}/jobs/{job}` | Request cancellation |
| GET | `/v1/projects/{project}/jobs/{job}/export?format=json\|csv` | Self-contained result or metrics table |
| GET | `/v1/projects/{project}/artifacts/{hash}` | Authorized immutable artifact |

Errors use `{ "error": { "code": "...", "message": "..." } }`. Artifact hashes are identifiers, not capabilities: a project receives an artifact only when its database reference authorizes that hash.

Interactive sessions are intentionally in-memory and capped at 19,200 actor-pulses. Their state includes scenario/configuration hashes, engine and built-in policy versions, seed, runtime platform, events, traces, and the exact current or final state. Branch sessions restore the engine continuation at the requested non-terminal pulse, retain parent simulation ID and branch tick in operational provenance, and reproduce the same artifact when no future input changes. The unscoped experiment routes use a well-known local-only workspace; project-scoped routes remain available for lifecycle and authorization management.

## Experiment request

```json
{
  "scenario": { "schemaVersion": "1.3.0" },
  "variants": [
    { "id": "crisis", "policyId": "chen-inspired", "actorIds": ["defender"] },
    { "id": "reference", "policyId": "sportive", "actorIds": ["defender"] }
  ],
  "seeds": [101, 102, 103]
}
```

The full scenario replaces the abbreviated example above. Variants and seeds are sorted before execution. Episode keys include the normalized scenario, policy assignment, seed, engine version, and metrics version, so compatible retries reuse completed work. The Version 1.1 result manifest records request/scenario/configuration/seed-set and artifact hashes, engine and policy versions, platform metadata, and per-episode safety, objective, separation, exposure, escalation, side-state, morale, cohesion, action, and terminal metrics. Operational latency stays outside deterministic artifacts.

Process-local telemetry is bounded to 10,000 structured records and never enters run or experiment checksums. It records request status/latency, simulation and configuration hashes, pulse counts, per-policy latency, queue delay, episode throughput, cancellation/failure, replay mismatch hashes, and artifact byte sizes. It is exposed only through the same loopback/same-origin boundary and is not sent externally.

## Durable operation

SQLite runs in WAL/FULL-synchronous mode with transactional migrations. A single serial worker uses 30-second leases and heartbeats; expired leases return to the queue. Artifacts publish through synced temporary files and atomic rename before their authorization reference commits. Startup removes temporary files, and unreferenced renamed files are garbage-collected.

Project deletion removes references transactionally. Newly unreferenced artifacts enter a 24-hour quarantine unless the privacy hard-delete path is used. Backups contain a SQLite online backup, a manifest of referenced hashes, and verified artifact bytes; restore refuses a database/hash mismatch.
