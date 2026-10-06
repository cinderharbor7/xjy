import type { z } from "zod";
import type {
  AssetBalanceSchema, PortfolioStateSchema, MarketStateSchema, StressTestResultSchema,
  InvestigationResultSchema, RiskAnalysisSchema, PolicyConfigSchema, PolicyDecisionSchema,
  ExecutionResultSchema, VerificationResultSchema, RescueSessionSchema, RescueProblemSchema,
} from "../schemas";

export type AssetBalance = z.infer<typeof AssetBalanceSchema>;
export type PortfolioState = z.infer<typeof PortfolioStateSchema>;
export type MarketState = z.infer<typeof MarketStateSchema>;
export type StressTestResult = z.infer<typeof StressTestResultSchema>;
export type InvestigationResult = z.infer<typeof InvestigationResultSchema>;
export type RiskAnalysis = z.infer<typeof RiskAnalysisSchema>;
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type RescueSession = z.infer<typeof RescueSessionSchema>;
export type RescueProblem = z.infer<typeof RescueProblemSchema>;
