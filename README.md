# Hey, I'm Livin' Here — Combat Simulator

A deterministic, explainable scenario simulator for comparing defensive decisions under pressure. The engine uses abstract, non-instructional effects and treats protection, separation, and disengagement as successful outcomes. Offensive commitment is prohibited after a scenario's threat ends.

> **Project status:** Version 1.0.0 is complete and approved for its single-user, loopback-only scope. Phases 0–7, deterministic Engine 0.4, Schema 1.3, the Phase 2 performance target, Chromium/Firefox/WebKit regression, and the manifest-bound human source-trait review all pass. This is not a real-world model, training instruction, safety certification, or source of legal advice.

Phase 0 closure is backed by the [closure record](docs/phase-0-closure.md), [decision register](docs/phase-0-decision-register.md), [threat-model review](docs/security/threat-model.md), and executable tests. All required decisions have an owner, risk, date, and testable consequence.

## Current capabilities

- Seeded 100 ms simulation pulses and named PCG32 random streams.
- Stable actor ordering and checksum-chained, versioned event logs.
- Six-decimal numeric normalization for all persisted derived values.
- Closed authoritative JSON Schemas with generated scenario types and explicit migration behavior.
- Size-, depth-, range-, and prohibited-content validation at import boundaries.
- Replay that re-runs a scenario and verifies both its event chain and final state.
- Range-, facing-, active-state-, and occlusion-aware actor observations.
- Rectangular obstacles with independent vision and movement blocking flags.
- Simultaneous movement proposals, map-bound clamping, and swept collision that prevents tunneling.
- Symmetric actor crowding with no input-order advantage.
- Tempo and interrupt contests driven by readiness, stance, surprise, stress, and encumbrance.
- Mass-, velocity-, reduced-mass-, impulse-, angle-, reach-, guard-, and stability-aware contact resolution.
- Simultaneous abstract disruption, impairment, shock, separation, neutralization, and multi-pulse recovery.
- Versioned objectives, terminal conditions, and complete per-actor/pulse explanation traces.
- A default safety gate that replaces post-threat commitment with withdrawal.
- Five actor policy adapters: safety-first, random-valid, sportive, Chen-inspired, and human intent, with explainable candidate scores and provenance-tagged doctrine weights.
- Individual fear with hysteretic morale states, bounded distance-decayed cascades, leader resistance, and recovery.
- Versioned squads with cohesion, isolation/escape/attention/relationship/formation inputs, leader and communication effects, routed counts, deterministic route-to-exit movement, and evacuation objectives.
- A complete data-driven action registry and deterministic uniform-grid fast paths for large sensing/crowding workloads.
- SQLite WAL persistence, content-addressed project-authorized artifacts, durable leased jobs, cancellation/retry, backup/restore, and CSV/JSON experiment exports.
- A responsive scenario editor with map tools, immediate preflight, JSON/import/export, undo/redo, autosave, and presets.
- Interactive deterministic replay with stepping, scrubbing, event filtering, observation/uncertainty overlays, explanation traces, exact continuation branching, and paired artifact comparison.
- Comparison preflight, true event divergence, confidence intervals, outlier filters, cancellation/failure states, and selected replay-bundle export.
- Bounded process-local structured operational telemetry; no external telemetry or authored scenario text is emitted.
- Six canonical fixtures with 64-paired-seed statistics, deterministic bootstrap intervals, sensitivity sweeps, and coefficient-dominance auditing.
- Scenario validation for identifiers, numeric limits, positions, obstacles, and vision/movement settings.
- Loopback Host/origin/media/rate hardening, multiplicative experiment quotas, obstacle-overlap and exit-reachability preflight.
- Periodic replay snapshots, Version 2 integrity-hashed backups, transactional migration rehearsal, rollback tooling, and versioned release examples.
- Automated Chromium, Firefox, and WebKit author/replay/comparison interaction tests with 12 committed visual baselines and CI failure traces.

## Requirements

- Node.js 22.22 or newer. The repository uses Node's built-in TypeScript type stripping.
- npm (bundled with Node). Runtime code remains dependency-free; development uses the pinned Playwright test package for browser regression.

## Quick start

