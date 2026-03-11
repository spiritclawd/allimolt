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
import { config, ensureDatabaseDir } from "../config";

// Ensure database directory exists before creating DB
ensureDatabaseDir();

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
  };
}

// Check if database is empty (for seeding)
export function isDatabaseEmpty(): boolean {
  const count = countClaims();
  return count === 0;
}

// Close database connection (for graceful shutdown)
export function closeDatabase(): void {
  db.close();
}

export { db };
