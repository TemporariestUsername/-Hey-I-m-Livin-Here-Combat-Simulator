# Benchmark baseline

Run `npm run benchmark` from the repository root. The harness performs one warm-up and ten complete 32-actor, 600-pulse episodes, then reports nearest-rank median and p95. It fails if any complete artifact hash, event count, or final checksum diverges.

`phase-0-reference.json` records the accepted compatibility measurement on the named reference environment, refreshed for Engine 0.4's full state, explanation, continuation, and spatial-index workload. The roadmap's 1,000 ms Phase 2 target and the 1,300 ms same-environment regression ceiling are deliberately separate. The recorded 948.659 ms p95 meets both limits without changing the full artifact identity.

CI locks the deterministic artifact identity. Timing results must be compared only on a materially equivalent environment, after checking host load and rerunning the complete ten-sample harness. Startup, JSON fixture reading, and output formatting are outside each timed sample; simulation plus artifact construction and hashing are inside.
