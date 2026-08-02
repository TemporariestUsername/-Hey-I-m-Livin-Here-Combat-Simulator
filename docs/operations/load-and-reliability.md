# Load, Failure, Migration, and Rollback Evidence

**Release:** 1.0.0
**Evidence date:** 2026-08-02

| Requirement | Release evidence | Threshold/result |
|---|---|---|
| Supported headless episode | Committed 32-actor/600-pulse ten-sample benchmark | p95 948.659 ms below 1,000 ms; full artifact hash fixed |
| Interactive replay seek | 25-pulse cache against the same supported fixture | Exact engine final actors; maximum sampled seek below 200 ms |
| Initial web transfer | Complete HTML/CSS/app/cache gzip check | Below 300 kB |
| Batch behavior | 128 deterministic five-pulse episodes | Finite and below a 5,000 ms release ceiling |
| Abuse allocation | Preflight variants×seeds×maxTicks calculation | Reject above 5,000,000 pulses before execution |
| Request abuse | Per-address fixed-window local quota | 1,200/minute by default; test proves 429/Retry-After |
| Partial artifact publication | Inject after temp sync and after rename | Startup cleanup/GC leaves no authorized partial artifact |
| Worker interruption | Lease expiry, retry, heartbeat, episode key reuse | Requeues without duplicate completed episode |
| Backup/restore | SQLite online backup plus manifest/database/artifact hashes | Integrity checked and authorized artifact readable after restore |
| Migration rehearsal | Hand-built metadata Version 1 database → Version 2 | Transactional, integrity `ok`, idempotent after reopen |
| Rollback rehearsal | Pre-upgrade backup restored into empty root | No in-place downgrade; integrity and artifact read verified |

Timings are acceptance evidence for the named reference environment, not portable performance promises. CI treats artifact identity and functional thresholds as authoritative across its operating-system matrix.
