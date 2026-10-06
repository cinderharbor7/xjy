import { z } from "zod";

// All public module and HTTP payloads are validated against these contracts.
export const WalletSchema = z.string().trim().min(1);
export const ActionSchema = z.enum(["NONE", "REPAY"]);
const usd = z.number().finite().nonnegative();
const confidence = z.number().finite().min(0).max(1);

export const PositionStateSchema = z.strictObject({
  wallet: WalletSchema,
  collateralUsd: usd,
  debtUsd: usd,
  healthFactor: z.number().finite().nonnegative(),
  ethPrice: z.number().finite().positive(),
  timestamp: z.iso.datetime(),
  blockNumber: z.number().int().nonnegative().optional(),
});

export const StressTestResultSchema = z.strictObject({
  ethChangePct: z.number().finite().min(-100),
  projectedHealthFactor: z.number().finite().nonnegative(),
  liquidationRisk: z.boolean(),
});

export const InvestigationResultSchema = z.strictObject({
  summary: z.string().min(1),
  primaryCause: z.string().min(1),
  evidence: z.array(z.string()),
  uncertainties: z.array(z.string()),
  confidence,
});

export const RiskAnalysisSchema = z.strictObject({
  riskScore: z.number().finite().min(0).max(100),
  confidence,
  healthFactor: z.number().finite().nonnegative(),
  stressTests: z.array(StressTestResultSchema),
  investigation: InvestigationResultSchema,
  recommendedAction: ActionSchema,
});

export const PolicyConfigSchema = z.strictObject({
  maxHealthFactorForTrigger: z.number().finite().positive(),
  minRiskScore: z.number().finite().min(0).max(100),
  minConfidence: confidence,
  maxRepayUsd: usd,
});

export const PolicyDecisionSchema = z.strictObject({
  triggered: z.boolean(),
  action: ActionSchema,
  repayAmountUsd: usd,
  reasons: z.array(z.string()).min(1),
}).superRefine((decision, context) => {
  const consistent = decision.triggered
    ? decision.action === "REPAY" && decision.repayAmountUsd > 0
    : decision.action === "NONE" && decision.repayAmountUsd === 0;
  if (!consistent) {
    context.addIssue({ code: "custom", message: "Only a triggered policy may approve a positive REPAY." });
  }
});

export const ExecutionResultSchema = z.strictObject({
  success: z.boolean(),
  action: ActionSchema,
  amountUsd: usd,
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  timestamp: z.iso.datetime(),
  error: z.string().optional(),
}).superRefine((result, context) => {
  if (result.action === "NONE" && (result.success || result.amountUsd !== 0 || result.txHash !== undefined)) {
    context.addIssue({ code: "custom", message: "NONE means execution was skipped: success=false, amountUsd=0, no txHash." });
  }
  if (result.action === "REPAY" && (result.amountUsd <= 0 || (result.success && !result.txHash))) {
    context.addIssue({ code: "custom", message: "REPAY requires a positive amount; successful execution requires a transaction hash." });
  }
  if (result.success && result.error !== undefined) {
    context.addIssue({ code: "custom", message: "Successful execution cannot include an error." });
  }
});

export const RescueSessionSchema = z.strictObject({
  before: PositionStateSchema,
  riskAnalysis: RiskAnalysisSchema,
  policyDecision: PolicyDecisionSchema,
  execution: ExecutionResultSchema,
  after: PositionStateSchema.optional(),
}).superRefine((session, context) => {
  const { policyDecision, execution, before, after } = session;
  if (execution.action !== policyDecision.action || execution.amountUsd !== policyDecision.repayAmountUsd) {
    context.addIssue({ code: "custom", message: "Execution must match the policy action and amount." });
  }
  if (execution.success !== (after !== undefined)) {
    context.addIssue({ code: "custom", message: "Successful execution must be followed by a position re-read; skipped or failed execution has no after." });
  }
  if (after && after.wallet !== before.wallet) {
    context.addIssue({ code: "custom", message: "Before and after must belong to the same wallet." });
  }
  if (session.riskAnalysis.healthFactor !== before.healthFactor) {
    context.addIssue({ code: "custom", message: "Risk analysis must describe the before position." });
  }
});

export const RescueRequestSchema = z.strictObject({ wallet: WalletSchema });
