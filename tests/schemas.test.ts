import { describe, expect, it } from "vitest";
import {
  AssetBalanceSchema, PortfolioStateSchema, MarketStateSchema, StressTestResultSchema,
  RiskAnalysisSchema, PolicyConfigSchema, PolicyDecisionSchema, ExecutionResultSchema, RescueSessionSchema,
} from "@/domain/schemas";
import { verifyRescueOutcome } from "@/domain/verification";

const portfolio = {
  wallet: "demo", totalUsd: 30000, riskAssetUsd: 30000, defensiveAssetUsd: 0, riskExposurePct: 100,
  assets: [
    { symbol: "ETH", amount: 10, usdValue: 30000, category: "RISK" as const },
    { symbol: "USDC", amount: 0, usdValue: 0, category: "DEFENSIVE" as const },
  ],
  timestamp: "2026-10-06T00:00:00.000Z",
};
const market = { asset: "ETH", priceUsd: 2700, priceChange5mPct: -3, priceChange1hPct: -10, volatilityScore: 82, timestamp: portfolio.timestamp };
const approval = { triggered: true, action: "SWAP_TO_SAFE" as const, sourceAsset: "ETH", targetAsset: "USDC", reduceExposurePct: 30, reasons: ["Approved"] };
const execution = { success: true, action: "SWAP_TO_SAFE" as const, sourceAsset: "ETH", targetAsset: "USDC", sourceAmount: 3, targetAmount: 8100, txHash: "0x" + "ab".repeat(32), timestamp: portfolio.timestamp };
const after = { ...portfolio, totalUsd: 27000, riskAssetUsd: 18900, defensiveAssetUsd: 8100, riskExposurePct: 70,
  assets: [{ symbol: "ETH", amount: 7, usdValue: 18900, category: "RISK" as const }, { symbol: "USDC", amount: 8100, usdValue: 8100, category: "DEFENSIVE" as const }] };
const risk = { riskScore: 91, confidence: 0.88, riskExposurePct: 100, stressTests: [], recommendedAction: "SWAP_TO_SAFE",
  investigation: { summary: "Mock", primaryCause: "Market shock", evidence: [], uncertainties: [], confidence: 0.88 } };
const session = { before: portfolio, market, riskAnalysis: risk, policyDecision: approval, execution, after,
  verification: verifyRescueOutcome(portfolio, after, approval, execution, market) };

