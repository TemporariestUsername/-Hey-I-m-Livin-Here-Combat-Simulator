# Hey, I'm Livin' Here — Combat Simulator

This repository contains the deterministic vertical slice described by Phase 1 of the implementation plan. It models defensive decisions with abstract, non-instructional effects and prohibits offensive commitment after a scenario's threat ends.

Node.js 24 or newer is required; the project uses Node's built-in TypeScript type stripping and has no runtime or development dependencies.

## Commands

```bash
npm test
npm run validate -- packages/scenarios/fixtures/threat-ends.json
npm run run -- packages/scenarios/fixtures/threat-ends.json run-log.json
npm run replay -- run-log.json
```

The CLI defaults to the included threat-termination fixture. Run artifacts contain a versioned scenario, immutable checksum-chained events, initial/final state, engine version, and final-state checksum.
