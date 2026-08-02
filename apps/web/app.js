import { buildReplayCache, replayActorsAtCache } from "./replay-cache.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const svgElement = name => document.createElementNS("http://www.w3.org/2000/svg", name);
const clone = value => structuredClone(value);

const app = {
  projectId: null,
  scenario: null,
  selectedActorId: null,
  tool: "select",
  zoom: 1,
  pan: { x: 0, y: 0 },
  panDrag: null,
  readOnly: true,
  undo: [],
  redo: [],
  log: null,
  simulationId: null,
  replayTick: 0,
  replayActorId: null,
  replayTimer: null,
  replayCache: null,
  validationTimer: null,
  activeJobId: null,
  comparison: null,
  comparisonFilter: { metric: "objectiveCompletionRate", divergentOnly: false },
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", "x-api-version": "1", ...(options.headers || {}) },
  });
  const contentType = response.headers.get("content-type") || "";
  const value = contentType.includes("json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(value?.error?.message || `Request failed (${response.status})`);
  return value;
}

async function createProject() {
  const project = await api("/v1/projects", { method: "POST", body: JSON.stringify({ name: "Scenario Lab" }) });
  app.projectId = project.id;
}

function announce(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(announce.timer);
  announce.timer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function setBusy(busy, title = "Running simulation", detail = "The durable worker is resolving pulses.") {
  $("#busy-title").textContent = title;
  $("#busy-detail").textContent = detail;
  $("#busy-overlay").hidden = !busy;
  $("#run-scenario").disabled = busy;
  $("#run-comparison").disabled = busy;
  $("#cancel-job").hidden = !busy || !app.activeJobId;
  if (busy) $("#cancel-job").disabled = false;
}

function snapshot() {
  if (!app.scenario) return;
  app.undo.push(JSON.stringify(app.scenario));
  if (app.undo.length > 50) app.undo.shift();
  app.redo.length = 0;
}

function ensureEditable() {
  if (!app.readOnly) return true;
  announce("Canonical presets are read only. Choose “Edit a copy” to author changes.");
  return false;
}

function nextId(items, prefix) {
  let index = items.length + 1;
  while (items.some(item => item.id === `${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function changed(message = "Unsaved changes") {
  $("#save-state").textContent = message;
  try { localStorage.setItem("living-here-draft", JSON.stringify(app.scenario)); } catch { /* storage is optional */ }
  renderAll();
  scheduleValidation();
}

function sideClass(actor) { return actor.side === app.scenario.actors[0]?.side ? "protected" : "opposing"; }
function initials(id) { return id.split(/[-_.]/).map(part => part[0]).join("").slice(0, 2).toUpperCase(); }
function labelFor(id) { return id.replaceAll(/[-_.]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, letter => letter.toUpperCase()); }

function renderAll() {
  if (!app.scenario) return;
  $("#scenario-title").textContent = app.scenario.name;
  $("#scenario-seed").textContent = `Seed ${app.scenario.seed}`;
  $("#actor-count").textContent = app.scenario.actors.length;
  $("#obstacle-count").textContent = app.scenario.map.obstacles?.length || 0;
  $("#exit-count").textContent = app.scenario.map.exits?.length || 0;
  $("#environment-count").textContent = app.scenario.map.environmentZones?.length || 0;
  $("#navigation-count").textContent = app.scenario.map.navigableAreas?.length || 0;
  $("#squad-count").textContent = app.scenario.squads?.length || 0;
  $("#objective-count").textContent = app.scenario.objectives?.length || 0;
  $("#max-pulse").textContent = `Pulse ${app.scenario.maxTicks}`;
  const end = app.scenario.threat.endsAtTick || app.scenario.maxTicks;
  $("#threat-tick").max = app.scenario.maxTicks;
  $("#threat-tick").value = end;
  $("#threat-tick-output").textContent = end;
  const threatProgress = end / app.scenario.maxTicks * 1000;
  $("#threat-window").setAttribute("width", threatProgress);
  $("#threat-marker").setAttribute("x1", threatProgress);
  $("#threat-marker").setAttribute("x2", threatProgress);
  const environment = app.scenario.environment || { ambientLight: 1, ambientNoise: 0, visibilityScale: 1 };
  $("#ambient-light").value = environment.ambientLight ?? 1;
  $("#ambient-light-output").textContent = Number(environment.ambientLight ?? 1).toFixed(2);
  $("#ambient-noise").value = environment.ambientNoise ?? 0;
  $("#ambient-noise-output").textContent = Number(environment.ambientNoise ?? 0).toFixed(2);
  $("#environment-event-tick").max = app.scenario.maxTicks;
  renderActorList();
  renderScheduledEvents();
  renderObjectives();
  renderArena($("#arena"), app.scenario.actors, app.selectedActorId, true);
  renderInspector();
  renderAuthoringMode();
  $("#json-source").value = JSON.stringify(app.scenario, null, 2);
  const compareTarget = $("#compare-target");
  const previousTarget = compareTarget.value;
  compareTarget.replaceChildren(...app.scenario.actors.map(actor => new Option(labelFor(actor.id), actor.id)));
  compareTarget.value = app.scenario.actors.some(actor => actor.id === previousTarget)
    ? previousTarget
    : (app.scenario.actors.find(actor => (actor.surprise || 0) < .25)?.id || app.scenario.actors[0]?.id || "");
  updateComparisonEstimate();
}

function comparisonSeeds() {
  return $("#compare-seeds").value.split(",").map(value => Number(value.trim())).filter(Number.isSafeInteger);
}

function updateComparisonEstimate() {
  if (!app.scenario) return;
  const seeds = comparisonSeeds();
  const episodes = seeds.length * 2;
  $("#comparison-estimate").textContent = `${episodes} episode${episodes === 1 ? "" : "s"} · up to ${(episodes * app.scenario.maxTicks).toLocaleString()} pulses`;
}

function renderAuthoringMode() {
  $("#edit-preset").hidden = !app.readOnly;
  $("#save-state").textContent = app.readOnly ? "Preset · read only" : $("#save-state").textContent;
  const selectors = [
    ".tool", "#add-actor", "#remove-actor", "#actor-inspector input", "#actor-inspector select", "#threat-tick",
    "#ambient-light", "#ambient-noise", "#environment-event-tick", "#environment-event-kind", "#environment-event-value",
    "#add-environment-event", "#add-protect-objective", "#add-separation-objective", "#apply-json",
  ];
  for (const control of selectors.flatMap(selector => $$(selector))) control.disabled = app.readOnly;
  $("#json-source").readOnly = app.readOnly;
  for (const button of $$("#scheduled-event-list button, #objective-list button")) button.disabled = app.readOnly;
}

function renderScheduledEvents() {
  const events = (app.scenario.scheduledEvents || []).filter(event => event.kind === "environment")
    .sort((left, right) => left.tick - right.tick || left.id.localeCompare(right.id));
  $("#scheduled-count").textContent = events.length;
  const list = $("#scheduled-event-list"); list.replaceChildren();
  for (const event of events) {
    const item = document.createElement("li");
    const changedField = ["ambientLight", "ambientNoise", "visibilityScale"].find(field => event[field] !== undefined);
    const label = document.createElement("span"); label.textContent = `Pulse ${event.tick} · ${labelFor(changedField || "environment")} ${changedField ? Number(event[changedField]).toFixed(2) : ""}`;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.setAttribute("aria-label", `Remove ${event.id}`);
    remove.addEventListener("click", () => { if (!ensureEditable()) return; snapshot(); app.scenario.scheduledEvents = app.scenario.scheduledEvents.filter(candidate => candidate.id !== event.id); changed("Environment transition removed"); });
    item.append(label, remove); list.append(item);
  }
}

function renderObjectives() {
  const list = $("#objective-list"); list.replaceChildren();
  for (const objective of app.scenario.objectives || []) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const detail = objective.side || objective.actorIds?.join(" ↔ ") || "scenario";
    label.textContent = `${labelFor(objective.kind)} · ${labelFor(detail)}`;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove"; remove.setAttribute("aria-label", `Remove ${objective.id}`);
    remove.addEventListener("click", () => { if (!ensureEditable()) return; snapshot(); app.scenario.objectives = app.scenario.objectives.filter(candidate => candidate.id !== objective.id); changed("Objective removed"); });
    item.append(label, remove); list.append(item);
  }
}

function renderActorList() {
  const list = $("#actor-list");
  list.replaceChildren();
  for (const actor of app.scenario.actors) {
    const button = document.createElement("button");
    button.className = "actor-card";
    button.type = "button";
    button.role = "option";
    button.dataset.actor = actor.id;
    button.setAttribute("aria-selected", String(actor.id === app.selectedActorId));
    const avatar = document.createElement("span");
    avatar.className = `avatar ${sideClass(actor) === "opposing" ? "amber" : ""}`;
    avatar.textContent = initials(actor.id);
    const identity = document.createElement("span");
    const strong = document.createElement("strong"); strong.textContent = labelFor(actor.id);
    const small = document.createElement("small"); small.textContent = actor.policyId || "random-valid";
    identity.append(strong, small);
    const morale = svgElement("svg"); morale.setAttribute("class", "morale-mini"); morale.setAttribute("viewBox", "0 0 100 3"); morale.setAttribute("aria-hidden", "true");
    const moraleTrack = svgElement("rect"); moraleTrack.setAttribute("class", "morale-track"); moraleTrack.setAttribute("width", 100); moraleTrack.setAttribute("height", 3);
    const moraleValue = svgElement("rect"); moraleValue.setAttribute("class", "morale-value"); moraleValue.setAttribute("width", Math.max(0, Math.min(100, (actor.fear || 0) * 100))); moraleValue.setAttribute("height", 3);
    morale.append(moraleTrack, moraleValue);
    button.append(avatar, identity, morale);
    button.addEventListener("click", () => selectActor(actor.id));
    list.append(button);
  }
}

function setArenaView(svg, editable) {
  const width = app.scenario.map.width * 60;
  const height = app.scenario.map.height * 60;
  if (!editable) return svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const viewWidth = width / app.zoom;
  const viewHeight = height / app.zoom;
  const x = (width - viewWidth) / 2 - app.pan.x;
  const y = (height - viewHeight) / 2 - app.pan.y;
  svg.setAttribute("viewBox", `${x} ${y} ${viewWidth} ${viewHeight}`);
}

function sectorPath(center, radius, facingDegrees, arcDegrees) {
  const start = (facingDegrees - arcDegrees / 2) * Math.PI / 180;
  const end = (facingDegrees + arcDegrees / 2) * Math.PI / 180;
  const first = { x: center.x + Math.cos(start) * radius, y: center.y + Math.sin(start) * radius };
  const second = { x: center.x + Math.cos(end) * radius, y: center.y + Math.sin(end) * radius };
  return `M ${center.x} ${center.y} L ${first.x} ${first.y} A ${radius} ${radius} 0 ${arcDegrees > 180 ? 1 : 0} 1 ${second.x} ${second.y} Z`;
}

function renderArena(svg, actors, selectedId, editable = false, observationTrace = null) {
  const width = app.scenario.map.width * 60;
  const height = app.scenario.map.height * 60;
  setArenaView(svg, editable);
  const navigationLayer = svg.querySelector('[data-map-layer="navigation"]') || svgElement("g");
  const environmentLayer = svg.querySelector('[data-map-layer="environment"]') || svgElement("g");
  const obstacleLayer = svg.querySelector('[data-map-layer="obstacles"]') || svgElement("g");
  const exitLayer = svg.querySelector('[data-map-layer="exits"]') || svgElement("g");
  const overlayLayer = svg.querySelector('[data-map-layer="overlays"]') || svgElement("g");
  const routeLayer = svg.querySelector('[data-map-layer="routes"]') || svgElement("g");
  const actorLayer = svg.querySelector('[data-map-layer="actors"]') || svgElement("g");
  for (const layer of [navigationLayer, environmentLayer, obstacleLayer, exitLayer, overlayLayer, routeLayer, actorLayer]) layer.replaceChildren();
  if (!obstacleLayer.id) {
    const prefix = editable ? "map" : "replay-map";
    navigationLayer.id = `${prefix}-navigation`; environmentLayer.id = `${prefix}-environment`; obstacleLayer.id = `${prefix}-obstacles`; exitLayer.id = `${prefix}-exits`; overlayLayer.id = `${prefix}-overlays`; routeLayer.id = `${prefix}-routes`; actorLayer.id = `${prefix}-actors`;
    navigationLayer.dataset.mapLayer = "navigation"; environmentLayer.dataset.mapLayer = "environment"; obstacleLayer.dataset.mapLayer = "obstacles"; exitLayer.dataset.mapLayer = "exits"; overlayLayer.dataset.mapLayer = "overlays"; routeLayer.dataset.mapLayer = "routes"; actorLayer.dataset.mapLayer = "actors";
    const grid = svgElement("rect"); grid.setAttribute("width", "100%"); grid.setAttribute("height", "100%"); grid.setAttribute("class", "grid"); grid.setAttribute("fill", "#0d1d21");
    svg.append(grid, navigationLayer, environmentLayer, obstacleLayer, exitLayer, overlayLayer, routeLayer, actorLayer);
  }
  for (const area of app.scenario.map.navigableAreas || []) {
    const rect = svgElement("rect"); rect.setAttribute("class", "map-navigation"); rect.setAttribute("x", area.x * 60); rect.setAttribute("y", area.y * 60);
    rect.setAttribute("width", area.width * 60); rect.setAttribute("height", area.height * 60); navigationLayer.append(rect);
  }
  for (const zone of app.scenario.map.environmentZones || []) {
    const rect = svgElement("rect"); rect.setAttribute("class", `map-zone ${zone.kind}`); rect.setAttribute("x", zone.x * 60); rect.setAttribute("y", zone.y * 60);
    rect.setAttribute("width", zone.width * 60); rect.setAttribute("height", zone.height * 60);
    const text = svgElement("text"); text.setAttribute("class", "map-zone-label"); text.setAttribute("x", zone.x * 60 + 6); text.setAttribute("y", zone.y * 60 + 14); text.textContent = `${labelFor(zone.kind)} ${Number(zone.value).toFixed(2)}`;
    environmentLayer.append(rect, text);
  }
  for (const obstacle of app.scenario.map.obstacles || []) {
    const rect = svgElement("rect");
    rect.setAttribute("class", "map-obstacle"); rect.setAttribute("x", obstacle.x * 60); rect.setAttribute("y", obstacle.y * 60);
    rect.setAttribute("width", obstacle.width * 60); rect.setAttribute("height", obstacle.height * 60); obstacleLayer.append(rect);
  }
  for (const exit of app.scenario.map.exits || []) {
    const rect = svgElement("rect"); rect.setAttribute("class", "map-exit"); rect.setAttribute("x", exit.x * 60); rect.setAttribute("y", exit.y * 60);
    rect.setAttribute("width", exit.width * 60); rect.setAttribute("height", exit.height * 60);
    const text = svgElement("text"); text.setAttribute("class", "map-exit-label"); text.setAttribute("x", exit.x * 60 + 6); text.setAttribute("y", exit.y * 60 + 14); text.textContent = labelFor(exit.id);
    exitLayer.append(rect, text);
  }
  if (actors.length > 1) {
    const line = svgElement("line"); line.setAttribute("class", "sight-line"); line.setAttribute("x1", actors[0].position.x * 60); line.setAttribute("y1", actors[0].position.y * 60);
    line.setAttribute("x2", actors[1].position.x * 60); line.setAttribute("y2", actors[1].position.y * 60); routeLayer.append(line);
  }
  const selected = actors.find(actor => actor.id === selectedId);
  if (selected && observationTrace) {
    const center = { x: selected.position.x * 60, y: selected.position.y * 60 };
    const cone = svgElement("path"); cone.setAttribute("class", "observation-cone");
    cone.setAttribute("d", sectorPath(center, Math.min((selected.visionRange || 20) * 60, Math.max(width, height) * 1.2), selected.facingDegrees || 0, selected.visionArcDegrees || 120));
    overlayLayer.append(cone);
    const uncertainty = svgElement("circle"); uncertainty.setAttribute("class", "uncertainty-ring"); uncertainty.setAttribute("cx", center.x); uncertainty.setAttribute("cy", center.y);
    uncertainty.setAttribute("r", 22 + Number(observationTrace.observationUncertainty || 0) * 58); overlayLayer.append(uncertainty);
    for (const [kind, ids] of [["visible", observationTrace.visibleActorIds], ["heard", observationTrace.heardActorIds], ["remembered", observationTrace.rememberedActorIds]]) {
      for (const id of ids || []) {
        const target = actors.find(actor => actor.id === id); if (!target) continue;
        const line = svgElement("line"); line.setAttribute("class", `observation-link ${kind}`); line.setAttribute("x1", center.x); line.setAttribute("y1", center.y); line.setAttribute("x2", target.position.x * 60); line.setAttribute("y2", target.position.y * 60); overlayLayer.append(line);
      }
    }
  }
  for (const actor of actors) {
    const group = svgElement("g");
    group.setAttribute("class", `actor-node ${sideClass(actor)} ${actor.id === selectedId ? "is-selected" : ""} ${actor.moraleState === "routing" ? "is-routing" : ""}`);
    group.setAttribute("transform", `translate(${actor.position.x * 60} ${actor.position.y * 60})`);
    group.dataset.actor = actor.id;
    if (editable) { group.setAttribute("tabindex", "0"); group.setAttribute("role", "button"); group.setAttribute("aria-label", `${labelFor(actor.id)}, ${actor.side}, ${actor.policyId || "random-valid"}`); }
    const range = svgElement("circle"); range.setAttribute("class", "range"); range.setAttribute("r", Math.min((actor.visionRange || 4) * 20, 100));
    const body = svgElement("circle"); body.setAttribute("class", "body"); body.setAttribute("r", actor.id === selectedId ? 16 : 14);
    const direction = svgElement("line"); direction.setAttribute("class", "direction"); direction.setAttribute("x1", 0); direction.setAttribute("y1", 0); direction.setAttribute("x2", 22); direction.setAttribute("y2", 0); direction.setAttribute("transform", `rotate(${actor.facingDegrees || 0})`);
    const label = svgElement("text"); label.setAttribute("class", "label"); label.setAttribute("y", 34); label.textContent = labelFor(actor.id);
    const state = svgElement("text"); state.setAttribute("class", "state"); state.setAttribute("y", 46); state.textContent = actor.moraleState || actor.policyId || "steady";
    group.append(range, direction, body, label, state); actorLayer.append(group);
  }
}

function selectActor(id) {
  app.selectedActorId = id;
  renderActorList();
  renderArena($("#arena"), app.scenario.actors, id, true);
  renderInspector();
}

function selectedActor() { return app.scenario.actors.find(actor => actor.id === app.selectedActorId); }

function renderInspector() {
  const actor = selectedActor();
  $("#actor-inspector-empty").hidden = Boolean(actor);
  $("#actor-inspector").hidden = !actor;
  if (!actor) return;
  $("#actor-name").textContent = labelFor(actor.id);
  $("#actor-side").textContent = `${labelFor(actor.side)} side · ${actor.squadId ? labelFor(actor.squadId) : "Independent"}`;
  $("#actor-avatar").textContent = initials(actor.id);
  $("#actor-avatar").className = `avatar ${sideClass(actor) === "opposing" ? "amber" : ""}`;
  $("#actor-x").value = actor.position.x; $("#actor-y").value = actor.position.y;
  $("#actor-policy").value = actor.policyId || "random-valid";
  const squadSelect = $("#actor-squad");
  squadSelect.replaceChildren(new Option("No squad", ""), ...(app.scenario.squads || []).map(squad => new Option(labelFor(squad.id), squad.id)));
  squadSelect.value = actor.squadId || "";
  for (const [field, fallback] of [["readiness", .5], ["resolve", .5], ["fear", 0]]) {
    $(`#actor-${field}`).value = actor[field] ?? fallback;
    $(`#${field}-output`).textContent = Number(actor[field] ?? fallback).toFixed(2);
  }
}

async function validate() {
  if (!app.scenario) return false;
  try {
    const result = await api("/v1/validate", { method: "POST", body: JSON.stringify(app.scenario) });
    const list = $("#validation-list"); list.replaceChildren();
    $("#validation-count").textContent = result.valid ? "Ready" : `${result.errors.length} issue${result.errors.length === 1 ? "" : "s"}`;
    $("#scenario-status").textContent = result.valid ? "Valid" : "Needs attention";
    $("#scenario-status").parentElement.classList.toggle("is-valid", result.valid);
    $("#scenario-status").parentElement.classList.toggle("is-invalid", !result.valid);
    if (result.valid) {
      const item = document.createElement("li"); item.className = "ok"; item.textContent = "Schema, content, references, map bounds, and terminal rules pass."; list.append(item);
    } else for (const error of result.errors.slice(0, 8)) { const item = document.createElement("li"); item.className = "error"; item.textContent = error; list.append(item); }
    return result.valid;
  } catch (error) {
    $("#validation-count").textContent = "Offline";
    return false;
  }
}

function scheduleValidation() {
  clearTimeout(app.validationTimer);
  app.validationTimer = setTimeout(validate, 180);
}

function switchView(view) {
  $$('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== view; });
  $$(".nav-tab").forEach(tab => { const active = tab.dataset.view === view; tab.classList.toggle("is-active", active); tab.setAttribute("aria-pressed", String(active)); });
}

function mutateActor(field, value) {
  if (!ensureEditable()) return;
  const actor = selectedActor(); if (!actor) return;
  snapshot();
  if (value === "") delete actor[field]; else actor[field] = value;
  changed();
}

function addActorAt(x = app.scenario.map.width / 2, y = app.scenario.map.height / 2) {
  if (!ensureEditable()) return;
  snapshot();
  let index = app.scenario.actors.length + 1;
  while (app.scenario.actors.some(actor => actor.id === `actor-${index}`)) index++;
  const side = app.scenario.actors[0]?.side || "side-a";
  const actor = { id: `actor-${index}`, side, position: { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) }, readiness: .6, stamina: 1, resolve: .6, fear: 0, threatened: true, policyId: "safety-first" };
  app.scenario.actors.push(actor); app.selectedActorId = actor.id; changed("Actor added");
}

function mapPointFromEvent(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const view = event.currentTarget.viewBox.baseVal;
  return {
    x: (view.x + (event.clientX - rect.left) / rect.width * view.width) / 60,
    y: (view.y + (event.clientY - rect.top) / rect.height * view.height) / 60,
  };
}

function addEnvironmentZone(kind, x, y) {
  app.scenario.map.environmentZones ||= [];
  const width = Math.min(3, app.scenario.map.width);
  const height = Math.min(3, app.scenario.map.height);
  app.scenario.map.environmentZones.push({
    id: nextId(app.scenario.map.environmentZones, kind), kind,
    x: Math.max(0, Math.min(app.scenario.map.width - width, Number((x - width / 2).toFixed(2)))),
    y: Math.max(0, Math.min(app.scenario.map.height - height, Number((y - height / 2).toFixed(2)))),
    width, height, value: kind === "light" ? 0.35 : kind === "noise" ? 0.75 : 0.7,
  });
}

function handleMapClick(event) {
  const actorNode = event.target.closest?.("[data-actor]");
  if (actorNode) return selectActor(actorNode.dataset.actor);
  if (app.tool === "select" || app.tool === "pan") return;
  if (!ensureEditable()) return;
  const { x, y } = mapPointFromEvent(event);
  if (app.tool === "spawn") return addActorAt(x, y);
  snapshot();
  if (app.tool === "obstacle") {
    app.scenario.map.obstacles ||= [];
    app.scenario.map.obstacles.push({ id: nextId(app.scenario.map.obstacles, "barrier"), x: Math.max(0, Math.min(app.scenario.map.width - 1.5, Number((x - .75).toFixed(2)))), y: Math.max(0, Math.min(app.scenario.map.height - .5, Number((y - .25).toFixed(2)))), width: 1.5, height: .5, blocksVision: true, blocksMovement: true });
    return changed("Barrier added");
  }
  if (app.tool === "exit") {
    app.scenario.map.exits ||= [];
    app.scenario.map.exits.push({ id: nextId(app.scenario.map.exits, "exit"), x: Math.max(0, Math.min(app.scenario.map.width - 1, Number((x - .5).toFixed(2)))), y: Math.max(0, Math.min(app.scenario.map.height - 2, Number((y - 1).toFixed(2)))), width: 1, height: 2 });
    return changed("Exit added");
  }
  if (["light", "noise", "cover"].includes(app.tool)) { addEnvironmentZone(app.tool, x, y); return changed(`${labelFor(app.tool)} zone added`); }
  if (app.tool === "navigation") {
    app.scenario.map.navigableAreas ||= [];
    const width = Math.min(4, app.scenario.map.width); const height = Math.min(4, app.scenario.map.height);
    app.scenario.map.navigableAreas.push({ id: nextId(app.scenario.map.navigableAreas, "nav"), x: Math.max(0, Math.min(app.scenario.map.width - width, Number((x - width / 2).toFixed(2)))), y: Math.max(0, Math.min(app.scenario.map.height - height, Number((y - height / 2).toFixed(2)))), width, height });
    return changed("Navigable area added");
  }
}

async function waitForJob(jobId) {
  app.activeJobId = jobId;
  $("#cancel-job").hidden = false;
  for (;;) {
    const job = await api(`/v1/projects/${app.projectId}/jobs/${jobId}`);
    $("#busy-detail").textContent = `${job.status === "running" ? "Resolving" : "Waiting"} · ${job.episodes?.length || 0} episode${job.episodes?.length === 1 ? "" : "s"}`;
    if (job.status === "completed") return job;
    if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error || `Job ${job.status}`);
    await new Promise(resolve => setTimeout(resolve, 120));
  }
}

async function runScenario() {
  if (!await validate()) return announce("Resolve preflight issues before running.");
  setBusy(true);
  try {
    const session = await api("/v1/simulations", { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ scenario: app.scenario }) });
    app.simulationId = session.id;
    await api(`/v1/simulations/${session.id}/run`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: "{}" });
    app.log = await api(`/v1/simulations/${session.id}/artifact`);
    loadReplay(app.log);
    switchView("replay");
    announce(`Replay ready · ${app.log.finalState.tick} pulses · ${app.log.events.length} events`);
  } catch (error) { announce(error.message); }
  finally { setBusy(false); }
}

