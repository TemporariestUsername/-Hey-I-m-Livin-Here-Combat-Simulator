# Hey, I'm Livin' Here — Combat Simulator

A deterministic, explainable scenario simulator for comparing defensive decisions under pressure. The engine uses abstract, non-instructional effects and treats protection, separation, and disengagement as successful outcomes. Offensive commitment is prohibited after a scenario's threat ends.

> **Project status:** Phase 2 foundation. The repository contains a headless engine and CLI; it is not a complete real-world model, safety certification, or source of legal advice.

## Current capabilities

- Seeded 100 ms simulation pulses and named PCG32 random streams.
- Stable actor ordering and checksum-chained, versioned event logs.
- Replay that re-runs a scenario and verifies both its event chain and final state.
- Range-, facing-, active-state-, and occlusion-aware actor observations.
- Rectangular obstacles with independent vision and movement blocking flags.
- Simultaneous movement proposals, map-bound clamping, and swept collision that prevents tunneling.
- A default safety gate that replaces post-threat commitment with withdrawal.
- Scenario validation for identifiers, numeric limits, positions, obstacles, and vision/movement settings.

## Requirements

- Node.js 24 or newer. The repository uses Node's built-in TypeScript type stripping.
- npm (bundled with Node). There are no runtime or development package dependencies.

## Quick start

```bash
npm test
npm run validate -- packages/scenarios/fixtures/threat-ends.json
npm run run -- packages/scenarios/fixtures/threat-ends.json run-log.json
npm run replay -- run-log.json
```

The CLI defaults to `packages/scenarios/fixtures/threat-ends.json` when an input is omitted. `run` writes a self-contained artifact with the scenario, initial and final state, immutable events, engine version, and final checksum.

### Working CLI example

The same checksum shown by `run` and `replay` demonstrates that replay reconstructed the recorded result.

![Terminal running and replaying the threat-ends scenario](docs/images/cli-run-replay.svg)

## Scenario format

Scenarios are JSON documents with schema version `1.0.0`. Positions and map dimensions are in metres; facing and vision arcs are in degrees; movement speed is metres per second.

```json
{
  "schemaVersion": "1.0.0",
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

For each pulse implemented by the current vertical slice, the engine:

1. Applies the scheduled threat transition.
2. Builds observations from a stable actor snapshot using range, facing, and line of sight.
3. Selects and safety-gates each actor's intent.
4. Computes all withdrawal movement proposals from the same post-intent snapshot.
5. Applies map bounds and swept obstacle collision, then records every movement result.
6. Emits checksum-chained observation, intent, movement, and lifecycle events.

Withdrawal moves directly away from the nearest visible actor on another side. Ties are resolved by stable actor ID. If there is no visible opponent, the actor holds position; collision rejects the full movement rather than allowing an actor to tunnel through an obstacle.

## Event log and replay

Every event records a schema version, sequence number, tick, payload, prior checksum, and its own checksum. Replay rejects sequence gaps, broken prior-checksum links, modified events, and final-state divergence. Because replay executes the bundled scenario again, artifacts should be retained with the engine version that created them.

## Tests

Run the complete suite with:

```bash
npm test
```

![Terminal showing the passing deterministic simulator test suite](docs/images/test-suite.svg)

The suite covers PRNG vectors, byte-identical logs, replay integrity, the post-threat safety gate, scenario validation, line-of-sight occlusion, swept collision, map bounds, observation ordering, and observation-driven withdrawal.

## Repository layout

```text
apps/cli/                 validate, run, and replay commands
packages/engine/          deterministic simulation, PRNG, geometry, sensing, checksums
packages/schema/          shared types and runtime scenario validation
packages/scenarios/       canonical fixtures
tests/                    engine and geometry integration tests
docs/decisions/           architecture decision records
docs/images/              README command screenshots
```

See [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) for the roadmap, acceptance criteria, safety boundaries, and remaining phases.
