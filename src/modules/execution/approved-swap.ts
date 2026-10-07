import { PolicyDecisionSchema } from "@/domain/schemas";
import type { PolicyConfig, PolicyDecision } from "@/domain/types";

/** Asset direction comes from trusted user configuration, never Agent-supplied labels. */
export function validateApprovedSwap(decision: PolicyDecision, config: PolicyConfig): PolicyDecision {
  const approved = PolicyDecisionSchema.parse(decision);
  if (!approved.triggered || approved.action !== "SWAP_TO_SAFE"
    || approved.sourceAsset === undefined || approved.targetAsset === undefined
    || !config.allowedRiskAssets.includes(approved.sourceAsset)
    || !config.allowedDefensiveAssets.includes(approved.targetAsset)
    || approved.reduceExposurePct === undefined || approved.reduceExposurePct > config.maxDeRiskPct) {
    throw new Error("Execution requires a policy-approved RISK → user-approved DEFENSIVE swap within the configured limit.");
  }
  return approved;
}
