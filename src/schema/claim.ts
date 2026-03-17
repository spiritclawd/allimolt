/**
 * AlliGo - Agent Claims Registry
 * Core Schema Definitions
 */

// ==================== ENUMS ====================

export enum ClaimType {
  LOSS = "loss",           // Financial loss from agent action/inaction
  ERROR = "error",         // Technical error causing damage
  BREACH = "breach",       // Contract/service agreement breach
  FRAUD = "fraud",         // Intentional malicious behavior
  SECURITY = "security",   // Security incident (wallet drained, etc.)
  UNKNOWN = "unknown",     // Unclassified
}

export enum ClaimCategory {
  TRADING = "trading",         // Trading/arbitrage failures
  PAYMENT = "payment",         // Payment execution errors
  SECURITY = "security",       // Wallet/key security
  EXECUTION = "execution",     // Smart contract execution
  DATA = "data",               // Data handling errors
  COMMUNICATION = "communication", // Agent-to-agent communication
  COMPLIANCE = "compliance",   // Regulatory violations
  OTHER = "other",
}

export enum Resolution {
  PENDING = "pending",
  RESOLVED = "resolved",       // Issue fixed, funds recovered
  PARTIAL = "partial",         // Partial recovery
  DISPUTED = "disputed",       // Under dispute
  UNRECOVERABLE = "unrecoverable", // Total loss
  REJECTED = "rejected",       // Claim was invalid
}

export enum ClaimSource {
  SELF_REPORTED = "self_reported",   // Agent developer/user reported
  THIRD_PARTY = "third_party",       // Independent reporter
  VERIFIED = "verified",             // Verified by AlliGo
  SCRAPED = "scraped",               // Aggregated from public sources
  INTEGRATION = "integration",       // Via API integration
}

// ==================== INTERFACES ====================

export interface AgentClaim {
  // Identity
  id: string;
  agentId: string;
  agentName?: string;
  developer?: string;
  developerContact?: string;
  
  // Claim Details
  claimType: ClaimType;
  category: ClaimCategory;
  severity: ClaimSeverity;
  
  // Financial Impact
  amountLost: number;           // USD value at time of loss
  assetType?: string;           // ETH, USDC, BTC, etc.
  assetAmount?: number;         // Amount in original asset
  recoveredAmount?: number;     // If any was recovered
  
  // Context
  chain?: string;
  txHash?: string;
  contractAddress?: string;
  counterparty?: string;        // Other agent/address involved
  
  // Timeline
  timestamp: number;            // When the incident occurred
  reportedAt: number;           // When it was reported
  resolvedAt?: number;
  
  // Description
  title: string;
  description: string;
  rootCause?: string;
  
  // Resolution
  resolution: Resolution;
  resolutionNotes?: string;
  
  // Verification
  source: ClaimSource;
  verified: boolean;
  evidence?: Evidence[];
  
  // Metadata
  tags?: string[];
  platform?: string;            // Where the agent operates
  agentVersion?: string;
}

export interface Evidence {
  type: "tx_hash" | "screenshot" | "log" | "link" | "document";
  url?: string;
  description?: string;
  data?: string;                // Base64 or raw data
}

export interface ClaimSeverity {
  score: number;                // 1-10
  level: "low" | "medium" | "high" | "critical";
  factors: string[];
}

// ==================== AGENT PROFILE ====================

export interface AgentProfile {
  agentId: string;
  name?: string;
  developer?: string;
  
  // Statistics
  totalClaims: number;
  openClaims: number;
  totalValueLost: number;
  totalValueRecovered: number;
  
  // Scoring
  riskScore: number;            // 0-100 (100 = safest)
  confidence: number;           // How confident is the score (0-100)
  
  // Breakdown
  claimsByType: Record<ClaimType, number>;
  claimsByCategory: Record<ClaimCategory, number>;
  
  // History
  firstClaimAt?: number;
  lastClaimAt?: number;
  
  // Verification
  verified: boolean;
  bonded?: number;              // If they have a bond/stake
}

// ==================== API TYPES ====================

export interface SubmitClaimRequest {
  agentId: string;
  agentName?: string;
  developer?: string;
  
  claimType: ClaimType;
  category: ClaimCategory;
  
  amountLost: number;
  assetType?: string;
  assetAmount?: number;
  
  chain?: string;
  txHash?: string;
  counterparty?: string;
  
  title: string;
  description: string;
  rootCause?: string;
  
  evidence?: Evidence[];
  tags?: string[];
  platform?: string;
  agentVersion?: string;
  
  // Reporter info (optional, can be anonymous)
  reporterEmail?: string;
  reporterWallet?: string;
}

