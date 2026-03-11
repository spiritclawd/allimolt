/**
 * Allimolt - Auth Layer
 * 
 * API key based authentication for private API access
 */

export interface APIKey {
  id: string;
  key: string;
  name: string;
  permissions: ("read" | "write" | "admin")[];
  createdAt: number;
  lastUsed: number;
  rateLimit: number; // requests per minute
}

// In-memory API key store
// For production: use PostgreSQL
const apiKeys: Map<string, APIKey> = new Map();

// Default admin key - MUST be changed in production
const DEFAULT_ADMIN_KEY = "allimolt_admin_change_me";

function hashKey(key: string): string {
  // Simple hash for demo - in production use proper bcrypt/argon2
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

export function initAuth(): void {
  // Initialize with default key if no keys exist
  if (apiKeys.size === 0) {
    const defaultKey: APIKey = {
      id: "default_admin",
      key: hashKey(DEFAULT_ADMIN_KEY),
      name: "Default Admin",
      permissions: ["read", "write", "admin"],
      createdAt: Date.now(),
      lastUsed: Date.now(),
      rateLimit: 1000,
    };
    apiKeys.set(DEFAULT_ADMIN_KEY, defaultKey);
    console.log("⚠️  DEFAULT API KEY ACTIVE - CHANGE IN PRODUCTION");
    console.log(`   Key: ${DEFAULT_ADMIN_KEY}`);
  }
}

export function validateApiKey(key: string): APIKey | null {
  const apiKey = apiKeys.get(key);
  if (!apiKey) return null;
  
  // Update last used
  apiKey.lastUsed = Date.now();
  
  return apiKey;
}

export function addApiKey(
  name: string,
  permissions: ("read" | "write" | "admin")[] = ["read"],
  rateLimit: number = 100
): { key: APIKey; plainKey: string } {
  const plainKey = `allimolt_${crypto.randomUUID().replace(/-/g, "")}`;
  const hashedKey = hashKey(plainKey);
  
  const newKey: APIKey = {
    id: crypto.randomUUID(),
    key: hashedKey,
    name,
    permissions,
    createdAt: Date.now(),
    lastUsed: Date.now(),
    rateLimit,
  };
  
  apiKeys.set(plainKey, newKey);
  
  return { key: newKey, plainKey };
}

export function revokeApiKey(keyId: string): boolean {
  for (const [plainKey, apiKey] of apiKeys.entries()) {
    if (apiKey.id === keyId) {
      apiKeys.delete(plainKey);
      return true;
    }
  }
  return false;
}

export function listApiKeys(): Omit<APIKey, "key">[] {
  return Array.from(apiKeys.values()).map(k => ({
    id: k.id,
    name: k.name,
    permissions: k.permissions,
    createdAt: k.createdAt,
    lastUsed: k.lastUsed,
    rateLimit: k.rateLimit,
  }));
}

export function hasPermission(apiKey: APIKey | null, permission: "read" | "write" | "admin"): boolean {
  if (!apiKey) return false;
  return apiKey.permissions.includes(permission);
}

export function getAuthHeader(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  
  return null;
}

export function getRateLimitForKey(key: APIKey | null): number {
  if (!key) return 10; // Default strict limit for unauthenticated
  return key.rateLimit;
}