function replayActorsAt(tick) {
  if (!app.log || !app.replayCache) return [];
  return replayActorsAtCache(app.replayCache, tick);
}

function loadReplay(log) {
  app.replayCache = buildReplayCache(log);
  app.replayTick = 0; app.replayActorId = log.scenario.actors[0]?.id;
  $("#replay-heading").textContent = log.scenario.name;
  $("#replay-summary").textContent = `${log.engineVersion} · ${log.events.length} events · ${log.finalState.terminalReason || "maximum duration"}`;
  $("#replay-tick").max = log.finalState.tick; $("#replay-tick").value = 0;
  $("#branch-run").disabled = true; $("#download-run").disabled = false;
  renderReplay();
}

function eventCategory(type) {
  if (type.includes("policy") || type.includes("intent") || type.includes("tempo")) return "decision";
  if (type.includes("contact") || type.includes("effects") || type.includes("recovery")) return "effect";
  if (type.includes("morale") || type.includes("squad") || type.includes("route")) return "morale";
  if (type.includes("objective") || type.includes("terminal") || type.includes("threat")) return "objective";
  return "system";
}

function renderReplay() {
  if (!app.log) return;
  $("#replay-tick-output").textContent = app.replayTick; $("#replay-tick").value = app.replayTick;
  $("#branch-run").disabled = !app.simulationId || app.replayTick >= app.log.finalState.tick;
  const actors = replayActorsAt(app.replayTick);
  const observationTrace = $("#observation-overlay").checked
    ? app.log.traces.find(item => item.tick === app.replayTick && item.actorId === app.replayActorId)
    : null;
  renderArena($("#replay-arena"), actors, app.replayActorId, false, observationTrace);
  $("#replay-arena").querySelectorAll("[data-actor]").forEach(node => node.addEventListener("click", () => { app.replayActorId = node.dataset.actor; renderReplay(); }));
  const filter = $("#event-filter").value;
  const events = app.log.events.filter(event => event.tick === app.replayTick && (filter === "all" || eventCategory(event.type) === filter));
  const list = $("#event-list"); list.replaceChildren();
  for (const event of events) {
    const item = document.createElement("li"); item.className = "event-item"; item.tabIndex = 0;
    const strong = document.createElement("strong"); strong.textContent = labelFor(event.type);
    const detail = document.createElement("span"); detail.textContent = String(event.payload.actorId || event.payload.targetId || event.payload.objectiveId || event.payload.reason || `Sequence ${event.sequence}`);
    item.append(strong, detail); item.addEventListener("click", () => { if (event.payload.actorId || event.payload.targetId) app.replayActorId = event.payload.actorId || event.payload.targetId; renderWhy(event); });
    item.addEventListener("keydown", key => { if (key.key === "Enter" || key.key === " ") { key.preventDefault(); item.click(); } });
    list.append(item);
  }
  renderWhy();
}

