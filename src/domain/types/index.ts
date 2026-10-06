import type { z } from "zod";
import type {
  PositionStateSchema, StressTestResultSchema, InvestigationResultSchema,
  RiskAnalysisSchema, PolicyConfigSchema, PolicyDecisionSchema,
  ExecutionResultSchema, RescueSessionSchema,
} from "../schemas";

export type PositionState = z.infer<typeof PositionStateSchema>;
export type StressTestResult = z.infer<typeof StressTestResultSchema>;
export type InvestigationResult = z.infer<typeof InvestigationResultSchema>;
export type RiskAnalysis = z.infer<typeof RiskAnalysisSchema>;
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
export type RescueSession = z.infer<typeof RescueSessionSchema>;
