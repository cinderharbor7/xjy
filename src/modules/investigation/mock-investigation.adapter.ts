import { InvestigationResultSchema } from "@/domain/schemas";
import type { InvestigationResult, MarketState, PortfolioState, RiskAnalysis } from "@/domain/types";
import type { InvestigationAdapter } from "./investigation.adapter";

export class MockInvestigationAdapter implements InvestigationAdapter {
  async investigate(portfolio: PortfolioState, market: MarketState, risk: RiskAnalysis): Promise<InvestigationResult> {
    return InvestigationResultSchema.parse({
      summary: "Mock investigation: a simulated market shock and increased volatility affect a portfolio with concentrated risk-asset exposure.",
      primaryCause: "Mock market decline combined with concentrated risk-asset exposure.",
      evidence: [
        `Mock portfolio risk exposure is ${portfolio.riskExposurePct}% with $${portfolio.riskAssetUsd.toLocaleString("en-US")} in risk assets.`,
        `Mock ${market.asset} price is $${market.priceUsd}; changes are ${market.priceChange5mPct}% over 5 minutes and ${market.priceChange1hPct}% over 1 hour.`,
        `Mock volatility score is ${market.volatilityScore}/100.`,
        `Demo risk score is ${risk.riskScore}/100.`,
      ],
      uncertainties: [
        "Mock data only: no blockchain balances or live market data were read.",
        "No LLM was called; confidence is a fixed demo value.",
        "Demo stress tests apply one common shock to risk assets and keep defensive values unchanged; defensive-asset risks are not covered.",
        "Demo swaps omit fees and slippage; a user-approved defensive asset is not guaranteed to retain its value.",
      ],
      confidence: 0.88,
    });
  }
}