function renderWhy(event) {
  const trace = app.log?.traces.find(item => item.tick === app.replayTick && item.actorId === app.replayActorId);
  const content = $("#why-content"); content.replaceChildren(); content.className = "why-grid";
  if (!trace) { content.className = "empty-state compact"; const p = document.createElement("p"); p.textContent = "No actor trace at this pulse."; content.append(p); return; }
  const heading = document.createElement("p"); heading.textContent = `${labelFor(trace.actorId)} selected ${labelFor(trace.selectedAction)}.`; content.append(heading);
  for (const [term, value] of Object.entries(trace.formulaTerms)) {
    const row = document.createElement("div"); row.className = "why-term";
    const name = document.createElement("span"); name.textContent = labelFor(term); const number = document.createElement("strong"); number.textContent = Number(value).toFixed(3);
    row.append(name, number); content.append(row);
  }
  const samples = document.createElement("p"); samples.textContent = `Random samples: ${trace.randomSamples.length ? trace.randomSamples.map(value => Number(value).toFixed(3)).join(", ") : "none"}`; content.append(samples);
  if (event) { const sequence = document.createElement("p"); sequence.textContent = `Selected event #${event.sequence}: ${labelFor(event.type)}`; content.append(sequence); }
}

function setReplayTick(tick) { app.replayTick = Math.max(0, Math.min(app.log?.finalState.tick || 0, tick)); renderReplay(); }
function toggleReplay() {
  if (app.replayTimer) { clearInterval(app.replayTimer); app.replayTimer = null; $("#replay-play").textContent = "▶"; return; }
  $("#replay-play").textContent = "❚❚";
  app.replayTimer = setInterval(() => { if (app.replayTick >= app.log.finalState.tick) { toggleReplay(); return; } setReplayTick(app.replayTick + 1); }, Number($("#replay-speed").value));
}

