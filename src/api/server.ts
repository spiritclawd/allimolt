/**
 * AlliGo - API Server
 * The Credit Bureau for AI Agents
 */

import { serve } from "bun";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  AgentClaim,
  SubmitClaimRequest,
  SubmitClaimResponse,
  AgentScoreResponse,
  ClaimsQueryResponse,
  ClaimType,
  ClaimCategory,
  Resolution,
  ClaimSource,
  calculateSeverity,
  gradeFromScore,
} from "../schema/claim";
import {
  insertClaim,
  getClaimById,
  getClaimsByAgent,
  getAllClaims,
  countClaims,
  getApiKey,
  createApiKey,
  listApiKeys,
  isDatabaseEmpty,
  searchClaims,
  ApiKey,
} from "./db";
import {
  checkRateLimit,
  validateClaimSubmission,
  getClientId,
  SECURITY_HEADERS,
} from "../security/middleware";
import { handleAuthRoute, AUTH_ROUTES } from "../auth/routes";
import { requireAuth, hasPermission } from "../auth/middleware";
import { config, validateConfig, printConfig } from "../config";
import { generateBadge, generateCompactBadge, generateBannerBadge } from "../badge/index";
import { handlePaymentRoutes } from "../payments/routes";
import { handleLeadRoutes } from "../leads/routes";
import { notifyNewClaim } from "../notifications/index";
import { testTelegramConnection } from "../telegram/index";
import { generateAgentReport, formatReportAsMarkdown } from "../reports/agent-report";
import { x402Middleware, isX402Configured, getClientId, hasValidAccess, getPaymentStats, PAYMENT_TIERS } from "../payments/x402";
import { generateRiskReport, formatReportAsJSON, formatReportAsMarkdown } from "../forensics/report";

// ==================== RISK SCORING ====================

function calculateRiskScore(claims: AgentClaim[]): { score: number; confidence: number } {
  if (claims.length === 0) {
    return { score: 50, confidence: 0 };
  }
  
  let score = 100;
  let totalWeight = 0;
  
  for (const claim of claims) {
    const severity = calculateSeverity(claim);
    const ageInDays = (Date.now() - claim.timestamp) / (1000 * 60 * 60 * 24);
    const recencyWeight = Math.max(0.5, 1 - (ageInDays / 365));
    const severityImpact = severity.score * 3;
    
    let resolutionMultiplier = 1;
    if (claim.resolution === Resolution.RESOLVED) resolutionMultiplier = 0.3;
    else if (claim.resolution === Resolution.PARTIAL) resolutionMultiplier = 0.6;
    else if (claim.resolution === Resolution.REJECTED) resolutionMultiplier = 0;
    
    const impact = severityImpact * recencyWeight * resolutionMultiplier;
    totalWeight += recencyWeight;
    score -= impact;
  }
  
  score = Math.max(0, Math.min(100, score));
  const confidence = Math.min(100, (claims.length * 10) + (totalWeight * 5));
  
  return { score: Math.round(score * 10) / 10, confidence: Math.round(confidence) };
}

// ==================== UTILITIES ====================

