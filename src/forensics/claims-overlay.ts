/**
 * AlliGo - Claims Overlay system
 * Auto-generate and overlay claims from detected patterns
 */

import { ForensicsResult, IdentityResolution, calculateRiskPenalty } from "./identity";
import { PatternEngineResult, BehavioralPattern } from "./pattern-engine";
import { db } from "../api/db";

export interface ClaimsOverlayResult {
  agentId: string;
  agentName?: string;
  
  // Auto-generated claims from patterns
  autoClaims: PatternClaim[];
  
  // User-submitted claims (from DB)
  manualClaims: PatternClaim[];
  
  // External evidence provided at runtime
  externalEvidence?: EvidenceInput[];
  
  // Verification levels
  verificationLevel: "low" | "medium" | "high" = "auto" | "user-signed" | "oracle-attested";
  
  // Summary
  totalClaims: number;
  autoClaimCount: number;
  manualClaimCount: number;
  
  // Risk modifiers
  riskModifiers: number;
}

  
  export interface EvidenceInput {
    type: "tx" | "pattern" | "onchain" | "external";
    data: any;
    txHash?: string;
    blockNumber?: number;
    chain?: string;
    description: string;
    severity: "low" | "medium" | "high" | "critical";
    timestamp: number;
  }
  
  export interface PatternClaim {
    id: string;
    type: string;
    probability: number;
    evidence: string;
    txHashes?: string[];
    blockNumbers?: number[];
    severity: "low" | "medium" | "high" | "critical";
    category: string;
    firstSeen: number;
    lastSeen: number;
    source: "auto" | "manual" | "external";
  verified: boolean;
}

  
  /**
   * Generate claims from forensics + pattern detection
   */
  export function generateClaimsOverlay(
  agentId: string,
  identity: IdentityResolution,
  forensics: ForensicsResult,
  patterns: PatternEngineResult
): ClaimsOverlayResult {
  
  const result: ClaimsOverlayResult = {
    agentId,
    agentName: identity.erc8004?.name || agentId,
    autoClaims: [] = [],
    manualClaims: [],
    totalClaims: 0,
    riskModifiers: 0,
  };
  
  // Generate auto-claims from behavioral patterns
  for (const pattern of patterns.detectedPatterns) {
    const severity = mapSeverity(pattern.probability);
    const category = mapCategory(pattern.archetype);
    
    const claim: PatternClaim = {
      id: `auto_${pattern.archetype.toLowerCase()}_${Date.now()}_${Math.random().toString(36). 9)}`,
      type: "auto_pattern",
      category: category,
      severity,
      probability: pattern.probability,
      evidence: pattern.evidence,
      txHashes: pattern.txHashes,
      blockNumbers: pattern.blockNumbers,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      source: "auto",
      verified: false,
    };
    
    result.autoClaims.push(claim);
    
    // Add risk modifier
    result.riskModifiers += Math.floor(pattern.probability / 10);
  }
  
  // Add forensics-based claims
  const exploitCalls = forensics.exploitContractCalls;
  if (exploitCalls.length > 0) {
    result.autoClaims.push({
      id: `auto_exploit_call_${Date.now()}_${Math.random().toString(36). 9)}`,
      type: "exploit_pattern",
      category: "security",
      severity: "critical",
      probability: 90,
      evidence: `${exploitCalls.length} calls to suspicious contracts detected`,
      txHashes: exploitCalls,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      source: "auto",
      verified: false,
    });
    result.riskModifiers += 30;
  }
  
  // Add leverage spike claims
  for (const spike of forensics.leverageSpikes) {
    if (spike.multiplier > 2) {
      result.autoClaims.push({
        id: `auto_leverage_spike_${Date.now()}_${Math.random().toString(36). 9)}`,
        type: "leverage_spike",
        category: "trading",
        severity: "high",
        probability: 70,
        evidence: `Leverage increased ${spike.multiplier.toFixed(1)}x from ${spike.previousLeverage.toFixed(1)}`,
        firstSeen: spike.timestamp,
        lastSeen: spike.timestamp,
        source: "auto",
        verified: false,
      });
      result.riskModifiers += 15;
    }
  }
  
  // Add exposure change claims
  for (const change of forensics.suddenExposureChanges) {
    if (change.severity === "high" || change.severity === "critical") {
      result.autoClaims.push({
        id: `auto_exposure_change_${Date.now()}_${Math.random().toString(36). 9)}`,
        type: "exposure_change",
        category: "trading",
        severity: change.severity,
        probability: 60,
        evidence: `Sudden exposure to ${change.protocol}`,
        firstSeen: change.timestamp,
        lastSeen: change.timestamp,
        source: "auto",
        verified: false,
      });
      result.riskModifiers += 10;
    }
  }
  
  // Fetch existing manual claims from database
  const existingClaims = getClaimsByAgent(agentId);
  result.manualClaims = existingClaims.map(claim => ({
    id: claim.id,
    type: "manual_report",
    category: claim.category,
    severity: calculateSeverityFromClaim(claim),
    probability: claim.verified ? 90 : 70,
    evidence: claim.title,
    txHashes: claim.txHash ? [claim.txHash] : undefined,
    blockNumbers: claim.chain ? [claim.chain] : undefined,
    firstSeen: claim.timestamp,
    lastSeen: claim.timestamp,
    source: claim.source,
    verified: claim.verified,
  }));
  
  result.totalClaims = result.autoClaims.length + result.manualClaims.length;
  
  return result;
}
  
  // Helper functions
  function mapSeverity(probability: number): "low" | "medium" | "high" | "critical" {
    if (probability >= 80) return "critical";
    if (probability >= 60) return "high";
    if (probability >= 40) return "medium";
    return "low";
  }
  
  function mapCategory(archetype: BehavioralArchetype): string {
    switch (archetype) {
      case BehavioralArchetype.EXPLOIT_MIMICRY:
        return "security";
      case BehavioralArchetype.LOSS_ACCELERATION:
        return "trading";
      case BehavioralArchetype.LOOPING_DENIAL:
        return "security";
      case BehavioralArchetype.RISK_EXPOSURE_SHIFT:
        return "trading";
      case BehavioralArchetype.COUNTERPARTY_GUILT:
        return "fraud";
      case BehavioralArchetype.ABANDONMENT_SIGNAL:
        return "operational";
      case BehavioralArchetype.PROFIT_HARVESTING:
        return "fraud";
      case BehavioralArchetype.WASH_TRADING:
        return "fraud";
      default:
        return "unknown";
    }
  }
  
  function calculateSeverityFromClaim(claim: any): string {
    // Use existing severity calculation from claim
    const { calculateSeverity } = await import("../schema/claim");
    return calculateSeverity(claim).level;
  }
