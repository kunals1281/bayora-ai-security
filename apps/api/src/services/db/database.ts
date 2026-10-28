import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export interface EvaluationRecord {
  id: string;
  status: "created" | "running" | "completed" | "failed" | "killed";
  modelId: string;
  policyHash: string;
  datasetVersions: string;
  seed: number;
  redSuccessBefore: number | null;
  redSuccessAfter: number | null;
  sampleCount: number;
  resultsJson: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface StoredAuditEvent {
  id: string;
  index: number;
  type: string;
  payload: string;
  payloadHash: string;
  prevHash: string;
  hash: string;
  signature: string | null;
  timestamp: string;
}

export interface StoredProbeResult {
  id: string;
  name: string;
  command: string;
  exitCode: number;
  blocked: boolean;
  output: string;
  timestamp: string;
}

export interface StoredFinding {
  id: string;
  evaluationId: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
  evidence: string[];
  createdAt: string;
}

class SQLiteDatabase {
  private db: DatabaseSync;
  private dbPath: string;

  constructor() {
    this.dbPath =
      process.env.SQLITE_DB_PATH ??
      path.resolve(process.cwd(), "data/bayora.sqlite");

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initTables();
  }

  private initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS evaluations (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        model_id TEXT NOT NULL,
        policy_hash TEXT NOT NULL,
        dataset_versions TEXT NOT NULL,
        seed INTEGER NOT NULL,
        red_success_before REAL,
        red_success_after REAL,
        sample_count INTEGER DEFAULT 0,
        results_json TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        event_index INTEGER NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        signature TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS probe_results (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        command TEXT NOT NULL,
        exit_code INTEGER NOT NULL,
        blocked INTEGER NOT NULL,
        output TEXT,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  // --- Evaluations Persistence ---
  insertEvaluation(record: EvaluationRecord) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO evaluations (
        id, status, model_id, policy_hash, dataset_versions, seed,
        red_success_before, red_success_after, sample_count, results_json,
        created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.status,
      record.modelId,
      record.policyHash,
      record.datasetVersions,
      record.seed,
      record.redSuccessBefore,
      record.redSuccessAfter,
      record.sampleCount,
      record.resultsJson,
      record.createdAt,
      record.completedAt,
    );
  }

  getEvaluation(id: string): EvaluationRecord | null {
    const stmt = this.db.prepare(`SELECT * FROM evaluations WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      status: row.status,
      modelId: row.model_id,
      policyHash: row.policy_hash,
      datasetVersions: row.dataset_versions,
      seed: Number(row.seed),
      redSuccessBefore: row.red_success_before,
      redSuccessAfter: row.red_success_after,
      sampleCount: Number(row.sample_count),
      resultsJson: row.results_json,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  listEvaluations(): EvaluationRecord[] {
    const stmt = this.db.prepare(
      `SELECT * FROM evaluations ORDER BY created_at DESC`,
    );
    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      modelId: row.model_id,
      policyHash: row.policy_hash,
      datasetVersions: row.dataset_versions,
      seed: Number(row.seed),
      redSuccessBefore: row.red_success_before,
      redSuccessAfter: row.red_success_after,
      sampleCount: Number(row.sample_count),
      resultsJson: row.results_json,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));
  }

  updateEvaluationStatus(
    id: string,
    status: EvaluationRecord["status"],
    completedAt?: string,
    updates?: Partial<EvaluationRecord>,
  ) {
    const existing = this.getEvaluation(id);
    if (!existing) return null;

    const merged = {
      ...existing,
      ...updates,
      status,
      completedAt: completedAt ?? existing.completedAt,
    };
    this.insertEvaluation(merged);
    return merged;
  }

  // --- Audit Events Persistence ---
  insertAuditEvent(event: StoredAuditEvent) {
    const stmt = this.db.prepare(`
      INSERT INTO audit_events (
        id, event_index, event_type, payload, payload_hash, prev_hash, hash, signature, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      event.index,
      event.type,
      event.payload,
      event.payloadHash,
      event.prevHash,
      event.hash,
      event.signature,
      event.timestamp,
    );
  }

  listAuditEvents(): StoredAuditEvent[] {
    const stmt = this.db.prepare(
      `SELECT * FROM audit_events ORDER BY event_index ASC`,
    );
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      id: r.id,
      index: Number(r.event_index),
      type: r.event_type,
      payload: r.payload,
      payloadHash: r.payload_hash,
      prevHash: r.prev_hash,
      hash: r.hash,
      signature: r.signature,
      timestamp: r.timestamp,
    }));
  }

  getLatestAuditEvent(): StoredAuditEvent | null {
    const stmt = this.db.prepare(
      `SELECT * FROM audit_events ORDER BY event_index DESC LIMIT 1`,
    );
    const r = stmt.get() as any;
    if (!r) return null;
    return {
      id: r.id,
      index: Number(r.event_index),
      type: r.event_type,
      payload: r.payload,
      payloadHash: r.payload_hash,
      prevHash: r.prev_hash,
      hash: r.hash,
      signature: r.signature,
      timestamp: r.timestamp,
    };
  }

  // --- Probes Persistence ---
  insertProbeResult(probe: StoredProbeResult) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO probe_results (
        id, name, command, exit_code, blocked, output, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      probe.id,
      probe.name,
      probe.command,
      probe.exitCode,
      probe.blocked ? 1 : 0,
      probe.output,
      probe.timestamp,
    );
  }

  listProbeResults(): StoredProbeResult[] {
    const stmt = this.db.prepare(`SELECT * FROM probe_results ORDER BY timestamp DESC`);
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      command: r.command,
      exitCode: Number(r.exit_code),
      blocked: Boolean(r.blocked),
      output: r.output,
      timestamp: r.timestamp,
    }));
  }

  // --- Findings Persistence ---
  insertFinding(finding: StoredFinding) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO findings (
        id, evaluation_id, severity, title, description, evidence_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      finding.id,
      finding.evaluationId,
      finding.severity,
      finding.title,
      finding.description,
      JSON.stringify(finding.evidence),
      finding.createdAt,
    );
  }

  listFindings(): StoredFinding[] {
    const stmt = this.db.prepare(`SELECT * FROM findings ORDER BY created_at DESC`);
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      id: r.id,
      evaluationId: r.evaluation_id,
      severity: r.severity,
      title: r.title,
      description: r.description,
      evidence: JSON.parse(r.evidence_json || "[]"),
      createdAt: r.created_at,
    }));
  }
}

export const db = new SQLiteDatabase();