```bash
npm test
npm run verify:release
npm run verify:phase7
npm run validate -- packages/scenarios/fixtures/threat-ends.json
npm run validate -- packages/scenarios/fixtures/sudden-crisis-physics.json
npm run run -- packages/scenarios/fixtures/sudden-crisis-physics.json physics-run.json
npm run run -- packages/scenarios/fixtures/threat-ends.json run-log.json
npm run replay -- run-log.json
npm run benchmark
npm run api
```

`npm run api` starts the complete local app at [http://127.0.0.1:8787](http://127.0.0.1:8787). The service binds only to loopback; its editor, replay, and experiment dashboard use the same validation and deterministic engine as the CLI.

Operational backup, verification, restore, and migration checks are available through `npm run ops -- …`; see `docs/operations/operations-guide.md`. Restore refuses to overwrite an existing data root.

The CLI defaults to `packages/scenarios/fixtures/threat-ends.json` when an input is omitted. `run` writes a self-contained artifact with the normalized scenario, initial and final state, immutable events, complete traces, engine version, and final checksum.

## Scenario format

Scenarios are JSON documents with schema version `1.3.0`. Positions and map dimensions are in metres; facing and vision arcs are in degrees; movement speed is metres per second.

```json
{
  "schemaVersion": "1.3.0",
  "id": "example",
  "name": "Occluded withdrawal example",
  "seed": 77,
  "pulseMs": 100,
  "maxTicks": 5,
  "map": {
    "width": 10,
    "height": 10,
    "obstacles": [
      {
        "id": "barrier",
        "x": 4,
        "y": 2,
        "width": 1,
        "height": 6,
        "blocksVision": true,
        "blocksMovement": true
      }
    ]
  },
  "threat": { "active": true, "endsAtTick": 3 },
  "actors": [
    {
      "id": "defender",
      "side": "protected",
      "position": { "x": 2, "y": 5 },
      "facingDegrees": 0,
      "visionRange": 10,
      "visionArcDegrees": 120,
      "movementSpeed": 1.4,
      "readiness": 0.8,
      "stamina": 1,
      "resolve": 0.8,
      "threatened": true
    }
  ]
}
```

Obstacle flags default to blocking when omitted. Vision settings default to a 20 m range, 120° arc, and 0° facing. Movement speed defaults to 1.4 m/s. Invalid or out-of-map values are rejected before simulation.

## Pulse behavior

For each pulse, the Engine 0.4 individual-and-group resolution pipeline:

1. Applies scheduled threat and environment transitions.
2. Applies carry-over physical recovery, then builds observations from a stable actor snapshot using range, facing, light, cover, ambient noise, hearing, memory, and uncertainty.
3. Invokes each actor's bound policy, records its candidates, rationale, and random samples, then applies safety and morale gates.
4. Computes simultaneous movement proposals, including routing toward a stable nearest exit, and applies map, obstacle, and crowding constraints.
5. Computes commitment profiles, readiness costs, telegraphing terms, and interrupt windows.
6. Resolves contact quality and impulse from physical and tactical terms using bounded named-stream noise.
7. Applies abstract effect packets simultaneously, propagates bounded morale signals, and updates squad cohesion.
8. Evaluates objectives and terminal conditions, snapshots exact state and named PRNG positions, then emits checksum-chained events and complete per-actor traces.

Withdrawal moves directly away from the nearest visible actor on another side. Ties are resolved by stable actor ID. If there is no visible opponent, the actor holds position; collision rejects the full movement rather than allowing an actor to tunnel through an obstacle.

## Event log and replay

Every event records a schema version, sequence number, tick, payload, prior checksum, and its own checksum. Replay rejects sequence gaps, broken prior-checksum links, modified events, and final-state divergence. A checksummed continuation captured at any non-terminal pulse resumes to the byte-identical uninterrupted artifact. Historical run artifacts remain immutable and must be retained with the schema and engine version that created them.

## Tests

Run the complete suite with:

```bash
npm test
```

The suite covers all named PRNG vectors and isolation, fresh-process byte-identical logs, golden artifact identity, replay and trace integrity, numeric and interrupt boundaries, simultaneous mutual effects, mass/speed monotonicity, multi-pulse recovery, disabled-actor invariants, actor-order independence, closed schemas, import limits, content fixtures, engagement gates, sensing, collision/crowding, objectives, terminals, doctrine distinctiveness, human-intent gating, bounded morale cascades, leader resistance, squad cohesion, routing/escape, fixed paired calibration cohorts, deterministic bootstrap evidence, sensitivity bands, coefficient provenance, bounded-state seed cohorts, and the physics-enabled benchmark.

`npm run test:browsers` separately executes the rendered author, replay-overlay, and paired-comparison flows against committed Chromium, Firefox, and WebKit PNG baselines. `npm run verify:release` combines the complete Phase 0–7 verifier with this browser suite.

The source-trait review is bound to an exact SHA-256 manifest. `npm run review:check` verifies the package while approval is pending; `npm run review:approval` requires a complete independent human decision; `npm run verify:final` combines that decision with every automated release gate.

## Screenshots

The CLI run and replay report the same checksum, demonstrating that replay reconstructed the recorded policy-enabled result.

![Terminal running and replaying the threat-ends scenario](docs/images/cli-run-replay.svg)

The screenshot below is an early milestone capture. The live `npm test` result is the closure authority.

![Terminal showing all eleven simulator tests passing](docs/images/test-suite.svg)

## Development diary

### 2026-08-03 — Multi-browser release regression

- Added pinned Playwright interaction and screenshot regression for Chromium, Firefox, and WebKit.
- Committed 12 accepted desktop/tablet author, replay-overlay, and paired-comparison baselines with a dedicated CI job and failure traces.
- Replaced CSP-incompatible dynamic inline presentation with SVG attributes and CSS classes, preserving the strict `style-src 'self'` boundary in WebKit.
- Added `npm run verify:release` as the combined Phase 0–7 and multi-browser engineering authority.

### 2026-08-02 — Version 1.0.0-rc.1 hardening

- Added loopback Host/origin/media-type guards, CSP/resource headers, request quotas, and multiplicative batch-allocation rejection.
- Added actor/obstacle overlap and conservative exit-reachability preflight.
- Added 25-pulse replay snapshots with exact engine-owned final state and supported-size seek/load tests.
- Added SQLite migration Version 2, integrity-hashed backup manifests, empty-root restore, rollback rehearsal, and operator tooling.
- Added the updated security review, operations/user guides, load evidence, release checklist, and versioned example run artifact.
- Closed all automated severity-one gates while holding external release for independent human source-trait approval.

### 2026-08-02 — Version 0.6 calibration engineering

- Added all six canonical fixtures and made the full suite available in the web preset library.
- Added 64-seed paired policy cohorts, descriptive bands, deterministic bootstrap intervals, paired standardized effects, and committed fixture/configuration hashes.
- Added isolated surprise, reach, and angle sensitivity sweeps; all favorable-factor lower bounds are non-negative.
- Audited 7,040 active-threat multi-term target decisions: all doctrine coefficients have provenance, and the largest single contribution share is below the 0.60 review threshold.
- Recorded the source-trait mapping and safety review while explicitly leaving independent human product approval pending.

### 2026-08-02 — Version 0.5, durable service, and playable scenario lab

- Added the loopback Version 1 API, SQLite WAL metadata, content-addressed artifact store, durable leased experiment jobs, cancellation/retry, pagination, metrics, exports, deletion lifecycle, and verified backup/restore.
- Added a keyboard-operable responsive scenario editor with map layers, timeline, inspector, shared preflight, JSON source, import/export, undo/redo, autosave, and a preset library.
- Added run progress, pulse replay, event filters, actor state reconstruction, complete “Why?” traces, branch-from-pulse authoring, and actor-selectable paired policy comparison.
- Browser-tested desktop and 720 px layouts, keyboard undo, a 290-event replay, eight-episode comparison, responsive overflow, console state, and accessible-name/ID structure.

### 2026-08-02 — Engine 0.3 and Phase 3 closure

- Added Schema 1.2 for closed exit, squad, morale, routing, evacuation, doctrine, and human-intent data while retaining explicit migrations from 1.0 and 1.1.
- Added five policy adapters, provenance-tagged sportive and Chen-inspired weights, and selected-policy contributions in per-actor traces.
- Added bounded distance-decayed morale cascades, leader resistance, hysteretic morale states, squad cohesion, stable route-to-exit movement, and evacuation objectives.
- Added an integrated one-versus-three fixture and qualitative tests for doctrine distinctiveness, cascade behavior, replay, actor-order equality, post-threat safety, and human-intent overrides.

### 2026-08-02 — Engine 0.2 and Phase 2 closure

- Added Schema 1.1 while retaining historical 1.0 schemas and an explicit migration path.
- Added abstract physical state, tempo/interrupt contests, mass-and-impulse contact resolution, simultaneous effects, recovery, actor crowding, objectives, terminal reasons, and complete trace records.
- Added a sudden-crisis physics fixture, exact threshold and monotonicity tests, 64-seed bounded-state coverage, disabled-actor enforcement, and trace-tamper replay detection.
- Upgraded the 32-actor/600-pulse benchmark to exercise physics: 81,938 events, 19,200 traces, 29 contacts, and p95 822.842 ms against the 1,000 ms target.

### 2026-07-29 — Phase 0 closure

- Closed determinism, numeric precision, PRNG, schema authority/versioning, persistence, and safety-abstraction decisions with owners, risks, dates, alternatives, review triggers, and executable consequences.
- Added authoritative closed JSON Schemas, generated scenario types, explicit migration/engine compatibility, import byte/depth limits, and shared prohibited-content linting.
- Added reviewed positive and category-specific negative fixtures, a threat-model review with residual-risk disposition, and a cross-platform CI matrix.
- Added the deterministic 32-actor/600-pulse benchmark, full-artifact identity checks, and a committed ten-sample reference baseline that meets the headless target on the named machine.

### 2026-07-29 — Explainable policy boundary

- Replaced intent selection embedded in the engine with a versioned policy contract.
- Added `safety-first` and `random-valid` baselines so scenario actors can explicitly declare how they choose candidate actions.
- Kept the rules-of-engagement gate in the engine. Policies propose actions; they cannot bypass the post-threat commitment prohibition.
- Added `policy-decided` events containing candidate scores, feature contributions, rationale, and bounded random samples. This is the first increment toward full per-tick trace records.
- Added validation and regression coverage for actor policy bindings, then refreshed the CLI and test screenshots to reflect the policy-enabled event log.

### 2026-07-29 — Sensing and simultaneous withdrawal

- Added range, facing, actor activity, and obstacle occlusion to the observation snapshot.
- Added simultaneous withdrawal proposals, map-bound clamping, and swept obstacle collision.
- Documented the author, validation, run, replay, and inspection workflows while keeping the implementation headless.

### 2026-07-29 — Deterministic vertical slice

- Established the 100 ms pulse loop, named PCG32 streams, stable actor ordering, and checksum-chained events.
- Added the `validate`, `run`, and `replay` CLI commands and the threat-termination safety fixture.
- Chose deterministic rerun verification for the first replay implementation; periodic snapshots and branch-from-tick remain later roadmap work.

### Next

Version 1.0.0 passes every automated and human release gate for the local-only supported scope. The simulator remains a synthetic game doctrine model rather than a claim of an official or predictive Chen Hegao ruleset.

## Repository layout

```text
apps/cli/                 validate, run, and replay commands
apps/api/                 loopback HTTP service and static application host
apps/web/                 accessible authoring, replay, and experiment client
packages/engine/          deterministic simulation, PRNG, geometry, sensing, checksums
packages/policies/        policy contracts and built-in baseline policies
packages/schema/          shared types and runtime scenario validation
packages/scenarios/       canonical fixtures
packages/service/         durable experiment orchestration and metrics
packages/storage/         SQLite metadata, artifact lifecycle, backup/restore
tests/                    engine, physics, schema, safety, integration, and browser visual tests
benchmarks/               physics-enabled supported-size fixture and harness
docs/decisions/           architecture decision records
docs/calibration/         coefficient provenance and calibration notes
docs/images/              README command screenshots
```

See [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) for the roadmap, acceptance criteria, safety boundaries, and remaining phases.
