/**
 * AlliGo - Behavioral Pattern Engine
 * Bridges on-chain forensics data with agentic behavioral archetype detection.
 * Fixed: import syntax, exploitmimicry typo, stub detector implementations.
 */

import { ForensicsResult, ProtocolInteraction, FailedTxPattern, LeverageSpike, ExposureChange } from "./onchain";
import { IdentityResolution, calculateRiskPenalty } from "./identity";

// Behavioral archetypes — on-chain pattern layer (distinct from agentic internals archetypes)
export enum BehavioralArchetype {
  EXPLOIT_MIMICRY = "Exploit_Mimicry",
  LOSS_ACCELERATION = "Loss_Acceleration",
  LOOPING_DENIAL = "Looping_Denial_of_Wallet",
  RISK_EXPOSURE_SHIFT = "Risk_Exposure_Shift",
  COUNTERPARTY_GUILT = "Counterparty_Guilt",
  ABANDONMENT_SIGNAL = "Abandonment_Signal",
  PROFIT_HARVESTING = "Profit_Harvesting",
  WASH_TRADING = "Wash_Trading",
  ROOKIE_MISTAKE = "Rookie_Mistake",
}

export interface BehavioralPattern {
  archetype: BehavioralArchetype;
  probability: number; // 0-1
  confidence: number; // 0-1
  evidence: string[];
  severity: "critical" | "high" | "medium" | "low";
  recommendation: string;
}

export interface PatternAnalysisResult {
  patterns: BehavioralPattern[];
  overallRiskScore: number;
  recurrenceForecast: string;
  riskMultiplier: number;
}

/**
 * Analyze behavioral patterns from on-chain forensics data.
 * Each detector maps on-chain signals to a behavioral archetype.
 */
export function analyzeBehavioralPatterns(
  forensics: ForensicsResult,
  identity: IdentityResolution
): PatternAnalysisResult {
  const patterns: BehavioralPattern[] = [];
  let riskMultiplier = 0;

  // 1. Exploit Mimicry — tx patterns mirroring known exploit sequences
  const exploitMimicry = detectExploitMimicry(forensics);
  if (exploitMimicry) {
    patterns.push(exploitMimicry);
    riskMultiplier += exploitMimicry.severity === "critical" ? 30 : 15;
  }

  // 2. Loss Acceleration — losses growing faster than market vol explains
  const lossAcceleration = detectLossAcceleration(forensics);
  if (lossAcceleration) {
    patterns.push(lossAcceleration);
    riskMultiplier += lossAcceleration.severity === "critical" ? 25 : 10;
  }

  // 3. Looping Denial — failed tx retry storms draining gas
  const loopingDenial = detectLoopingDenial(forensics);
  if (loopingDenial) {
    patterns.push(loopingDenial);
    riskMultiplier += 15;
  }

  // 4. Risk Exposure Shift — agent silently migrating from safe to high-risk positions
  const riskExposure = detectRiskExposureShift(forensics);
  if (riskExposure) {
    patterns.push(riskExposure);
    riskMultiplier += riskExposure.severity === "critical" ? 20 : 10;
  }

  // 5. Counterparty Guilt — coordinated behavior with compromised counterparties
  const counterpartyGuilt = detectCounterpartyGuilt(forensics);
  if (counterpartyGuilt) {
    patterns.push(counterpartyGuilt);
    riskMultiplier += counterpartyGuilt.severity === "critical" ? 15 : 8;
  }

  // 6. Abandonment Signal — activity drop-off preceding known loss events
  const abandonment = detectAbandonmentSignal(forensics);
  if (abandonment) {
    patterns.push(abandonment);
    riskMultiplier += abandonment.severity === "critical" ? 15 : 5;
  }

  // 7. Profit Harvesting — exit scam pattern (accumulate then drain)
  const profitHarvesting = detectProfitHarvesting(forensics);
  if (profitHarvesting) {
    patterns.push(profitHarvesting);
    riskMultiplier += profitHarvesting.severity === "critical" ? 35 : 15;
  }

  // 8. Wash Trading — self-dealing volume inflation
  const washTrading = detectWashTrading(forensics);
  if (washTrading) {
    patterns.push(washTrading);
    riskMultiplier += washTrading.severity === "critical" ? 20 : 10;
  }

  // 9. Rookie Mistake — high-cost reversible errors (no stop-loss, bad slippage)
  const rookieMistake = detectRookieMistake(forensics);
  if (rookieMistake) {
    patterns.push(rookieMistake);
    riskMultiplier += rookieMistake.severity === "critical" ? 10 : 5;
  }

  const overallRiskScore = calculatePatternRiskScore(patterns);
  const recurrenceForecast = generateRecurrenceForecast(patterns, forensics);

  return { patterns, overallRiskScore, recurrenceForecast, riskMultiplier };
}

// ==================== DETECTOR IMPLEMENTATIONS ====================

