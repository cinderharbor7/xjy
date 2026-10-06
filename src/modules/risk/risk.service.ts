import { MarketStateSchema, PortfolioStateSchema, RiskAnalysisSchema } from "@/domain/schemas";
import type { MarketState, PortfolioState, RiskAnalysis } from "@/domain/types";
import { runStressTest } from "./stress-test";

export class RiskService {
  analyze(portfolio: PortfolioState, market: MarketState): RiskAnalysis {
    const current = PortfolioStateSchema.parse(portfolio);
    const conditions = MarketStateSchema.parse(market);
    // Deterministic demo calculation, not a production portfolio risk model.
    const downsideScore = Math.min(100, Math.max(0, -conditions.priceChange1hPct * 10));
    const riskScore = current.riskAssetUsd === 0 ? 0 : Math.round(
      0.5 * conditions.volatilityScore + 0.3 * downsideScore + 0.2 * current.riskExposurePct,
    );

    return RiskAnalysisSchema.parse({
      riskScore,
      confidence: 0,
      riskExposurePct: current.riskExposurePct,
      stressTests: [-5, -10, -15].map((shock) => runStressTest(current, shock)),
      investigation: {
        summary: "Pending investigation",
        primaryCause: "Pending investigation",
        evidence: [],
        uncertainties: ["Investigation has not run yet."],
        confidence: 0,
      },
      recommendedAction: riskScore > 80 ? "SWAP_TO_SAFE" : "NONE",
    });
  }
}
