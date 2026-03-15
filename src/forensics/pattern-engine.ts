/**
 * AlliGo - Behavioral Pattern Engine
 * Killer predictive moat for agent failures
 */

import { ForensicsResult, ProtocolInteraction, FailedTxPattern } LeverageSpike, ExposureChange } from "./onchain";
import { IdentityResolution, calculateRiskPenalty } from "./identity";

import { db } from "../api/db";

// Behavioral archetypes
export enum BehavioralArchetype {
  EXPLOIT_MIMICRY = "Exploit_Mimicry",
  LOSS_ACCELERATION = "Loss_Acceleration",
  LOOPING_DENIAL = "Looping_Denial_of_Wallet",
  RISK_EXPOSURE_SHIFT = "Risk_Exposure_Shift",
  COUNTERPARTY_GUILT = "Counterparty_Guilt",
  ABANDONMENT_SIGNAL = "Abandonment_Signal",
  PROFIT_Harvesting = "Profit_Harvesting",
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
  riskMultiplier: number; // Applied to base risk score
}

/**
 * Analyze behavioral patterns from forensics data
 */
export function analyzeBehavioralPatterns(
  forensics: ForensicsResult,
  identity: IdentityResolution
): PatternAnalysisResult {
  const patterns: BehavioralPattern[] = [];
  let riskMultiplier = 0;

  // 1. Exploit Mimicry Detection
  const exploitMimicry = detectExploitMimicry(forensics);
  if (exploitmimicry) {
    patterns.push(exploitMimicry);
    riskMultiplier += exploitmimicry.severity === "critical" ? 30 : 15;
  }

  // 2. Loss Acceleration Detection
  const lossAcceleration = detectLossAcceleration(forensics);
  if (lossAcceleration) {
    patterns.push(lossAcceleration);
    riskMultiplier += lossAcceleration.severity === "critical" ? 25 : 10;
  }

  // 3. Looping Denial Detection
  const loopingDenial = detectLoopingDenial(forensics);
  if (loopingDenial) {
    patterns.push(loopingDenial);
    riskMultiplier += 15;
  }

  // 4. Risk Exposure Shift Detection
  const riskExposure = detectRiskExposureShift(forensics);
  if (riskExposure) {
    patterns.push(riskExposure);
    riskMultiplier += riskExposure.severity === "critical" ? 20 : 10;
  }

  // 5. Counterparty Guilt Detection
  const counterpartyGuilt = detectCounterpartyGuilt(forensics);
  if (counterpartyGuilt) {
    patterns.push(counterpartyGuilt);
    riskMultiplier += counterpartyGuilt.severity === "critical" ? 15 : 8;
  }

  // 6. Abandonment Signal Detection
  const abandonment = detectAbandonmentSignal(forensics);
  if (abandonment) {
    patterns.push(abandonment);
    riskMultiplier += abandonment.severity === "critical" ? 15 : 5;
  }

  // 7. Profit Harvesting Detection (exit scam pattern)
  const profitHarvesting = detectProfitHarvesting(forensics);
  if (profitHarvesting) {
    patterns.push(profitHarvesting);
    riskMultiplier += profitHarvesting.severity === "critical" ? 35 : 15;
  }

  // 8. Wash Trading Detection
  const washTrading = detectWashTrading(forensics);
  if (washTrading) {
    patterns.push(washTrading);
    riskMultiplier += washTrading.severity === "critical" ? 20 : 10;
  }

  // Calculate overall risk score
  const overallRiskScore = calculatePatternRiskScore(patterns);
  
  // Generate recurrence forecast
  const recurrenceForecast = generateRecurrenceForecast(patterns, forensics);

  return {
    patterns,
    overallRiskScore,
    recurrenceForecast,
    riskMultiplier,
  };
}

