# Phase 5 closure record

- **Closure date:** 2026-08-03
- **Application version:** 0.5.0
- **Status:** complete; Engine 0.4 authoring/replay contracts reconfirmed

## Deliverable evidence

| Deliverable | Evidence | Result |
|---|---|---|
| Accessible scenario editor | Semantic three-column editor, labeled controls, skip link, focus rings, keyboard map movement and structural audit | Complete |
| Map and timeline | SVG actor/obstacle/exit/environment/navigation layers; select/pan/spawn/barrier/light/noise/cover/nav/exit tools; zoom, objectives, scheduled environment timeline and actor inspector | Complete |
| Validation | Immediate shared Schema 1.3/content/semantic preflight and JSON source view | Complete |
| Authoring lifecycle | Undo/redo, local draft restore, import/export, six canonical read-only presets with explicit editable copies | Complete |
| Run controls | Idempotent exact simulation submission, progress overlay and structured failure reporting | Complete |
| Replay | Pulse scrubber, play/pause, stepping, speed, event filters and reconstructed actor state | Complete |
| Explanations | Per-actor policy contributions, physics terms, random samples, effect and event context | Complete |
| Facilitator overlays | Hidden-by-default selected-actor observation cone, visible/heard/remembered links and uncertainty | Complete |
| Branching | Server-backed exact non-terminal continuation with parent/tick provenance and artifact-equality test | Complete |
| Comparison | Actor-selectable paired policies/seeds, artifact alignment, first true event divergence, 95% mean intervals, filters/outliers, cancellation/failure state and selected bundle export | Complete |
| Responsive/accessibility | Desktop/tablet/mobile layouts, reduced motion, high contrast and color-independent labels; automated 1440×1000 and 768×1024 rendered baselines | Complete |
| Multi-browser regression | Pinned Chromium, Firefox, and WebKit interaction/visual runs over author, replay-overlay, and paired-comparison flows; 12 committed PNG baselines and CI failure traces | Complete |

## Browser acceptance evidence

The in-app browser was used against the loopback service on 2026-08-02:

- The six-actor canonical preset rendered valid and read-only; all mutation tools and inspector fields were disabled until **Edit a copy**.
- The editable copy accepted a pulse-2 light transition, a protection objective, a map light zone, and pointer panning while preflight remained ready.
- The expanded nine-tool toolbar remained fully visible at the standard app viewport after its two-row layout correction.
- Running the edited preset produced a 10-pulse, 392-event replay; at pulse 1 the optional overlay rendered one observation cone, one uncertainty ring and five sensed/memory links.
- The browser console contained zero warnings or errors.
- Exact branch artifact equality, paired artifact loading/divergence, timeout/cancellation and bundle contracts are exercised at the API/static-test boundary.

On 2026-08-03, the same secured loopback app also passed nine repeatable Playwright tests across pinned Chromium, Firefox, and WebKit. The suite exercises desktop and tablet authoring, deterministic run/replay with observation overlays, paired comparison results, CSP-safe rendering, and console/page failures. Twelve browser-specific PNGs are the accepted visual baselines; CI uploads traces and actual/diff images on failure.

## Automated evidence

`tests/web.test.ts` checks syntax, dependency-free asset policy, compressed budget, unique IDs, critical accessible names, disclaimer, WCAG contrast, complete tool/timeline/objective/overlay contracts, keyboard/autosave/validation/replay/branch/comparison hooks and responsive/reduced-motion CSS. API and persistence tests prove exact branch equality, telemetry, experiment artifact access, cancellation, timeout failure, metrics and export contracts.

Run `npm run verify:phase5` for inherited Phase 0–5 gates and baseline integrity, or `npm run test:browsers` for rendered multi-browser comparison. The UI remains a synthetic educational model and presents no procedural combat instruction or real-world outcome claim.
