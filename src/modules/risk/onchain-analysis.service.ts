import { OnchainSignalStateSchema, RiskAnalysisSchema } from "@/domain/schemas";
import type { MarketState, OnchainSignalState, PortfolioState, RiskAnalysis } from "@/domain/types";
import { InvestigationService } from "../investigation/investigation.service";
import { OnchainSellPressureInvestigationAdapter } from "../investigation/onchain-investigation.adapter";
import { OnchainRiskService } from "./onchain-risk.service";

/**
 * B's minimum runnable entry point: A's DEX_SELL_PRESSURE signal in, a frozen
 * RiskAnalysis out. The result is a strict RiskAnalysisSchema value with both
 * confidences equal and riskExposurePct taken from the portfolio, so D can read
 * it through AnalysisSchema without any schema change.
 */
export class OnchainAnalysisService {
  constructor(private readonly riskService = new OnchainRiskService()) {}

  async analyze(portfolio: PortfolioState, market: MarketState, signal: OnchainSignalState): Promise<RiskAnalysis> {
    const observation = OnchainSignalStateSchema.parse(signal);
    const preliminary = this.riskService.analyze(portfolio, market, observation);
    const investigation = await new InvestigationService(
      new OnchainSellPressureInvestigationAdapter(observation),
    ).investigate(portfolio, market, preliminary);
    return RiskAnalysisSchema.parse({ ...preliminary, investigation, confidence: investigation.confidence });
  }
}
