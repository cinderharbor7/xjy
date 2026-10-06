import { describe, expect, it } from "vitest";
import {
  PositionStateSchema, StressTestResultSchema, InvestigationResultSchema,
  RiskAnalysisSchema, PolicyConfigSchema, PolicyDecisionSchema, ExecutionResultSchema, RescueSessionSchema,
} from "@/domain/schemas";

const position = {
  wallet: "demo-wallet", collateralUsd: 200000, debtUsd: 100000,
  healthFactor: 1.08, ethPrice: 2800, timestamp: "2026-10-06T00:00:00.000Z",
};

describe("frozen domain schemas", () => {
  it("accepts the initial demo position, including zero debt", () => {
    expect(PositionStateSchema.parse(position)).toEqual(position);
    expect(PositionStateSchema.parse({ ...position, debtUsd: 0 }).debtUsd).toBe(0);
  });

  it.each([
    { wallet: " " }, { debtUsd: -1 }, { healthFactor: Infinity },
    { collateralUsd: NaN }, { timestamp: "today" }, { blockNumber: 1.5 },
    { secretInternalField: true },
  ])("rejects invalid or private position fields: %j", (invalid) => {
    expect(PositionStateSchema.safeParse({ ...position, ...invalid }).success).toBe(false);
  });

  it("validates stress, investigation, risk score and confidence ranges", () => {
    expect(StressTestResultSchema.safeParse({ ethChangePct: -101, projectedHealthFactor: 1, liquidationRisk: false }).success).toBe(false);
    const investigation = { summary: "Mock", primaryCause: "Low HF", evidence: [], uncertainties: [], confidence: 0.88 };
    expect(InvestigationResultSchema.safeParse({ ...investigation, confidence: 1.01 }).success).toBe(false);
    expect(RiskAnalysisSchema.safeParse({ riskScore: 101, confidence: 0.88, healthFactor: 1.08, stressTests: [], investigation, recommendedAction: "REPAY" }).success).toBe(false);
  });

  it("rejects contradictory policy approvals and unsupported actions", () => {
    const approval = { triggered: true, action: "REPAY", repayAmountUsd: 20000, reasons: ["Approved"] };
    expect(PolicyDecisionSchema.parse(approval)).toEqual(approval);
    for (const invalid of [{ triggered: false }, { action: "NONE" }, { repayAmountUsd: 0 }, { action: "BUY" }]) {
      expect(PolicyDecisionSchema.safeParse({ ...approval, ...invalid }).success).toBe(false);
    }
    expect(PolicyConfigSchema.safeParse({ maxHealthFactorForTrigger: 1.15, minRiskScore: 80, minConfidence: 0.85, maxRepayUsd: -1 }).success).toBe(false);
  });

  it("requires a correctly formatted fake transaction hash and forbids executor HF claims", () => {
    const execution = { success: true, action: "REPAY", amountUsd: 20000, timestamp: position.timestamp, txHash: `0x${"ab".repeat(32)}` };
    expect(ExecutionResultSchema.parse(execution)).toEqual(execution);
    expect(ExecutionResultSchema.safeParse({ ...execution, txHash: "fake" }).success).toBe(false);
    expect(ExecutionResultSchema.safeParse({ ...execution, healthFactor: 1.34 }).success).toBe(false);
    expect(ExecutionResultSchema.safeParse({ ...execution, txHash: undefined }).success).toBe(false);
  });

  it("requires policy/execution agreement and a matching position re-read after success", () => {
    const session = {
      before: position,
      riskAnalysis: {
        riskScore: 91, confidence: 0.88, healthFactor: 1.08, stressTests: [], recommendedAction: "REPAY",
        investigation: { summary: "Mock", primaryCause: "Low HF", evidence: [], uncertainties: [], confidence: 0.88 },
      },
      policyDecision: { triggered: true, action: "REPAY", repayAmountUsd: 20000, reasons: ["Approved"] },
      execution: { success: true, action: "REPAY", amountUsd: 20000, timestamp: position.timestamp, txHash: `0x${"ab".repeat(32)}` },
      after: { ...position, debtUsd: 80000, healthFactor: 1.34 },
    };
    expect(RescueSessionSchema.parse(session)).toEqual(session);
    expect(RescueSessionSchema.safeParse({ ...session, after: undefined }).success).toBe(false);
    expect(RescueSessionSchema.safeParse({ ...session, after: { ...session.after, wallet: "another-wallet" } }).success).toBe(false);
    expect(RescueSessionSchema.safeParse({ ...session, execution: { ...session.execution, amountUsd: 30000 } }).success).toBe(false);
    expect(RescueSessionSchema.safeParse({ ...session, riskAnalysis: { ...session.riskAnalysis, healthFactor: 1.2 } }).success).toBe(false);
  });
});