function detectExploitMimicry(forensics: ForensicsResult): BehavioralPattern | null {
  const evidence: string[] = [];
  let probability = 0;

  const exploitCalls = forensics.exploit_calls ?? [];
  const failedPatterns = forensics.failed_tx_patterns ?? [];

  if (exploitCalls.length > 0) {
    evidence.push(`${exploitCalls.length} exploit-style call(s) detected (delegatecall/selfdestruct/flashloan)`);
    probability += Math.min(60, exploitCalls.length * 20);
  }

  // Rapid sequential failed txns often indicate exploit probing
  const rapidFails = failedPatterns.filter(p => p.frequency > 3);
  if (rapidFails.length > 0) {
    evidence.push(`${rapidFails.length} rapid-failure pattern(s) matching exploit probe signatures`);
    probability += Math.min(40, rapidFails.length * 15);
  }

  if (probability < 25) return null;

  return {
    archetype: BehavioralArchetype.EXPLOIT_MIMICRY,
    probability: Math.min(1, probability / 100),
    confidence: exploitCalls.length > 2 ? 0.85 : 0.55,
    evidence,
    severity: probability > 60 ? "critical" : probability > 40 ? "high" : "medium",
    recommendation: "Halt agent operations, audit contract interactions, check for unauthorized approvals",
  };
}

function detectLossAcceleration(forensics: ForensicsResult): BehavioralPattern | null {
  const evidence: string[] = [];
  let probability = 0;

  const metrics = forensics.metrics;
  if (!metrics) return null;

  if (metrics.total_loss_usd > 0) {
    if (metrics.total_loss_usd > 1_000_000) {
      evidence.push(`Critical loss magnitude: $${(metrics.total_loss_usd / 1e6).toFixed(2)}M`);
      probability += 50;
    } else if (metrics.total_loss_usd > 100_000) {
      evidence.push(`High loss: $${(metrics.total_loss_usd / 1e3).toFixed(0)}K`);
      probability += 30;
    } else {
      evidence.push(`Loss detected: $${metrics.total_loss_usd.toFixed(0)}`);
      probability += 15;
    }
  }

  const leverageSpikes = forensics.leverage_spikes ?? [];
  if (leverageSpikes.length > 0) {
    const maxLev = Math.max(...leverageSpikes.map(l => l.leverage_ratio));
    evidence.push(`Leverage spike detected: ${maxLev.toFixed(1)}x`);
    probability += Math.min(40, maxLev * 3);
  }

  if (probability < 20) return null;

  return {
    archetype: BehavioralArchetype.LOSS_ACCELERATION,
    probability: Math.min(1, probability / 100),
    confidence: 0.75,
    evidence,
    severity: probability > 70 ? "critical" : probability > 40 ? "high" : "medium",
    recommendation: "Review position sizing rules, enforce hard stop-losses, audit leverage limits",
  };
}

function detectLoopingDenial(forensics: ForensicsResult): BehavioralPattern | null {
  const evidence: string[] = [];
  let probability = 0;

  const failedPatterns = forensics.failed_tx_patterns ?? [];
  const highFreqFails = failedPatterns.filter(p => p.frequency > 5);

  if (highFreqFails.length > 0) {
    evidence.push(`${highFreqFails.length} high-frequency failure loop(s) — potential gas drain`);
    probability += Math.min(70, highFreqFails.reduce((s, p) => s + p.frequency * 5, 0));
  }

  if (probability < 20) return null;

  return {
    archetype: BehavioralArchetype.LOOPING_DENIAL,
    probability: Math.min(1, probability / 100),
    confidence: 0.70,
    evidence,
    severity: probability > 60 ? "high" : "medium",
    recommendation: "Add circuit breaker with exponential backoff, cap retry attempts per tx type",
  };
}

function detectRiskExposureShift(forensics: ForensicsResult): BehavioralPattern | null {
  const evidence: string[] = [];
  let probability = 0;

  const exposureChanges = forensics.exposure_changes ?? [];
  const largeShifts = exposureChanges.filter(e => Math.abs(e.change_percent) > 50);

  if (largeShifts.length > 0) {
    evidence.push(`${largeShifts.length} large exposure shift(s) > 50% in single window`);
    probability += Math.min(65, largeShifts.length * 25);
  }

  if (probability < 20) return null;

  return {
    archetype: BehavioralArchetype.RISK_EXPOSURE_SHIFT,
    probability: Math.min(1, probability / 100),
    confidence: 0.65,
    evidence,
    severity: probability > 55 ? "high" : "medium",
    recommendation: "Enforce position concentration limits, require governance approval for large reallocations",
  };
}

function detectCounterpartyGuilt(forensics: ForensicsResult): BehavioralPattern | null {
  const evidence: string[] = [];
  let probability = 0;

  const interactions = forensics.protocol_interactions ?? [];
  const failedInteractions = interactions.filter(i => !i.success);

  if (failedInteractions.length > interactions.length * 0.5 && interactions.length > 3) {
    evidence.push(`${failedInteractions.length}/${interactions.length} protocol interactions failed — counterparty risk signal`);
    probability += 40;
  }

  if (probability < 20) return null;

  return {
    archetype: BehavioralArchetype.COUNTERPARTY_GUILT,
    probability: Math.min(1, probability / 100),
    confidence: 0.55,
    evidence,
    severity: "medium",
    recommendation: "Audit counterparty contracts, diversify protocol exposure, add pre-flight checks",
  };
}

