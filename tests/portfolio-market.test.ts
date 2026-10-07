import { describe, expect, it, vi } from "vitest";
import { DEMO_POLICY_CONFIG, MockScenarioState } from "@/mocks/scenarios";
import { PortfolioService } from "@/modules/portfolio/portfolio.service";
import { MockPortfolioAdapter } from "@/modules/portfolio/mock-portfolio.adapter";
import { MarketService } from "@/modules/market/market.service";
import { MockMarketAdapter } from "@/modules/market/mock-market.adapter";
import type { PolicyDecision, PortfolioState } from "@/domain/types";

const wallet = "demo";
const approval: PolicyDecision = { triggered: true, action: "SWAP_TO_SAFE", sourceAsset: "ETH", targetAsset: "USDC", reduceExposurePct: 30, reasons: ["Approved"] };

describe("portfolio and market boundaries", () => {
  it("reads independent contracts and simulates the market shock before the swap", async () => {
    const state = new MockScenarioState(wallet);
    const portfolio = new PortfolioService(new MockPortfolioAdapter(state));
    const market = new MarketService(new MockMarketAdapter(state));
    const before = await portfolio.getPortfolio(wallet);
    expect(before).toMatchObject({ totalUsd: 30000, riskExposurePct: 100 });
    expect(await market.getMarketState()).toMatchObject({ priceUsd: 2700, priceChange1hPct: -10, volatilityScore: 82 });
    expect(state.applySwap(approval)).toEqual({ sourceAmount: 3, targetAmount: 8100 });
    const after = await portfolio.getPortfolio(wallet);
    expect(after).toMatchObject({ totalUsd: 27000, riskAssetUsd: 18900, defensiveAssetUsd: 8100, riskExposurePct: 70 });
    expect(after.assets.map((asset) => asset.amount)).toEqual([7, 8100]);
    expect(before.totalUsd).toBe(30000);
  });

  it("uses percentage points: an 80% portfolio reduces to 50%, rather than 56%", () => {
    const state = new MockScenarioState(wallet);
    const initial: PortfolioState = { ...state.getPortfolio(wallet), totalUsd: 37500, defensiveAssetUsd: 7500, riskExposurePct: 80,
      assets: [{ symbol: "ETH", amount: 10, usdValue: 30000, category: "RISK" }, { symbol: "USDC", amount: 7500, usdValue: 7500, category: "DEFENSIVE" }] };
    const mixed = new MockScenarioState(wallet, DEMO_POLICY_CONFIG, initial);
    expect(mixed.applySwap(approval)).toEqual({ sourceAmount: 3.75, targetAmount: 11250 });
    expect(mixed.getPortfolio(wallet).riskExposurePct).toBe(50);
  });

  it("keeps requests and returned snapshots isolated and rejects duplicate swaps", () => {
    const first = new MockScenarioState(wallet);
    const second = new MockScenarioState(wallet);
    first.getPortfolio(wallet).assets[0].amount = 0;
    expect(first.getPortfolio(wallet).assets[0].amount).toBe(10);
    first.applySwap(approval);
    expect(() => first.applySwap(approval)).toThrow(/already/);
    expect(second.getPortfolio(wallet).assets[0].amount).toBe(10);
  });

  it.each([0, 0.03])("settles an entire fractional ETH balance without a negative remainder (USDC=%s)", (usdcAmount) => {
    const ethAmount = 9 / 1234;
    const riskAssetUsd = ethAmount * 3000;
    const totalUsd = riskAssetUsd + usdcAmount;
    const initial: PortfolioState = {
      wallet, totalUsd, riskAssetUsd, defensiveAssetUsd: usdcAmount,
      riskExposurePct: riskAssetUsd / totalUsd * 100, timestamp: new Date().toISOString(),
      assets: [
        { symbol: "ETH", amount: ethAmount, usdValue: riskAssetUsd, category: "RISK" },
        { symbol: "USDC", amount: usdcAmount, usdValue: usdcAmount, category: "DEFENSIVE" },
      ],
    };
    const state = new MockScenarioState(wallet, { ...DEMO_POLICY_CONFIG, maxDeRiskPct: 100 }, initial);
    state.getMarketState();
    const current = state.getPortfolio(wallet);
    const receipt = state.applySwap({ ...approval, reduceExposurePct: current.riskExposurePct });
    expect(receipt.sourceAmount).toBe(ethAmount);
    expect(state.getPortfolio(wallet)).toMatchObject({ riskAssetUsd: 0, riskExposurePct: 0 });
    expect(state.getPortfolio(wallet).assets.map((asset) => asset.amount)).toEqual([0, usdcAmount + ethAmount * 2700]);
  });

  it.each([
    { triggered: false, action: "NONE", reasons: ["Not approved"] },
    { ...approval, sourceAsset: "USDC", targetAsset: "ETH" },
    { ...approval, targetAsset: "UNKNOWN" },
    { ...approval, reduceExposurePct: 31 },
  ])("does not change balances for unapproved/unsafe swaps: %j", (decision) => {
    const state = new MockScenarioState(wallet);
    expect(() => state.applySwap(decision as PolicyDecision)).toThrow();
    expect(state.getPortfolio(wallet).assets.map((asset) => asset.amount)).toEqual([10, 0]);
  });

  it("validates data and wallet identity at the service boundary", async () => {
    const state = new MockScenarioState(wallet);
    const getPortfolio = vi.fn(async () => state.getPortfolio(wallet));
    await expect(new PortfolioService({ getPortfolio }).getPortfolio(" ")).rejects.toThrow();
    expect(getPortfolio).not.toHaveBeenCalled();
    await expect(new PortfolioService({ getPortfolio }).getPortfolio("other")).rejects.toThrow(/different wallet/);
    await expect(new PortfolioService({ getPortfolio: async () => ({ ...state.getPortfolio(wallet), riskExposurePct: 1 }) }).getPortfolio(wallet)).rejects.toThrow();
    await expect(new MarketService({ getMarketState: async () => ({ ...state.getMarketState(), priceUsd: 0 }) }).getMarketState()).rejects.toThrow();
  });
});
