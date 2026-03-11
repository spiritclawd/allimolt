/**
 * Allimolt - API Key Authentication Middleware
 * 
 * Usage in endpoints:
 *   const auth = authenticateRequest(request);
 *   if (!auth.valid) return errorResponse(auth.reason, 401);
 */

import { validateApiKey, TIERS, type TierName, type APIKey } from "./auth";

interface AuthResult {
  valid: boolean;
  tier: TierName;
  remaining: number;
  reason?: string;
  apiKey?: APIKey;
}

// Endpoints that don't require API key
const PUBLIC_ENDPOINTS = [
  "/",
  "/health",
];

// Endpoints with tier requirements
const TIER_REQUIREMENTS: Record<string, TierName> = {
  "/api/claims": "free",           // Submit claims
  "/api/agents": "free",           // Basic agent info
  "/api/stats": "free",            // Public stats
  "/api/underwriting": "developer", // Insurance underwriting
  "/api/alerts": "platform",        // Real-time alerts
  "/api/export": "enterprise",      // Data export
};

export function authenticateRequest(request: Request): AuthResult {
  const url = new URL(request.url);
  const path = url.pathname;

  // Check if public endpoint
  if (PUBLIC_ENDPOINTS.some(ep => path === ep)) {
    return { valid: true, tier: "free", remaining: -1 };
  }

  // Check for API key in headers
  const authHeader = request.headers.get("Authorization");
  const apiKeyHeader = request.headers.get("X-API-Key");
  
  let apiKey: string | null = null;

  if (authHeader?.startsWith("Bearer ")) {
    apiKey = authHeader.slice(7);
  } else if (apiKeyHeader) {
    apiKey = apiKeyHeader;
  }

  // No API key provided
  if (!apiKey) {
    // Check if endpoint allows free tier without key
    const requiredTier = getRequiredTier(path);
    if (requiredTier === "free") {
      // Allow limited free access without API key
      return { valid: true, tier: "free", remaining: 10 };
    }
    
    return { 
      valid: false, 
      tier: "free", 
      remaining: 0, 
      reason: "API key required. Get one free at allimolt.io" 
    };
  }

  // Validate API key
  const keyData = validateApiKey(apiKey);
  
  if (!keyData) {
    return {
      valid: false,
      tier: "free",
      remaining: 0,
      reason: "Invalid API key",
    };
  }

  // Check tier requirements
  const requiredTier = getRequiredTier(path);
  if (!hasTierAccess(keyData.tier, requiredTier)) {
    return {
      valid: false,
      tier: keyData.tier,
      remaining: keyData.rateLimit,
      reason: `This endpoint requires ${requiredTier} tier. Current: ${keyData.tier}`,
    };
  }

  return {
    valid: true,
    tier: keyData.tier,
    remaining: keyData.rateLimit,
    apiKey: keyData,
  };
}

function getRequiredTier(path: string): TierName {
  for (const [endpoint, tier] of Object.entries(TIER_REQUIREMENTS)) {
    if (path.startsWith(endpoint)) {
      return tier;
    }
  }
  return "free";
}

function hasTierAccess(userTier: TierName, requiredTier: TierName): boolean {
  const tierOrder: TierName[] = ["free", "developer", "platform", "enterprise"];
  const userLevel = tierOrder.indexOf(userTier);
  const requiredLevel = tierOrder.indexOf(requiredTier);
  return userLevel >= requiredLevel;
}

// Response headers for rate limiting
export function getRateLimitHeaders(result: AuthResult): Record<string, string> {
  const tierConfig = TIERS[result.tier];
  return {
    "X-RateLimit-Limit": String(tierConfig.requestsPerDay),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Tier": result.tier,
  };
}
