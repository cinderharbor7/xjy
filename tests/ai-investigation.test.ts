import { describe, expect, it, vi } from "vitest";
import { InvestigationResultSchema, RiskAnalysisSchema } from "@/domain/schemas";
import type { MarketState, OnchainSignalState, PortfolioState, RiskAnalysis } from "@/domain/types";
import { AiInvestigationAdapter } from "@/modules/investigation/ai-investigation.adapter";
import { OnchainSellPressureInvestigationAdapter } from "@/modules/investigation/onchain-investigation.adapter";

const txHash = "0x" + "ab".repeat(32);
const blockHash = "0x" + "cd".repeat(32);
const contractAddress = "0x" + "12".repeat(20);

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

const risk: RiskAnalysis = {
  riskScore: 100,
  confidence: 0.9,
  riskExposurePct: 100,
  stressTests: [
    { priceChangePct: -5, projectedPortfolioUsd: 28500, projectedLossUsd: 1500 },
    { priceChangePct: -10, projectedPortfolioUsd: 27000, projectedLossUsd: 3000 },
    { priceChangePct: -15, projectedPortfolioUsd: 25500, projectedLossUsd: 4500 },
  ],
  investigation: {
    summary: "placeholder",
    primaryCause: "placeholder",
    evidence: [],
    uncertainties: [],
    confidence: 0.9,
  },
  recommendedAction: "SWAP_TO_SAFE",
};

describe("AiInvestigationAdapter", () => {
  it("falls back to the deterministic template when no API key is provided", async () => {
    const ai = new AiInvestigationAdapter(signal);
    const result = await ai.investigate(portfolio, market, risk);

    const fallback = await new OnchainSellPressureInvestigationAdapter(signal).investigate(portfolio, market, risk);

    expect(result.summary).toBe(fallback.summary);
    expect(result.primaryCause).toBe(fallback.primaryCause);
    expect(result.confidence).toBe(fallback.confidence);
    expect(result.evidence).toEqual(fallback.evidence);
    expect(result.uncertainties).toEqual(fallback.uncertainties);
  });

  it("falls back to the deterministic template when the API key is empty", async () => {
    const ai = new AiInvestigationAdapter(signal, { apiKey: "   " });
    const result = await ai.investigate(portfolio, market, risk);

    const fallback = await new OnchainSellPressureInvestigationAdapter(signal).investigate(portfolio, market, risk);
    expect(result.summary).toBe(fallback.summary);
  });

  it("falls back to the deterministic template when the LLM call fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    const ai = new AiInvestigationAdapter(signal, { apiKey: "sk-test", timeoutMs: 100 });
    const result = await ai.investigate(portfolio, market, risk);

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const fallback = await new OnchainSellPressureInvestigationAdapter(signal).investigate(portfolio, market, risk);
    expect(result.summary).toBe(fallback.summary);

    fetchSpy.mockRestore();
  });

  it("falls back when the LLM returns invalid JSON", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "not-json" } }] }),
    } as Response);

    const ai = new AiInvestigationAdapter(signal, { apiKey: "sk-test" });
    const result = await ai.investigate(portfolio, market, risk);

    const fallback = await new OnchainSellPressureInvestigationAdapter(signal).investigate(portfolio, market, risk);
    expect(result.summary).toBe(fallback.summary);

    fetchSpy.mockRestore();
  });

  it("parses and validates a valid LLM JSON response", async () => {
    const llmResult = {
      summary: "AI summary: elevated sell pressure observed.",
      primaryCause: "AI cause: concentrated DEX selling.",
      evidence: [
        "AI evidence: gross sell $300000 vs baseline $100000 (3.00×).",
        "AI evidence: tx 0xabab... at block 21000000 — source: MOCK fixture.",
      ],
      uncertainties: [
        "AI unknown 1: gross sell does not net buys.",
        "AI unknown 2: single pool does not represent the whole market.",
        "AI unknown 3: schema validation is not cryptographic proof.",
        "AI unknown 4: confidence is not a price-fall probability.",
      ],
      confidence: 0.72,
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(llmResult) } }] }),
    } as Response);

    const ai = new AiInvestigationAdapter(signal, { apiKey: "sk-test" });
    const result = await ai.investigate(portfolio, market, risk);

    expect(result.summary).toBe(llmResult.summary);
    expect(result.primaryCause).toBe(llmResult.primaryCause);
    expect(result.confidence).toBe(0.72);
    expect(result.evidence).toHaveLength(2);
    expect(result.uncertainties).toHaveLength(4);

    // Schema must validate.
    expect(() => InvestigationResultSchema.parse(result)).not.toThrow();

    fetchSpy.mockRestore();
  });

  it("clamps confidence to MAX 0.9 when the LLM returns a higher value", async () => {
    const llmResult = {
      summary: "AI summary.",
      primaryCause: "AI cause.",
      evidence: ["e1"],
      uncertainties: ["u1", "u2", "u3", "u4"],
      confidence: 0.99,
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(llmResult) } }] }),
    } as Response);

    const ai = new AiInvestigationAdapter(signal, { apiKey: "sk-test" });
    const result = await ai.investigate(portfolio, market, risk);

    expect(result.confidence).toBe(0.9);
    fetchSpy.mockRestore();
  });

  it("produces a valid InvestigationResult shape regardless of LLM availability", async () => {
    const ai = new AiInvestigationAdapter(signal);
    const result = await ai.investigate(portfolio, market, risk);

    expect(() => InvestigationResultSchema.parse(result)).not.toThrow();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(0.9);
    expect(result.uncertainties.length).toBeGreaterThanOrEqual(4);
    expect(result.evidence.length).toBeGreaterThanOrEqual(1);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.primaryCause.length).toBeGreaterThan(0);
  });

  it("never carries execution authority in the investigation output", async () => {
    const ai = new AiInvestigationAdapter(signal);
    const result = await ai.investigate(portfolio, market, risk);

    const text = JSON.stringify(result).toLowerCase();
    expect(text).not.toContain("execute");
    expect(text).not.toContain("swap_to_safe");
    expect(text).not.toContain("approve");
    expect(text).not.toContain("broadcast");
  });
});
