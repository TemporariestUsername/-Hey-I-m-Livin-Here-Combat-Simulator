#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { replay, runSimulation } from "../../../packages/engine/src/index.ts";
import { assertScenario, validateScenario, type RunLog } from "../../../packages/schema/src/index.ts";

const fixture = resolve("packages/scenarios/fixtures/threat-ends.json");
const [command = "help", input = fixture, output = "run-log.json"] = process.argv.slice(2);

async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(resolve(path), "utf8")); }

switch (command) {
  case "validate": {
    const result = validateScenario(await json(input));
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
    break;
  }
  case "run": {
    const scenario = await json(input);
    assertScenario(scenario);
    const log = runSimulation(scenario);
    await writeFile(resolve(output), `${JSON.stringify(log, null, 2)}\n`);
    console.log(`Wrote ${log.events.length} events to ${output}; final checksum ${log.finalChecksum}`);
    break;
  }
  case "replay": {
    const log = await json(input) as RunLog;
    const state = replay(log);
    console.log(`Replay verified at tick ${state.tick}; final checksum ${log.finalChecksum}`);
    break;
  }
  default:
    console.log("Usage: cli <validate|run|replay> [input.json] [output.json]");
    if (command !== "help") process.exitCode = 1;
}