async function branchFromReplay() {
  if (!app.log || !app.simulationId || app.replayTick >= app.log.finalState.tick) return;
  setBusy(true, "Creating exact branch", `Restoring deterministic continuation at pulse ${app.replayTick}`);
  try {
    const branch = await api(`/v1/simulations/${app.simulationId}/branches`, {
      method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ tick: app.replayTick }),
    });
    await api(`/v1/simulations/${branch.id}/run`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: "{}" });
    app.simulationId = branch.id;
    app.log = await api(`/v1/simulations/${branch.id}/artifact`);
    loadReplay(app.log);
    setReplayTick(Number(branch.provenance.branchTick || 0));
    announce(`Exact continuation branch restored at pulse ${branch.provenance.branchTick}.`);
  } catch (error) { announce(error.message); }
  finally { setBusy(false); }
}

async function runComparison() {
  if (!await validate()) return announce("Resolve preflight issues before comparing.");
  const seeds = comparisonSeeds();
  if (!seeds.length || new Set(seeds).size !== seeds.length) return announce("Use unique whole-number seeds.");
  const target = $("#compare-target").value;
  const variants = [{ id: $("#compare-a").value, policyId: $("#compare-a").value, actorIds: [target] }, { id: $("#compare-b").value, policyId: $("#compare-b").value, actorIds: [target] }];
  if (variants[0].id === variants[1].id) return announce("Choose two different policies.");
  setBusy(true, "Running paired comparison", `${variants.length} policies × ${seeds.length} paired seeds`);
  try {
    const job = await api(`/v1/projects/${app.projectId}/experiments`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ scenario: app.scenario, variants, seeds }) });
    await waitForJob(job.id);
    const result = await api(`/v1/projects/${app.projectId}/jobs/${job.id}/export`);
    const logs = Object.fromEntries(await Promise.all(result.episodes.map(async episode => [
      episode.artifactHash,
      await api(`/v1/projects/${app.projectId}/artifacts/${episode.artifactHash}`),
    ])));
    app.comparison = { result, variants, logs };
    renderComparison();
    announce(`Compared ${result.episodes.length} paired episodes.`);
  } catch (error) {
    const root = $("#comparison-results"); root.replaceChildren();
    const message = document.createElement("p"); message.className = "comparison-error"; message.textContent = `Comparison failed: ${error.message}`; root.append(message);
    announce(error.message);
  }
  finally { app.activeJobId = null; setBusy(false); }
}

