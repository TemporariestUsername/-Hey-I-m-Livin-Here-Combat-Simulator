import { DatabaseSync } from "node:sqlite";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobRecord {
  id: string;
  projectId: string;
  kind: string;
  status: JobStatus;
  payload: unknown;
  resultHash?: string;
  idempotencyKey: string;
  attempts: number;
  leaseOwner?: string;
  leaseUntil?: number;
  cancelRequested: boolean;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

type Row = Record<string, unknown>;

function asJob(row: Row): JobRecord {
  return {
    id: String(row.id), projectId: String(row.project_id), kind: String(row.kind), status: String(row.status) as JobStatus,
    payload: JSON.parse(String(row.payload_json)), idempotencyKey: String(row.idempotency_key), attempts: Number(row.attempts),
    cancelRequested: Boolean(row.cancel_requested), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    ...(row.result_hash ? { resultHash: String(row.result_hash) } : {}),
    ...(row.lease_owner ? { leaseOwner: String(row.lease_owner) } : {}),
    ...(row.lease_until ? { leaseUntil: Number(row.lease_until) } : {}),
    ...(row.error ? { error: String(row.error) } : {}),
  };
}

export class MetadataRepository {
  readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts(
        hash TEXT PRIMARY KEY, size INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_artifacts(
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        hash TEXT NOT NULL REFERENCES artifacts(hash), kind TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(project_id, hash, kind)
      );
      CREATE TABLE IF NOT EXISTS jobs(
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL, result_hash TEXT,
        idempotency_key TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lease_owner TEXT,
        lease_until INTEGER, cancel_requested INTEGER NOT NULL DEFAULT 0, error TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(project_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS jobs_lease_index ON jobs(status, lease_until, created_at);
      CREATE TABLE IF NOT EXISTS episodes(
        episode_key TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        variant_id TEXT NOT NULL, seed INTEGER NOT NULL, status TEXT NOT NULL,
        artifact_hash TEXT, metrics_json TEXT, error TEXT, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_events(
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, event TEXT NOT NULL,
        subject_id TEXT, recorded_at INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, unixepoch('subsec') * 1000);
    `);
    this.transaction(() => {
      this.database.exec("CREATE INDEX IF NOT EXISTS audit_events_project_time ON audit_events(project_id, recorded_at, sequence)");
      this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES (?,?)").run(2, Date.now());
    });
  }

  transaction<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createProject(id: string, name: string, now = Date.now()): void {
    this.database.prepare("INSERT INTO projects(id,name,created_at) VALUES (?,?,?)").run(id, name, now);
    this.audit(id, "project-created", id, now);
  }

  projectExists(id: string): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM projects WHERE id=?").get(id));
  }

  addArtifactReference(projectId: string, hash: string, size: number, kind: string, now = Date.now()): void {
    this.transaction(() => {
      this.database.prepare("INSERT OR IGNORE INTO artifacts(hash,size,created_at) VALUES (?,?,?)").run(hash, size, now);
      this.database.prepare("INSERT OR IGNORE INTO project_artifacts(project_id,hash,kind,created_at) VALUES (?,?,?,?)")
        .run(projectId, hash, kind, now);
      this.audit(projectId, "artifact-referenced", hash, now);
    });
  }

  projectCanReadArtifact(projectId: string, hash: string): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM project_artifacts WHERE project_id=? AND hash=? LIMIT 1").get(projectId, hash));
  }

  referencedHashes(): Set<string> {
    return new Set((this.database.prepare("SELECT DISTINCT hash FROM project_artifacts").all() as Row[]).map(row => String(row.hash)));
  }

  deleteProject(projectId: string, now = Date.now()): string[] {
    return this.transaction(() => {
      const hashes = (this.database.prepare("SELECT hash FROM project_artifacts WHERE project_id=?").all(projectId) as Row[])
        .map(row => String(row.hash));
      this.database.prepare("DELETE FROM projects WHERE id=?").run(projectId);
      this.audit(undefined, "project-deleted", projectId, now);
      return hashes.filter(hash => !this.database.prepare("SELECT 1 FROM project_artifacts WHERE hash=? LIMIT 1").get(hash));
    });
  }

  enqueueJob(job: Omit<JobRecord, "status" | "attempts" | "cancelRequested" | "createdAt" | "updatedAt">, now = Date.now()): JobRecord {
    this.database.prepare(`INSERT OR IGNORE INTO jobs
      (id,project_id,kind,status,payload_json,idempotency_key,created_at,updated_at)
      VALUES (?,?,?,'queued',?,?,?,?)`).run(job.id, job.projectId, job.kind, JSON.stringify(job.payload), job.idempotencyKey, now, now);
    return this.getJobByIdempotency(job.projectId, job.idempotencyKey)!;
  }

  getJob(id: string): JobRecord | undefined {
    const row = this.database.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Row | undefined;
    return row ? asJob(row) : undefined;
  }

  getJobByIdempotency(projectId: string, key: string): JobRecord | undefined {
    const row = this.database.prepare("SELECT * FROM jobs WHERE project_id=? AND idempotency_key=?").get(projectId, key) as Row | undefined;
    return row ? asJob(row) : undefined;
  }

  listJobs(projectId: string, limit = 50, after?: { createdAt: number; id: string }): JobRecord[] {
    const rows = after
      ? this.database.prepare(`SELECT * FROM jobs WHERE project_id=? AND (created_at>? OR (created_at=? AND id>?))
          ORDER BY created_at,id LIMIT ?`).all(projectId, after.createdAt, after.createdAt, after.id, limit)
      : this.database.prepare("SELECT * FROM jobs WHERE project_id=? ORDER BY created_at,id LIMIT ?").all(projectId, limit);
    return (rows as Row[]).map(asJob);
  }

  recoverExpiredJobs(now = Date.now()): number {
    const result = this.database.prepare(`UPDATE jobs SET status='queued',lease_owner=NULL,lease_until=NULL,updated_at=?
      WHERE status='running' AND lease_until IS NOT NULL AND lease_until<=? AND cancel_requested=0`).run(now, now);
    return Number(result.changes);
  }

  leaseNextJob(owner: string, now = Date.now(), leaseMs = 30_000): JobRecord | undefined {
    return this.transaction(() => {
      this.recoverExpiredJobs(now);
      const row = this.database.prepare(`SELECT id FROM jobs WHERE status='queued' AND cancel_requested=0 ORDER BY created_at,id LIMIT 1`).get() as Row | undefined;
      if (!row) return undefined;
      this.database.prepare(`UPDATE jobs SET status='running',lease_owner=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'`)
        .run(owner, now + leaseMs, now, row.id);
      return this.getJob(String(row.id));
    });
  }

  heartbeat(jobId: string, owner: string, now = Date.now(), leaseMs = 30_000): boolean {
    const result = this.database.prepare(`UPDATE jobs SET lease_until=?,updated_at=? WHERE id=? AND status='running' AND lease_owner=?`)
      .run(now + leaseMs, now, jobId, owner);
    return Number(result.changes) === 1;
  }

  requestCancellation(jobId: string, now = Date.now()): void {
    this.database.prepare(`UPDATE jobs SET cancel_requested=1,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,updated_at=? WHERE id=?`)
      .run(now, jobId);
  }

  finishJob(jobId: string, owner: string, status: "completed" | "failed" | "cancelled", resultHash?: string, error?: string, now = Date.now()): void {
    const result = this.database.prepare(`UPDATE jobs SET status=?,result_hash=?,error=?,lease_owner=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND status='running' AND lease_owner=?`).run(status, resultHash ?? null, error ?? null, now, jobId, owner);
    if (Number(result.changes) !== 1) throw new Error(`job ${jobId} is not leased by ${owner}`);
  }

  upsertEpisode(jobId: string, episodeKey: string, variantId: string, seed: number, status: string,
    artifactHash?: string, metrics?: unknown, error?: string, now = Date.now()): void {
    this.database.prepare(`INSERT INTO episodes(episode_key,job_id,variant_id,seed,status,artifact_hash,metrics_json,error,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(episode_key) DO UPDATE SET
      status=excluded.status,artifact_hash=excluded.artifact_hash,metrics_json=excluded.metrics_json,error=excluded.error,updated_at=excluded.updated_at`)
      .run(episodeKey, jobId, variantId, seed, status, artifactHash ?? null, metrics ? JSON.stringify(metrics) : null, error ?? null, now);
  }

  episodes(jobId: string): Array<{ episodeKey: string; variantId: string; seed: number; status: string; artifactHash?: string; metrics?: unknown }> {
    return (this.database.prepare("SELECT * FROM episodes WHERE job_id=? ORDER BY variant_id,seed").all(jobId) as Row[]).map(row => ({
      episodeKey: String(row.episode_key), variantId: String(row.variant_id), seed: Number(row.seed), status: String(row.status),
      ...(row.artifact_hash ? { artifactHash: String(row.artifact_hash) } : {}),
      ...(row.metrics_json ? { metrics: JSON.parse(String(row.metrics_json)) } : {}),
    }));
  }

  integrityCheck(): string {
    return String((this.database.prepare("PRAGMA integrity_check").get() as Row).integrity_check);
  }

  schemaVersions(): number[] {
    return (this.database.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Row[])
      .map(row => Number(row.version));
  }

  audit(projectId: string | undefined, event: string, subjectId: string | undefined, now = Date.now()): void {
    this.database.prepare("INSERT INTO audit_events(project_id,event,subject_id,recorded_at) VALUES (?,?,?,?)")
      .run(projectId ?? null, event, subjectId ?? null, now);
  }

  close(): void { this.database.close(); }
}
