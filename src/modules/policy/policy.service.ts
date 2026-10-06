import {
  PolicyConfigSchema,
  PolicyDecisionSchema,
  PortfolioStateSchema,
  RiskAnalysisSchema,
  approximatelyEqual,
} from "@/domain/schemas";
import type {
  PolicyConfig,
  PolicyDecision,
  PortfolioState,
  RiskAnalysis,
} from "@/domain/types";

export class PolicyService {
  private readonly config: PolicyConfig;

  constructor(config: PolicyConfig) {
    this.config = PolicyConfigSchema.parse(config);
  }

  evaluate(portfolio: PortfolioState, risk: RiskAnalysis): PolicyDecision {
    const current = PortfolioStateSchema.parse(portfolio);
    const validatedRisk = RiskAnalysisSchema.parse(risk);
    if (!approximatelyEqual(validatedRisk.riskExposurePct, current.riskExposurePct)) {
      throw new Error("Risk analysis risk exposure must match the current portfolio.");
    }

    const source = current.assets.find((asset) => asset.category === "RISK" && asset.amount > 0
      && asset.usdValue > 0 && this.config.allowedRiskAssets.includes(asset.symbol));
    const target = this.config.allowedDefensiveAssets.find((symbol) => {
      const held = current.assets.find((asset) => asset.symbol === symbol);
      return !held || held.category === "DEFENSIVE";
    });

    // Investigation prose and recommendedAction never authorize execution.
    const rules = [
      {
        passed: validatedRisk.riskScore > this.config.minRiskScore,
        description: `Risk score ${validatedRisk.riskScore} > ${this.config.minRiskScore}`,
      },
      {
        passed: validatedRisk.confidence > this.config.minConfidence,
        description: `Confidence ${validatedRisk.confidence} > ${this.config.minConfidence}`,
      },
      {
        passed: current.riskExposurePct > this.config.minRiskExposurePct,
        description: `Risk exposure ${current.riskExposurePct}% > ${this.config.minRiskExposurePct}%`,
      },
      {
        passed: this.config.maxDeRiskPct > 0,
        description: `De-risk limit ${this.config.maxDeRiskPct} percentage points > 0`,
      },
      {
        passed: source !== undefined,
        description: "A held risk asset with positive value is on the user-approved risk allowlist",
      },
      {
        passed: target !== undefined,
        description: "A user-approved defensive target is available with no conflicting portfolio category",
      },
    ];
    const triggered = rules.every((rule) => rule.passed);
    const reasons = rules.map((rule) => `${rule.description}: ${rule.passed ? "passed" : "failed"}.`);
    if (!triggered || !source || !target) {
      return PolicyDecisionSchema.parse({ triggered: false, action: "NONE", reasons });
    }
    const reduceExposurePct = Math.min(this.config.maxDeRiskPct, source.usdValue / current.totalUsd * 100);
    reasons.push(`Approved ${source.symbol} → user-approved defensive asset ${target}, reducing exposure by ${reduceExposurePct} percentage points, limited by held source value and the configured cap.`);
    return PolicyDecisionSchema.parse({
      triggered: true,
      action: "SWAP_TO_SAFE",
      sourceAsset: source.symbol,
      targetAsset: target,
      reduceExposurePct,
      reasons,
    });
  }
}
