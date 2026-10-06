import { z } from "zod";
import { verifyRescueOutcome } from "../verification";

export { OnchainEvidenceSchema, OnchainSignalStateSchema } from "./onchain";

export const WalletSchema = z.string().trim().min(1);
export const AssetSymbolSchema = z.string().trim().min(1);
export const ActionSchema = z.enum(["NONE", "SWAP_TO_SAFE"]);
const usd = z.number().finite().nonnegative();
const pct = z.number().finite().min(0).max(100);
const confidence = z.number().finite().min(0).max(1);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const approximatelyEqual = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

export const AssetBalanceSchema = z.strictObject({
  symbol: AssetSymbolSchema,
  tokenAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  amount: usd,
  usdValue: usd,
  category: z.enum(["RISK", "DEFENSIVE"]),
});

export const PortfolioStateSchema = z.strictObject({
  wallet: WalletSchema,
  totalUsd: usd,
  riskAssetUsd: usd,
  defensiveAssetUsd: usd,
  riskExposurePct: pct,
  assets: z.array(AssetBalanceSchema),
  timestamp: z.iso.datetime(),
  blockNumber: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).superRefine((portfolio, context) => {
  const risk = portfolio.assets.filter((asset) => asset.category === "RISK").reduce((sum, asset) => sum + asset.usdValue, 0);
  const defensive = portfolio.assets.filter((asset) => asset.category === "DEFENSIVE").reduce((sum, asset) => sum + asset.usdValue, 0);
  const total = risk + defensive;
  const exposure = total === 0 ? 0 : risk / total * 100;
  if (new Set(portfolio.assets.map((asset) => asset.symbol)).size !== portfolio.assets.length
    || !approximatelyEqual(risk, portfolio.riskAssetUsd)
    || !approximatelyEqual(defensive, portfolio.defensiveAssetUsd)
    || !approximatelyEqual(total, portfolio.totalUsd)
    || !approximatelyEqual(exposure, portfolio.riskExposurePct)
    || portfolio.assets.some((asset) => asset.amount === 0 && asset.usdValue !== 0)) {
    context.addIssue({ code: "custom", message: "Unique asset balances, category totals and risk exposure must agree." });
  }
});

export const MarketStateSchema = z.strictObject({
  asset: AssetSymbolSchema,
  priceUsd: z.number().finite().positive(),
  priceChange5mPct: z.number().finite().min(-100),
  priceChange1hPct: z.number().finite().min(-100),
  volatilityScore: pct,
  timestamp: z.iso.datetime(),
});

export const StressTestResultSchema = z.strictObject({
  priceChangePct: z.number().finite().min(-100),
  projectedPortfolioUsd: usd,
  projectedLossUsd: usd,
});

export const InvestigationResultSchema = z.strictObject({
  summary: z.string().min(1),
  primaryCause: z.string().min(1),
  evidence: z.array(z.string()),
  uncertainties: z.array(z.string()),
  confidence,
});

export const RiskAnalysisSchema = z.strictObject({
  riskScore: pct,
  confidence,
  riskExposurePct: pct,
  stressTests: z.array(StressTestResultSchema),
  investigation: InvestigationResultSchema,
  recommendedAction: ActionSchema,
});

export const PolicyConfigSchema = z.strictObject({
  minRiskScore: pct,
  minConfidence: confidence,
  minRiskExposurePct: pct,
  maxDeRiskPct: pct,
  allowedRiskAssets: z.array(AssetSymbolSchema),
  allowedDefensiveAssets: z.array(AssetSymbolSchema),
}).superRefine((config, context) => {
  if (new Set(config.allowedRiskAssets).size !== config.allowedRiskAssets.length
    || new Set(config.allowedDefensiveAssets).size !== config.allowedDefensiveAssets.length
    || config.allowedRiskAssets.some((asset) => config.allowedDefensiveAssets.includes(asset))) {
    context.addIssue({ code: "custom", message: "Risk and defensive allowlists must be unique and disjoint." });
  }
});

export const PolicyDecisionSchema = z.strictObject({
  triggered: z.boolean(),
  action: ActionSchema,
  sourceAsset: AssetSymbolSchema.optional(),
  targetAsset: AssetSymbolSchema.optional(),
  // Percentage points of total portfolio exposure, never a fraction of the risk balance.
  reduceExposurePct: pct.optional(),
  reasons: z.array(z.string()).min(1),
}).superRefine((decision, context) => {
  const consistent = decision.triggered
    ? decision.action === "SWAP_TO_SAFE" && decision.sourceAsset !== undefined && decision.targetAsset !== undefined
      && decision.sourceAsset !== decision.targetAsset && decision.reduceExposurePct !== undefined && decision.reduceExposurePct > 0
    : decision.action === "NONE" && decision.sourceAsset === undefined && decision.targetAsset === undefined && decision.reduceExposurePct === undefined;
  if (!consistent) context.addIssue({ code: "custom", message: "Only a triggered policy may approve a positive structured SWAP_TO_SAFE." });
});

export const ExecutionResultSchema = z.strictObject({
  success: z.boolean(),
  action: ActionSchema,
  sourceAsset: AssetSymbolSchema.optional(),
  targetAsset: AssetSymbolSchema.optional(),
  sourceAmount: z.number().finite().positive().optional(),
  targetAmount: z.number().finite().positive().optional(),
  txHash: hash.optional(),
  timestamp: z.iso.datetime(),
  error: z.string().min(1).optional(),
}).superRefine((result, context) => {
  const consistent = result.action === "NONE"
    ? !result.success && result.sourceAsset === undefined && result.targetAsset === undefined
      && result.sourceAmount === undefined && result.targetAmount === undefined && result.txHash === undefined && result.error === undefined
    : result.sourceAsset !== undefined && result.targetAsset !== undefined && result.sourceAsset !== result.targetAsset
      && (result.success
        ? result.sourceAmount !== undefined && result.targetAmount !== undefined && result.txHash !== undefined && result.error === undefined
        : result.sourceAmount === undefined && result.targetAmount === undefined && result.error !== undefined);
  if (!consistent) context.addIssue({ code: "custom", message: "Execution must describe a skipped action, a complete swap receipt, or an explicit failed swap." });
});

export const VerificationResultSchema = z.strictObject({
  status: z.enum(["SKIPPED", "PASSED", "FAILED"]),
  reasons: z.array(z.string()).min(1),
});

export const RescueSessionSchema = z.strictObject({
  before: PortfolioStateSchema,
  market: MarketStateSchema,
  riskAnalysis: RiskAnalysisSchema,
  policyDecision: PolicyDecisionSchema,
  execution: ExecutionResultSchema,
  after: PortfolioStateSchema.optional(),
  verification: VerificationResultSchema,
}).superRefine((session, context) => {
  const { policyDecision, execution, before, after, riskAnalysis } = session;
  if (execution.action !== policyDecision.action || execution.sourceAsset !== policyDecision.sourceAsset || execution.targetAsset !== policyDecision.targetAsset
    || execution.success !== (after !== undefined) || (after && after.wallet !== before.wallet)
    || !approximatelyEqual(riskAnalysis.riskExposurePct, before.riskExposurePct)
    || riskAnalysis.confidence !== riskAnalysis.investigation.confidence
    || session.verification.status !== verifyRescueOutcome(before, after, policyDecision, execution, session.market).status) {
    context.addIssue({ code: "custom", message: "Session authorization, analysis, independent re-read and verification must agree." });
  }
});

export const RescueRequestSchema = z.strictObject({ wallet: WalletSchema });
export const RescueProblemSchema = z.strictObject({
  type: z.string().min(1), title: z.string().min(1), status: z.union([z.literal(400), z.literal(500)]),
  detail: z.string().min(1), instance: z.literal("/api/rescue"), code: z.enum(["INVALID_REQUEST", "RESCUE_FAILED"]),
});
