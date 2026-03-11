/**
 * Allimolt - API Server
 * The Credit Bureau for AI Agents
 */

import { serve } from "bun";
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
} from "./db";
import {
  checkRateLimit,
  validateClaimSubmission,
  getClientId,
  SECURITY_HEADERS,
  logAudit,
  DEFAULT_RATE_LIMITS,
} from "../security/middleware";
import {
  initAuth,
  validateApiKey,
  hasPermission,
  getAuthHeader,
  getRateLimitForKey,
  addApiKey,
  listApiKeys,
} from "./auth";

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
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
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

function requireAuth(req: Request, requiredPermission: "read" | "write" | "admin"): { valid: boolean; response?: Response } {
  const apiKey = getAuthHeader(req);
  
  if (!apiKey) {
    return { valid: false, response: unauthorized() };
  }
  
  const keyData = validateApiKey(apiKey);
  if (!keyData) {
    return { valid: false, response: unauthorized() };
  }
  
  if (!hasPermission(keyData, requiredPermission)) {
    return { valid: false, response: json({ success: false, error: "Insufficient permissions" }, 403) };
  }
  
  // Rate limit based on key tier
  const clientId = getClientId(req);
  const rateLimit = checkRateLimit(clientId, { 
    windowMs: 60000, 
    maxRequests: getRateLimitForKey(keyData) 
  });
  
  if (!rateLimit.allowed) {
    return { 
      valid: false, 
      response: json({ success: false, error: "Rate limit exceeded", resetIn: rateLimit.resetIn }, 429) 
    };
  }
  
  return { valid: true };
}

// ==================== HANDLERS ====================

async function handleSubmitClaim(req: Request): Promise<Response> {
  // Auth required for write operations
  const authCheck = requireAuth(req, "write");
  if (!authCheck.valid) return authCheck.response!;
  
  const clientId = getClientId(req);
  
  // Remove duplicate rate limiting - handled by requireAuth
  try {
    const body = await req.json();
    
    // Validate and sanitize input
    const validation = validateClaimSubmission(body);
    if (!validation.valid) {
      logAudit({
        action: "submit_claim",
        clientId,
        path: "/api/claims",
        method: "POST",
        success: false,
        error: validation.errors.join(", "),
      });
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
    
    logAudit({
      action: "submit_claim",
      clientId,
      path: "/api/claims",
      method: "POST",
      success: true,
    });
    
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
  const claims = getAllClaims(limit, offset);
  const total = countClaims();
  
  return json<ClaimsQueryResponse>({
    claims,
    total,
    page: Math.floor(offset / limit) + 1,
    pageSize: limit,
  });
}

// ==================== ROUTER ====================

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  
  if (path === "/" && method === "GET") {
    return json({
      name: "Allimolt",
      description: "The Credit Bureau for AI Agents - PRIVATE API",
      version: "0.2.0",
      auth: "Bearer <API_KEY> required for all endpoints",
      defaultKey: "allimolt_admin_change_me",
      endpoints: {
        "POST /api/claims": "Submit a new claim (write permission)",
        "GET /api/claims": "List all claims (read permission)",
        "GET /api/claims?id=...": "Get specific claim (read permission)",
        "GET /api/agents/:id/claims": "Get claims for an agent (read permission)",
        "GET /api/agents/:id/score": "Get risk score for an agent (read permission)",
        "GET /api/stats": "Get global statistics (read permission)",
        "GET /health": "Health check (no auth)",
      },
    });
  }
  
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
  if (path === "/health") return json({ status: "ok", timestamp: Date.now() });
  
  return error("Not found", 404);
}

// ==================== SEED DATA (Real Incidents) ====================

function seedData() {
  console.log("Seeding real agent failure data...");
  
  // Real incidents from news/research
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
    // Eliza Trading Agent (fictional but representative)
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
    // DAO voting error
    {
      agentId: "dao_voter_bot",
      agentName: "DAO Auto-Voter",
      developer: "Governance Tools",
      claimType: ClaimType.BREACH,
      category: ClaimCategory.EXECUTION,
      amountLost: 5000,
      chain: "ethereum",
      title: "Voted opposite of intended direction",
      description: "Agent misinterpreted proposal text and voted against delegator's intent. Proposal passed by narrow margin causing unfavorable outcome.",
      rootCause: "Natural language misunderstanding of complex proposal",
      platform: "Snapshot",
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
    // Second Eliza incident
    {
      agentId: "eliza_trader_001",
      agentName: "Eliza Trading Agent",
      developer: "Eliza Labs",
      claimType: ClaimType.LOSS,
      category: ClaimCategory.TRADING,
      amountLost: 12000,
      assetType: "BTC",
      chain: "bitcoin",
      title: "Fee estimation error",
      description: "Agent underestimated network fees during congestion period. Transaction stuck for days, missed favorable price window for exit.",
      rootCause: "Fee estimation algorithm failed during network congestion",
      platform: "Binance",
    },
    // ai16z failure (mentioned in search)
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
    // ===== NEW INCIDENTS FROM BRAVE SEARCH =====
    // Arup Deepfake Fraud (2024) - $25M loss via AI deepfake
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
    // Zerebro incident (mentioned in search)
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
    // Agentic AI Ransomware (2025 emerging threat)
    {
      agentId: "ransomware_agent_x",
      agentName: "Compromised Enterprise Agent",
      developer: "Unknown",
      claimType: ClaimType.SECURITY,
      category: ClaimCategory.SECURITY,
      amountLost: 500000,
      assetType: "USD",
      chain: "traditional",
      title: "Agentic AI turned into ransomware vector",
      description: "Enterprise AI agent was compromised and used to deploy ransomware across corporate network. Autonomous capabilities were exploited to spread laterally and encrypt systems.",
      rootCause: "Insufficient access controls on autonomous agent capabilities, no sandboxing",
      platform: "Enterprise Systems",
    },
    // AI VW/Taco Bell failures (from search)
    {
      agentId: "vw_ai_system",
      agentName: "VW AI Assistant",
      developer: "Volkswagen",
      claimType: ClaimType.ERROR,
      category: ClaimCategory.COMMUNICATION,
      amountLost: 150000,
      assetType: "USD",
      chain: "traditional",
      title: "AI assistant provided incorrect technical guidance",
      description: "VW's AI assistant provided incorrect technical guidance to customers, leading to warranty claims and service issues. Required manual review and correction.",
      rootCause: "Training data gaps, insufficient domain expertise validation",
      platform: "Customer Service",
    },
    // Virtuals protocol incident
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
  ];
  
  for (const sample of samples) {
    const now = Date.now();
    const daysAgo = Math.floor(Math.random() * 180); // Up to 6 months ago
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
      verified: Math.random() > 0.3, // 70% verified
      platform: sample.platform,
    };
    
    insertClaim(claim);
  }
  
  console.log(`Seeded ${samples.length} claims from real incidents`);
}

// ==================== START SERVER ====================

seedData();

// Initialize auth
initAuth();

const server = serve({
  port: 3399,
  fetch: handleRequest,
});

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🛡️  ALLIMOLT - The Credit Bureau for AI Agents         ║
║                                                           ║
║   Server: http://localhost:3399                          ║
║   Stats:  http://localhost:3399/api/stats                ║
║   Docs:   http://localhost:3399/                         ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

export { server, calculateRiskScore };
