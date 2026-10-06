import type { ExecutionResult, MarketState, PolicyDecision, PortfolioState, VerificationResult } from "./types";

const close = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Evidence comes from independently read balances, never from an Executor-supplied portfolio. */
export function verifyRescueOutcome(before: PortfolioState, after: PortfolioState | undefined, decision: PolicyDecision, execution: ExecutionResult, market: MarketState): VerificationResult {
  if (!execution.success) return { status: "SKIPPED", reasons: [decision.triggered ? "Execution failed; no changed portfolio is claimed." : "Policy did not approve execution."] };
  if (!after) return { status: "FAILED", reasons: ["No independently read portfolio is available."] };
  const sourceBefore = before.assets.find((asset) => asset.symbol === decision.sourceAsset);
  const sourceAfter = after.assets.find((asset) => asset.symbol === decision.sourceAsset);
  const targetBefore = before.assets.find((asset) => asset.symbol === decision.targetAsset);
  const targetAfter = after.assets.find((asset) => asset.symbol === decision.targetAsset);
  // Price the pre-swap balances at the market quote so a market loss cannot expand the authorization.
  const quotedTotalUsd = before.assets.reduce((total, asset) => total + (asset.symbol === market.asset ? asset.amount * market.priceUsd : asset.usdValue), 0);
  const sourcePrice = sourceBefore?.symbol === market.asset ? market.priceUsd : sourceBefore && sourceBefore.amount > 0 ? sourceBefore.usdValue / sourceBefore.amount : 0;
  const executedExposurePoints = execution.sourceAmount !== undefined && quotedTotalUsd > 0 ? execution.sourceAmount * sourcePrice / quotedTotalUsd * 100 : 0;
  const checks = [
    { passed: before.wallet === after.wallet, reason: "The re-read belongs to the same wallet." },
    { passed: Date.parse(after.timestamp) >= Date.parse(before.timestamp) && Date.parse(after.timestamp) >= Date.parse(execution.timestamp) && (before.blockNumber === undefined || after.blockNumber === undefined || after.blockNumber >= before.blockNumber), reason: "The re-read evidence has not moved backwards or preceded execution." },
    { passed: sourceBefore?.category === "RISK" && sourceAfter?.category === "RISK" && targetAfter?.category === "DEFENSIVE" && (!targetBefore || targetBefore.category === "DEFENSIVE"), reason: "The swap direction remains RISK → user-approved DEFENSIVE." },
    { passed: !!sourceBefore && !!sourceAfter && execution.sourceAmount !== undefined && close(sourceBefore.amount - sourceAfter.amount, execution.sourceAmount), reason: "The source balance reduction matches the execution receipt." },
    { passed: !!targetAfter && execution.targetAmount !== undefined && close(targetAfter.amount - (targetBefore?.amount ?? 0), execution.targetAmount), reason: "The defensive balance increase matches the execution receipt." },
    { passed: decision.reduceExposurePct !== undefined && close(executedExposurePoints, decision.reduceExposurePct), reason: "The executed source amount matches the approved percentage points at the market quote." },
    { passed: before.assets.every((asset) => {
      const current = after.assets.find((item) => item.symbol === asset.symbol);
      return !!current && current.category === asset.category && current.tokenAddress === asset.tokenAddress
        && (asset.symbol === decision.sourceAsset || asset.symbol === decision.targetAsset || close(asset.amount, current.amount));
    }) && after.assets.every((asset) => before.assets.some((item) => item.symbol === asset.symbol) || asset.symbol === decision.targetAsset), reason: "Asset identities and non-approved balances remain unchanged." },
    { passed: after.riskExposurePct < before.riskExposurePct, reason: `Risk exposure decreased from ${before.riskExposurePct}% to ${after.riskExposurePct}%.` },
  ];
  return { status: checks.every((check) => check.passed) ? "PASSED" : "FAILED", reasons: checks.map((check) => `${check.passed ? "Passed" : "Failed"}: ${check.reason}`) };
}
