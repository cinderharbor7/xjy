import { PolicyConfigSchema, PolicyDecisionSchema, PositionStateSchema, WalletSchema } from "@/domain/schemas";
import type { PolicyConfig, PolicyDecision, PositionState } from "@/domain/types";

export const DEMO_WALLET = "0x1111111111111111111111111111111111111111";

// Demo parameters only; they are not production financial advice or limits.
export const DEMO_POLICY_CONFIG: PolicyConfig = Object.freeze(PolicyConfigSchema.parse({
  maxHealthFactorForTrigger: 1.15,
  minRiskScore: 80,
  minConfidence: 0.85,
  maxRepayUsd: 20_000,
}));

/** Simulated external position state, owned by one rescue request. */
export class MockScenarioState {
  private readonly wallet: string;
  private repaid = false;

  constructor(wallet: string) {
    this.wallet = WalletSchema.parse(wallet);
  }

  getPosition(wallet: string): PositionState {
    if (WalletSchema.parse(wallet) !== this.wallet) {
      throw new Error("Mock scenario wallet does not match this request.");
    }

    return PositionStateSchema.parse({
      wallet: this.wallet,
      collateralUsd: 200_000,
      debtUsd: this.repaid ? 80_000 : 100_000,
      healthFactor: this.repaid ? 1.34 : 1.08,
      ethPrice: 2_800,
      timestamp: new Date().toISOString(),
    });
  }

  applyRepay(decision: PolicyDecision): void {
    const approved = PolicyDecisionSchema.parse(decision);
    if (!approved.triggered || approved.action !== "REPAY" || approved.repayAmountUsd !== 20_000) {
      throw new Error("Mock scenario only supports an approved $20,000 REPAY.");
    }
    if (this.repaid) {
      throw new Error("Mock scenario REPAY has already been applied.");
    }
    this.repaid = true;
  }
}
