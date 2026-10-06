import { PortfolioStateSchema, StressTestResultSchema } from "@/domain/schemas";
import type { PortfolioState, StressTestResult } from "@/domain/types";

/** Demo-only common risk-asset shock; defensive-asset risks are not modeled. */
export function runStressTest(portfolio: PortfolioState, priceChangePct: number): StressTestResult {
  const current = PortfolioStateSchema.parse(portfolio);
  if (!Number.isFinite(priceChangePct) || priceChangePct < -100) {
    throw new Error("Price change must be finite and at least -100 percent.");
  }
  const projectedPortfolioUsd = current.riskAssetUsd * (1 + priceChangePct / 100) + current.defensiveAssetUsd;
  return StressTestResultSchema.parse({
    priceChangePct,
    projectedPortfolioUsd,
    projectedLossUsd: Math.max(0, current.totalUsd - projectedPortfolioUsd),
  });
}
