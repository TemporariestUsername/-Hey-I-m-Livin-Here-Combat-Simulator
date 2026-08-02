const clone = value => structuredClone(value);

function applyReplayEvent(actors, event) {
  const payload = event.payload;
  const actor = actors.get(payload.actorId || payload.targetId);
  if (!actor) return;
  if (event.type === "movement-resolved" || event.type === "effects-applied") actor.position = clone(payload.to);
  if (event.type === "intent-resolved") { actor.intent = payload.selected; actor.stamina = payload.stamina; }
  if (event.type === "effects-applied") {
    for (const [field, delta] of Object.entries(payload.deltas || {})) actor[field] = Number(((actor[field] || 0) + Number(delta)).toFixed(6));
    actor.neutralized = payload.neutralized;
    if (payload.neutralized) actor.active = false;
  }
  if (event.type === "recovery-applied") {
    for (const [field, delta] of Object.entries(payload.changes || {})) actor[field] = Number(((actor[field] || 0) + Number(delta)).toFixed(6));
  }
  if (event.type === "morale-updated") { actor.fear = payload.fearAfter; actor.moraleState = payload.stateAfter; }
  if (event.type === "route-progress" && payload.reachedExit) { actor.escaped = true; actor.active = false; }
}

export function buildReplayCache(log, interval = 25) {
  const actors = new Map(log.initialState.actors.map(actor => [actor.id, clone(actor)]));
  const eventsByTick = new Map();
  for (const event of log.events) {
    const events = eventsByTick.get(event.tick) || []; events.push(event); eventsByTick.set(event.tick, events);
  }
  const snapshots = new Map([[0, [...actors.values()].map(clone)]]);
  for (let tick = 1; tick <= log.finalState.tick; tick += 1) {
    for (const event of eventsByTick.get(tick) || []) applyReplayEvent(actors, event);
    if (tick % interval === 0) snapshots.set(tick, [...actors.values()].map(clone));
  }
  snapshots.set(log.finalState.tick, log.finalState.actors.map(clone));
  return { interval, eventsByTick, snapshots };
}

export function replayActorsAtCache(cache, tick) {
  const snapshotTick = Math.max(0, ...[...cache.snapshots.keys()].filter(value => value <= tick));
  const actors = new Map(cache.snapshots.get(snapshotTick).map(actor => [actor.id, clone(actor)]));
  for (let current = snapshotTick + 1; current <= tick; current += 1) {
    for (const event of cache.eventsByTick.get(current) || []) applyReplayEvent(actors, event);
  }
  return [...actors.values()];
}
