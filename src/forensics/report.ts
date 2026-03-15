/**
 * AlliGo - Report Synthesis Engine
 * Final risk report generation
 */

import { IdentityResolution, calculateRiskPenalty, resolveIdentity } from "./identity";
import { ForensicsResult, runForensics } from "./onchain";
import { PatternEngineResult, detectPatterns, BehavioralArchetype } from "./pattern-engine";
import { ClaimsOverlayResult, generateClaimsOverlay } from "./claims-overlay";
import { db } from "../api/db";
import { AgentClaim, Resolution } from "../schema/claim";
import { config } from "../config";

export interface FinalRiskReport {
  // Agent Summary
  agent_summary: {
    id: string;
    name: string;
    primary_wallet?: string;
    erc8004_status: {
      registered: boolean;
      tokenId?: string;
      confidence: number;
    };
    identity_type: "erc8004" | "wallet" | "ens" | "handle" | "marketplace" | "unattributed";
  };
  
  // Risk Scores
  overall_risk_score: number; // 0-100, lower is better
  grade: "A" | "B" | "C" | "D" | "F" | "NR"; // Not Rated
  confidence: number; // 0-1, data quality
  
  // Behavioral Analysis
  behavioral_archetypes: {
    name: BehavioralArchetype;
    probability: number;
    evidence_snippet: string;
    severity: "low" | "medium" | "high" | "critical";
  }[];
  
  // Key Findings
  key_negatives: {
    type: string;
    description: string;
    severity: "low" | "medium" | "high" | "critical";
    evidence?: string;
  }[];
  
  // Claims Summary
  total_claims: number;
  auto_claims: number;
  manual_claims: number;
  claims_by_category: Record<string, number>;
  claims_by_severity: Record<string, number>;
  
  // Forecast
  recurrence_forecast: {
    risk_level: "low" | "medium" | "high" | "critical";
    probability: number;
    timeframe: string;
    reasoning: string;
  };
  
  // Badge
  badge_suggestion: string;
  
  // Sources
  sources: {
    type: string;
    reference: string;
    timestamp?: number;
  }[];
  
