# Prohibited-content policy

## Status and ownership

- **Status:** accepted
- **Date:** 2026-07-29
- **Owner:** safety and product maintainers
- **Risk:** critical

## Allowed model vocabulary

Contact and consequences are expressed only as abstract disruption, impairment, shock, disarm, separation, routing, neutralization, protection, withdrawal, and recovery. Tools are represented by abstract traits. Outputs describe model behavior, not real-world effectiveness, legality, or safety.

## Prohibited content

Scenario data, policy configuration, events, traces, UI copy, and exports must not contain:

1. anatomy-specific targets or target-selection fields;
2. procedural technique steps or ordered instructions for causing harm;
3. fields that optimize real-world harm, effectiveness, severity, or evasion;
4. weapon construction, acquisition, or modification instructions;
5. claims that model results predict survival, legal outcomes, or real-world success;
6. graphic descriptions or visual depictions of injury.

Imported documents are data only and may not contain executable scripts, HTML, or remote asset references. Unknown fields are not permission to bypass this policy.

## Enforcement

- Runtime validation recursively runs the prohibited-field linter before scenario validation.
- The linter normalizes field names before matching reserved concepts, so casing and punctuation do not bypass it.
- Negative fixtures prove prohibited structures fail closed.
- Free-form prose added in later schema versions requires a reviewed vocabulary strategy before release; until then, the scenario schema deliberately has no notes or description fields.
- Every new schema, fixture, policy, event payload, and export format receives the checklist in `content-review-checklist.md`.

## Testable consequence

CI must reject every negative fixture. A linter-rule change requires safety-owner review and new positive and negative tests. The default engagement gate must continue to replace post-threat offensive commitment with a defensive fallback.
