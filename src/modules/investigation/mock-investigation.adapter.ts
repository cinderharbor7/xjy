import { InvestigationResultSchema } from "@/domain/schemas";
import type { InvestigationResult, PositionState, RiskAnalysis } from "@/domain/types";
import type { InvestigationAdapter } from "./investigation.adapter";

export class MockInvestigationAdapter implements InvestigationAdapter {
  async investigate(position: PositionState, risk: RiskAnalysis): Promise<InvestigationResult> {
    return InvestigationResultSchema.parse({
      summary: "Mock investigation: the position has a thin health factor buffer and is vulnerable to an ETH price decline.",
      primaryCause: "Mock scenario: low health factor and ETH price exposure.",
      evidence: [
        `Mock position health factor is ${position.healthFactor.toFixed(2)} with $${position.debtUsd.toLocaleString("en-US")} debt.`,
        `Demo risk score is ${risk.riskScore}/100.`,
        "Demo linear stress test places health factor below 1 under a 10% ETH price decline.",
      ],
      uncertainties: [
        "Mock data only: no Ethereum or Aave position was read.",
        "No LLM was called; confidence is a fixed demo value.",
        "Linear stress tests omit real collateral mix, liquidation thresholds, fees and market dynamics.",
      ],
      confidence: 0.88,
    });
  }
}