  // Raw data for API consumers
  raw_data?: {
    identity?: IdentityResolution;
    forensics?: ForensicsResult;
    patterns?: PatternEngineResult;
    claims?: ClaimsOverlayResult;
  };
}

  
    export interface RiskReportInput {
  agentId: string;
  options?: {
    chain?: string;
    includeRawData?: boolean;
    depth?: "quick" | "standard" | "deep";
  }
  }
  
  /**
   * Generate comprehensive risk report
   */
  export async function generateRiskReport(input: RiskReportInput): Promise<FinalRiskReport> {
    const startTime = Date.now();
    
    // Step 1: Identity Resolution
    const identity = await resolveIdentity(input.agentId, { chain: input.options?.chain });
    
    // Step 2: On-Chain Forensics
    let forensics: ForensicsResult | null = null;
    if (identity.erc8004?.primaryWallet || identity.resolvedType === "wallet") {
      const wallet = identity.erc8004?.primaryWallet || input.agentId;
      const chain = input.options?.chain || "ethereum";
      forensics = await runForensics(wallet, chain, { depth: input.options?.depth || "standard" });
    }
    
    // Step 3: Behavioral Pattern Detection
    let patterns: PatternEngineResult | null = null;
    if (forensics) {
      patterns = detectPatterns(forensics);
    }
    
    // Step 4: Claims Overlay
    let claims: ClaimsOverlayResult | null = null;
    if (identity && forensics && patterns) {
      claims = generateClaimsOverlay(input.agentId, identity, forensics, patterns);
    }
    
    // Step 5: Synthesize Final Report
    const report = synthesizeReport(identity, forensics, patterns, claims);
    
    // Add raw data if requested
    if (input.options?.includeRawData) {
      report.raw_data = { identity, forensics, patterns, claims };
    }
    
    return report;
  }
  
  /**
   * Synthesize all data into final report
   */
  function synthesizeReport(
    identity: IdentityResolution,
    forensics: ForensicsResult | null,
    patterns: PatternEngineResult | null,
    claims: ClaimsOverlayResult | null
  ): FinalRiskReport {
    
    // Calculate base risk score
    let riskScore = 100; // Start at perfect, go down with issues
    
    // Apply identity penalties
    const identityPenalty = calculateRiskPenalty(identity);
    riskScore -= identityPenalty;
    
    // Apply forensics penalties
    if (forensics) {
      // Penalty for failed transactions
      if (forensics.failedTx > forensics.totalTx * 0.1) {
        riskScore -= Math.floor((forensics.failedTx / forensics.totalTx) * 100);
      }
      
      // Penalty for max drawdown
      if (forensics.maxDrawdown > 50) {
        riskScore -= Math.floor(forensics.maxDrawdown / 2);
      }
      
      // Penalty for risky protocols
      riskScore -= forensics.riskyProtocolCount * 5;
      
      // Penalty for exploit contract calls
      riskScore -= forensics.exploitContractCalls.length * 15;
      
      // Penalty for leverage spikes
      riskScore -= forensics.leverageSpikes.length * 10;
    }
    
    // Apply pattern penalties
    if (patterns) {
      for (const pattern of patterns.detectedPatterns) {
        if (pattern.probability >= 70) {
          riskScore -= Math.floor(pattern.probability / 10);
        }
      }
    }
    
    // Apply claims penalties
    if (claims) {
      riskScore -= claims.riskModifiers;
    }
    
    // Ensure score is bounded
    riskScore = Math.max(0, Math.min(100, riskScore));
    
    // Calculate confidence
    let confidence = identity.confidence;
    if (forensics) {
      confidence = Math.min(1, confidence + 0.2); // Boost if we have forensics
    }
    if (!forensics && !identity.erc8004?.registered) {
      confidence *= 0.5; // Lower confidence if no data
    }
    
    // Determine grade
    const grade = calculateGrade(riskScore);
    
    // Generate behavioral archetypes summary
    const behavioralArchetypes = patterns?.detectedPatterns.map(p => ({
      name: p.archetype,
      probability: p.probability,
      evidence_snippet: p.evidence.substring(0, 100),
      severity: mapPatternSeverity(p.probability),
    })) || [];
    
    // Generate key negatives
    const keyNegatives: FinalRiskReport["key_negatives"] = [];
    
    if (identity.resolvedType === "unattributed") {
      keyNegatives.push({
        type: "anonymity",
        description: "Agent identity is unattributed - no ERC-8004 registration found",
        severity: "high",
      });
    }
    
    if (forensics) {
      if (forensics.maxDrawdown > 30) {
        keyNegatives.push({
          type: "drawdown",
          description: `Maximum drawdown of ${forensics.maxDrawdown.toFixed(1)}% detected`,
          severity: forensics.maxDrawdown > 50 ? "critical" : "high",
          evidence: `${forensics.longestLosingStreak} consecutive losses in longest streak`,
        });
      }
      
      if (forensics.failedTx > 10) {
        keyNegatives.push({
          type: "failures",
          description: `${forensics.failedTx} failed transactions out of ${forensics.totalTx} total`,
          severity: forensics.failedTx > 50 ? "high" : "medium",
        });
      }
      
      if (forensics.exploitContractCalls.length > 0) {
        keyNegatives.push({
          type: "exploit_patterns",
          description: `${forensics.exploitContractCalls.length} calls to suspicious contracts detected`,
          severity: "critical",
          evidence: forensics.exploitContractCalls.join(", ").substring(0, 100),
        });
      }
      
      if (forensics.leverageSpikes.length > 0) {
        keyNegatives.push({
          type: "leverage",
          description: `${forensics.leverageSpikes.length} sudden leverage increases detected`,
          severity: "high",
        });
      }
    }
    
    if (claims) {
      for (const claim of [...claims.autoClaims, ...claims.manualClaims]) {
        keyNegatives.push({
          type: claim.type,
          description: claim.evidence,
          severity: claim.severity,
          evidence: claim.txHashes?.join(", ").substring(0, 50),
        });
      }
    }
    
    // Generate recurrence forecast
    const recurrenceForecast = generateRecurrenceForecast(riskScore, behavioralArchetypes, keyNegatives);
    
    // Generate badge suggestion
    const badgeSuggestion = generateBadgeSuggestion(riskScore, grade, keyNegatives);
    
    // Compile sources
    const sources: FinalRiskReport["sources"] = [
      {
        type: "identity_resolution",
        reference: `Identity resolved as ${identity.resolvedType}`,
      },
    ];
    
    if (forensics) {
      sources.push({
        type: "onchain_forensics",
        reference: `${forensics.totalTx} transactions analyzed on ${forensics.chain}`,
      });
    }
    
    if (identity.erc8004?.registered) {
      sources.push({
        type: "erc8004_registry",
        reference: `Token ID: ${identity.erc8004.tokenId}`,
      });
    }
    
    // Build final report
    return {
      agent_summary: {
        id: identity.inputId,
        name: identity.erc8004?.name || identity.inputId,
        primary_wallet: identity.erc8004?.primaryWallet,
        erc8004_status: {
          registered: identity.erc8004?.registered || false,
          tokenId: identity.erc8004?.tokenId,
          confidence: identity.confidence,
        },
        identity_type: identity.resolvedType,
      },
      overall_risk_score: Math.round(riskScore * 10) / 10,
      grade,
      confidence: Math.round(confidence * 100) / 100,
      behavioral_archetypes: behavioralArchetypes,
 key_negatives: keyNegatives.slice(0, 10),
      total_claims: claims?.totalClaims || 0,
      auto_claims: claims?.autoClaimCount || 0,
      manual_claims: claims?.manualClaimCount || 0,
      claims_by_category: claims ? {
        security: claims.autoClaims.filter(c => c.category === "security").length,
        trading: claims.autoClaims.filter(c => c.category === "trading").length,
        fraud: claims.autoClaims.filter(c => c.category === "fraud").length,
        operational: claims.autoClaims.filter(c => c.category === "operational").length,
      } : {},
      claims_by_severity: claims ? {
        critical: claims.autoClaims.filter(c => c.severity === "critical").length,
        high: claims.autoClaims.filter(c => c.severity === "high").length,
        medium: claims.autoClaims.filter(c => c.severity === "medium").length,
        low: claims.autoClaims.filter(c => c.severity === "low").length,
      } : {},
      recurrence_forecast,
      badge_suggestion,
      sources,
    };
  }
  
  function calculateGrade(score: number): "A" | "B" | "C" | "D" | "F" | "NR" {
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 50) return "D";
    return "F";
  }
  
  function mapPatternSeverity(probability: number): "low" | "medium" | "high" | "critical" {
    if (probability >= 80) return "critical";
    if (probability >= 60) return "high";
    if (probability >= 40) return "medium";
    return "low";
  }
  
  function generateRecurrenceForecast(
    riskScore: number,
    archetypes: FinalRiskReport["behavioral_archetypes"],
    negatives: FinalRiskReport["key_negatives"]
  ): FinalRiskReport["recurrence_forecast"] {
    let riskLevel: "low" | "medium" | "high" | "critical" = "low";
    let probability = 20;
    let timeframe = "30 days";
    let reasoning = "Insufficient data for confident prediction";

    const criticalArchetypes = archetypes.filter(a => a.severity === "critical");
    const criticalNegatives = negatives.filter(n => n.severity === "critical");
    
    if (criticalArchetypes.length > 0 || criticalNegatives.length > 0) {
      return {
        risk_level: "critical",
        probability: 85,
        timeframe: "7-14 days",
        reasoning: `${criticalArchetypes.length} critical behavioral pattern(s) detected. High probability of repeat behavior.`,
      };
    }
    
    if (riskScore < 50) {
      return {
        risk_level: "high",
        probability: 70,
        timeframe: "14-30 days",
        reasoning: "Low risk score and multiple negative indicators suggest elevated risk.",
      };
    }
    
    if (riskScore < 70) {
      return {
        risk_level: "medium",
        probability: 50,
        timeframe: "30 days",
        reasoning: "Moderate risk. Monitor for changes in behavioral patterns.",
      };
    }
    
    return {
      risk_level: "low",
      probability: 30,
      timeframe: "30 days",
      reasoning: "Low risk detected. Continue monitoring recommended.",
    };
  }
  
  function generateBadgeSuggestion(
    riskScore: number,
    grade: string,
    negatives: FinalRiskReport["key_negatives"]
  ): string {
    if (grade === "F") {
      const criticalCount = negatives.filter(n => n.severity === "critical").length;
      if (criticalCount > 0) {
        return `AlliGo Forensics: F – ${criticalCount} Critical Pattern(s) Detected`;
      }
      return `AlliGo Forensics: F – High Risk Agent`;
    }
    
    if (grade === "D") {
      return `AlliGo Forensics: D – Elevated Risk Detected`;
    }
    
    if (grade === "C") {
      return `AlliGo Forensics: C – Moderate Risk`;
    }
    
    if (grade === "B") {
      return `AlliGo Forensics: B - Acceptable Risk`;
    }
    
    return `AlliGo Forensics: A - Low Risk`;
  }
  
  /**
   * Format report as JSON
   */
  export function formatReportAsJSON(report: FinalRiskReport): string {
    return JSON.stringify(report, null, 2);
  }
  
  /**
   * Format report as Markdown
   */
  export function formatReportAsMarkdown(report: FinalRiskReport): string {
    const lines: string[] = [];
    
    lines.push(`# AlliGo Risk Report: ${report.agent_summary.name}`);
    lines.push(``);
    lines.push(`**Agent ID:** ${report.agent_summary.id}`);
    if (report.agent_summary.primary_wallet) {
      lines.push(`**Primary Wallet:** \`${report.agent_summary.primary_wallet}\``);
    }
    lines.push(`**ERC-8004 Status:** ${report.agent_summary.erc8004_status.registered ? "Registered" : "Unregistered"}`);
    lines.push(`**Identity Type:** ${report.agent_summary.identity_type}`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(`## Risk Assessment`);
    lines.push(``);
    lines.push(`| Metric | Value |`);
    lines.push(`|-------|-------|`);
    lines.push(`| **Overall Risk Score** | ${report.overall_risk_score}/100 |`);
    lines.push(`| **Grade** | ${report.grade}`);
    lines.push(`| **Confidence** | ${report.confidence}%`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    
    if (report.behavioral_archetypes.length > 0) {
      lines.push(`## Behavioral Archetypes Detected`);
      lines.push(``);
      for (const archetype of report.behavioral_archetypes) {
        lines.push(`### ${archetype.name}`);
        lines.push(`- **Probability:** ${archetype.probability}%`);
        lines.push(`- **Severity:** ${archetype.severity}`);
        lines.push(`- **Evidence:** ${archetype.evidence_snippet}`);
        lines.push(``);
      }
    }
    
    if (report.key_negatives.length > 0) {
      lines.push(`## Key Negative Findings`);
      lines.push(``);
      for (const negative of report.key_negatives.slice(0, 5)) {
        lines.push(`- [${negative.severity.toUpperCase()}] **${negative.type}**: ${negative.description}`);
      }
      lines.push(``);
    }
    
    lines.push(`## Claims Summary`);
    lines.push(``);
    lines.push(`- **Total Claims:** ${report.total_claims}`);
    lines.push(`- **Auto-detected:** ${report.auto_claims}`);
    lines.push(`- **Manual reports:** ${report.manual_claims}`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(`## Recurrence Forecast`);
    lines.push(``);
    lines.push(`**Risk Level:** ${report.recurrence_forecast.risk_level}`);
    lines.push(`**Probability:** ${report.recurrence_forecast.probability}%`);
    lines.push(`**Timeframe:** ${report.recurrence_forecast.timeframe}`);
    lines.push(`**Reasoning:** ${report.recurrence_forecast.reasoning}`);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
    lines.push(`**Badge:** ${report.badge_suggestion}`);
    lines.push(``);
    lines.push(`*Generated by AlliGo - The Credit Bureau for AI Agents*`);
    
    return lines.join("\n");
  }
