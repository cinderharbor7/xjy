import { approximatelyEqual, InvestigationResultSchema, MarketStateSchema, PortfolioStateSchema, RiskAnalysisSchema } from "@/domain/schemas";
import type { InvestigationResult, MarketState, PortfolioState, RiskAnalysis } from "@/domain/types";
import type { InvestigationAdapter } from "./investigation.adapter";

export class InvestigationService {
  constructor(private readonly adapter: InvestigationAdapter) {}

  async investigate(portfolio: PortfolioState, market: MarketState, risk: RiskAnalysis): Promise<InvestigationResult> {
    const current = PortfolioStateSchema.parse(portfolio);
    const conditions = MarketStateSchema.parse(market);
    const analysis = RiskAnalysisSchema.parse(risk);
    if (!approximatelyEqual(analysis.riskExposurePct, current.riskExposurePct)) {
      throw new Error("Investigation risk analysis does not match the portfolio risk exposure.");
    }
    return InvestigationResultSchema.parse(await this.adapter.investigate(current, conditions, analysis));
  }
}
