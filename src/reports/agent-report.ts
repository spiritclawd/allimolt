/**
 * AlliGo - Automated Agent Report System
 * Generate performance reports for any agent ID across protocols (8004, etc.)
 */

import { getClaimsByAgent } from "../api/db";
import { calculateSeverity, gradeFromScore, Resolution } from "../schema/claim";

export interface AgentReportRequest {
  agentId: string;
  protocol?: string;  // e.g., "8004", "eliza", "virtuals"
  includeHistory?: boolean;
  format?: "json" | "markdown" | "badge";
}

export interface AgentReport {
  // Identity
  agentId: string;
  protocol: string;
  reportGeneratedAt: number;

  // Risk Assessment
  riskScore: number;
  confidence: number;
  grade: string;
  riskLevel: "minimal" | "low" | "moderate" | "high" | "critical" | "unknown";

  // Claims Summary
  totalClaims: number;
  openClaims: number;
  resolvedClaims: number;
  rejectedClaims: number;

  // Financial Impact
  totalValueLost: number;
  totalValueRecovered: number;
  averageLossPerIncident: number;

  // Breakdown
  claimsByType: Record<string, number>;
  claimsByCategory: Record<string, number>;
  claimsByChain: Record<string, number>;

  // History
  recentClaims?: AgentClaimSummary[];

  // Recommendations
  recommendation: string;
  shouldTransact: boolean;
  suggestedSafeguards: string[];

  // Data Source
  dataSource: "alligo_database" | "protocol_registry" | "combined";
  verifiedData: boolean;
}

export interface AgentClaimSummary {
  id: string;
  title: string;
  amountLost: number;
  category: string;
  timestamp: number;
  resolution: string;
  verified: boolean;
}

// Protocol-specific agent ID resolvers
const PROTOCOL_RESOLVERS: Record<string, (agentId: string) => string[]> = {
  "8004": (agentId: string) => {
    // 8004 protocol - Standard AI Agent Identification
    // Format: protocol:namespace:identifier
    const variants = [agentId];
    if (agentId.includes(":")) {
      const parts = agentId.split(":");
      if (parts.length >= 3) {
        variants.push(parts[2]); // Just the identifier
        variants.push(`${parts[0]}:${parts[2]}`); // Protocol + ID
      }
    }
    return variants;
  },
  "eliza": (agentId: string) => {
    return [agentId, `eliza_${agentId}`, agentId.toLowerCase()];
  },
  "virtuals": (agentId: string) => {
    return [agentId, `virtuals_${agentId}`];
  },
  "default": (agentId: string) => {
    return [agentId, agentId.toLowerCase(), agentId.replace(/[^a-zA-Z0-9_]/g, "_")];
  }
};

/**
 * Resolve agent ID across different formats
 */
function resolveAgentIdVariants(agentId: string, protocol?: string): string[] {
  const resolver = protocol ? PROTOCOL_RESOLVERS[protocol] : PROTOCOL_RESOLVERS.default;
  const variants = resolver(agentId);

  // Add common variations
  const additionalVariants = new Set<string>();
  for (const variant of variants) {
    additionalVariants.add(variant);
    additionalVariants.add(variant.toLowerCase());
    additionalVariants.add(variant.replace(/-/g, "_"));
    additionalVariants.add(variant.replace(/_/g, "-"));
  }

  return Array.from(additionalVariants);
}

/**
 * Calculate risk score from claims
 */
