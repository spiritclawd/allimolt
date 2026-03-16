/**
 * AlliGo - Calibration Test Runner
 * Runs detection on synthetic test cases and produces detailed metrics
 * 
 * Run with: bun run src/forensics/run-calibration.ts
 */

import { generateComprehensiveTestSuite, SyntheticTestCase } from "./synthetic-generator";
import { analyzeAgenticInternals, AgenticArchetype, AgenticForensicsReport } from "./agentic-internals";

interface CalibrationMetrics {
  total_tests: number;
  correct: number;
  accuracy: number;
  false_positives: number;
  false_positive_rate: number;
  avg_confidence: number;
  avg_processing_time_ms: number;
  by_difficulty: {
    easy: { total: number; correct: number; accuracy: number; avg_prob: number };
    medium: { total: number; correct: number; accuracy: number; avg_prob: number };
    hard: { total: number; correct: number; accuracy: number; avg_prob: number };
  };
  by_archetype: Record<string, { 
    total: number; 
    correct: number; 
    precision: number;
    recall: number;
    f1: number;
    avg_probability: number;
    false_positives: number;
    false_negatives: number;
  }>;
  threshold_recommendations: Record<string, { current: number; recommended: number; reason: string }>;
  timestamp: number;
}

async function runCalibration(): Promise<CalibrationMetrics> {
  console.log("🔬 ALLIGO DETECTION CALIBRATION TEST\n");
  console.log("=".repeat(60));
  
  const startTime = Date.now();
  const testCases = generateComprehensiveTestSuite();
  console.log(`📊 Generated ${testCases.length} test cases\n`);
  
  // Initialize metrics
  const byDifficulty = {
    easy: { total: 0, correct: 0, accuracy: 0, avg_prob: 0 },
    medium: { total: 0, correct: 0, accuracy: 0, avg_prob: 0 },
    hard: { total: 0, correct: 0, accuracy: 0, avg_prob: 0 },
  };
  
  const archetypeMetrics: Record<string, { 
    total: number; 
    correct: number; 
    true_positives: number;
    false_positives: number;
    false_negatives: number;
    probabilities: number[];
  }> = {};
  
  // Initialize all archetypes
  const archetypes = Object.values(AgenticArchetype);
  for (const archetype of archetypes) {
    archetypeMetrics[archetype] = { 
      total: 0, 
      correct: 0, 
      true_positives: 0,
      false_positives: 0,
      false_negatives: 0,
      probabilities: []
    };
  }
  
  let correct = 0;
  let falsePositives = 0;
  let totalConfidence = 0;
  let totalProcessingTime = 0;
  
  // Run each test case
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const testStartTime = Date.now();
    
    try {
      const result = await analyzeAgenticInternals(testCase.agent);
      const processingTime = Date.now() - testStartTime;
      totalProcessingTime += processingTime;
      
      totalConfidence += result.confidence;
      
      // Track by difficulty
      byDifficulty[testCase.difficulty].total++;
      
      // Determine if this is a benign case
      const isBenign = testCase.agent.agent_handle?.includes("benign");
      
      if (isBenign) {
        // Benign cases should have high risk scores (>70 = good)
        byDifficulty[testCase.difficulty].total++;
        
        if (result.overall_risk_score >= 70) {
          correct++;
          byDifficulty[testCase.difficulty].correct++;
        } else {
          falsePositives++;
          console.log(`  ❌ FP: ${testCase.id} - Expected benign, got risk ${result.overall_risk_score}`);
        }
      } else {
        // Malicious cases - check if expected archetype was detected
        const expectedArchetype = testCase.expected_archetype;
        archetypeMetrics[expectedArchetype].total++;
        
        // Find matching detection
        const detectedArchetypes = result.behavioral_archetypes || [];
        const match = detectedArchetypes.find(d => d.archetype === expectedArchetype);
        
        if (match && match.probability >= 30) {
          correct++;
          byDifficulty[testCase.difficulty].correct++;
          archetypeMetrics[expectedArchetype].correct++;
          archetypeMetrics[expectedArchetype].true_positives++;
          archetypeMetrics[expectedArchetype].probabilities.push(match.probability);
          byDifficulty[testCase.difficulty].avg_prob += match.probability;
          
          console.log(`  ✅ ${testCase.id}: ${expectedArchetype} @ ${match.probability}%`);
        } else {
          archetypeMetrics[expectedArchetype].false_negatives++;
          
          // Check if wrong archetype was detected (false positive for that archetype)
          const topDetection = detectedArchetypes[0];
          if (topDetection && topDetection.probability >= 30) {
            archetypeMetrics[topDetection.archetype].false_positives++;
          }
          
          console.log(`  ❌ FN: ${testCase.id} - Expected ${expectedArchetype}, got ${detectedArchetypes[0]?.archetype || "none"} @ ${detectedArchetypes[0]?.probability || 0}%`);
        }
      }
      
    } catch (error: any) {
      console.error(`  ⚠️ Error on ${testCase.id}:`, error.message);
    }
    
    // Progress indicator
    if ((i + 1) % 16 === 0) {
      console.log(`\n  Progress: ${i + 1}/${testCases.length} tests completed\n`);
    }
  }
  
  // Calculate final metrics
  const total = testCases.length;
  const accuracy = correct / total;
  const falsePositiveRate = falsePositives / total;
  const avgConfidence = totalConfidence / total;
  const avgProcessingTime = totalProcessingTime / total;
  
  // Calculate accuracies by difficulty
  for (const diff of ["easy", "medium", "hard"] as const) {
    const d = byDifficulty[diff];
    d.accuracy = d.total > 0 ? d.correct / d.total : 0;
    d.avg_prob = d.total > 0 ? d.avg_prob / d.total : 0;
  }
  
  // Calculate per-archetype metrics
  const byArchetype: CalibrationMetrics["by_archetype"] = {};
  const thresholdRecommendations: CalibrationMetrics["threshold_recommendations"] = {};
  
  for (const [archetype, data] of Object.entries(archetypeMetrics)) {
    if (data.total === 0) continue;
    
    const precision = data.true_positives / (data.true_positives + data.false_positives) || 0;
    const recall = data.true_positives / (data.true_positives + data.false_negatives) || 0;
    const f1 = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    const avgProb = data.probabilities.length > 0 
      ? data.probabilities.reduce((a, b) => a + b, 0) / data.probabilities.length 
      : 0;
    
    byArchetype[archetype] = {
      total: data.total,
      correct: data.correct,
      precision,
      recall,
      f1,
      avg_probability: avgProb,
      false_positives: data.false_positives,
      false_negatives: data.false_negatives,
    };
    
    // Generate threshold recommendations
    if (recall < 0.7 && avgProb > 0) {
      const recommended = Math.max(20, Math.floor(avgProb * 0.8));
      thresholdRecommendations[archetype] = {
        current: 30,
        recommended,
        reason: `Low recall (${(recall * 100).toFixed(0)}%) with avg detection probability ${(avgProb).toFixed(0)}% - lower threshold to capture more cases`,
      };
    } else if (precision < 0.7 && data.false_positives > 0) {
      const recommended = Math.min(50, Math.floor(avgProb * 1.2));
      thresholdRecommendations[archetype] = {
        current: 30,
        recommended,
        reason: `Low precision (${(precision * 100).toFixed(0)}%) with ${data.false_positives} false positives - raise threshold`,
      };
    }
  }
  
  const metrics: CalibrationMetrics = {
    total_tests: total,
    correct,
    accuracy,
    false_positives: falsePositives,
    false_positive_rate: falsePositiveRate,
    avg_confidence: avgConfidence,
    avg_processing_time_ms: avgProcessingTime,
    by_difficulty: byDifficulty,
    by_archetype: byArchetype,
    threshold_recommendations: thresholdRecommendations,
    timestamp: Date.now(),
  };
  
  // Print results
  const totalTime = Date.now() - startTime;
  
  console.log("\n" + "=".repeat(60));
  console.log("📊 CALIBRATION RESULTS");
  console.log("=".repeat(60));
  console.log(`\n  Total Tests:          ${total}`);
  console.log(`  Correct Detections:   ${correct}`);
  console.log(`  Overall Accuracy:     ${(accuracy * 100).toFixed(1)}%`);
  console.log(`  False Positives:      ${falsePositives} (${(falsePositiveRate * 100).toFixed(1)}%)`);
  console.log(`  Avg Confidence:       ${(avgConfidence * 100).toFixed(1)}%`);
  console.log(`  Avg Processing Time:  ${avgProcessingTime.toFixed(0)}ms`);
  console.log(`  Total Time:           ${(totalTime / 1000).toFixed(1)}s`);
  
  console.log("\n  📈 By Difficulty:");
  for (const [diff, data] of Object.entries(byDifficulty)) {
    console.log(`     ${diff.padEnd(8)}: ${(data.accuracy * 100).toFixed(1)}% accuracy (${data.correct}/${data.total}) avg prob: ${data.avg_prob.toFixed(0)}%`);
  }
  
  console.log("\n  🎯 By Archetype:");
  for (const [archetype, data] of Object.entries(byArchetype)) {
    const f1Str = data.f1.toFixed(2);
    console.log(`     ${archetype.padEnd(35)}: P=${(data.precision * 100).toFixed(0)}% R=${(data.recall * 100).toFixed(0)}% F1=${f1Str} (${data.correct}/${data.total})`);
  }
  
  if (Object.keys(thresholdRecommendations).length > 0) {
    console.log("\n  🔧 Threshold Recommendations:");
    for (const [archetype, rec] of Object.entries(thresholdRecommendations)) {
      console.log(`     ${archetype.padEnd(35)}: ${rec.current}% → ${rec.recommended}%`);
      console.log(`       Reason: ${rec.reason}`);
    }
  }
  
  console.log("\n" + "=".repeat(60));
  
  return metrics;
}

// Export for programmatic use
export { runCalibration, CalibrationMetrics };

// Run if executed directly
if (import.meta.main) {
  runCalibration().catch(console.error);
}
