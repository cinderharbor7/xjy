import { PositionStateSchema, RiskAnalysisSchema } from "@/domain/schemas";
import type { PositionState, RiskAnalysis } from "@/domain/types";
import { runStressTest } from "./stress-test";

export class RiskService {
  analyze(position: PositionState): RiskAnalysis {
    const current = PositionStateSchema.parse(position);
    // Fixed demo bands expose the module boundary without pretending to be a production risk model.
    const riskScore = current.debtUsd === 0 ? 0
      : current.healthFactor <= 1.1 ? 91
      : current.healthFactor < 1.3 ? 75
      : current.healthFactor < 1.5 ? 50
      : 20;

    return RiskAnalysisSchema.parse({
      riskScore,
      confidence: 0,
      healthFactor: current.healthFactor,
      stressTests: [-5, -10, -15].map((shock) => runStressTest(current, shock)),
      investigation: {
        summary: "Pending investigation",
        primaryCause: "Pending investigation",
        evidence: [],
        uncertainties: ["Investigation has not run yet."],
        confidence: 0,
      },
      recommendedAction: riskScore > 80 ? "REPAY" : "NONE",
    });
  }
}