function calculateRiskScoreFromClaims(claims: any[]): { score: number; confidence: number } {
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

/**
 * Generate recommendation based on risk assessment
 */
function generateRecommendation(report: Partial<AgentReport>): { recommendation: string; shouldTransact: boolean; suggestedSafeguards: string[] } {
  const safeguards: string[] = [];

  if (report.totalClaims === 0) {
    return {
      recommendation: "No claims found for this agent. Not yet rated. Consider requesting agent registration or proceed with standard caution.",
      shouldTransact: true,
      suggestedSafeguards: ["Request agent to register with AlliGo", "Start with small transactions", "Monitor first interactions closely"]
    };
  }

  if (report.grade === "A") {
    return {
      recommendation: `Excellent track record. ${report.totalClaims} claim(s) with minimal impact. Agent demonstrates strong reliability.`,
      shouldTransact: true,
      suggestedSafeguards: ["Standard monitoring recommended"]
    };
  }

  if (report.grade === "B") {
    safeguards.push("Consider transaction limits for high-value operations");
    safeguards.push("Request recent performance logs if available");
    return {
      recommendation: `Good track record. ${report.totalClaims} claim(s), $${report.totalValueLost?.toLocaleString()} total loss. Generally safe to transact.`,
      shouldTransact: true,
      suggestedSafeguards: safeguards
    };
  }

  if (report.grade === "C") {
    safeguards.push("Implement transaction approval workflow");
    safeguards.push("Set maximum transaction values");
    safeguards.push("Require additional verification for sensitive operations");
    return {
      recommendation: `Moderate risk. ${report.totalClaims} claim(s) with $${report.totalValueLost?.toLocaleString()} total loss. Proceed with caution.`,
      shouldTransact: true,
      suggestedSafeguards: safeguards
    };
  }

  if (report.grade === "D") {
    safeguards.push("Use escrow for all transactions");
    safeguards.push("Require human approval for transactions above $100");
    safeguards.push("Implement real-time monitoring");
    safeguards.push("Consider alternative agents if available");
    return {
      recommendation: `High risk. ${report.totalClaims} claims with significant losses. Strong caution advised.`,
      shouldTransact: false,
      suggestedSafeguards: safeguards
    };
  }

  // Grade F
  safeguards.push("DO NOT TRANSACT without escrow");
  safeguards.push("Require full insurance coverage");
  safeguards.push("Use only for testing/sandbox environments");
  safeguards.push("Consider reporting additional issues to AlliGo");
  return {
    recommendation: `Critical risk. Agent has ${report.totalClaims} claims with $${report.totalValueLost?.toLocaleString()} in losses. Avoid transactions unless fully insured.`,
    shouldTransact: false,
    suggestedSafeguards: safeguards
  };
}

/**
 * Generate a comprehensive agent report
 */
export function generateAgentReport(request: AgentReportRequest): AgentReport {
  const { agentId, protocol = "default", includeHistory = true } = request;

  // Resolve agent ID variants
  const variants = resolveAgentIdVariants(agentId, protocol);

  // Search for claims across all variants
  let allClaims: any[] = [];
  for (const variant of variants) {
    const claims = getClaimsByAgent(variant);
    allClaims = allClaims.concat(claims);
  }

  // Deduplicate by claim ID
  const claimsMap = new Map<string, any>();
  for (const claim of allClaims) {
    claimsMap.set(claim.id, claim);
  }
  const uniqueClaims = Array.from(claimsMap.values());

  // Calculate risk score
  const { score, confidence } = calculateRiskScoreFromClaims(uniqueClaims);
  const grade = uniqueClaims.length > 0 ? gradeFromScore(score) : "NR";

  // Calculate financial metrics
  const totalValueLost = uniqueClaims.reduce((sum, c) => sum + c.amountLost, 0);
  const totalValueRecovered = uniqueClaims.reduce((sum, c) => sum + (c.recoveredAmount || 0), 0);

  // Count by resolution
  const openClaims = uniqueClaims.filter(c => c.resolution === Resolution.PENDING).length;
  const resolvedClaims = uniqueClaims.filter(c => c.resolution === Resolution.RESOLVED).length;
  const rejectedClaims = uniqueClaims.filter(c => c.resolution === Resolution.REJECTED).length;

  // Breakdown by type/category/chain
  const claimsByType: Record<string, number> = {};
  const claimsByCategory: Record<string, number> = {};
  const claimsByChain: Record<string, number> = {};

  for (const claim of uniqueClaims) {
    claimsByType[claim.claimType] = (claimsByType[claim.claimType] || 0) + 1;
    claimsByCategory[claim.category] = (claimsByCategory[claim.category] || 0) + 1;
    if (claim.chain) claimsByChain[claim.chain] = (claimsByChain[claim.chain] || 0) + 1;
  }

  // Determine risk level
  let riskLevel: AgentReport["riskLevel"];
  if (uniqueClaims.length === 0) riskLevel = "unknown";
  else if (score >= 90) riskLevel = "minimal";
  else if (score >= 80) riskLevel = "low";
  else if (score >= 60) riskLevel = "moderate";
  else if (score >= 40) riskLevel = "high";
  else riskLevel = "critical";

  // Build report
  const report: AgentReport = {
    agentId,
    protocol,
    reportGeneratedAt: Date.now(),

    riskScore: score,
    confidence,
    grade,
    riskLevel,

    totalClaims: uniqueClaims.length,
    openClaims,
    resolvedClaims,
    rejectedClaims,

    totalValueLost,
    totalValueRecovered,
    averageLossPerIncident: uniqueClaims.length > 0 ? totalValueLost / uniqueClaims.length : 0,

    claimsByType,
    claimsByCategory,
    claimsByChain,

    dataSource: "alligo_database",
    verifiedData: uniqueClaims.some(c => c.verified)
  };

  // Include history if requested
  if (includeHistory && uniqueClaims.length > 0) {
    report.recentClaims = uniqueClaims
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10)
      .map(c => ({
        id: c.id,
        title: c.title,
        amountLost: c.amountLost,
        category: c.category,
        timestamp: c.timestamp,
        resolution: c.resolution,
        verified: c.verified
      }));
  }

  // Generate recommendations
  const { recommendation, shouldTransact, suggestedSafeguards } = generateRecommendation(report);
  report.recommendation = recommendation;
  report.shouldTransact = shouldTransact;
  report.suggestedSafeguards = suggestedSafeguards;

  return report;
}

