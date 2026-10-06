import type { InvestigationResult, PositionState, RiskAnalysis } from "@/domain/types";

export interface InvestigationAdapter {
  investigate(position: PositionState, risk: RiskAnalysis): Promise<InvestigationResult>;
}