describe("Guardian data contracts", () => {
  it("accepts an unleveraged portfolio and a genuinely empty portfolio", () => {
    expect(PortfolioStateSchema.parse(portfolio)).toEqual(portfolio);
    expect(PortfolioStateSchema.parse({ ...portfolio, totalUsd: 0, riskAssetUsd: 0, riskExposurePct: 0, assets: [] }).riskExposurePct).toBe(0);
  });
  it.each([
    { totalUsd: -1 }, { riskExposurePct: Infinity }, { riskExposurePct: 101 },
    { riskAssetUsd: NaN }, { defensiveAssetUsd: 1 }, { totalUsd: 29999 },
    { riskExposurePct: 99 }, { assets: [...portfolio.assets, portfolio.assets[0]] },
    { timestamp: "today" }, { blockNumber: 1.5 }, { debtUsd: 1 }, { priceChange1hPct: -10 },
  ])("rejects inconsistent, invalid or old domain fields: %j", (invalid) => {
    expect(PortfolioStateSchema.safeParse({ ...portfolio, ...invalid }).success).toBe(false);
  });
  it("rejects unknown categories and impossible zero-quantity positive-value balances", () => {
    expect(AssetBalanceSchema.safeParse({ ...portfolio.assets[0], category: "SAFE" }).success).toBe(false);
    const invalid = { ...portfolio, assets: [{ ...portfolio.assets[0], amount: 0 }, portfolio.assets[1]] };
    expect(PortfolioStateSchema.safeParse(invalid).success).toBe(false);
  });
  it("validates market and stress contracts independently", () => {
    expect(MarketStateSchema.parse(market)).toEqual(market);
    expect(MarketStateSchema.safeParse({ ...market, volatilityScore: 101 }).success).toBe(false);
    expect(MarketStateSchema.safeParse({ ...market, priceChange5mPct: -101 }).success).toBe(false);
    expect(MarketStateSchema.safeParse({ ...market, priceUsd: 0 }).success).toBe(false);
    expect(StressTestResultSchema.safeParse({ priceChangePct: -101, projectedPortfolioUsd: 0, projectedLossUsd: 30000 }).success).toBe(false);
    expect(RiskAnalysisSchema.safeParse({ ...risk, riskScore: 101 }).success).toBe(false);
    expect(RiskAnalysisSchema.safeParse({ ...risk, healthFactor: 1 }).success).toBe(false);
  });
  it("requires unique, nonoverlapping user asset allowlists", () => {
    const config = { minRiskScore: 80, minConfidence: 0.85, minRiskExposurePct: 70, maxDeRiskPct: 30, allowedRiskAssets: ["ETH"], allowedDefensiveAssets: ["USDC"] };
    expect(PolicyConfigSchema.parse(config)).toEqual(config);
    expect(PolicyConfigSchema.safeParse({ ...config, allowedDefensiveAssets: ["ETH"] }).success).toBe(false);
    expect(PolicyConfigSchema.safeParse({ ...config, allowedRiskAssets: ["ETH", "ETH"] }).success).toBe(false);
    expect(PolicyConfigSchema.safeParse({ ...config, maxDeRiskPct: 101 }).success).toBe(false);
  });
  it("rejects contradictory authorization and obsolete/free-text actions", () => {
    expect(PolicyDecisionSchema.parse(approval)).toEqual(approval);
    for (const invalid of [{ triggered: false }, { action: "NONE" }, { action: "REPAY" }, { action: "BUY" }, { reduceExposurePct: 0 }, { targetAsset: "ETH" }, { instruction: "sell everything" }]) {
      expect(PolicyDecisionSchema.safeParse({ ...approval, ...invalid }).success).toBe(false);
    }
    expect(PolicyDecisionSchema.safeParse({ triggered: false, action: "NONE", reasons: ["Blocked"] }).success).toBe(true);
  });
  it("distinguishes complete receipts, failed swaps and skipped execution", () => {
    expect(ExecutionResultSchema.parse(execution)).toEqual(execution);
    for (const invalid of [{ txHash: "fake" }, { txHash: undefined }, { sourceAmount: 0 }, { targetAmount: Infinity }, { error: "contradiction" }, { after }, { healthFactor: 1.34 }]) {
      expect(ExecutionResultSchema.safeParse({ ...execution, ...invalid }).success).toBe(false);
    }
    expect(ExecutionResultSchema.safeParse({ success: false, action: "NONE", timestamp: portfolio.timestamp }).success).toBe(true);
    expect(ExecutionResultSchema.safeParse({ success: false, action: "SWAP_TO_SAFE", sourceAsset: "ETH", targetAsset: "USDC", timestamp: portfolio.timestamp, error: "Failed" }).success).toBe(true);
  });
  it("requires an independent wallet-matching re-read and honest verification", () => {
    expect(RescueSessionSchema.parse(session)).toEqual(session);
    expect(session.verification.status).toBe("PASSED");
    for (const invalid of [
      { after: undefined }, { after: { ...after, wallet: "other" } }, { execution: { ...execution, sourceAsset: "BTC" } },
      { riskAnalysis: { ...risk, riskExposurePct: 80 } }, { riskAnalysis: { ...risk, confidence: 0.5 } },
      { after: portfolio },
    ]) expect(RescueSessionSchema.safeParse({ ...session, ...invalid }).success).toBe(false);
    expect(RescueSessionSchema.safeParse({ ...session, after: portfolio, verification: verifyRescueOutcome(portfolio, portfolio, approval, execution, market) }).success).toBe(true);
  });
  it("does not verify an oversized swap merely because receipt balances and lower exposure agree", () => {
    const oversized = { ...execution, sourceAmount: 8, targetAmount: 21600 };
    const excessiveAfter = { ...after, riskAssetUsd: 5400, defensiveAssetUsd: 21600, riskExposurePct: 20,
      assets: [{ symbol: "ETH", amount: 2, usdValue: 5400, category: "RISK" as const }, { symbol: "USDC", amount: 21600, usdValue: 21600, category: "DEFENSIVE" as const }] };
    expect(verifyRescueOutcome(portfolio, excessiveAfter, approval, oversized, market).status).toBe("FAILED");
    expect(RescueSessionSchema.safeParse({ ...session, execution: oversized, after: excessiveAfter }).success).toBe(false);
  });
});