/**
 * Format report as markdown
 */
export function formatReportAsMarkdown(report: AgentReport): string {
  const lines: string[] = [
    `# AlliGo Agent Report: ${report.agentId}`,
    "",
    `**Generated:** ${new Date(report.reportGeneratedAt).toISOString()}`,
    `**Protocol:** ${report.protocol}`,
    "",
    "## Risk Assessment",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| **Grade** | ${report.grade} |`,
    `| **Risk Score** | ${report.riskScore}/100 |`,
    `| **Confidence** | ${report.confidence}% |`,
    `| **Risk Level** | ${report.riskLevel} |`,
    "",
    "## Claims Summary",
    "",
    `| Status | Count |`,
    `|--------|-------|`,
    `| Total Claims | ${report.totalClaims} |`,
    `| Open | ${report.openClaims} |`,
    `| Resolved | ${report.resolvedClaims} |`,
    `| Rejected | ${report.rejectedClaims} |`,
    "",
    "## Financial Impact",
    "",
    `- **Total Value Lost:** $${report.totalValueLost.toLocaleString()}`,
    `- **Total Recovered:** $${report.totalValueRecovered.toLocaleString()}`,
    `- **Average Loss/Incident:** $${report.averageLossPerIncident.toLocaleString()}`,
    "",
    "## Recommendation",
    "",
    report.shouldTransact
      ? `✅ **SAFE TO TRANSACT** - ${report.recommendation}`
      : `⚠️ **CAUTION ADVISED** - ${report.recommendation}`,
    "",
    "### Suggested Safeguards",
    "",
    ...report.suggestedSafeguards.map(s => `- ${s}`),
    "",
    "---",
    "*Powered by AlliGo - The Credit Bureau for AI Agents*"
  ];

  return lines.join("\n");
}

export default { generateAgentReport, formatReportAsMarkdown };
