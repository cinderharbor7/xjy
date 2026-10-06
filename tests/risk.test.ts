import { describe, expect, it } from "vitest";
import type { MarketState, PortfolioState } from "@/domain/types";
import { DEMO_WALLET, MockScenarioState } from "@/mocks/scenarios";
import { RiskService } from "@/modules/risk/risk.service";
import { runStressTest } from "@/modules/risk/stress-test";

const state = new MockScenarioState(DEMO_WALLET);
const portfolio = state.getPortfolio(DEMO_WALLET);
const market = state.getMarketState();
const mixed: PortfolioState = {
  ...portfolio, totalUsd: 30_000, riskAssetUsd: 24_000, defensiveAssetUsd: 6_000, riskExposurePct: 80,
  assets: [
    { symbol: "ETH", amount: 8, usdValue: 24_000, category: "RISK" },
    { symbol: "USDC", amount: 6_000, usdValue: 6_000, category: "DEFENSIVE" },
  ],
};

describe("deterministic portfolio risk service", () => {
  it("derives the fixed demo score from market and exposure without inventing Agent confidence", () => {
    const risk = new RiskService().analyze(portfolio, market);
    expect(risk).toMatchObject({
      riskScore: 91, confidence: 0, riskExposurePct: 100, recommendedAction: "SWAP_TO_SAFE",
      investigation: { summary: "Pending investigation", confidence: 0 },
    });
    expect(risk.stressTests).toEqual([
      { priceChangePct: -5, projectedPortfolioUsd: 28_500, projectedLossUsd: 1_500 },
      { priceChangePct: -10, projectedPortfolioUsd: 27_000, projectedLossUsd: 3_000 },
      { priceChangePct: -15, projectedPortfolioUsd: 25_500, projectedLossUsd: 4_500 },
    ]);
    expect(risk).not.toHaveProperty("healthFactor");
  });

  it("uses portfolio exposure as a score input", () => {
    expect(new RiskService().analyze(mixed, market)).toMatchObject({ riskScore: 87, riskExposurePct: 80 });
  });

  it.each([
    { volatilityScore: 0, priceChange1hPct: 10, score: 20 },
    { volatilityScore: 0, priceChange1hPct: -5, score: 35 },
    { volatilityScore: 100, priceChange1hPct: -100, score: 100 },
    { volatilityScore: 1, priceChange1hPct: 0, score: 21 },
  ])("clamps downside and rounds the deterministic score: %j", ({ score, ...conditions }) => {
    expect(new RiskService().analyze(portfolio, { ...market, ...conditions }).riskScore).toBe(score);
  });

  it("does not recommend mitigation for a low-score market", () => {
    expect(new RiskService().analyze(portfolio, { ...market, volatilityScore: 0, priceChange1hPct: 0 }).recommendedAction).toBe("NONE");
  });

  it.each([
    { totalUsd: 10_000, defensiveAssetUsd: 10_000, assets: [{ symbol: "USDC", amount: 10_000, usdValue: 10_000, category: "DEFENSIVE" as const }] },
    { totalUsd: 0, defensiveAssetUsd: 0, assets: [] },
  ])("has no risk-asset mitigation for a defensive or empty portfolio: %j", (balances) => {
    const current = { ...portfolio, ...balances, riskAssetUsd: 0, riskExposurePct: 0 };
    const risk = new RiskService().analyze(current, market);
    expect(risk).toMatchObject({ riskScore: 0, recommendedAction: "NONE", riskExposurePct: 0 });
    expect(risk.stressTests.every((stress) => stress.projectedLossUsd === 0)).toBe(true);
  });

  it("validates both inputs before calculating risk", () => {
    expect(() => new RiskService().analyze({ ...portfolio, riskExposurePct: 90 }, market)).toThrow();
    expect(() => new RiskService().analyze({ ...portfolio, healthFactor: 1 } as PortfolioState, market)).toThrow();
    expect(() => new RiskService().analyze(portfolio, { ...market, volatilityScore: Infinity })).toThrow();
    expect(() => new RiskService().analyze(portfolio, { ...market, execute: "BUY" } as MarketState)).toThrow();
  });
});

describe("demo portfolio value stress tests", () => {
  it("shocks only risk assets and leaves defensive value unchanged", () => {
    expect(runStressTest(mixed, -10)).toEqual({ priceChangePct: -10, projectedPortfolioUsd: 27_600, projectedLossUsd: 2_400 });
    expect(runStressTest(mixed, -100)).toEqual({ priceChangePct: -100, projectedPortfolioUsd: 6_000, projectedLossUsd: 24_000 });
  });

  it("handles a zero shock and a price rise without reporting a negative loss", () => {
    expect(runStressTest(portfolio, 0)).toEqual({ priceChangePct: 0, projectedPortfolioUsd: 30_000, projectedLossUsd: 0 });
    expect(runStressTest(portfolio, 10)).toEqual({ priceChangePct: 10, projectedPortfolioUsd: 33_000, projectedLossUsd: 0 });
  });

  it.each([-101, Infinity, NaN])("rejects an invalid price shock %s", (shock) => {
    expect(() => runStressTest(portfolio, shock)).toThrow();
  });
});