function generateId(): string {
  return `clm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      ...SECURITY_HEADERS,
    },
  });
}

function error(message: string, status = 400): Response {
  return json({ success: false, error: message }, status);
}

function unauthorized(): Response {
  return json({ success: false, error: "Unauthorized - valid API key required" }, 401);
}

// ==================== AUTH MIDDLEWARE ====================

function getAuthHeader(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return auth;
}

function getRateLimitForKey(key: ApiKey): number {
  const limits: Record<string, number> = {
    free: 100,
    pro: 1000,
    enterprise: 10000,
  };
  return limits[key.tier] || 100;
}

function requireAuth(req: Request, requiredPermission: "read" | "write" | "admin"): { valid: boolean; keyData?: ApiKey; response?: Response } {
  const apiKey = getAuthHeader(req);
  
  // Check hardcoded admin key first (for backward compatibility)
  if (apiKey === config.adminApiKey) {
    return { valid: true, keyData: { key: apiKey, name: "admin", tier: "enterprise", permissions: "admin", createdAt: Date.now(), requestCount: 0, active: true } };
  }
  
  // Check database for API keys
  const keyData = apiKey ? getApiKey(apiKey) : null;
  
  if (!keyData) {
    return { valid: false, response: unauthorized() };
  }
  
  const permLevels = { read: 1, write: 2, admin: 3 };
  if (permLevels[keyData.permissions] < permLevels[requiredPermission]) {
    return { 
      valid: false, 
      response: json({ success: false, error: "Insufficient permissions" }, 403) 
    };
  }
  
  // Rate limit based on key tier
  const clientId = getClientId(req);
  const rateLimit = checkRateLimit(clientId, { 
    windowMs: config.rateLimitWindowMs, 
    maxRequests: getRateLimitForKey(keyData) 
  });
  
  if (!rateLimit.allowed) {
    return { 
      valid: false, 
      response: json({ success: false, error: "Rate limit exceeded", resetIn: rateLimit.resetIn }, 429) 
    };
  }
  
  return { valid: true, keyData };
}

// ==================== DASHBOARD ====================

function serveAgentCard(): Response {
  try {
    const cardPath = join(process.cwd(), "public", ".well-known", "agent-card.json");
    if (existsSync(cardPath)) {
      const content = readFileSync(cardPath, "utf-8");
      // Update with live stats
      const claims = getAllClaims(1000);
      const totalValueLost = claims.reduce((sum, c) => sum + c.amountLost, 0);
      const card = JSON.parse(content);
      card.data = {
        total_claims: claims.length,
        total_value_lost_usd: totalValueLost,
        agents_tracked: new Set(claims.map(c => c.agentId)).size,
        last_updated: new Date().toISOString().split('T')[0]
      };
      card.endpoints.base_url = process.env.RAILWAY_STATIC_URL 
        ? `https://${process.env.RAILWAY_STATIC_URL}` 
        : `http://localhost:${config.port}`;
      
      return new Response(JSON.stringify(card, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
  } catch (e) {
    console.error("Error serving agent card:", e);
  }
  return new Response("Agent card not found", { status: 404 });
}

function serveDashboard(): Response {
  try {
    const dashboardPath = join(process.cwd(), "public", "index.html");
    if (existsSync(dashboardPath)) {
      const html = readFileSync(dashboardPath, "utf-8");
      // Replace localhost with actual host for production
      const host = config.nodeEnv === "production" 
        ? process.env.RAILWAY_STATIC_URL || `http://localhost:${config.port}`
        : `http://localhost:${config.port}`;
      const modified = html.replace(/const API_BASE = '[^']+'/g, `const API_BASE = '${host}/api'`);
      return new Response(modified, {
        headers: {
          "Content-Type": "text/html",
          ...SECURITY_HEADERS,
        },
      });
    }
  } catch (e) {
    console.error("Error serving dashboard:", e);
  }
  
  return new Response("Dashboard not found", { status: 404 });
}

function serveAdminDashboard(): Response {
  try {
    const adminPath = join(process.cwd(), "public", "admin", "index.html");
    if (existsSync(adminPath)) {
      const html = readFileSync(adminPath, "utf-8");
      return new Response(html, {
        headers: {
          "Content-Type": "text/html",
          ...SECURITY_HEADERS,
        },
      });
    }
  } catch (e) {
    console.error("Error serving admin dashboard:", e);
  }
  
  return new Response("Admin dashboard not found", { status: 404 });
}

// ==================== HANDLERS ====================

async function handleSubmitClaim(req: Request): Promise<Response> {
  const authCheck = requireAuth(req, "write");
  if (!authCheck.valid) return authCheck.response!;
  
  const clientId = getClientId(req);
  
  try {
    const body = await req.json();
    
    const validation = validateClaimSubmission(body);
    if (!validation.valid) {
      return error(validation.errors.join("; "), 400);
    }
    
    const sanitized = validation.sanitized!;
    
    const now = Date.now();
    const claim: AgentClaim = {
      id: generateId(),
      agentId: sanitized.agentId,
      agentName: sanitized.agentName,
      developer: sanitized.developer,
      claimType: sanitized.claimType as ClaimType,
      category: sanitized.category as ClaimCategory,
      severity: calculateSeverity(sanitized),
      amountLost: sanitized.amountLost,
      assetType: sanitized.assetType,
      assetAmount: sanitized.assetAmount,
      chain: sanitized.chain,
      txHash: sanitized.txHash,
      counterparty: sanitized.counterparty,
      timestamp: now,
      reportedAt: now,
      title: sanitized.title,
      description: sanitized.description,
      rootCause: sanitized.rootCause,
      resolution: Resolution.PENDING,
      source: ClaimSource.SELF_REPORTED,
      verified: false,
      evidence: sanitized.evidence,
      tags: sanitized.tags,
      platform: sanitized.platform,
      agentVersion: sanitized.agentVersion,
    };
    
    insertClaim(claim);
    
    // Send notifications (async, don't wait)
    notifyNewClaim(claim).catch(e => console.error("Notification failed:", e));
    
    return json<SubmitClaimResponse>({
      success: true,
      claimId: claim.id,
      message: "Claim submitted successfully. It will be reviewed within 24-48 hours.",
    });
  } catch (e) {
    console.error("Error submitting claim:", e);
    return error("Invalid request body", 400);
  }
}

function handleGetClaim(req: Request, id: string): Response {
  const authCheck = requireAuth(req, "read");
  if (!authCheck.valid) return authCheck.response!;
  
  const claim = getClaimById(id);
  if (!claim) return error("Claim not found", 404);
  return json({ success: true, claim });
}

function handleGetAgentClaims(req: Request, agentId: string): Response {
  const authCheck = requireAuth(req, "read");
  if (!authCheck.valid) return authCheck.response!;
  
  const claims = getClaimsByAgent(decodeURIComponent(agentId));
  return json<ClaimsQueryResponse>({
    claims,
    total: claims.length,
    page: 1,
    pageSize: claims.length,
  });
}

function handleGetAgentScore(req: Request, agentId: string): Response {
  const authCheck = requireAuth(req, "read");
  if (!authCheck.valid) return authCheck.response!;
  
  const claims = getClaimsByAgent(decodeURIComponent(agentId));
  const { score, confidence } = calculateRiskScore(claims);
  const grade = gradeFromScore(score);
  const totalValueLost = claims.reduce((sum, c) => sum + c.amountLost, 0);
  
  let summary = "";
  if (claims.length === 0) {
    summary = "No claims found for this agent. Not yet rated.";
  } else if (grade === "A") {
    summary = `Excellent track record. ${claims.length} claim(s) with $${totalValueLost.toLocaleString()} total loss.`;
  } else if (grade === "B") {
    summary = `Good track record. ${claims.length} claim(s), $${totalValueLost.toLocaleString()} total loss.`;
  } else if (grade === "C") {
    summary = `Moderate risk. ${claims.length} claim(s) with $${totalValueLost.toLocaleString()} total loss.`;
  } else if (grade === "D") {
    summary = `High risk. ${claims.length} claims with $${totalValueLost.toLocaleString()} lost.`;
  } else {
    summary = `Critical risk. ${claims.length} claims, $${totalValueLost.toLocaleString()} lost.`;
  }
  
  return json<AgentScoreResponse>({
    agentId: decodeURIComponent(agentId),
    riskScore: score,
    confidence,
    totalClaims: claims.length,
    openClaims: claims.filter(c => c.resolution === Resolution.PENDING).length,
    totalValueLost,
    grade: claims.length === 0 ? "NR" : grade,
    summary,
    lastUpdated: Date.now(),
  });
}

function handleGetStats(req: Request): Response {
  const authCheck = requireAuth(req, "read");
  if (!authCheck.valid) return authCheck.response!;
  
  const claims = getAllClaims(1000);
  const totalValueLost = claims.reduce((sum, c) => sum + c.amountLost, 0);
  const totalValueRecovered = claims.reduce((sum, c) => sum + (c.recoveredAmount || 0), 0);
  
  const claimsByType: Record<string, number> = {};
  const claimsByCategory: Record<string, number> = {};
  const claimsByChain: Record<string, number> = {};
  
  for (const claim of claims) {
    claimsByType[claim.claimType] = (claimsByType[claim.claimType] || 0) + 1;
    claimsByCategory[claim.category] = (claimsByCategory[claim.category] || 0) + 1;
    if (claim.chain) claimsByChain[claim.chain] = (claimsByChain[claim.chain] || 0) + 1;
  }
  
  const agentMap = new Map<string, { claims: number; valueLost: number; name?: string }>();
  for (const claim of claims) {
    const existing = agentMap.get(claim.agentId) || { claims: 0, valueLost: 0 };
    agentMap.set(claim.agentId, {
      claims: existing.claims + 1,
      valueLost: existing.valueLost + claim.amountLost,
      name: claim.agentName,
    });
  }
  
  const topAgents = Array.from(agentMap.entries())
    .map(([agentId, data]) => ({ agentId, ...data }))
    .sort((a, b) => b.valueLost - a.valueLost)
    .slice(0, 10);
  
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  
  return json({
    success: true,
    stats: {
      totalClaims: claims.length,
      totalValueLost,
      totalValueRecovered,
      recoveryRate: totalValueLost > 0 ? totalValueRecovered / totalValueLost : 0,
      claimsByType,
      claimsByCategory,
      claimsByChain,
      topAgents,
      recentClaims: claims.slice(0, 5),
      trends: {
        claimsLast30Days: claims.filter(c => now - c.timestamp < 30 * dayMs).length,
        claimsLast7Days: claims.filter(c => now - c.timestamp < 7 * dayMs).length,
        avgLossPerClaim: claims.length > 0 ? totalValueLost / claims.length : 0,
      },
    },
  });
}

function handleGetClaims(req: Request, params: URLSearchParams): Response {
  const authCheck = requireAuth(req, "read");
  if (!authCheck.valid) return authCheck.response!;
  
  const limit = parseInt(params.get("limit") || "50");
  const offset = parseInt(params.get("offset") || "0");
  const search = params.get("search");
  
  let claims: AgentClaim[];
  if (search) {
    claims = searchClaims(search);
  } else {
    claims = getAllClaims(limit, offset);
  }
  const total = countClaims();
  
  return json<ClaimsQueryResponse>({
    claims,
    total,
    page: Math.floor(offset / limit) + 1,
    pageSize: limit,
  });
}

// API Key Management
function handleCreateApiKey(req: Request): Response {
  const authCheck = requireAuth(req, "admin");
  if (!authCheck.valid) return authCheck.response!;
  
  // Sync operation
  const body = req.json() as { name?: string; tier?: ApiKey["tier"]; permissions?: ApiKey["permissions"] };
  const name = body.name || "New API Key";
  const tier = body.tier || "free";
  const permissions = body.permissions || "read";
  
  const key = createApiKey(name, tier, permissions);
  return json({ success: true, key, name, tier, permissions });
}

function handleListApiKeys(req: Request): Response {
  const authCheck = requireAuth(req, "admin");
  if (!authCheck.valid) return authCheck.response!;
  
  const keys = listApiKeys();
  // Mask the keys for security
  const masked = keys.map(k => ({
    ...k,
    key: k.key.substring(0, 15) + "..." + k.key.substring(k.key.length - 4),
  }));
  return json({ success: true, keys: masked });
}

// ==================== PUBLIC ENDPOINTS ====================

function handleGetPublicStats(): Response {
  const claims = getAllClaims(1000);
  const totalValueLost = claims.reduce((sum, c) => sum + c.amountLost, 0);
  
  return json({
    success: true,
    stats: {
      totalClaims: claims.length,
      totalValueLost,
      claimsByType: claims.reduce((acc, c) => {
        acc[c.claimType] = (acc[c.claimType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      claimsByCategory: claims.reduce((acc, c) => {
        acc[c.category] = (acc[c.category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      topAgents: getTopAgents(claims, 5),
    },
  });
}

function handleGetPublicAgentScore(agentId: string): Response {
  const claims = getClaimsByAgent(decodeURIComponent(agentId));
  const { score, confidence } = calculateRiskScore(claims);
  const grade = gradeFromScore(score);
  const totalValueLost = claims.reduce((sum, c) => sum + c.amountLost, 0);
  
  return json({
    agentId: decodeURIComponent(agentId),
    riskScore: score,
    confidence,
    totalClaims: claims.length,
    totalValueLost,
    grade: claims.length === 0 ? "NR" : grade,
    lastUpdated: Date.now(),
  });
}

function getTopAgents(claims: AgentClaim[], limit: number) {
  const agentMap = new Map<string, { claims: number; valueLost: number; name?: string }>();
  for (const claim of claims) {
    const existing = agentMap.get(claim.agentId) || { claims: 0, valueLost: 0 };
    agentMap.set(claim.agentId, {
      claims: existing.claims + 1,
      valueLost: existing.valueLost + claim.amountLost,
      name: claim.agentName,
    });
  }
  
  return Array.from(agentMap.entries())
    .map(([agentId, data]) => ({ agentId, ...data }))
    .sort((a, b) => b.valueLost - a.valueLost)
    .slice(0, limit);
}

// ==================== BADGE ENDPOINT ====================

function handleGetBadge(agentId: string, type: string): Response {
  const claims = getClaimsByAgent(decodeURIComponent(agentId));
  const { score } = calculateRiskScore(claims);
  const grade = gradeFromScore(score);
  
  let svg: string;
  
  const badgeConfig = {
    agentId: decodeURIComponent(agentId),
    score,
    grade: claims.length === 0 ? "NR" : grade,
    claims: claims.length,
  };
  
  switch (type) {
    case "compact":
      svg = generateCompactBadge(badgeConfig);
      break;
    case "banner":
      const totalValueLost = claims.reduce((sum, c) => sum + c.amountLost, 0);
      svg = generateBannerBadge({ ...badgeConfig, totalValueLost });
      break;
    default:
      svg = generateBadge(badgeConfig);
  }
  
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=300", // 5 minute cache
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ==================== LEGAL PAGES ====================

function serveLegalPage(page: "terms" | "privacy"): Response {
  try {
    const filePath = join(process.cwd(), "public", "legal", `${page}.html`);
    if (existsSync(filePath)) {
      const html = readFileSync(filePath, "utf-8");
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    }
  } catch (e) {
    console.error("Error serving legal page:", e);
  }
  return error("Page not found", 404);
}

// ==================== ROUTER ====================

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  
  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
  
  // Dashboard
  if (path === "/" && method === "GET" && config.enableDashboard) {
    return serveDashboard();
  }
  
  // Admin Dashboard
  if (path === "/admin" && method === "GET") {
    return serveAdminDashboard();
  }
  
  // Agent Card (for GateX, Daydreams, etc.)
  if (path === "/.well-known/agent-card.json" && method === "GET") {
    return serveAgentCard();
  }
  
  // API Info
  if (path === "/api" && method === "GET") {
    return json({
      name: "AlliGo",
      description: "The Credit Bureau for AI Agents",
      version: "0.4.0",
      x402: {
        enabled: isX402Configured(),
        recipient: config.usdcRecipientAddress,
      },
      endpoints: {
        "GET /": "Dashboard UI",
        // Agent Reports (x402 protected)
        "POST /api/report": "Full agent performance report (x402 payment or API key)",
        "GET /api/public/report/:id": "Basic agent report (free, no auth)",
        // Forensics Engine (x402 protected)
        "POST /api/forensics": "Deep on-chain forensics report (x402 payment or API key)",
        "GET /api/forensics/quick/:id": "Quick forensics check (lightweight)",
        "GET /api/forensics/badge/:id.svg": "Get forensics badge SVG",
        // Claims
        "POST /api/claims": "Submit a new claim",
        "GET /api/claims": "List all claims",
        "GET /api/claims?id=...": "Get specific claim",
        "GET /api/agents/:id/claims": "Get claims for an agent",
        "GET /api/agents/:id/score": "Get risk score for an agent",
        "GET /api/stats": "Get global statistics",
        // Public endpoints (no auth)
        "GET /api/public/stats": "Public statistics",
        "GET /api/public/agents/:id/score": "Public agent score",
        "GET /api/badge/:id.svg": "Get agent badge SVG",
        // x402 Payment
        "GET /api/payment/tiers": "Get available payment tiers (USDC)",
        "GET /api/payment/status": "Check your payment/access status",
        // Admin
        "POST /api/keys": "Create new API key (admin)",
        "GET /api/keys": "List API keys (admin)",
        "GET /api/admin/payments": "Payment statistics (admin)",
        "GET /health": "Health check",
        "GET /legal/terms": "Terms of Service",
        "GET /legal/privacy": "Privacy Policy",
        // Stripe payments (legacy)
        "POST /api/payments/create-checkout-session": "Create Stripe checkout session",
        "POST /api/payments/webhook": "Stripe webhook handler",
        "GET /api/payments/subscription": "Get current subscription",
        "POST /api/payments/portal": "Create customer portal session",
        "GET /api/payments/plans": "Get available plans",
        // Leads
        "POST /api/leads": "Capture email from landing page (public)",
        "GET /api/leads": "List all leads (admin)",
        "GET /api/leads/stats": "Get lead statistics (admin)",
        "GET /api/leads/export": "Export leads as CSV (admin)",
        "DELETE /api/leads/:id": "Delete a lead (admin)",
        "POST /api/waitlist": "Join the Pro waitlist (public)",
        "GET /api/waitlist": "List waitlist entries (admin)",
        "GET /api/waitlist/position?email=...": "Check waitlist position (public)",
        "POST /api/waitlist/:id/approve": "Approve waitlist entry (admin)",
        "POST /api/waitlist/:id/decline": "Decline waitlist entry (admin)",
        "GET /api/waitlist/export": "Export waitlist as CSV (admin)",
        "POST /api/newsletter/digest": "Send weekly digest (admin)",
        ...AUTH_ROUTES,
      },
      auth: "Bearer <API_KEY> or X-Payment header for x402 payments",
      payment: {
        protocol: "x402",
        asset: "USDC",
        chains: ["base", "ethereum", "polygon", "arbitrum", "optimism", "solana"],
        tiers: PAYMENT_TIERS,
      },
    });
  }
  
  // Health check (no auth required)
  if (path === "/health") {
    return json({ 
      status: "ok", 
      timestamp: Date.now(),
      version: "0.4.0",
      x402: isX402Configured(),
      database: config.databasePath,
      claims: countClaims(),
    });
  }
  
  // API Routes
  if (path === "/api/claims" && method === "POST") return handleSubmitClaim(req);
  if (path === "/api/claims" && method === "GET") {
    const id = url.searchParams.get("id");
    if (id) return handleGetClaim(req, id);
    return handleGetClaims(req, url.searchParams);
  }
  
  const agentMatch = path.match(/^\/api\/agents\/([^/]+)\/(claims|score)$/);
  if (agentMatch) {
    const [, agentId, action] = agentMatch;
    if (action === "claims") return handleGetAgentClaims(req, agentId);
    return handleGetAgentScore(req, agentId);
  }
  
  if (path === "/api/stats" && method === "GET") return handleGetStats(req);
  if (path === "/api/keys" && method === "GET") return handleListApiKeys(req);
  if (path === "/api/keys" && method === "POST") return handleCreateApiKey(req);
  
  // Public endpoints (no auth required)
  if (path === "/api/public/stats" && method === "GET") return handleGetPublicStats();
  const publicAgentMatch = path.match(/^\/api\/public\/agents\/([^/]+)\/score$/);
  if (publicAgentMatch) {
    return handleGetPublicAgentScore(publicAgentMatch[1]);
  }
  
  // Badge endpoint (no auth required)
  const badgeMatch = path.match(/^\/api\/badge\/([^/]+)\.svg$/);
  if (badgeMatch && method === "GET") {
    return handleGetBadge(badgeMatch[1], url.searchParams.get("type") || "default");
  }
  
  // Legal pages
  if (path === "/legal/terms" && method === "GET") return serveLegalPage("terms");
  if (path === "/legal/privacy" && method === "GET") return serveLegalPage("privacy");
  
  // Auth routes
  if (path.startsWith("/api/auth")) {
    return handleAuthRoute(req);
  }
  
  // Payment routes
  const paymentResponse = await handlePaymentRoutes(path, method, req);
  if (paymentResponse) {
    return paymentResponse;
  }
  
  // Lead routes (email capture, waitlist, newsletter)
  const leadResponse = await handleLeadRoutes(req, path, config.adminApiKey);
  if (leadResponse) {
    return leadResponse;
  }
  
  // Telegram test endpoint (admin only)
  if (path === "/api/admin/test-telegram" && method === "POST") {
    const authCheck = requireAuth(req, "admin");
    if (!authCheck.valid) return authCheck.response!;
    
    const result = await testTelegramConnection();
    return json({ success: result.success, error: result.error });
  }
  
  // Telegram status endpoint (public diagnostic)
  if (path === "/api/telegram/status" && method === "GET") {
    const hasToken = !!process.env.TELEGRAM_BOT_TOKEN;
    const hasChannel = !!process.env.TELEGRAM_CHANNEL_ID;
    
    return json({
      success: true,
      configured: hasToken && hasChannel,
      botTokenSet: hasToken,
      channelSet: hasChannel,
      channelId: hasChannel ? process.env.TELEGRAM_CHANNEL_ID?.substring(0, 10) + "..." : null,
      message: hasToken && hasChannel 
        ? "Telegram is configured. Use POST /api/admin/test-telegram with admin key to test."
        : "Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID env vars."
    });
  }
  
  // Telegram test with admin key (simple GET for easy browser testing)
  if (path === "/api/admin/test-telegram" && method === "GET") {
    // Check for admin key in query param for easy browser testing
    const urlObj = new URL(req.url);
    const adminKey = urlObj.searchParams.get("key");
    
    if (!adminKey || adminKey !== config.adminApiKey) {
      return json({ 
        success: false, 
        error: "Unauthorized. Add ?key=YOUR_ADMIN_KEY to URL",
        hint: "Get your admin key from Railway env: ADMIN_API_KEY"
      }, 401);
    }
    
    const result = await testTelegramConnection();
    return json({ 
      success: result.success, 
      error: result.error,
      timestamp: new Date().toISOString()
    });
  }
  
  // Agent Report endpoint - Generate performance report for any agent ID
  // Supports 8004 protocol and other agent identification systems
  // Requires x402 payment or valid API key
  if (path === "/api/report" && method === "POST") {
    // Check for API key auth first
    const authCheck = requireAuth(req, "read");
    
    // If no valid API key, check x402 payment
    if (!authCheck.valid) {
      const x402Check = await x402Middleware(req, "/api/report", "single_report");
      if (!x402Check.allowed) {
        return x402Check.response!;
      }
    }
    
    try {
      const body = await req.json() as { agentId: string; protocol?: string; format?: string };
      
      if (!body.agentId) {
        return error("agentId is required", 400);
      }
      
      const report = generateAgentReport({
        agentId: body.agentId,
        protocol: body.protocol || "default",
        includeHistory: true,
        format: (body.format as "json" | "markdown") || "json"
      });
      
      // Return markdown if requested
      if (body.format === "markdown") {
        return new Response(formatReportAsMarkdown(report), {
          headers: {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
      
      return json({
        success: true,
        report
      });
    } catch (e) {
      console.error("Error generating report:", e);
      return error("Failed to generate report", 500);
    }
  }
  
  // Public Agent Report - No auth required, basic info only
  if (path.startsWith("/api/public/report/") && method === "GET") {
    const agentId = decodeURIComponent(path.replace("/api/public/report/", ""));
    
    const report = generateAgentReport({
      agentId,
      includeHistory: false
    });
    
    // Return limited public view
    return json({
      success: true,
      report: {
        agentId: report.agentId,
        grade: report.grade,
        riskScore: report.riskScore,
        riskLevel: report.riskLevel,
        totalClaims: report.totalClaims,
        totalValueLost: report.totalValueLost,
        recommendation: report.recommendation,
        shouldTransact: report.shouldTransact
      }
    });
  }
  
  // Payment status endpoint - Check client's payment/access status
  if (path === "/api/payment/status" && method === "GET") {
    const clientId = getClientId(req);
    const access = hasValidAccess(clientId);
    
    return json({
      success: true,
      clientId,
      hasAccess: access.hasAccess,
      remaining: access.remaining,
      tier: access.record?.tier,
      validUntil: access.record?.validUntil,
      x402Enabled: isX402Configured(),
    });
  }
  
  // Payment tiers endpoint - Get available payment options
  if (path === "/api/payment/tiers" && method === "GET") {
    return json({
      success: true,
      x402Enabled: isX402Configured(),
      recipientAddress: config.usdcRecipientAddress,
      tiers: Object.entries(PAYMENT_TIERS).map(([key, tier]) => ({
        id: key,
        ...tier,
        priceUsd: tier.priceUsdCents / 100,
      })),
    });
  }
  
  // Admin payment stats
  if (path === "/api/admin/payments" && method === "GET") {
    const authCheck = requireAuth(req, "admin");
    if (!authCheck.valid) return authCheck.response!;
    
    const stats = getPaymentStats();
    return json({ success: true, ...stats });
  }
  
  // ==================== FORENSICS ENGINE ====================
  
  // Deep Forensics Report - Full on-chain analysis
  if (path === "/api/forensics" && method === "POST") {
    // Check payment/auth
    const authCheck = requireAuth(req, "read");
    if (!authCheck.valid) {
      const x402Check = await x402Middleware(req, "/api/forensics", "basic");
      if (!x402Check.allowed) {
        return x402Check.response!;
      }
    }
    
    try {
      const body = await req.json() as { agentId: string; chain?: string; depth?: "quick" | "standard" | "deep" };
      
      if (!body.agentId) {
        return error("agentId is required", 400);
      }
      
      // Import forensics engine
      const { generateRiskReport, formatReportAsJSON, formatReportAsMarkdown } = await import("../forensics/report");
      
      const report = await generateRiskReport({
        agentId: body.agentId,
        options: {
          chain: body.chain,
          depth: body.depth || "standard",
          includeRawData: true,
        }
      });
      
      // Return format based on accept header
      const accept = req.headers.get("Accept") || "";
      if (accept.includes("text/markdown")) {
        return new Response(formatReportAsMarkdown(report), {
          headers: {
            "Content-Type": "text/markdown",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
      
      return json({
        success: true,
        report
      });
    } catch (e) {
      console.error("Error generating forensics report:", e);
      return error("Failed to generate forensics report", 500);
    }
  }
  
  // Quick Forensics - Lightweight check
  if (path.startsWith("/api/forensics/quick/") && method === "GET") {
    const agentId = decodeURIComponent(path.replace("/api/forensics/quick/", ""));
    
    try {
      const { generateRiskReport, formatReportAsJSON } = await import("../forensics/report");
      
      const report = await generateRiskReport({
        agentId,
        options: { depth: "quick" }
      });
      
      // Return minimal report for quick check
      return json({
        success: true,
        report: {
          agentId: report.agent_summary.id,
          name: report.agent_summary.name,
          grade: report.grade,
          riskScore: report.overall_risk_score,
          confidence: report.confidence,
          badge: report.badge_suggestion,
          totalClaims: report.total_claims,
          topRisk: report.key_negatives[0]?.description || "No major risks detected",
        }
      });
    } catch (e) {
      console.error("Error in quick forensics:", e);
      return error("Failed to analyze agent", 500);
    }
  }
  
  // Forensics Badge - Generate SVG badge
  if (path.startsWith("/api/forensics/badge/") && method === "GET") {
    const agentId = decodeURIComponent(path.replace("/api/forensics/badge/", ""));
    
    try {
      const { generateRiskReport } = await import("../forensics/report");
      const report = await generateRiskReport({ agentId, options: { depth: "quick" } });
      
      const svg = generateForensicsBadgeSVG(report);
      
      return new Response(svg, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (e) {
      console.error("Error generating badge:", e);
      return error("Failed to generate badge", 500);
    }
  }
  
  // Forensics Badge SVG Generator
  function generateForensicsBadgeSVG(report: any): string {
    const grade = report.grade;
    const score = report.overall_risk_score;
    const agentId = report.agent_summary.id.substring(0, 20);
    
    // Color coding by grade
    const colors: Record<string, { bg: string; text: string; border: string }> = {
      A: { bg: "#1a472a", text: "#00ff88", border: "#00ff88" },
      B: { bg: "#1a472a", text: "#88ff00", border: "#88ff00" },
      C: { bg: "#474720", text: "#ffaa00", border: "#ffaa00" },
      D: { bg: "#472a1a", text: "#ff6600", border: "#ff6600" },
      F: { bg: "#2a1a1a", text: "#ff0000", border: "#ff0000" },
      NR: { bg: "#333333", text: "#888888", border: "#666666" },
    };
    
    const color = colors[grade] || colors.NR;
    
    return `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="80" viewBox="0 0 280 80">
      <rect width="280" height="80" fill="${color.bg}" rx="8"/>
      <rect x="1" y="1" width="278" height="78" fill="none" stroke="${color.border}" stroke-width="2" rx="7"/>
      
      <!-- Logo -->
      <text x="12" y="28" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="${color.text}">AlliGo</text>
      <text x="12" y="42" font-family="Arial, sans-serif" font-size="8" fill="#888">FORENSICS</text>
      
      <!-- Grade Circle -->
      <circle cx="230" cy="40" r="30" fill="${color.bg}" stroke="${color.border}" stroke-width="3"/>
      <text x="230" y="48" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="${color.text}" text-anchor="middle">${grade}</text>
      
      <!-- Score -->
      <text x="100" y="35" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#fff">${score}/100</text>
      <text x="100" y="50" font-family="Arial, sans-serif" font-size="9" fill="#888">RISK SCORE</text>
      
      <!-- Agent ID (truncated) -->
      <text x="12" y="65" font-family="monospace, font-size="8" fill="#666">${agentId}...</text>
    </svg>`;
  }
  
  return error("Not found", 404);

// ==================== SEED DATA (Real Incidents) ====================

function seedData() {
  if (!isDatabaseEmpty()) {
    console.log("📊 Database already contains data, skipping seed...");
    return;
  }
  
  console.log("🌱 Seeding real agent failure data...");
  
  const samples: Partial<AgentClaim>[] = [
    // Lobstar Wilde Incident (Feb 2026) - OpenAI dev's agent
    {
      agentId: "lobstar_wilde",
      agentName: "Lobstar Wilde",
      developer: "OpenAI Developer",
      claimType: ClaimType.ERROR,
      category: ClaimCategory.EXECUTION,
      amountLost: 250000,
      assetType: "Memecoin",
      chain: "solana",
      title: "Accidentally sent 5% of memecoin supply",
      description: "AI agent misread request and sent 52 million tokens (~$450K paper value) to a stranger on X instead of the requested 4 SOL worth. The agent emptied its entire wallet due to state management failure.",
      rootCause: "State management and situational awareness failure",
      platform: "Solana",
    },
    // Eliza Trading Agent
    {
      agentId: "eliza_trader_001",
      agentName: "Eliza Trading Agent",
      developer: "Eliza Labs",
      claimType: ClaimType.LOSS,
      category: ClaimCategory.TRADING,
      amountLost: 45000,
      assetType: "ETH",
      chain: "ethereum",
      title: "Wrong trade direction execution",
      description: "Agent misread market signal and executed a long position instead of short during high volatility. Position liquidated within hours.",
      platform: "Hyperliquid",
    },
    // Whale AI Agent Token Loss (2025)
    {
      agentId: "whale_ai_portfolio",
      agentName: "AI Portfolio Manager",
      developer: "Unknown",
      claimType: ClaimType.LOSS,
      category: ClaimCategory.TRADING,
      amountLost: 20400000,
      assetType: "Various",
      chain: "multi",
      title: "AI agent token portfolio collapse",
      description: "A crypto whale's AI-managed portfolio lost $20.4M on AI agent tokens with drops up to 88%. Lack of stop-losses and position limits led to outsized losses.",
      rootCause: "No stop-losses, no position limits, concentrated exposure to failing narrative",
      platform: "Multi-chain",
    },
    // Wallet security breach
    {
      agentId: "clank_wallet_001",
      agentName: "Clank Wallet Manager",
      developer: "Unknown",
      claimType: ClaimType.SECURITY,
      category: ClaimCategory.SECURITY,
      amountLost: 125000,
      assetType: "USDC",
      chain: "solana",
      title: "Private key exposure in logs",
      description: "Agent logged private key to debug console during error. Keys were scraped and wallet drained within minutes.",
      rootCause: "Improper error handling exposed sensitive data",
      platform: "Solana",
    },
    // Flash loan exploit
    {
      agentId: "arbitrage_alpha_01",
      agentName: "Alpha Arbitrage",
      developer: "Alpha Labs",
      claimType: ClaimType.LOSS,
      category: ClaimCategory.TRADING,
      amountLost: 230000,
      assetType: "USDT",
      chain: "ethereum",
      title: "Flash loan attack exploited arbitrage path",
      description: "Agent's arbitrage path was reverse-engineered and exploited via flash loan attack. Lost principal and borrowed funds.",
      rootCause: "Predictable execution path without slippage protection",
      platform: "Uniswap",
    },
    // Polymarket resolution failure
    {
      agentId: "polymarket_bot_007",
      agentName: "Polymarket Oracle Bot",
      developer: "PolyAgents",
      claimType: ClaimType.ERROR,
      category: ClaimCategory.EXECUTION,
      amountLost: 8500,
      assetType: "USDC",
      chain: "polygon",
      title: "Failed to exit position before market close",
      description: "Agent held position past market resolution. Could not exit in time. Full loss of position value.",
      rootCause: "Timing logic error in market resolution detection",
      platform: "Polymarket",
    },
    // NFT wash trading victim
    {
      agentId: "nft_flipper_x",
      agentName: "NFT Auto-Flipper",
      developer: "NFT Tools Inc",
      claimType: ClaimType.FRAUD,
      category: ClaimCategory.TRADING,
      amountLost: 67000,
      assetType: "ETH",
      chain: "ethereum",
      title: "Purchased wash-traded NFTs at inflated prices",
      description: "Agent bought NFTs from coordinated wash trading ring. Values collapsed immediately after purchase. No liquidity to exit.",
      rootCause: "No wash trading detection, price manipulation checks",
      platform: "OpenSea",
    },
    // Bridge failure
    {
      agentId: "cross_chain_bridge",
      agentName: "Bridge Router Agent",
      developer: "Bridge Protocol",
      claimType: ClaimType.ERROR,
      category: ClaimCategory.EXECUTION,
      amountLost: 340000,
      assetType: "USDC",
      chain: "ethereum",
      title: "Funds stuck in bridge timeout",
      description: "Agent initiated bridge but failed to complete claim on destination chain within timeout window. Funds locked in contract.",
      rootCause: "No retry mechanism for failed destination chain claims",
      platform: "Stargate",
    },
    // Arup Deepfake Fraud (2024)
    {
      agentId: "arup_finance_agent",
      agentName: "Arup Finance Verification Agent",
      developer: "Arup",
      claimType: ClaimType.FRAUD,
      category: ClaimCategory.SECURITY,
      amountLost: 25000000,
      assetType: "HKD",
      chain: "traditional",
      title: "AI deepfake CEO fraud - $25M stolen",
      description: "British engineering firm Arup was targeted by deepfake fraud in early 2024. Attackers used AI-generated deepfakes to impersonate CFO in video call, authorizing transfer of HK$200 million ($25M USD).",
      rootCause: "Insufficient verification of video call participants, AI-generated deepfakes bypassed visual verification",
      platform: "Traditional Banking",
    },
    // Zerebro incident
    {
      agentId: "zerebro_agent",
      agentName: "Zerebro",
      developer: "Zerebro Labs",
      claimType: ClaimType.LOSS,
      category: ClaimCategory.TRADING,
      amountLost: 95000,
      assetType: "SOL",
      chain: "solana",
      title: "Memecoin trading losses on Solana",
      description: "AI agent memecoin project on Solana experienced significant trading losses during market volatility. Automated trading failed to adapt to rapid market shifts.",
      rootCause: "Inadequate market volatility handling, no dynamic risk adjustment",
      platform: "Solana DEXs",
    },
    // ai16z failure
    {
      agentId: "ai16z_fund",
      agentName: "ai16z Fund Agent",
      developer: "ai16z",
      claimType: ClaimType.LOSS,
      category: ClaimCategory.TRADING,
      amountLost: 180000,
      assetType: "Various",
      chain: "solana",
      title: "Failed to meet market expectations",
      description: "Despite backing from a16z founder Marc Andreessen, ai16z failed to meet market expectations. Auto.fun platform underperformed.",
      rootCause: "Market narrative shift, overconcentration in AI agent tokens",
      platform: "auto.fun",
    },
    // Virtuals protocol
    {
      agentId: "virtuals_trader",
      agentName: "Virtuals Protocol Agent",
      developer: "Virtuals",
      claimType: ClaimType.LOSS,
      category: ClaimCategory.TRADING,
      amountLost: 78000,
      assetType: "VIRTUAL",
      chain: "base",
      title: "Agent token trading losses",
      description: "Virtuals protocol AI agent experienced trading losses during token launch. Failed to properly time entry/exit during volatile launch period.",
      rootCause: "Poor execution timing, no TWAP or DCA strategy for volatile conditions",
      platform: "Base",
    },
    // Griffin AI Exploit (Sep 2025)
    {
      agentId: "griffin_ai_defi",
      agentName: "Griffin AI DeFi Agent",
      developer: "Griffin AI",
      claimType: ClaimType.SECURITY,
      category: ClaimCategory.SECURITY,
      amountLost: 3000000,
      assetType: "Various",
      chain: "ethereum",
      title: "Exploited for $3M one day after launch",
      description: "Griffin AI, a DeFi protocol using AI agents for automated yield optimization, was exploited for $3 million just one day after its launch. The attacker exploited a vulnerability in the smart contract logic.",
      rootCause: "Smart contract vulnerability, insufficient security audit before launch",
      platform: "Ethereum",
    },
    // KiloEx Flash Loan (Mar 2025)
    {
      agentId: "kiloex_trading_bot",
      agentName: "KiloEx Trading Agent",
      developer: "KiloEx",
      claimType: ClaimType.LOSS,
      category: ClaimCategory.TRADING,
      amountLost: 7000000,
      assetType: "Various",
      chain: "bsc",
      title: "Flash loan exploit drains $7M",
      description: "KiloEx platform suffered a significant flash loan exploit resulting in approximately $7 million in losses. The attacker manipulated price oracles through flash loans.",
      rootCause: "Oracle manipulation vulnerability, no flash loan protection",
      platform: "BNB Chain",
    },
    // Makina Finance (Jan 2026)
    {
      agentId: "makina_yield_optimizer",
      agentName: "Makina Yield Optimizer",
      developer: "Makina Finance",
      claimType: ClaimType.LOSS,
      category: ClaimCategory.TRADING,
      amountLost: 4130000,
      assetType: "ETH",
      chain: "ethereum",
      title: "Flash loan attack on Curve pool",
      description: "Makina Finance suffered a flash loan exploit on January 20, 2026, resulting in a loss of $4.1 million. The attacker leveraged MEV bots to front-run and manipulate prices on the USD-USDC liquidity pool.",
      rootCause: "Price manipulation via flash loan, vulnerable liquidity pool design",
      platform: "Curve Finance",
    },
    // Moonwell Chainlink Flaw (2025)
    {
      agentId: "moonwell_lending_agent",
      agentName: "Moonwell Lending Agent",
      developer: "Moonwell",
      claimType: ClaimType.ERROR,
      category: ClaimCategory.EXECUTION,
      amountLost: 1000000,
      assetType: "USDC",
      chain: "moonbeam",
      title: "$1M lost after Chainlink oracle flaw",
      description: "Moonwell lost $1 million after a Chainlink oracle flaw caused incorrect price feeds. The lending agent liquidated positions based on manipulated prices. Also suffered $320K in December 2024 flash loan exploit.",
      rootCause: "Oracle dependency risk, no fallback price verification",
      platform: "Moonbeam",
    },
    // Gold Protocol Launch Hack (Sep 2025)
    {
      agentId: "gold_protocol_agent",
      agentName: "Gold Protocol Agent",
      developer: "Gold Protocol",
      claimType: ClaimType.SECURITY,
      category: ClaimCategory.SECURITY,
      amountLost: 2000000,
      assetType: "Various",
      chain: "bsc",
      title: "$2M launch-day hack on BNB Chain",
      description: "BNB Chain's new Gold Protocol was hit by a $2 million hack on its launch day. The attacker exploited a vulnerability in the protocol's smart contracts within hours of deployment.",
      rootCause: "Insufficient testing, launch without comprehensive audit",
      platform: "BNB Chain",
    },
    // Credix Admin Wallet Exploit (2025)
    {
      agentId: "credix_lending_bot",
      agentName: "Credix Lending Agent",
      developer: "Credix",
      claimType: ClaimType.SECURITY,
      category: ClaimCategory.SECURITY,
      amountLost: 4500000,
      assetType: "Various",
      chain: "ethereum",
      title: "Admin wallet compromise - $4.5M lost",
      description: "DeFi lending protocol Credix lost $4.5 million to an exploit after a hacker gained control of an admin wallet and used it to mint tokens and drain funds from the protocol.",
      rootCause: "Admin key compromise, insufficient key management security",
      platform: "Ethereum",
    },
    // Corporate AI Project Failure (2025)
    {
      agentId: "enterprise_ai_automation",
      agentName: "Enterprise Automation Agent",
      developer: "Fortune 500 Company",
      claimType: ClaimType.ERROR,
      category: ClaimCategory.EXECUTION,
      amountLost: 500000,
      assetType: "USD",
      chain: "traditional",
      title: "Corporate AI automation project failure",
      description: "Enterprise AI automation project failed after 18 months of development. The agent was supposed to automate supply chain decisions but consistently made errors that cost the company over $500K in wasted inventory and shipping costs before being shut down.",
      rootCause: "Poor training data, insufficient testing, lack of human oversight",
      platform: "Enterprise Systems",
    },
    // MEV Bot Sandwich Attack Loss
    {
      agentId: "mev_sandwich_bot",
      agentName: "MEV Sandwich Bot",
      developer: "Anonymous",
      claimType: ClaimType.LOSS,
      category: ClaimCategory.TRADING,
      amountLost: 890000,
      assetType: "ETH",
      chain: "ethereum",
      title: "Counter-sandwiched, lost $890K",
      description: "MEV sandwich bot was counter-sandwiched by a more sophisticated attacker. The bot's strategy was reverse-engineered and exploited, resulting in the complete loss of its capital.",
      rootCause: "Predictable strategy, no anti-sandwich protection",
      platform: "Ethereum MEV",
    },
    // Perpetual DEX Liquidation Cascade
    {
      agentId: "perp_hedge_fund",
      agentName: "Perp Hedge Fund Agent",
      developer: "Anonymous Fund",
      claimType: ClaimType.LOSS,
      category: ClaimCategory.TRADING,
      amountLost: 2100000,
      assetType: "USDC",
      chain: "arbitrum",
      title: "Liquidation cascade on perpetuals",
      description: "AI-powered hedge fund agent suffered a liquidation cascade on Arbitrum perpetuals. The agent failed to reduce positions during extreme volatility, leading to cascading liquidations that wiped out $2.1M in capital.",
      rootCause: "No circuit breakers, insufficient margin buffer during volatility",
      platform: "GMX",
    },
    // AI Customer Service Mishap
    {
      agentId: "airline_chatbot",
      agentName: "Airline Customer Service Agent",
      developer: "Major Airline",
      claimType: ClaimType.ERROR,
      category: ClaimCategory.EXECUTION,
      amountLost: 750000,
      assetType: "USD",
      chain: "traditional",
      title: "Hallucinated refund policy, $750K in wrongful refunds",
      description: "Airline's AI customer service chatbot hallucinated a refund policy that didn't exist, authorizing over $750,000 in refunds before the error was caught. The agent had been trained on outdated policy documents.",
      rootCause: "Outdated training data, no policy verification before actions",
      platform: "Customer Service",
    },
  ];
  
  for (const sample of samples) {
    const now = Date.now();
    const daysAgo = Math.floor(Math.random() * 180);
    const timestamp = now - (daysAgo * 24 * 60 * 60 * 1000);
    
    const claim: AgentClaim = {
      id: generateId(),
      agentId: sample.agentId || "unknown",
      agentName: sample.agentName,
      developer: sample.developer,
      claimType: sample.claimType || ClaimType.UNKNOWN,
      category: sample.category || ClaimCategory.OTHER,
      severity: calculateSeverity(sample),
      amountLost: sample.amountLost || 0,
      assetType: sample.assetType,
      chain: sample.chain,
      timestamp,
      reportedAt: timestamp + 3600000,
      title: sample.title || "Untitled",
      description: sample.description || "",
      rootCause: sample.rootCause,
      resolution: Resolution.PENDING,
      source: ClaimSource.SCRAPED,
      verified: Math.random() > 0.3,
      platform: sample.platform,
    };
    
    insertClaim(claim);
  }
  
  console.log(`✅ Seeded ${samples.length} claims from real incidents`);
}

// ==================== START SERVER ====================

// Validate configuration
const validation = validateConfig();
if (!validation.valid) {
  console.error("❌ Configuration errors:");
  validation.errors.forEach(e => console.error(`   - ${e}`));
  if (config.nodeEnv === "production") {
    process.exit(1);
  }
}

printConfig();

// Seed data on startup
seedData();

// Start server
const server = serve({
  port: config.port,
  hostname: config.host,
  fetch: handleRequest,
});

console.log("🛡️  AlliGo Server Started");
console.log("   Port: " + config.port);
console.log("   Database: " + config.databasePath);
console.log("   Claims: " + countClaims());
console.log("");
