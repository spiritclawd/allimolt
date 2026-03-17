/**
 * AlliGo - Database Layer
 * Persistent SQLite storage, designed to scale to PostgreSQL
 */

import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import {
  AgentClaim,
  ClaimType,
  ClaimCategory,
  Resolution,
  ClaimSource,
} from "../schema/claim";
import { config, ensureDatabaseDir, checkVolumeMount } from "../config";

// Ensure database directory exists before creating DB
ensureDatabaseDir();

// Check if persistent volume is mounted (logs warning if not)
const volumeStatus = checkVolumeMount();

// Initialize database with persistent storage
const db = new Database(config.databasePath, { create: true });

// Enable WAL mode for better concurrent performance
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA synchronous = NORMAL");
db.run("PRAGMA cache_size = 10000");

// Create tables
db.run(`
  CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    agentId TEXT NOT NULL,
    agentName TEXT,
    developer TEXT,
    developerContact TEXT,
    
    claimType TEXT NOT NULL,
    category TEXT NOT NULL,
    severityScore INTEGER DEFAULT 1,
    severityLevel TEXT DEFAULT 'low',
    
    amountLost REAL NOT NULL,
    assetType TEXT,
    assetAmount REAL,
    recoveredAmount REAL,
    
    chain TEXT,
    txHash TEXT,
    contractAddress TEXT,
    counterparty TEXT,
    
    timestamp INTEGER NOT NULL,
    reportedAt INTEGER NOT NULL,
    resolvedAt INTEGER,
    
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    rootCause TEXT,
    
    resolution TEXT DEFAULT 'pending',
    resolutionNotes TEXT,
    
    source TEXT DEFAULT 'self_reported',
    verified INTEGER DEFAULT 0,
    evidence TEXT,
    
    tags TEXT,
    platform TEXT,
    agentVersion TEXT,
    
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

// Create indexes for common queries
db.run(`CREATE INDEX IF NOT EXISTS idx_claims_agentId ON claims(agentId)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_claims_timestamp ON claims(timestamp)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_claims_type ON claims(claimType)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_claims_category ON claims(category)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_claims_chain ON claims(chain)`);

// Migration: add EAS attestation columns (safe — ADD COLUMN is idempotent via try/catch)
try { db.run("ALTER TABLE claims ADD COLUMN easUid TEXT"); } catch {}
try { db.run("ALTER TABLE claims ADD COLUMN easVerifyUrl TEXT"); } catch {}
try { db.run("ALTER TABLE claims ADD COLUMN easMode TEXT"); } catch {}

// ==================== PREDICTIONS ====================
// Pre-mortem risk flags: timestamped onchain BEFORE an incident happens.
// When a predicted incident is later confirmed, status → 'confirmed'.
// The gap between predictedAt and confirmedAt is the moat proof.
db.run(`
  CREATE TABLE IF NOT EXISTS predictions (
    id TEXT PRIMARY KEY,
    agentId TEXT NOT NULL,
    agentName TEXT,
    protocol TEXT,
    chain TEXT,
    contractAddress TEXT,

    archetype TEXT NOT NULL,
    confidence INTEGER NOT NULL,
    riskScore INTEGER NOT NULL,
    riskLevel TEXT NOT NULL,

    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    reasons TEXT NOT NULL,

    status TEXT DEFAULT 'active',
    predictedAt INTEGER NOT NULL,
    confirmedAt INTEGER,
    confirmedClaimId TEXT,
    confirmedTxHash TEXT,

    source TEXT DEFAULT 'virtuals_monitor',
    easUid TEXT,
    easVerifyUrl TEXT,

    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);
db.run(`CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_predictions_agentId ON predictions(agentId)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_predictions_predictedAt ON predictions(predictedAt)`);

// Create API keys table
db.run(`
  CREATE TABLE IF NOT EXISTS api_keys (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tier TEXT DEFAULT 'free',
    permissions TEXT DEFAULT 'read',
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    last_used INTEGER,
    request_count INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  )
`);

// Create audit log table
db.run(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    clientId TEXT,
    path TEXT,
    method TEXT,
    success INTEGER,
    error TEXT,
    timestamp INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

// ==================== CLAIMS ====================

export function insertClaim(claim: AgentClaim): void {
  const stmt = db.prepare(`
    INSERT INTO claims (
      id, agentId, agentName, developer, developerContact,
      claimType, category, severityScore, severityLevel,
      amountLost, assetType, assetAmount, recoveredAmount,
      chain, txHash, contractAddress, counterparty,
      timestamp, reportedAt, resolvedAt,
      title, description, rootCause,
      resolution, resolutionNotes,
      source, verified, evidence,
      tags, platform, agentVersion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    claim.id,
    claim.agentId,
    claim.agentName || null,
    claim.developer || null,
    claim.developerContact || null,
    claim.claimType,
    claim.category,
    claim.severity?.score || 1,
    claim.severity?.level || "low",
    claim.amountLost,
    claim.assetType || null,
    claim.assetAmount || null,
    claim.recoveredAmount || null,
    claim.chain || null,
    claim.txHash || null,
    claim.contractAddress || null,
    claim.counterparty || null,
    claim.timestamp,
    claim.reportedAt,
    claim.resolvedAt || null,
    claim.title,
    claim.description,
    claim.rootCause || null,
    claim.resolution,
    claim.resolutionNotes || null,
    claim.source,
    claim.verified ? 1 : 0,
    claim.evidence ? JSON.stringify(claim.evidence) : null,
    claim.tags ? JSON.stringify(claim.tags) : null,
    claim.platform || null,
    claim.agentVersion || null
  );
}

export function getClaimById(id: string): AgentClaim | null {
  const stmt = db.prepare("SELECT * FROM claims WHERE id = ?");
  const row = stmt.get(id) as any;
  return row ? rowToClaim(row) : null;
}

export function getClaimsByAgent(agentId: string): AgentClaim[] {
  const stmt = db.prepare("SELECT * FROM claims WHERE agentId = ? ORDER BY timestamp DESC");
  const rows = stmt.all(agentId) as any[];
  return rows.map(rowToClaim);
}

export function getAllClaims(limit = 100, offset = 0): AgentClaim[] {
  const stmt = db.prepare("SELECT * FROM claims ORDER BY timestamp DESC LIMIT ? OFFSET ?");
  const rows = stmt.all(limit, offset) as any[];
  return rows.map(rowToClaim);
}

export function countClaims(): number {
  const stmt = db.prepare("SELECT COUNT(*) as count FROM claims");
  const result = stmt.get() as { count: number };
  return result.count;
}

export function searchClaims(query: string): AgentClaim[] {
  const stmt = db.prepare(`
    SELECT * FROM claims 
    WHERE agentId LIKE ? OR agentName LIKE ? OR title LIKE ? OR description LIKE ?
    ORDER BY timestamp DESC
    LIMIT 50
  `);
  const searchTerm = `%${query}%`;
  const rows = stmt.all(searchTerm, searchTerm, searchTerm, searchTerm) as any[];
  return rows.map(rowToClaim);
}

export function updateClaimResolution(id: string, resolution: Resolution, notes?: string): boolean {
  const stmt = db.prepare(`
    UPDATE claims 
    SET resolution = ?, resolutionNotes = ?, resolvedAt = ?
    WHERE id = ?
  `);
  const result = stmt.run(resolution, notes || null, Date.now(), id);
  return result.changes > 0;
}

// ==================== API KEYS ====================

export interface ApiKey {
  key: string;
  name: string;
  tier: "free" | "pro" | "enterprise";
  permissions: "read" | "write" | "admin";
  createdAt: number;
  lastUsed?: number;
  requestCount: number;
  active: boolean;
}

export function getApiKey(key: string): ApiKey | null {
  const stmt = db.prepare("SELECT * FROM api_keys WHERE key = ? AND active = 1");
  const row = stmt.get(key) as any;
  if (!row) return null;
  
  // Update last used
  db.prepare("UPDATE api_keys SET last_used = ?, request_count = request_count + 1 WHERE key = ?")
    .run(Date.now(), key);
  
  return {
    key: row.key,
    name: row.name,
    tier: row.tier,
    permissions: row.permissions,
    createdAt: row.created_at,
    lastUsed: row.last_used,
    requestCount: row.request_count,
    active: row.active === 1,
  };
}

export function createApiKey(name: string, tier: ApiKey["tier"] = "free", permissions: ApiKey["permissions"] = "read"): string {
  const key = `alligo_${tier}_${Math.random().toString(36).substr(2, 24)}`;
  const stmt = db.prepare("INSERT INTO api_keys (key, name, tier, permissions) VALUES (?, ?, ?, ?)");
  stmt.run(key, name, tier, permissions);
  return key;
}

export function listApiKeys(): ApiKey[] {
  const stmt = db.prepare("SELECT * FROM api_keys ORDER BY created_at DESC");
  const rows = stmt.all() as any[];
  return rows.map(row => ({
    key: row.key,
    name: row.name,
    tier: row.tier,
    permissions: row.permissions,
    createdAt: row.created_at,
    lastUsed: row.last_used,
    requestCount: row.request_count,
    active: row.active === 1,
  }));
}

export function revokeApiKey(key: string): boolean {
  const stmt = db.prepare("UPDATE api_keys SET active = 0 WHERE key = ?");
  const result = stmt.run(key);
  return result.changes > 0;
}

// ==================== AUDIT LOG ====================

export function logAudit(entry: {
  action: string;
  clientId?: string;
  path?: string;
  method?: string;
  success: boolean;
  error?: string;
}): void {
  const stmt = db.prepare(`
    INSERT INTO audit_log (action, clientId, path, method, success, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    entry.action,
    entry.clientId || null,
    entry.path || null,
    entry.method || null,
    entry.success ? 1 : 0,
    entry.error || null
  );
}

// ==================== HELPERS ====================

function rowToClaim(row: any): AgentClaim {
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: row.agentName || undefined,
    developer: row.developer || undefined,
    developerContact: row.developerContact || undefined,
    claimType: row.claimType as ClaimType,
    category: row.category as ClaimCategory,
    severity: {
      score: row.severityScore,
      level: row.severityLevel,
      factors: [],
    },
    amountLost: row.amountLost,
    assetType: row.assetType || undefined,
    assetAmount: row.assetAmount || undefined,
    recoveredAmount: row.recoveredAmount || undefined,
    chain: row.chain || undefined,
    txHash: row.txHash || undefined,
    contractAddress: row.contractAddress || undefined,
    counterparty: row.counterparty || undefined,
    timestamp: row.timestamp,
    reportedAt: row.reportedAt,
    resolvedAt: row.resolvedAt || undefined,
    title: row.title,
    description: row.description,
    rootCause: row.rootCause || undefined,
    resolution: row.resolution as Resolution,
    resolutionNotes: row.resolutionNotes || undefined,
    source: row.source as ClaimSource,
    verified: row.verified === 1,
    evidence: row.evidence ? JSON.parse(row.evidence) : undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    platform: row.platform || undefined,
    agentVersion: row.agentVersion || undefined,
    easUid: row.easUid || undefined,
    easVerifyUrl: row.easVerifyUrl || undefined,
    easMode: row.easMode || undefined,
  };
}

// Patch a claim's on-chain and EAS fields (admin only)
export function patchClaimOnChain(id: string, fields: {
  txHash?: string;
  contractAddress?: string;
  chain?: string;
  eas_uid?: string;
  eas_verify_url?: string;
  eas_mode?: string;
}): boolean {
  const updates: string[] = [];
  const values: (string | null)[] = [];
  if (fields.txHash !== undefined) { updates.push("txHash = ?"); values.push(fields.txHash); }
  if (fields.contractAddress !== undefined) { updates.push("contractAddress = ?"); values.push(fields.contractAddress); }
  if (fields.chain !== undefined) { updates.push("chain = ?"); values.push(fields.chain); }
  if (fields.eas_uid !== undefined) { updates.push("easUid = ?"); values.push(fields.eas_uid); }
  if (fields.eas_verify_url !== undefined) { updates.push("easVerifyUrl = ?"); values.push(fields.eas_verify_url); }
  if (fields.eas_mode !== undefined) { updates.push("easMode = ?"); values.push(fields.eas_mode); }
  if (updates.length === 0) return false;
  values.push(id);
  const stmt = db.prepare(`UPDATE claims SET ${updates.join(", ")} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// Delete a claim by ID (admin only)
export function deleteClaimById(id: string): boolean {
  const stmt = db.prepare("DELETE FROM claims WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

// Check if database is empty (for seeding)
export function isDatabaseEmpty(): boolean {
  const count = countClaims();
  return count === 0;
}

// ==================== PREDICTIONS CRUD ====================

export interface Prediction {
  id: string;
  agentId: string;
  agentName?: string;
  protocol?: string;
  chain?: string;
  contractAddress?: string;
  archetype: string;
  confidence: number;
  riskScore: number;
  riskLevel: string;
  title: string;
  summary: string;
  reasons: string[];
  status: "active" | "confirmed" | "expired" | "false_positive";
  predictedAt: number;
  confirmedAt?: number;
  confirmedClaimId?: string;
  confirmedTxHash?: string;
  source: string;
  easUid?: string;
  easVerifyUrl?: string;
}

export function insertPrediction(p: Prediction): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO predictions (
      id, agentId, agentName, protocol, chain, contractAddress,
      archetype, confidence, riskScore, riskLevel,
      title, summary, reasons, status, predictedAt,
      confirmedAt, confirmedClaimId, confirmedTxHash, source, easUid, easVerifyUrl
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);
  stmt.run(
    p.id, p.agentId, p.agentName ?? null, p.protocol ?? null, p.chain ?? null, p.contractAddress ?? null,
    p.archetype, p.confidence, p.riskScore, p.riskLevel,
    p.title, p.summary, JSON.stringify(p.reasons), p.status, p.predictedAt,
    p.confirmedAt ?? null, p.confirmedClaimId ?? null, p.confirmedTxHash ?? null,
    p.source, p.easUid ?? null, p.easVerifyUrl ?? null
  );
}

export function getPredictions(opts: { status?: string; limit?: number } = {}): Prediction[] {
  let query = "SELECT * FROM predictions";
  const params: any[] = [];
  if (opts.status) { query += " WHERE status = ?"; params.push(opts.status); }
  query += " ORDER BY predictedAt DESC LIMIT ?";
  params.push(opts.limit ?? 100);
  const rows = db.prepare(query).all(...params) as any[];
  return rows.map(rowToPrediction);
}

export function getPredictionById(id: string): Prediction | null {
  const row = db.prepare("SELECT * FROM predictions WHERE id = ?").get(id) as any;
  return row ? rowToPrediction(row) : null;
}

export function confirmPrediction(id: string, claimId: string, txHash?: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`
    UPDATE predictions SET status = 'confirmed', confirmedAt = ?, confirmedClaimId = ?, confirmedTxHash = ?
    WHERE id = ?
  `);
  const result = stmt.run(now, claimId, txHash ?? null, id);
  return result.changes > 0;
}

export function patchPredictionEas(id: string, easUid: string, easVerifyUrl: string): boolean {
  const stmt = db.prepare("UPDATE predictions SET easUid = ?, easVerifyUrl = ? WHERE id = ?");
  const result = stmt.run(easUid, easVerifyUrl, id);
  return result.changes > 0;
}

export function countPredictions(status?: string): number {
  if (status) {
    return (db.prepare("SELECT COUNT(*) as c FROM predictions WHERE status = ?").get(status) as any).c;
  }
  return (db.prepare("SELECT COUNT(*) as c FROM predictions").get() as any).c;
}

function rowToPrediction(row: any): Prediction {
  return {
    id: row.id,
    agentId: row.agentId,
    agentName: row.agentName ?? undefined,
    protocol: row.protocol ?? undefined,
    chain: row.chain ?? undefined,
    contractAddress: row.contractAddress ?? undefined,
    archetype: row.archetype,
    confidence: row.confidence,
    riskScore: row.riskScore,
    riskLevel: row.riskLevel,
    title: row.title,
    summary: row.summary,
    reasons: JSON.parse(row.reasons ?? "[]"),
    status: row.status,
    predictedAt: row.predictedAt,
    confirmedAt: row.confirmedAt ?? undefined,
    confirmedClaimId: row.confirmedClaimId ?? undefined,
    confirmedTxHash: row.confirmedTxHash ?? undefined,
    source: row.source,
    easUid: row.easUid ?? undefined,
    easVerifyUrl: row.easVerifyUrl ?? undefined,
  };
}

// Close database connection (for graceful shutdown)
export function closeDatabase(): void {
  db.close();
}

export { db };
