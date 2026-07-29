# Security threat model

- **Status:** reviewed
- **Review date:** 2026-07-29
- **Owners:** security and platform maintainers
- **Risk:** critical

## Scope and assets

The review covers imported scenarios, CLI files, the future browser/API boundary, persistence, experiment workers, policy plug-ins, event artifacts, and replay. Protected assets are artifact integrity, deterministic provenance, availability, authorization boundaries, user projects, credentials, and the non-instructional safety model.

## Trust boundaries

1. Untrusted imported JSON enters schema and content validation.
2. Browser and CLI requests enter the future API authentication, authorization, quota, and idempotency boundary.
3. API jobs cross into workers and policy execution.
4. Workers publish immutable artifacts and transactional metadata.
5. Replay clients consume artifacts that may have left trusted storage.

## Threat register

| Threat | Risk | Required mitigation | Verification |
|---|---|---|---|
| Oversized or pathological input exhausts CPU/memory | High | Reject byte, nesting, actor, map, tick, seed, and batch limits before allocation | Limit and load tests |
| Script, markup, remote-resource, or prohibited content injection | Critical | Treat imports as data; recursive schema/content validation; output encoding; no remote assets | Negative fixtures and browser security tests |
| Artifact tampering or replay substitution | High | SHA-256 content addressing, event chain, scenario/engine/config provenance | Tamper and replay tests |
| Path traversal through CLI import/export | High | Resolve against an explicit workspace/output policy and reject unsafe server-side paths | Traversal tests before remote CLI mode |
| Authorization bypass or cross-project access | Critical | Principal-scoped repositories, deny-by-default authorization, audit events | API contract tests |
| CSRF or request replay | High | Same-site protections, CSRF tokens where cookies are used, scoped idempotency keys | API security tests |
| Queue flooding or expensive geometry denial of service | High | Quotas, preflight cost estimates, bounded jobs, cancellation, worker limits | Abuse and load tests |
| Untrusted policy escapes execution boundary | Critical | Version 1 production permits signed built-ins; extensions run out of process without network and with CPU/memory/time limits | Sandbox escape and timeout tests |
| Secrets or imported markup leak through traces | High | Structured allowlisted logs and output encoding; never log credentials or raw imports | Log-scrubbing tests |
| Partial artifact/database writes create false provenance | High | Atomic artifact publication and transactional metadata described by ADR 0006 | Crash-injection tests |
| Personal data is retained unintentionally | Medium | No personal data by default; documented retention and deletion | Data inventory and deletion tests |

## Review conclusion

The deterministic headless engine may proceed with bounded validated inputs. API, persistence, web import, and third-party policies must not ship until their listed mitigations have executable evidence. New trust boundaries require this document to be revised and re-reviewed.
