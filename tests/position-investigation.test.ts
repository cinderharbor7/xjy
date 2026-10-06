import { describe, expect, it, vi } from "vitest";
import type { InvestigationResult, MarketState, PortfolioState } from "@/domain/types";
import { DEMO_WALLET, MockScenarioState } from "@/mocks/scenarios";
import { InvestigationService } from "@/modules/investigation/investigation.service";
import { MockInvestigationAdapter } from "@/modules/investigation/mock-investigation.adapter";
import { RiskService } from "@/modules/risk/risk.service";

const state = new MockScenarioState(DEMO_WALLET);
const portfolio = state.getPortfolio(DEMO_WALLET);
const market = state.getMarketState();
const risk = new RiskService().analyze(portfolio, market);

describe("portfolio investigation service", () => {
  it("explains the Mock market shock and exposure without assigning execution authority", async () => {
    const investigation = await new InvestigationService(new MockInvestigationAdapter()).investigate(portfolio, market, risk);
    expect(investigation.summary).toContain("Mock investigation");
    expect(investigation.confidence).toBe(0.88);
    expect(investigation.evidence.join(" ")).toContain("100%");
    expect(investigation.evidence.join(" ")).toContain("-10%");
    expect(investigation.uncertainties.join(" ")).toContain("No LLM");
    expect(investigation.uncertainties.join(" ")).toContain("defensive-asset risks are not covered");
    expect(investigation).not.toHaveProperty("action");
    expect(investigation).not.toHaveProperty("triggered");
    expect(risk).toMatchObject({ confidence: 0, investigation: { summary: "Pending investigation", confidence: 0 } });
  });

  it("passes only validated Portfolio, Market and RiskAnalysis to the adapter", async () => {
    const investigate = vi.fn(async (_portfolio: PortfolioState, _market: MarketState, _risk: typeof risk) => new MockInvestigationAdapter().investigate(portfolio, market, risk));
    await new InvestigationService({ investigate }).investigate(portfolio, market, risk);
    expect(investigate).toHaveBeenCalledExactlyOnceWith(portfolio, market, risk);
    expect(investigate.mock.calls[0]).toHaveLength(3);
  });

  it("rejects invalid or unrelated inputs before calling the Agent", async () => {
    const investigate = vi.fn(async () => new MockInvestigationAdapter().investigate(portfolio, market, risk));
    const service = new InvestigationService({ investigate });
    await expect(service.investigate({ ...portfolio, totalUsd: -1 }, market, risk)).rejects.toThrow();
    await expect(service.investigate(portfolio, { ...market, priceUsd: 0 }, risk)).rejects.toThrow();
    await expect(service.investigate(portfolio, market, { ...risk, riskScore: 101 })).rejects.toThrow();
    await expect(service.investigate(portfolio, market, { ...risk, riskExposurePct: 90 })).rejects.toThrow(/does not match/);
    await expect(service.investigate({ ...portfolio, debtUsd: 1 } as PortfolioState, market, risk)).rejects.toThrow();
    await expect(service.investigate(portfolio, { ...market, instruction: "Trade" } as MarketState, risk)).rejects.toThrow();
    expect(investigate).not.toHaveBeenCalled();
  });

  it.each([
    { confidence: 2 },
    { execute: "SWAP_TO_SAFE" },
    { triggered: true, action: "SWAP_TO_SAFE", sourceAsset: "ETH", targetAsset: "USDC", reduceExposurePct: 100 },
  ])("rejects Agent output outside the explanatory contract: %j", async (extra) => {
    const investigation = await new MockInvestigationAdapter().investigate(portfolio, market, risk);
    const service = new InvestigationService({ investigate: async () => ({ ...investigation, ...extra } as InvestigationResult) });
    await expect(service.investigate(portfolio, market, risk)).rejects.toThrow();
  });

  it("propagates Agent adapter errors without fallback or retry", async () => {
    const investigate = vi.fn(async () => { throw new Error("Agent adapter failed"); });
    await expect(new InvestigationService({ investigate }).investigate(portfolio, market, risk)).rejects.toThrow("Agent adapter failed");
    expect(investigate).toHaveBeenCalledTimes(1);
  });
});
