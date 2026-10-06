import { InvestigationResultSchema, PositionStateSchema, RiskAnalysisSchema } from "@/domain/schemas";
import type { InvestigationResult, PositionState, RiskAnalysis } from "@/domain/types";
import type { InvestigationAdapter } from "./investigation.adapter";

export class InvestigationService {
  constructor(private readonly adapter: InvestigationAdapter) {}

  async investigate(position: PositionState, risk: RiskAnalysis): Promise<InvestigationResult> {
    const current = PositionStateSchema.parse(position);
    const analysis = RiskAnalysisSchema.parse(risk);
    if (analysis.healthFactor !== current.healthFactor) {
      throw new Error("Investigation risk analysis does not match the position health factor.");
    }
    return InvestigationResultSchema.parse(await this.adapter.investigate(current, analysis));
  }
}
