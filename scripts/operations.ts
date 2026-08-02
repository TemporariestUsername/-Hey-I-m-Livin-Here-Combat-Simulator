#!/usr/bin/env node
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ArtifactRepository, createBackup, MetadataRepository, restoreBackup, verifyBackup,
} from "../packages/storage/src/index.ts";

const [command, first, second] = process.argv.slice(2);
const usage = "usage: node scripts/operations.ts backup <data-root> <backup-dir> | verify <backup-dir> | restore <backup-dir> <empty-data-root> | migrate-check <data-root>";
if (!command) throw new Error(usage);

if (command === "verify") {
  if (!first || second) throw new Error(usage);
  const manifest = await verifyBackup(first);
  console.log(JSON.stringify({ verified: true, ...manifest }, null, 2));
} else if (command === "restore") {
  if (!first || !second) throw new Error(usage);
  const metadataPath = join(second, "metadata.sqlite");
  try { await access(metadataPath); throw new Error("restore target already contains metadata.sqlite; choose an empty directory"); }
  catch (error) { if (error instanceof Error && !error.message.includes("ENOENT") && !error.message.includes("no such file")) throw error; }
  await mkdir(second, { recursive: true });
  await restoreBackup(first, metadataPath, join(second, "artifacts"));
  console.log(JSON.stringify({ restored: true, dataRoot: second }, null, 2));
} else if (command === "backup" || command === "migrate-check") {
  if (!first || (command === "backup" && !second)) throw new Error(usage);
  const metadata = new MetadataRepository(join(first, "metadata.sqlite"));
  try {
    if (command === "backup") {
      const artifacts = new ArtifactRepository(join(first, "artifacts"), metadata);
      const manifest = await createBackup(metadata, artifacts, second!);
      console.log(JSON.stringify({ backedUp: true, ...manifest }, null, 2));
    } else {
      console.log(JSON.stringify({ integrity: metadata.integrityCheck(), schemaVersions: metadata.schemaVersions() }, null, 2));
    }
  } finally { metadata.close(); }
} else {
  throw new Error(usage);
}
