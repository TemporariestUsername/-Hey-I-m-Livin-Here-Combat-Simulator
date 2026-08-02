# ADR 0001: Deterministic runtime

- **Status:** accepted
- **Decision date:** 2026-07-29
- **Owner:** engine maintainers
- **Risk:** high

## Context

Replays, paired-seed comparisons, and benchmark regression checks are only meaningful if equivalent inputs produce equivalent normalized artifacts without depending on process history or host services.

## Decision

- Advance simulation with 100 ms integer ticks. The engine may not read wall-clock time, the network, the filesystem, locale-sensitive formatting, or ambient randomness.
- Normalize actor and obstacle collections by ID before execution. Rules that need a tie-break use the stable ID.
- Keep state JSON-safe and normalize persisted numbers according to ADR 0005.
- Serialize checksum inputs with recursively key-sorted JSON and link immutable events with SHA-256.
- Include the engine semantic version in every run log. Replay rejects a different engine version rather than silently attempting compatibility.
- Store exact named-stream positions and periodic state snapshots in Schema 1.3 artifacts. Engine 0.4 continuation from any non-terminal pulse must produce the same complete final artifact as uninterrupted execution, including event checksums, traces, snapshots, final state, and artifact hash.
- Support Node.js 22.22+ and 24.x on macOS, Linux, and Windows, on arm64 or x64 where Node supports the platform. CI runs the deterministic suite on the maintained platform matrix; a platform is not supported until that job passes.

## Alternatives considered

- Native floating-point state without normalization was rejected because runtime drift becomes artifact drift.
- Allocation-order processing was rejected because input order would change outcomes.
- Trusting stored final state during replay was rejected because corruption could go undetected.

## Consequences and evidence

Two fresh CLI processes must write byte-identical complete logs. Reversing actor or obstacle input order must leave the normalized artifact unchanged. Golden complete-artifact hashes, replay-chain tests, and pulse-by-pulse continuation equality must pass. Evidence is in `tests/phase-zero.test.ts` and `.github/workflows/ci.yml`.

A deliberate change to ordering, serialization, numeric behavior, or engine compatibility requires an engine version change and refreshed golden evidence.

## Review trigger

Review when adding concurrency inside a pulse, native/WASM math, a new supported runtime, parallel workers, a different snapshot cadence, or a different checksum/serialization path.
