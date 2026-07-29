# Phase 0 benchmark baseline

- **Status:** accepted
- **Date:** 2026-07-29
- **Owner:** engine maintainers
- **Risk:** high

`packages/scenarios/fixtures/benchmark-32-actors.json` is the stable benchmark fixture: 32 actors, 600 pulses (60 simulated seconds), fixed seed, no obstacles, and safety-first policies. `npm run benchmark` performs warm-up runs followed by five measured runs, verifies that every run has the same checksum and event count, and reports median and p95 wall time.

The provisional Phase 2 acceptance budget is p95 below 1,000 ms on the supported developer reference machine using Node.js 24 or newer. The Phase 0 command reports `budgetMet` but does not fail: its purpose is to expose the baseline before optimization, while Phase 2 owns enforcement of the performance exit criterion. Results record runtime, platform, architecture, CPU model, sample count, checksum, and event count. This baseline measures regression rather than real-world fidelity; changes to the fixture or methodology require a decision-record update.
