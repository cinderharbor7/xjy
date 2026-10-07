import { describe, expect, it } from "vitest";
import { MarketStateSchema, PortfolioStateSchema } from "@/domain/schemas";
import type { MarketState, PortfolioState } from "@/domain/types";
import {
  computeApprovedSourceAmount, isToken0, quotedPortfolioUsd, quotedSourcePrice, toRawAmount,
} from "@/modules/execution/fork-amounts";

function buildPortfolio(ethAmount: number, usdcAmount: number, ethPrice: number): PortfolioState {
  const riskUsd = ethAmount * ethPrice;
  const total = riskUsd + usdcAmount;
  return PortfolioStateSchema.parse({
    wallet: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    totalUsd: total,
    riskAssetUsd: riskUsd,
    defensiveAssetUsd: usdcAmount,
    riskExposurePct: total === 0 ? 0 : (riskUsd / total) * 100,
    assets: [
      { symbol: "ETH", amount: ethAmount, usdValue: riskUsd, category: "RISK" },
      { symbol: "USDC", amount: usdcAmount, usdValue: usdcAmount, category: "DEFENSIVE" },
    ],
    timestamp: new Date().toISOString(),
  });
}

function buildMarket(priceUsd: number): MarketState {
  return MarketStateSchema.parse({
    asset: "ETH", priceUsd, priceChange5mPct: -3, priceChange1hPct: -10,
    volatilityScore: 82, timestamp: new Date().toISOString(),
  });
}

describe("quoted pricing", () => {
  it("prices the market asset at the market quote and everything else at snapshot value", () => {
    // Snapshot priced at $3000; the market has already crashed to $2700.
    const portfolio = buildPortfolio(10, 0, 3000);
    const market = buildMarket(2700);
    expect(quotedPortfolioUsd(portfolio, market)).toBe(27000);
    expect(quotedSourcePrice(portfolio, market, "ETH")).toBe(2700);
  });

  it("prices non-market assets at their snapshot ratio", () => {
    // Zero-balance assets are unpriceable (0), matching verification.ts exactly.
    const empty = buildPortfolio(10, 0, 3000);
    expect(quotedSourcePrice(empty, buildMarket(2700), "USDC")).toBe(0);
    const funded = buildPortfolio(10, 5000, 3000);
    expect(quotedSourcePrice(funded, buildMarket(2700), "USDC")).toBe(1);
  });

  it("returns 0 for a missing or empty source asset", () => {
    const portfolio = buildPortfolio(0, 5000, 3000);
    expect(quotedSourcePrice(portfolio, buildMarket(2700), "ETH")).toBe(0);
  });
});

describe("computeApprovedSourceAmount", () => {
  it("converts approved percentage points into the exact source amount", () => {
    const portfolio = buildPortfolio(10, 0, 3000);
    const market = buildMarket(2700);
    // 30 points of a $27000 portfolio at $2700/ETH = exactly 3 ETH.
    expect(computeApprovedSourceAmount(portfolio, market, "ETH", 30)).toBeCloseTo(3, 12);
  });

  it("realises full-balance points exactly when the exposure equals the approved points", () => {
    const portfolio = buildPortfolio(10, 0, 3000);
    const market = buildMarket(2700);
    expect(computeApprovedSourceAmount(portfolio, market, "ETH", 100)).toBe(10);
  });

  it("is never more than the held balance for points below full exposure", () => {
    const portfolio = buildPortfolio(10, 5000, 3000);
    const market = buildMarket(3000);
    const amount = computeApprovedSourceAmount(portfolio, market, "ETH", 30);
    // Exposure is 30000/35000 ≈ 85.7 points; 30 points must stay within holdings.
    expect(amount).toBeGreaterThan(0);
    expect(amount).toBeLessThanOrEqual(10);
  });

  it("mirrors verifyRescueOutcome's exposure-points formula exactly", () => {
    const portfolio = buildPortfolio(10, 1234, 3000);
    const market = buildMarket(2600);
    const approvedPoints = 25;
    const amount = computeApprovedSourceAmount(portfolio, market, "ETH", approvedPoints);
    // Reproduce verification.ts lines 15-17 verbatim.
    const quotedTotalUsd = portfolio.assets.reduce(
      (total, asset) => total + (asset.symbol === market.asset ? asset.amount * market.priceUsd : asset.usdValue), 0,
    );
    const sourcePrice = market.priceUsd;
    const executedPoints = amount * sourcePrice / quotedTotalUsd * 100;
    expect(Math.abs(executedPoints - approvedPoints) / approvedPoints).toBeLessThan(1e-10);
  });

  it("returns NaN when the portfolio cannot be priced", () => {
    const portfolio = buildPortfolio(0, 0, 3000);
    expect(Number.isNaN(computeApprovedSourceAmount(portfolio, buildMarket(2700), "ETH", 30))).toBe(true);
  });
});

describe("toRawAmount", () => {
  it("converts at 18 decimals without precision loss", () => {
    expect(toRawAmount(3, 18)).toBe(3_000_000_000_000_000_000n);
  });

  it("converts at 6 decimals and rounds beyond token precision", () => {
    expect(toRawAmount(8050.207108, 6)).toBe(8_050_207_108n);
    expect(toRawAmount(1.0000005, 6)).toBe(1_000_001n); // rounds at the token's own precision
  });

  it("rejects non-positive or non-finite amounts and invalid decimals", () => {
    expect(() => toRawAmount(0, 18)).toThrow();
    expect(() => toRawAmount(-1, 18)).toThrow();
    expect(() => toRawAmount(Number.NaN, 18)).toThrow();
    expect(() => toRawAmount(1, -1)).toThrow();
    expect(() => toRawAmount(1, 19)).toThrow();
  });
});

describe("isToken0", () => {
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  it("orders Uniswap V2 tokens deterministically regardless of case", () => {
    expect(isToken0(WETH, USDC)).toBe(false);
    expect(isToken0(USDC, WETH)).toBe(true);
    expect(isToken0(WETH.toLowerCase(), USDC)).toBe(false);
  });
});
