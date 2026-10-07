import type { InvestigationResult, MarketState, PortfolioState, RiskAnalysis } from "@/domain/types";

export interface InvestigationAdapter {
  investigate(portfolio: PortfolioState, market: MarketState, risk: RiskAnalysis): Promise<InvestigationResult>;
}
