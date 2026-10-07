import { MarketStateSchema, OnchainSignalStateSchema, PortfolioStateSchema, RiskAnalysisSchema } from "@/domain/schemas";
import type { MarketState, OnchainSignalState, PortfolioState, RiskAnalysis } from "@/domain/types";
import { RiskService } from "./risk.service";
import { clamp, sellPressureUplift } from "./sell-pressure";

/**
 * Signal-aware companion to RiskService. It reuses the frozen deterministic
 * market/portfolio score and adds a bounded, documented sell-pressure uplift.
 * RiskService.analyze (no signal) is left untouched, so the fixed Demo numbers
 * and the frozen RiskAnalysis contract do not change.
 */
export class OnchainRiskService {
  constructor(private readonly base = new RiskService()) {}

  analyze(portfolio: PortfolioState, market: MarketState, signal: OnchainSignalState): RiskAnalysis {
    const current = PortfolioStateSchema.parse(portfolio);
    const baseline = this.base.analyze(current, MarketStateSchema.parse(market));
    const observation = OnchainSignalStateSchema.parse(signal);
    const riskScore = current.riskAssetUsd === 0
      ? 0
      : Math.round(clamp(baseline.riskScore + sellPressureUplift(observation.anomalyRatio), 0, 100));
    return RiskAnalysisSchema.parse({
      ...baseline,
      riskScore,
      recommendedAction: riskScore > 80 ? "SWAP_TO_SAFE" : "NONE",
    });
  }
}
