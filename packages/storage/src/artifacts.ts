import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { MetadataRepository } from "./metadata.ts";

export type PublishCrashPoint = "after-temp-sync" | "after-rename";

export class ArtifactRepository {
  readonly root: string;
  readonly metadata: MetadataRepository;

  constructor(root: string, metadata: MetadataRepository) {
    this.root = root;
    this.metadata = metadata;
  }

  objectPath(hash: string): string { return join(this.root, "objects", hash.slice(0, 2), hash); }

  async initialize(): Promise<void> {
    await mkdir(join(this.root, "objects"), { recursive: true });
    await mkdir(join(this.root, "tmp"), { recursive: true });
    await mkdir(join(this.root, "quarantine"), { recursive: true });
    for (const name of await readdir(join(this.root, "tmp"))) await rm(join(this.root, "tmp", name), { force: true });
  }

  async publish(projectId: string, bytes: Uint8Array, kind: string, crashAt?: PublishCrashPoint): Promise<string> {
    if (!this.metadata.projectExists(projectId)) throw new Error(`unknown project ${projectId}`);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const destination = this.objectPath(hash);
    await mkdir(join(this.root, "objects", hash.slice(0, 2)), { recursive: true });
    const temporary = join(this.root, "tmp", `${hash}.${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (crashAt === "after-temp-sync") throw new Error("injected crash after temp sync");
    try {
      await rename(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await rm(temporary, { force: true });
    }
    if (crashAt === "after-rename") throw new Error("injected crash after rename");
    this.metadata.addArtifactReference(projectId, hash, bytes.byteLength, kind);
    return hash;
  }

  async read(projectId: string, hash: string): Promise<Uint8Array> {
    if (!this.metadata.projectCanReadArtifact(projectId, hash)) throw new Error("artifact not authorized for project");
    const bytes = await readFile(this.objectPath(hash));
    if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error("artifact integrity mismatch");
    return bytes;
  }

  async garbageCollectOrphans(): Promise<string[]> {
    const referenced = this.metadata.referencedHashes();
    const removed: string[] = [];
    for (const prefix of await readdir(join(this.root, "objects")).catch(() => [])) {
      const directory = join(this.root, "objects", prefix);
      if (!(await stat(directory)).isDirectory()) continue;
      for (const hash of await readdir(directory)) {
        if (!referenced.has(hash)) {
          await rm(join(directory, hash), { force: true });
          removed.push(hash);
        }
      }
    }
    return removed.sort();
  }

  async quarantine(hash: string, now = Date.now()): Promise<void> {
    const source = this.objectPath(hash);
    const destination = join(this.root, "quarantine", `${now}.${hash}`);
    await rename(source, destination).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }

  async sweepQuarantine(now = Date.now(), delayMs = 86_400_000): Promise<string[]> {
    const removed: string[] = [];
    for (const name of await readdir(join(this.root, "quarantine"))) {
      const separator = name.indexOf(".");
      const timestamp = Number(name.slice(0, separator));
      if (Number.isFinite(timestamp) && now - timestamp >= delayMs) {
        await rm(join(this.root, "quarantine", name), { force: true });
        removed.push(name.slice(separator + 1));
      }
    }
    return removed.sort();
  }

  async hardDelete(hash: string): Promise<void> {
    await rm(this.objectPath(hash), { force: true });
    for (const name of await readdir(join(this.root, "quarantine"))) {
      if (name.endsWith(`.${hash}`)) await rm(join(this.root, "quarantine", name), { force: true });
    }
  }
}
