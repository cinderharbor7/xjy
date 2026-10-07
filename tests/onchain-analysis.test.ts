import { describe, expect, it } from "vitest";
import { RiskAnalysisSchema } from "@/domain/schemas";
import type { MarketState, OnchainSignalState, PortfolioState } from "@/domain/types";
import { OnchainAnalysisService } from "@/modules/risk/onchain-analysis.service";
import { OnchainRiskService } from "@/modules/risk/onchain-risk.service";
import { sellPressureUplift } from "@/modules/risk/sell-pressure";
import { sellPressureConfidence } from "@/modules/investigation/onchain-investigation.adapter";

const txHash = "0x" + "ab".repeat(32);
const blockHash = "0x" + "cd".repeat(32);
const contractAddress = "0x" + "12".repeat(20);

// Reuses the frozen A->B boundary example (3x anomaly, 12 txs, 8 wallets).
const signal: OnchainSignalState = {
  signalType: "DEX_SELL_PRESSURE",
  asset: "ETH",
  windowStart: "2026-10-06T12:00:00.000Z",
  windowEnd: "2026-10-06T12:05:00.000Z",
  currentSellVolumeUsd: 300000,
  baselineSellVolumeUsd: 100000,
  anomalyRatio: 3,
  txCount: 12,
  uniqueWallets: 8,
  evidence: [
    { type: "TRANSACTION", txHash, blockNumber: 21000000, description: "Sample ETH sell", source: "MOCK fixture" },
    { type: "BLOCK", blockHash, blockNumber: 21000001, description: "Window end block", source: "MOCK fixture" },
    { type: "CONTRACT_EVENT", txHash, blockNumber: 21000002, contractAddress, description: "DEX swap event", source: "MOCK fixture" },
  ],
};

const portfolio: PortfolioState = {
  wallet: "test-wallet",
  totalUsd: 30000,
  riskAssetUsd: 30000,
  defensiveAssetUsd: 0,
  riskExposurePct: 100,
  assets: [{ symbol: "ETH", amount: 10, usdValue: 30000, category: "RISK" }],
  timestamp: "2026-10-06T12:00:00.000Z",
};

const market: MarketState = {
  asset: "ETH",
  priceUsd: 2700,
  priceChange5mPct: -3,
  priceChange1hPct: -10,
  volatilityScore: 82,
  timestamp: "2026-10-06T12:00:00.000Z",
};

const FROZEN_KEYS = ["confidence", "investigation", "recommendedAction", "riskExposurePct", "riskScore", "stressTests"];

describe("sell-pressure rules", () => {
  it("adds no uplift at 1x and saturates at the documented ratio", () => {
    expect(sellPressureUplift(1)).toBe(0);
    expect(sellPressureUplift(3)).toBe(30);
    expect(sellPressureUplift(5)).toBe(30);
    expect(sellPressureUplift(0.5)).toBe(0);
  });
});

describe("OnchainAnalysisService (A signal -> frozen RiskAnalysis)", () => {
  it("receives A's signal and computes the documented risk score", async () => {
    const result = await new OnchainAnalysisService().analyze(portfolio, market, signal);
    // Frozen demo base is 91; a 3x anomaly adds the full 30-point uplift, clamped at 100.
    expect(result.riskScore).toBe(100);
    expect(result.recommendedAction).toBe("SWAP_TO_SAFE");
    expect(result.riskExposurePct).toBe(portfolio.riskExposurePct);
    expect(result.stressTests).toHaveLength(3);
  });

  it("emits the frozen RiskAnalysis shape so D can consume it unchanged", async () => {
    const result = await new OnchainAnalysisService().analyze(portfolio, market, signal);
    expect(Object.keys(result).sort()).toEqual(FROZEN_KEYS);
    expect(RiskAnalysisSchema.parse(result)).toEqual(result);
    expect(result.confidence).toBe(result.investigation.confidence);
  });

  it("carries A's trade evidence with its source into the investigation", async () => {
    const result = await new OnchainAnalysisService().analyze(portfolio, market, signal);
    const text = result.investigation.evidence.join("\n");
    expect(text).toContain(txHash);
    expect(text).toContain(blockHash);
    expect(text).toContain(contractAddress);
    expect(text).toContain("source: MOCK fixture");
    expect(text).toContain("21000000");
    expect(result.investigation.primaryCause.length).toBeGreaterThan(0);
    expect(result.investigation.uncertainties.length).toBeGreaterThan(0);
  });

  it("keeps confidence bounded and never claims certainty", async () => {
    const result = await new OnchainAnalysisService().analyze(portfolio, market, signal);
    expect(result.investigation.confidence).toBe(sellPressureConfidence(signal));
    expect(result.investigation.confidence).toBe(0.9);
    expect(result.investigation.confidence).toBeGreaterThan(0);
    expect(result.investigation.confidence).toBeLessThanOrEqual(0.9);
  });

  it("adds no uplift for a neutral 1x window", async () => {
    const neutral: OnchainSignalState = { ...signal, currentSellVolumeUsd: 100000, anomalyRatio: 1 };
    const result = await new OnchainAnalysisService().analyze(portfolio, market, neutral);
    expect(result.riskScore).toBe(91);
    expect(result.recommendedAction).toBe("SWAP_TO_SAFE");
  });

  it("keeps a moderate portfolio below the policy threshold for a 2x signal", async () => {
    const moderatePortfolio: PortfolioState = {
      wallet: "moderate-wallet",
      totalUsd: 10000,
      riskAssetUsd: 3000,
      defensiveAssetUsd: 7000,
      riskExposurePct: 30,
      assets: [
        { symbol: "ETH", amount: 1, usdValue: 3000, category: "RISK" },
        { symbol: "USDC", amount: 7000, usdValue: 7000, category: "DEFENSIVE" },
      ],
      timestamp: "2026-10-06T12:00:00.000Z",
    };
    const calmMarket: MarketState = { ...market, priceUsd: 3000, priceChange5mPct: -1, priceChange1hPct: -2, volatilityScore: 40 };
    const twoX: OnchainSignalState = { ...signal, currentSellVolumeUsd: 200000, anomalyRatio: 2 };
    const result = await new OnchainAnalysisService().analyze(moderatePortfolio, calmMarket, twoX);
    // base = round(0.5*40 + 0.3*20 + 0.2*30) = 32; uplift(2x) = 15.
    expect(result.riskScore).toBe(47);
    expect(result.recommendedAction).toBe("NONE");
  });

  it("scores zero when the portfolio holds no risk assets", async () => {
    const defensive: PortfolioState = {
      wallet: "defensive-wallet",
      totalUsd: 10000,
      riskAssetUsd: 0,
      defensiveAssetUsd: 10000,
      riskExposurePct: 0,
      assets: [{ symbol: "USDC", amount: 10000, usdValue: 10000, category: "DEFENSIVE" }],
      timestamp: "2026-10-06T12:00:00.000Z",
    };
    const result = await new OnchainAnalysisService().analyze(defensive, market, signal);
    expect(result.riskScore).toBe(0);
    expect(result.recommendedAction).toBe("NONE");
  });

  it("rejects a signal that tries to carry execution authority", async () => {
    const tampered = { ...signal, permission: "APPROVED" } as unknown as OnchainSignalState;
    await expect(new OnchainAnalysisService().analyze(portfolio, market, tampered)).rejects.toThrow();
    expect(() => new OnchainRiskService().analyze(portfolio, market, tampered)).toThrow();
  });
});