function metricSummary(items, key) {
  const values = items.map(item => Number(item.metrics[key])).filter(Number.isFinite).sort((left, right) => left - right);
  if (!values.length) return { mean: 0, low: 0, high: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length < 2 ? 0 : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const margin = 1.96 * Math.sqrt(variance / values.length);
  return { mean, low: mean - margin, high: mean + margin };
}

function firstTrueDivergence(left, right) {
  const length = Math.max(left.events.length, right.events.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.events[index]; const b = right.events[index];
    const comparable = event => event ? { tick: event.tick, type: event.type, payload: event.payload } : null;
    if (JSON.stringify(comparable(a)) !== JSON.stringify(comparable(b))) {
      const event = a || b;
      return { tick: event?.tick ?? 0, sequence: index, label: labelFor(event?.type || "artifact-length") };
    }
  }
  return left.finalChecksum === right.finalChecksum ? null : { tick: left.finalState.tick, sequence: length, label: "Final State" };
}

function quartile(values, proportion) {
  if (!values.length) return 0;
  const position = (values.length - 1) * proportion;
  const lower = Math.floor(position); const fraction = position - lower;
  return values[lower] + (values[lower + 1] - values[lower] || 0) * fraction;
}

function renderComparison() {
  if (!app.comparison) return;
  const { result, variants, logs } = app.comparison;
  const root = $("#comparison-results"); root.replaceChildren();
  const byVariant = Object.fromEntries(variants.map(variant => [variant.id, result.episodes.filter(episode => episode.variantId === variant.id)]));
  const toolbar = document.createElement("div"); toolbar.className = "comparison-toolbar";
  const metricLabel = document.createElement("label"); metricLabel.textContent = "Outlier metric";
  const metricSelect = document.createElement("select");
  for (const [label, key] of [["Objective completion", "objectiveCompletionRate"], ["Protected-party safety", "protectedPartySafetyRate"], ["Threat exposure", "activeThreatExposureTicks"], ["Escalation", "escalationCount"], ["Morale affected", "moraleActorsAffected"]]) metricSelect.append(new Option(label, key));
  metricSelect.value = app.comparisonFilter.metric; metricSelect.addEventListener("change", () => { app.comparisonFilter.metric = metricSelect.value; renderComparison(); }); metricLabel.append(metricSelect);
  const divergentLabel = document.createElement("label"); divergentLabel.className = "overlay-toggle";
  const divergent = document.createElement("input"); divergent.type = "checkbox"; divergent.checked = app.comparisonFilter.divergentOnly;
  divergent.addEventListener("change", () => { app.comparisonFilter.divergentOnly = divergent.checked; renderComparison(); }); divergentLabel.append(divergent, " Only true divergences");
  const exportButton = document.createElement("button"); exportButton.type = "button"; exportButton.className = "button button-ghost"; exportButton.textContent = "Export selected replay bundle";
  toolbar.append(metricLabel, divergentLabel, exportButton); root.append(toolbar);
  const metricGrid = document.createElement("div"); metricGrid.className = "metric-grid";
  for (const [label, key] of [["Objective completion", "objectiveCompletionRate"], ["Protected-party safety", "protectedPartySafetyRate"], ["Threat exposure", "activeThreatExposureTicks"], ["Escalation count", "escalationCount"]]) {
    for (const variant of variants) {
      const summary = metricSummary(byVariant[variant.id], key);
      const card = document.createElement("div"); card.className = "metric-card";
      const name = document.createElement("span"); name.textContent = `${label} · ${labelFor(variant.id)}`;
      const value = document.createElement("strong"); value.textContent = summary.mean.toFixed(2);
      const note = document.createElement("small"); note.className = "distribution-note"; note.textContent = `95% mean CI ${summary.low.toFixed(2)}–${summary.high.toFixed(2)} · ${byVariant[variant.id].length} episodes`;
      card.append(name, value, note); metricGrid.append(card);
    }
  }
  root.append(metricGrid);
  const table = document.createElement("table"); table.className = "comparison-table";
  const caption = document.createElement("caption"); caption.className = "sr-only"; caption.textContent = "Paired policy comparison by seed";
  const head = document.createElement("thead"); const header = document.createElement("tr");
  for (const title of ["Include", "Seed", ...variants.map(variant => `${labelFor(variant.id)} terminal`), "First true divergence"]) { const th = document.createElement("th"); th.textContent = title; header.append(th); } head.append(header);
  const body = document.createElement("tbody");
  const paired = [...new Set(result.episodes.map(episode => episode.seed))].sort((a, b) => a - b).map(seed => {
    const episodes = variants.map(variant => byVariant[variant.id].find(episode => episode.seed === seed));
    const divergence = episodes.every(Boolean) ? firstTrueDivergence(logs[episodes[0].artifactHash], logs[episodes[1].artifactHash]) : null;
    const metric = app.comparisonFilter.metric;
    const delta = Number(episodes[0]?.metrics[metric]) - Number(episodes[1]?.metrics[metric]);
    return { seed, episodes, divergence, delta };
  });
  const deltas = paired.map(pair => pair.delta).filter(Number.isFinite).sort((left, right) => left - right);
  const q1 = quartile(deltas, .25); const q3 = quartile(deltas, .75); const iqr = q3 - q1;
  const visiblePairs = paired.filter(pair => !app.comparisonFilter.divergentOnly || pair.divergence);
  for (const pair of visiblePairs) {
    const row = document.createElement("tr");
    if (pair.delta < q1 - iqr * 1.5 || pair.delta > q3 + iqr * 1.5) row.className = "is-outlier";
    const includeCell = document.createElement("td"); const include = document.createElement("input"); include.type = "checkbox"; include.checked = true; include.dataset.seed = String(pair.seed); include.setAttribute("aria-label", `Include seed ${pair.seed}`); includeCell.append(include); row.append(includeCell);
    const seedCell = document.createElement("td"); seedCell.textContent = pair.seed; row.append(seedCell);
    const episodes = pair.episodes;
    for (const episode of episodes) { const cell = document.createElement("td"); cell.textContent = episode?.metrics.terminalReason || "—"; row.append(cell); }
    const divergence = document.createElement("td"); divergence.textContent = pair.divergence ? `Pulse ${pair.divergence.tick} · event ${pair.divergence.sequence} · ${pair.divergence.label}` : "No artifact divergence"; row.append(divergence); body.append(row);
  }
  table.append(caption, head, body); root.append(table);
  exportButton.addEventListener("click", () => {
    const selectedSeeds = new Set([...body.querySelectorAll('input[data-seed]:checked')].map(input => Number(input.dataset.seed)));
    const selectedEpisodes = result.episodes.filter(episode => selectedSeeds.has(episode.seed));
    const bundle = { schemaVersion: "1.0.0", exportedAt: new Date().toISOString(), experiment: { ...result, episodes: selectedEpisodes },
      runLogs: Object.fromEntries(selectedEpisodes.map(episode => [episode.artifactHash, logs[episode.artifactHash]])) };
    download(`comparison-${result.scenarioId}.json`, bundle);
  });
}

function download(name, value) {
  const url = URL.createObjectURL(new Blob([typeof value === "string" ? value : JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

function bind() {
  $$(".nav-tab").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
  $$(".tool").forEach(button => button.addEventListener("click", () => { app.tool = button.dataset.tool; $$(".tool").forEach(item => { const active = item === button; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", String(active)); }); }));
  $("#arena").addEventListener("click", handleMapClick);
  $("#arena").addEventListener("pointerdown", event => { if (app.tool !== "pan") return; app.panDrag = { x: event.clientX, y: event.clientY, pan: { ...app.pan } }; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add("is-panning"); });
  $("#arena").addEventListener("pointermove", event => { if (!app.panDrag) return; const rect = event.currentTarget.getBoundingClientRect(); const view = event.currentTarget.viewBox.baseVal; app.pan.x = app.panDrag.pan.x + (event.clientX - app.panDrag.x) / rect.width * view.width; app.pan.y = app.panDrag.pan.y + (event.clientY - app.panDrag.y) / rect.height * view.height; setArenaView(event.currentTarget, true); });
  const endPan = event => { if (!app.panDrag) return; app.panDrag = null; event.currentTarget.classList.remove("is-panning"); };
  $("#arena").addEventListener("pointerup", endPan); $("#arena").addEventListener("pointercancel", endPan);
  $("#arena").addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (app.tool === "pan") { event.preventDefault(); const delta = event.shiftKey ? 60 : 12; if (event.key === "ArrowLeft") app.pan.x -= delta; if (event.key === "ArrowRight") app.pan.x += delta; if (event.key === "ArrowUp") app.pan.y -= delta; if (event.key === "ArrowDown") app.pan.y += delta; return setArenaView(event.currentTarget, true); }
    const actor = selectedActor(); if (!actor || !ensureEditable()) return; event.preventDefault(); snapshot(); const delta = event.shiftKey ? 1 : .1; if (event.key === "ArrowLeft") actor.position.x = Math.max(0, actor.position.x - delta); if (event.key === "ArrowRight") actor.position.x = Math.min(app.scenario.map.width, actor.position.x + delta); if (event.key === "ArrowUp") actor.position.y = Math.max(0, actor.position.y - delta); if (event.key === "ArrowDown") actor.position.y = Math.min(app.scenario.map.height, actor.position.y + delta); changed("Actor moved");
  });
  $("#zoom-in").addEventListener("click", () => { app.zoom = Math.min(1.5, app.zoom + .1); $("#zoom-output").textContent = `${Math.round(app.zoom * 100)}%`; renderArena($("#arena"), app.scenario.actors, app.selectedActorId, true); });
  $("#zoom-out").addEventListener("click", () => { app.zoom = Math.max(.7, app.zoom - .1); $("#zoom-output").textContent = `${Math.round(app.zoom * 100)}%`; renderArena($("#arena"), app.scenario.actors, app.selectedActorId, true); });
  $("#add-actor").addEventListener("click", () => addActorAt());
  $("#remove-actor").addEventListener("click", () => { if (!ensureEditable()) return; const actor = selectedActor(); if (!actor || app.scenario.actors.length <= 1) return announce("A scenario needs at least one actor."); snapshot(); app.scenario.actors = app.scenario.actors.filter(item => item.id !== actor.id); app.selectedActorId = app.scenario.actors[0].id; changed("Actor removed"); });
  for (const field of ["x", "y"]) $("#actor-" + field).addEventListener("change", event => mutateActor("position", { ...selectedActor().position, [field]: Number(event.target.value) }));
  $("#actor-policy").addEventListener("change", event => mutateActor("policyId", event.target.value));
  $("#actor-squad").addEventListener("change", event => mutateActor("squadId", event.target.value));
  for (const field of ["readiness", "resolve", "fear"]) $("#actor-" + field).addEventListener("input", event => { if (!ensureEditable()) return; const actor = selectedActor(); if (!actor) return; actor[field] = Number(event.target.value); $(`#${field}-output`).textContent = actor[field].toFixed(2); renderActorList(); renderArena($("#arena"), app.scenario.actors, app.selectedActorId, true); scheduleValidation(); });
  $("#threat-tick").addEventListener("input", event => { if (!ensureEditable()) return; app.scenario.threat.endsAtTick = Number(event.target.value); changed("Threat window updated"); });
  for (const [id, field, fallback] of [["ambient-light", "ambientLight", 1], ["ambient-noise", "ambientNoise", 0]]) {
    $("#" + id).addEventListener("input", event => { if (!ensureEditable()) return; app.scenario.environment ||= { ambientLight: 1, ambientNoise: 0, visibilityScale: 1 }; app.scenario.environment[field] = Number(event.target.value); $(`#${id}-output`).textContent = Number(event.target.value).toFixed(2); scheduleValidation(); });
    $("#" + id).value = fallback;
  }
  $("#add-environment-event").addEventListener("click", () => { if (!ensureEditable()) return; snapshot(); app.scenario.scheduledEvents ||= []; const field = $("#environment-event-kind").value; const event = { id: nextId(app.scenario.scheduledEvents, "environment"), tick: Number($("#environment-event-tick").value), kind: "environment", [field]: Number($("#environment-event-value").value) }; app.scenario.scheduledEvents.push(event); changed("Environment transition added"); });
  $("#add-protect-objective").addEventListener("click", () => { if (!ensureEditable()) return; snapshot(); app.scenario.objectives ||= []; const side = selectedActor()?.side || app.scenario.actors[0]?.side; app.scenario.objectives.push({ id: nextId(app.scenario.objectives, "protect"), kind: "protect-side", side }); changed("Protection objective added"); });
  $("#add-separation-objective").addEventListener("click", () => { if (!ensureEditable()) return; if (app.scenario.actors.length < 2) return announce("Separation requires at least two actors."); snapshot(); app.scenario.objectives ||= []; app.scenario.objectives.push({ id: nextId(app.scenario.objectives, "separation"), kind: "separation", actorIds: app.scenario.actors.slice(0, 2).map(actor => actor.id), minimumDistanceM: 3 }); changed("Separation objective added"); });
  $("#tab-inspector").addEventListener("click", () => { $("#tab-inspector").setAttribute("aria-selected", "true"); $("#tab-json").setAttribute("aria-selected", "false"); $("#inspector-panel").hidden = false; $("#json-panel").hidden = true; });
  $("#tab-json").addEventListener("click", () => { $("#tab-inspector").setAttribute("aria-selected", "false"); $("#tab-json").setAttribute("aria-selected", "true"); $("#inspector-panel").hidden = true; $("#json-panel").hidden = false; $("#json-source").value = JSON.stringify(app.scenario, null, 2); });
  $("#apply-json").addEventListener("click", () => { if (!ensureEditable()) return; try { const next = JSON.parse($("#json-source").value); snapshot(); app.scenario = next; app.selectedActorId = next.actors?.[0]?.id || null; changed("JSON applied"); } catch (error) { announce(`JSON error: ${error.message}`); } });
  $("#run-scenario").addEventListener("click", runScenario);
  $("#run-comparison").addEventListener("click", runComparison);
  $("#compare-seeds").addEventListener("input", updateComparisonEstimate);
  $("#cancel-job").addEventListener("click", async () => {
    if (!app.activeJobId) return;
    $("#cancel-job").disabled = true;
    try {
      await api(`/v1/projects/${app.projectId}/jobs/${app.activeJobId}`, { method: "DELETE" });
      $("#busy-detail").textContent = "Cancellation requested; waiting for the current episode boundary.";
    } catch (error) { announce(`Cancellation failed: ${error.message}`); }
  });
  $("#export-scenario").addEventListener("click", () => download(`${app.scenario.id}.json`, app.scenario));
  $("#download-run").addEventListener("click", () => app.log && download(`${app.log.scenario.id}-run.json`, app.log));
  $("#import-file").addEventListener("change", async event => { const file = event.target.files?.[0]; if (!file) return; try { const next = JSON.parse(await file.text()); if (app.scenario) snapshot(); app.readOnly = false; app.scenario = next; app.selectedActorId = next.actors?.[0]?.id || null; changed("Imported scenario"); } catch (error) { announce(`Import failed: ${error.message}`); } event.target.value = ""; });
  $("#edit-preset").addEventListener("click", () => { app.readOnly = false; app.scenario = clone(app.scenario); app.scenario.id = `${app.scenario.id}-copy`.slice(0, 80); app.scenario.name = `${app.scenario.name} — editable copy`; $("#save-state").textContent = "Editable copy"; changed("Editable copy"); announce("Editing a local copy; the canonical preset remains unchanged."); });
  $("#preset-menu").addEventListener("click", loadPreset);
  $("#preset-select").addEventListener("change", loadPreset);
  $("#replay-tick").addEventListener("input", event => setReplayTick(Number(event.target.value)));
  $("#replay-start").addEventListener("click", () => setReplayTick(0)); $("#replay-back").addEventListener("click", () => setReplayTick(app.replayTick - 1)); $("#replay-play").addEventListener("click", toggleReplay); $("#replay-forward").addEventListener("click", () => setReplayTick(app.replayTick + 1)); $("#replay-end").addEventListener("click", () => setReplayTick(app.log?.finalState.tick || 0));
  $("#event-filter").addEventListener("change", renderReplay); $("#branch-run").addEventListener("click", branchFromReplay);
  $("#observation-overlay").addEventListener("change", renderReplay);
  document.addEventListener("keydown", event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); runScenario(); } if (!app.readOnly && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey && app.undo.length) { event.preventDefault(); app.redo.push(JSON.stringify(app.scenario)); app.scenario = JSON.parse(app.undo.pop()); changed("Undo"); } if (!app.readOnly && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && event.shiftKey && app.redo.length) { event.preventDefault(); app.undo.push(JSON.stringify(app.scenario)); app.scenario = JSON.parse(app.redo.pop()); changed("Redo"); } });
}

async function loadPreset() {
  try {
    const presetId = $("#preset-select").value;
    const preset = await api(`/presets/${presetId}.json`);
    if (app.scenario) snapshot();
    app.readOnly = true; app.pan = { x: 0, y: 0 }; app.zoom = 1;
    app.scenario = preset; app.selectedActorId = preset.actors[0]?.id || null;
    $("#save-state").textContent = "Preset loaded"; renderAll(); await validate();
  } catch (error) { announce(`Could not load preset: ${error.message}`); }
}

async function start() {
  bind();
  try {
    await createProject();
    let restored = false;
    try {
      const draft = JSON.parse(localStorage.getItem("living-here-draft") || "null");
      if (draft?.schemaVersion === "1.3.0" && Array.isArray(draft.actors) && draft.actors.length) {
        app.readOnly = false; app.scenario = draft; app.selectedActorId = draft.actors[0].id; restored = true;
        $("#save-state").textContent = "Draft restored"; renderAll(); await validate();
      }
    } catch { /* an invalid local draft is ignored */ }
    if (!restored) await loadPreset();
  }
  catch (error) { announce(`Service unavailable: ${error.message}`); }
}

start();