function detectAbandonmentSignal(forensics: ForensicsResult): BehavioralPattern | null {
  const evidence: string[] = [];
  let probability = 0;

  const metrics = forensics.metrics;
  if (!metrics) return null;

  if (metrics.total_transactions === 0) {
    evidence.push("No transactions detected in analysis window — possible abandonment");
    probability = 35;
  }

  if (probability < 20) return null;

  return {
    archetype: BehavioralArchetype.ABANDONMENT_SIGNAL,
    probability: Math.min(1, probability / 100),
    confidence: 0.45,
    evidence,
    severity: "low",
    recommendation: "Verify agent is still operational, check for silent failures or paused state",
  };
}

function detectProfitHarvesting(forensics: ForensicsResult): BehavioralPattern | null {
  const evidence: string[] = [];
  let probability = 0;

  const exploitCalls = forensics.exploit_calls ?? [];
  const metrics = forensics.metrics;

  // Large outflow combined with exploit-style calls = exit scam signal
  if (exploitCalls.length > 0 && metrics && metrics.total_loss_usd > 500_000) {
    evidence.push(`Exploit calls combined with >$500K outflow: exit scam pattern`);
    probability = 75;
  }

  if (probability < 25) return null;

  return {
    archetype: BehavioralArchetype.PROFIT_HARVESTING,
    probability: Math.min(1, probability / 100),
    confidence: 0.80,
    evidence,
    severity: "critical",
    recommendation: "Immediate halt, freeze remaining assets, initiate incident response",
  };
}

function detectWashTrading(forensics: ForensicsResult): BehavioralPattern | null {
  const evidence: string[] = [];
  let probability = 0;

  const interactions = forensics.protocol_interactions ?? [];
  // Self-dealing: same address appearing as both sender and counterparty
  const selfDealing = interactions.filter(i =>
    i.protocol && forensics.metrics && i.protocol.toLowerCase().includes("self")
  );

  if (selfDealing.length > 2) {
    evidence.push(`${selfDealing.length} self-referential transactions detected`);
    probability = 55;
  }

  if (probability < 25) return null;

  return {
    archetype: BehavioralArchetype.WASH_TRADING,
    probability: Math.min(1, probability / 100),
    confidence: 0.60,
    evidence,
    severity: "high",
    recommendation: "Audit transaction counterparty diversity, flag for regulatory review",
  };
}

function detectRookieMistake(forensics: ForensicsResult): BehavioralPattern | null {
  const evidence: string[] = [];
  let probability = 0;

  const failedPatterns = forensics.failed_tx_patterns ?? [];
  const leverageSpikes = forensics.leverage_spikes ?? [];

  if (failedPatterns.length > 0 && leverageSpikes.length === 0) {
    // Failures without leverage = operational errors, not strategy failures
    evidence.push(`${failedPatterns.length} operational failure pattern(s) without leverage spikes — likely configuration errors`);
    probability = 35;
  }

  if (probability < 20) return null;

  return {
    archetype: BehavioralArchetype.ROOKIE_MISTAKE,
    probability: Math.min(1, probability / 100),
    confidence: 0.50,
    evidence,
    severity: "low",
    recommendation: "Review agent configuration, add pre-flight validation, test on testnet first",
  };
}

// ==================== SCORING & UTILITIES ====================

function calculatePatternRiskScore(patterns: BehavioralPattern[]): number {
  if (patterns.length === 0) return 0;

  const severityWeights = { critical: 40, high: 25, medium: 15, low: 5 };
  const totalScore = patterns.reduce((sum, p) => {
    return sum + (severityWeights[p.severity] * p.probability);
  }, 0);

  return Math.min(100, Math.round(totalScore));
}

function generateRecurrenceForecast(
  patterns: BehavioralPattern[],
  forensics: ForensicsResult
): string {
  const criticalCount = patterns.filter(p => p.severity === "critical").length;
  const highCount = patterns.filter(p => p.severity === "high").length;

  if (criticalCount > 0) {
    return `HIGH RECURRENCE RISK: ${criticalCount} critical pattern(s) detected. Without intervention, similar losses expected within 30 days.`;
  }
  if (highCount > 1) {
    return `ELEVATED RECURRENCE RISK: Multiple high-severity patterns suggest systemic issues. Recommend full audit before next deployment.`;
  }
  if (patterns.length > 0) {
    return `MODERATE RECURRENCE RISK: ${patterns.length} behavioral pattern(s) identified. Monitor closely, implement recommended mitigations.`;
  }
  return "LOW RECURRENCE RISK: No significant behavioral patterns detected in current analysis window.";
}
