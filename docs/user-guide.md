# Scenario Lab User Guide — Release Candidate

Living Here is educational scenario software for exploring a synthetic game model. It is not self-defense training, legal or medical advice, safety certification, a historical reconstruction, or a predictor of real encounters. Actions and effects are deliberately abstract.

## Author

Choose one of the six read-only presets, then select **Edit a copy** before changing it. The map toolbar supports select, pan, actor spawn, barrier, light, noise, cover, navigable-area, and exit tools. The left rail authors ambient conditions, scheduled light/noise/visibility transitions, protection and separation objectives, and the threat window. Arrow keys move the selected actor, Shift+Arrow moves by a larger step, and Pan plus the zoom controls change the map view. Undo/redo uses the platform shortcut. Editable changes are saved as a browser-local draft; canonical presets are never overwritten.

Preflight uses the same closed Schema 1.3 validator as the API and CLI. It checks IDs, ranges, actor and obstacle overlap, map bounds, navigation, exit reachability, squads, objectives, threat timing, content policy, and terminal conditions. The editor never silently repairs invalid content. JSON and file import are data-only and limited to one MiB.

## Run and replay

Select **Run scenario** or press Command/Ctrl+Enter. The durable local worker creates a deterministic run log. In Replay, use start/back/play/forward/end, the pulse slider, speed, and event category filter. Select an actor or event to inspect the “Why?” trace: visible IDs, selected action, formula terms, and bounded random samples.

Replay uses a 25-pulse snapshot cache. The final cached actor state is the engine-owned final state; the supported 32-actor/600-pulse fixture stays below the 200 ms seek budget. The observation overlay is off by default; when enabled it shows only the selected actor’s modeled cone, visible/heard/remembered links, and uncertainty. **Branch from pulse** asks the server for the exact checksummed continuation at a non-terminal pulse and completes that branch from the restored engine state.

Download produces a self-contained versioned run log. Never edit a run log and represent it as verified; replay checks the checksum chain, engine compatibility, and final checksum.

## Compare

Choose a target actor, two different built-in policies, and unique non-negative whole-number seeds. Preflight shows episode and maximum-pulse allocation before execution. The same seeds and mechanics are used for both variants. The dashboard loads both run artifacts for every pair, reports the first true event-level divergence, mean 95% intervals, objective/safety/exposure/escalation distributions, selectable outlier metrics, divergence filtering, cancellation/failure state, and a selected self-contained replay-bundle export. These values describe this model only.

The canonical calibration uses 64 paired seeds and reports mean, median, percentile bands, deterministic bootstrap intervals, and coefficient provenance. It does not estimate real-world probability. A small seed list is useful for exploration, not inference.

## Accessibility and privacy

All core controls are keyboard-operable and labeled, layouts adapt to tablet width, reduced-motion preferences are honored, and status does not depend on red/green alone. Use the skip link to move directly to the workspace. Report any inaccessible control as a release issue.

The local service binds only to loopback and emits no external telemetry. It retains a bounded in-memory structured operations buffer for local diagnostics; this contains hashes, IDs, timings, status, counts, and generic failures, never scenario text, and is not part of deterministic artifacts. Browser autosave uses local storage. Do not enter personal, surveillance, medical, or confidential data. Exported files and backups are under the user/operator’s control.

## Safe interpretation

The simulator may display `disruption`, `impairment`, `shock`, `separation`, `rout`, or `neutralization`. These are game variables, not anatomical outcomes. Do not translate traces into procedural technique, target selection, a recommended response, or a claim about law or human psychology. When a threat ends, the engine prohibits further offensive commitment regardless of policy.
