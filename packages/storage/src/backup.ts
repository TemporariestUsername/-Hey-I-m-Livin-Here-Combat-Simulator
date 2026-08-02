import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import type { ArtifactRepository } from "./artifacts.ts";
import type { MetadataRepository } from "./metadata.ts";

export interface BackupManifest {
  version: 2;
  createdAt: number;
  metadataSchemaVersions: number[];
  databaseSha256: string;
  artifactHashes: string[];
}

export async function createBackup(metadata: MetadataRepository, artifacts: ArtifactRepository, destination: string,
  now = Date.now()): Promise<BackupManifest> {
  await mkdir(join(destination, "artifacts"), { recursive: true });
  metadata.database.exec("PRAGMA wal_checkpoint(FULL)");
  await backup(metadata.database, join(destination, "metadata.sqlite"));
  const artifactHashes = [...metadata.referencedHashes()].sort();
  for (const hash of artifactHashes) {
    const bytes = await readFile(artifacts.objectPath(hash));
    if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error(`artifact ${hash} failed backup integrity check`);
    await copyFile(artifacts.objectPath(hash), join(destination, "artifacts", hash));
  }
  const databaseBytes = await readFile(join(destination, "metadata.sqlite"));
  const manifest: BackupManifest = {
    version: 2,
    createdAt: now,
    metadataSchemaVersions: metadata.schemaVersions(),
    databaseSha256: createHash("sha256").update(databaseBytes).digest("hex"),
    artifactHashes,
  };
  await writeFile(join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

export async function verifyBackup(destination: string): Promise<BackupManifest> {
  const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8")) as BackupManifest;
  if (manifest.version !== 2 || !Array.isArray(manifest.artifactHashes) || !Array.isArray(manifest.metadataSchemaVersions)) {
    throw new Error("unsupported backup manifest");
  }
  const databaseBytes = await readFile(join(destination, "metadata.sqlite"));
  if (createHash("sha256").update(databaseBytes).digest("hex") !== manifest.databaseSha256) {
    throw new Error("backup database hash mismatch");
  }
  const database = new DatabaseSync(join(destination, "metadata.sqlite"), { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
    if (integrity.integrity_check !== "ok") throw new Error("backup database integrity check failed");
    const versions = (database.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<Record<string, unknown>>)
      .map(row => Number(row.version));
    if (JSON.stringify(versions) !== JSON.stringify(manifest.metadataSchemaVersions)) {
      throw new Error("backup manifest does not match metadata schema versions");
    }
    const referenced = new Set((database.prepare("SELECT DISTINCT hash FROM project_artifacts").all() as Array<Record<string, unknown>>)
      .map(row => String(row.hash)));
    if (JSON.stringify([...referenced].sort()) !== JSON.stringify([...manifest.artifactHashes].sort())) {
      throw new Error("backup manifest does not match database references");
    }
  } finally {
    database.close();
  }
  for (const hash of manifest.artifactHashes) {
    const bytes = await readFile(join(destination, "artifacts", hash));
    if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error(`backup artifact ${hash} failed integrity check`);
  }
  return manifest;
}

export async function restoreBackup(destination: string, databasePath: string, artifactRoot: string): Promise<void> {
  const manifest = await verifyBackup(destination);
  await mkdir(join(artifactRoot, "objects"), { recursive: true });
  await mkdir(dirname(databasePath), { recursive: true });
  await copyFile(join(destination, "metadata.sqlite"), databasePath);
  for (const hash of manifest.artifactHashes) {
    const directory = join(artifactRoot, "objects", hash.slice(0, 2));
    await mkdir(directory, { recursive: true });
    await copyFile(join(destination, "artifacts", hash), join(directory, hash));
  }
}
