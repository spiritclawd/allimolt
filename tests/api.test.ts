/**
 * Allimolt - Unit Tests
 */

import { describe, test, expect } from "bun:test";
import {
  calculateSeverity,
  gradeFromScore,
  ClaimType,
  ClaimCategory,
} from "../src/schema/claim";

describe("Severity Calculation", () => {
  test("low severity for small losses", () => {
    const result = calculateSeverity({ amountLost: 500 });
    expect(result.level).toBe("low");
    expect(result.score).toBeLessThan(4);
  });

  test("medium severity for moderate losses", () => {
    const result = calculateSeverity({ amountLost: 5000 });
    expect(result.level).toBe("medium");
  });

  test("high severity for significant losses", () => {
    const result = calculateSeverity({ amountLost: 50000 });
    expect(result.level).toBe("high");
  });

  test("critical severity for major losses", () => {
    const result = calculateSeverity({ amountLost: 1000000 });
    expect(result.level).toBe("critical");
    expect(result.score).toBe(10);
  });

  test("fraud increases severity", () => {
    const normal = calculateSeverity({ amountLost: 5000 });
    const fraud = calculateSeverity({ amountLost: 5000, claimType: ClaimType.FRAUD });
    expect(fraud.score).toBeGreaterThan(normal.score);
  });
});

describe("Grade Assignment", () => {
  test("A grade for excellent scores", () => {
    expect(gradeFromScore(95)).toBe("A");
    expect(gradeFromScore(90)).toBe("A");
  });

  test("B grade for good scores", () => {
    expect(gradeFromScore(89)).toBe("B");
    expect(gradeFromScore(75)).toBe("B");
  });

  test("C grade for moderate scores", () => {
    expect(gradeFromScore(74)).toBe("C");
    expect(gradeFromScore(60)).toBe("C");
  });

  test("D grade for poor scores", () => {
    expect(gradeFromScore(59)).toBe("D");
    expect(gradeFromScore(40)).toBe("D");
  });

  test("F grade for critical scores", () => {
    expect(gradeFromScore(39)).toBe("F");
    expect(gradeFromScore(0)).toBe("F");
  });
});

describe("Claim Type Validation", () => {
  test("valid claim types", () => {
    expect(ClaimType.LOSS).toBe("loss");
    expect(ClaimType.ERROR).toBe("error");
    expect(ClaimType.BREACH).toBe("breach");
    expect(ClaimType.FRAUD).toBe("fraud");
    expect(ClaimType.SECURITY).toBe("security");
  });
});

describe("Category Validation", () => {
  test("valid categories", () => {
    expect(ClaimCategory.TRADING).toBe("trading");
    expect(ClaimCategory.SECURITY).toBe("security");
    expect(ClaimCategory.EXECUTION).toBe("execution");
    expect(ClaimCategory.PAYMENT).toBe("payment");
  });
});

console.log("✅ All tests defined. Run with: bun test");
