import {
  PolicyConfigSchema,
  PolicyDecisionSchema,
  PositionStateSchema,
  RiskAnalysisSchema,
} from "@/domain/schemas";
import type {
  PolicyConfig,
  PolicyDecision,
  PositionState,
  RiskAnalysis,
} from "@/domain/types";

export class PolicyService {
  private readonly config: PolicyConfig;

  constructor(config: PolicyConfig) {
    this.config = PolicyConfigSchema.parse(config);
  }

  evaluate(position: PositionState, risk: RiskAnalysis): PolicyDecision {
    const validatedPosition = PositionStateSchema.parse(position);
    const validatedRisk = RiskAnalysisSchema.parse(risk);
    if (validatedRisk.healthFactor !== validatedPosition.healthFactor) {
      throw new Error("Risk analysis health factor must match the current position.");
    }

    // Investigation prose and recommendedAction never authorize execution.
    const rules = [
      {
        passed: validatedPosition.healthFactor < this.config.maxHealthFactorForTrigger,
        description: `Health factor ${validatedPosition.healthFactor} < ${this.config.maxHealthFactorForTrigger}`,
      },
      {
        passed: validatedRisk.riskScore > this.config.minRiskScore,
        description: `Risk score ${validatedRisk.riskScore} > ${this.config.minRiskScore}`,
      },
      {
        passed: validatedRisk.confidence > this.config.minConfidence,
        description: `Confidence ${validatedRisk.confidence} > ${this.config.minConfidence}`,
      },
      {
        passed: validatedPosition.debtUsd > 0,
        description: `Debt $${validatedPosition.debtUsd} > $0`,
      },
      {
        passed: this.config.maxRepayUsd > 0,
        description: `Repay limit $${this.config.maxRepayUsd} > $0`,
      },
    ];
    const triggered = rules.every((rule) => rule.passed);
    const repayAmountUsd = triggered
      ? Math.min(validatedPosition.debtUsd, this.config.maxRepayUsd)
      : 0;
    const reasons = rules.map((rule) => `${rule.description}: ${rule.passed ? "passed" : "failed"}.`);
    if (triggered) {
      reasons.push(`Approved REPAY $${repayAmountUsd}, limited by current debt and the configured repayment cap.`);
    }

    return PolicyDecisionSchema.parse({
      triggered,
      action: triggered ? "REPAY" : "NONE",
      repayAmountUsd,
      reasons,
    });
  }
}
