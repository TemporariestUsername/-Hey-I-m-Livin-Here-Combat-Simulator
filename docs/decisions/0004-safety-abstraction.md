# ADR 0004: Safety abstraction and engagement gates

- **Status:** accepted
- **Date:** 2026-07-29
- **Owner:** safety and product maintainers
- **Risk:** critical

## Decision

The simulator describes contact only through abstract disruption, impairment, shock, disarm, separation, routing, or neutralization. Schemas will not accept anatomical targets, procedural technique steps, or real-world optimization fields. Threat is explicit scenario state; offensive commitment is prohibited after it ends and the failed predicate is logged.

## Consequence

The product is an educational scenario model, not legal advice, safety certification, or a prediction of real encounters. Every new schema and content pack needs prohibited-content review. Tests must prove that post-threat commitment is replaced by a defensive fallback.