export interface SubmitClaimResponse {
  success: boolean;
  claimId?: string;
  message: string;
  estimatedReviewTime?: string;
}

export interface AgentScoreResponse {
  agentId: string;
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  confidence: number;
  
  totalClaims: number;
  openClaims: number;
  totalValueLost: number;

  // elizaOS plugin + ecosystem compatibility
  incidentCount: number;
  verifiedIncidents: number;
  easAttested: boolean;
  lastIncident: string | null;
  
  grade: "A" | "B" | "C" | "D" | "F" | "NR";  // NR = Not Rated
  
  summary: string;
  lastUpdated: number;
}

export interface ClaimsQueryResponse {
  claims: AgentClaim[];
  total: number;
  page: number;
  pageSize: number;
}

// ==================== STATS ====================

export interface GlobalStats {
  totalClaims: number;
  totalValueLost: number;
  totalValueRecovered: number;
  recoveryRate: number;
  
  claimsByType: Record<ClaimType, number>;
  claimsByCategory: Record<ClaimCategory, number>;
  claimsByChain: Record<string, number>;
  
  topAgents: Array<{
    agentId: string;
    name?: string;
    claims: number;
    valueLost: number;
  }>;
  
  recentClaims: AgentClaim[];
  
  trends: {
    claimsLast30Days: number;
    claimsLast7Days: number;
    avgLossPerClaim: number;
  };
}

// ==================== HELPER FUNCTIONS ====================

export function calculateSeverity(claim: Partial<AgentClaim>): ClaimSeverity {
  const amount = claim.amountLost || 0;
  
  let score = 1;
  let level: ClaimSeverity["level"] = "low";
  const factors: string[] = [];
  
  // Amount-based scoring
  if (amount >= 1000000) {
    score = 10;
    level = "critical";
    factors.push("Loss > $1M");
  } else if (amount >= 100000) {
    score = 8;
    level = "critical";
    factors.push("Loss > $100K");
  } else if (amount >= 10000) {
    score = 6;
    level = "high";
    factors.push("Loss > $10K");
  } else if (amount >= 1000) {
    score = 4;
    level = "medium";
    factors.push("Loss > $1K");
  } else if (amount > 0) {
    score = 2;
    level = "low";
    factors.push("Loss < $1K");
  }
  
  // Type-based adjustment
  if (claim.claimType === ClaimType.FRAUD) {
    score = Math.min(10, score + 2);
    factors.push("Fraud involved");
    level = level === "low" ? "medium" : level;
  }
  
  if (claim.claimType === ClaimType.SECURITY) {
    score = Math.min(10, score + 1);
    factors.push("Security incident");
  }
  
  // Recovery adjustment
  if (claim.recoveredAmount && claim.recoveredAmount > 0) {
    const recoveryRate = claim.recoveredAmount / amount;
    if (recoveryRate > 0.9) {
      score = Math.max(1, score - 3);
      factors.push("Mostly recovered");
    } else if (recoveryRate > 0.5) {
      score = Math.max(1, score - 2);
      factors.push("Partially recovered");
    }
  }
  
  return { score, level, factors };
}

export function calculateRiskScore(
  claims: AgentClaim[],
  totalVolume?: number
): { score: number; confidence: number } {
  if (claims.length === 0) {
    return { score: 50, confidence: 0 }; // No data = neutral, low confidence
  }
  
  // Base score starts at 100
  let score = 100;
  let totalWeight = 0;
  
  for (const claim of claims) {
    const severity = calculateSeverity(claim);
    const ageInDays = (Date.now() - claim.timestamp) / (1000 * 60 * 60 * 24);
    
    // Recent claims weight more
    const recencyWeight = Math.max(0.5, 1 - (ageInDays / 365));
    
    // Severity impact
    const severityImpact = severity.score * 3;
    
    // Resolution adjustment
    let resolutionMultiplier = 1;
    if (claim.resolution === Resolution.RESOLVED) {
      resolutionMultiplier = 0.3;
    } else if (claim.resolution === Resolution.PARTIAL) {
      resolutionMultiplier = 0.6;
    } else if (claim.resolution === Resolution.REJECTED) {
      resolutionMultiplier = 0;
    }
    
    const impact = severityImpact * recencyWeight * resolutionMultiplier;
    totalWeight += recencyWeight;
    
    score -= impact;
  }
  
  // Normalize
  score = Math.max(0, Math.min(100, score));
  
  // Confidence based on number of claims and their weight
  const confidence = Math.min(100, (claims.length * 10) + (totalWeight * 5));
  
  return { 
    score: Math.round(score * 10) / 10, 
    confidence: Math.round(confidence) 
  };
}

export function gradeFromScore(score: number): AgentScoreResponse["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  if (score >= 0) return "F";
  return "NR";
}
