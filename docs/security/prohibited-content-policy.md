# Prohibited-content policy

- **Status:** accepted
- **Policy date:** 2026-07-29
- **Owner:** safety and product maintainers
- **Risk:** critical
- **Applies to:** scenarios, policy configuration, events, traces, imported run logs, UI-authored text, content packs, and exports

## Allowed abstraction

Content may describe observable context and abstract outcomes: communication, barriers, alarms, exits, cover, visibility, readiness, stamina, resolve, shock, disruption, impairment, protection, separation, withdrawal, routing, recovery, disarm, and neutralization. It may compare simulated policies while clearly presenting the system as educational software rather than real-world instruction or prediction.

## Prohibited categories

1. Anatomy-specific targets or harm.
2. Injury mechanisms or graphic physiological detail.
3. Stepwise techniques, procedural sequences, timing recipes, or operational instructions for harming a person.
4. Real-world optimization fields, rankings, or advice intended to maximize harm.
5. Weapon-use procedures or instructions.
6. Executable/script content, HTML-like active markup, or dynamic evaluation fields.
7. Remote URLs, remote asset loading, or data-HTML resources in imported content.
8. Unknown structures outside the authoritative closed schema.
9. Claims of legal correctness, safety certification, guaranteed effectiveness, or prediction of an actual encounter.

## Enforcement model

- JSON Schema closes all authorable objects; unknown fields fail rather than being stripped.
- Structural lint rejects prohibited field families after case and punctuation normalization.
- Targeted text checks reject markup, remote-resource syntax, step-numbered procedures, and co-occurring anatomical/harm language.
- The same linter processes scenario and run-log imports. Current exports are derived solely from accepted data; future configurable policy/export boundaries must invoke it explicitly.
- Engine engagement gates remain independent of content validation.
- New schemas and content packs require human review because automated text checks are supplementary controls, not semantic proof.

## Fixture requirements

Each prohibited category that can appear in Version 1 data has a committed negative fixture under `packages/scenarios/fixtures/negative/`. `safety-positive.json` is a reviewed allowed-language fixture guarding against obvious overblocking. CI must prove all negatives fail and the positive passes.

## False-positive and false-negative handling

Do not weaken closed schemas to admit a rejected document. If benign text is rejected, narrow the context-specific detector and add a positive regression fixture. If harmful content passes, add a negative fixture and prefer a schema/structural restriction over an ever-growing keyword list. Euphemistic or contextual content packs remain subject to human review.

## Review record

The Phase 0 threat-model review traced this policy through scenario validation, run-log validation, CLI import, event production, and replay. It found no route for unknown scenario fields or the listed Version 1 negative categories after the closure changes. Review again for every authorable field, configurable policy, UI editor, content pack, or external import/export format.
