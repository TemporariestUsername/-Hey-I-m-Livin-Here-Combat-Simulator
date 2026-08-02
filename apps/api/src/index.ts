#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createApiServer, listenLocal } from "./server.ts";
import { ExperimentService } from "../../../packages/service/src/index.ts";
import { ArtifactRepository, MetadataRepository } from "../../../packages/storage/src/index.ts";

const dataRoot = resolve(process.env.LIVING_HERE_DATA ?? ".living-here");
await mkdir(dataRoot, { recursive: true });
const metadata = new MetadataRepository(resolve(dataRoot, "metadata.sqlite"));
const artifacts = new ArtifactRepository(resolve(dataRoot, "artifacts"), metadata);
await artifacts.initialize();
await artifacts.garbageCollectOrphans();
metadata.recoverExpiredJobs();
const experiments = new ExperimentService(metadata, artifacts);
const server = createApiServer({ metadata, artifacts, experiments, autoRun: true });
const port = Number(process.env.LIVING_HERE_PORT ?? 8787);
const address = await listenLocal(server, port);
console.log(`Living Here local API listening at http://${address.host}:${address.port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.closeAllConnections();
    server.close(() => {
      metadata.close();
      process.exit(0);
    });
  });
}
