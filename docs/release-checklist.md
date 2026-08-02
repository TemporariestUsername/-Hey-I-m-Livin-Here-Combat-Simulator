# Version 1 Release Checklist

**Release:** 1.0.0
**Date:** 2026-08-03
**External-release decision:** Approved for Version 1.0.0 local release

| Gate | Evidence | Status |
|---|---|---|
| Phases 0–5 implementation | Phase closure records and inherited verifiers | Pass |
| Six canonical scenarios/statistical bands | Phase 6 verifier, 64 paired seeds, sensitivity results | Pass |
| Independent human source-trait review | Jizanthipus (Bawss), approved 2026-08-03 against manifest `07919a7f…d8bf`; `npm run review:approval` | Pass |
| Security review/current boundaries | Updated threat model; loopback host/origin/media/rate tests | Pass for local-only scope |
| Prohibited content and disclaimers | Closed schema, negative fixtures, UI/report/user-guide copy tests | Pass |
| Unit/property/integration/statistical/accessibility tests | `npm run verify:phase7` | Pass |
| Chromium/Firefox/WebKit interaction and visual regression | 9 Playwright runs, 12 accepted PNG baselines, dedicated CI job | Pass |
| Performance/load/replay budgets | Benchmark and `tests/hardening.test.ts` | Pass |
| Backup/restore/migration/rollback | Persistence and hardening suites; operations guide | Pass |
| Cross-platform deterministic artifact | CI matrix and golden fixture/example manifest hashes | Pass locally; CI matrix is the merge gate |
| Severity-one defects | No open automated severity-one finding | Pass |
| Public/multi-user deployment | Outside approved threat model | Prohibited |

Version 1.0.0 is approved for the documented dependency-free runtime, single-user, loopback-only boundary. Any changed reviewed input, failed golden replay, cross-project artifact access, post-threat commitment, prohibited-content escape, or non-loopback exposure reopens the release. Public or multi-user deployment remains prohibited until a new threat-model review approves that boundary.
