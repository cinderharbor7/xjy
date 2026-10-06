import { PositionStateSchema, StressTestResultSchema } from "@/domain/schemas";
import type { PositionState, StressTestResult } from "@/domain/types";

/** Demo-only linear price shock; it does not model Aave liquidation parameters. */
export function runStressTest(position: PositionState, ethChangePct: number): StressTestResult {
  const current = PositionStateSchema.parse(position);
  if (!Number.isFinite(ethChangePct) || ethChangePct < -100) {
    throw new Error("ETH price change must be finite and at least -100 percent.");
  }
  const projectedHealthFactor = Number((current.healthFactor * (1 + ethChangePct / 100)).toFixed(2));
  return StressTestResultSchema.parse({
    ethChangePct,
    projectedHealthFactor,
    liquidationRisk: current.debtUsd > 0 && projectedHealthFactor <= 1,
  });
}
