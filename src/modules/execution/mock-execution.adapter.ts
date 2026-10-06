import { ExecutionResultSchema, PolicyDecisionSchema } from "@/domain/schemas";
import type { ExecutionResult, PolicyDecision } from "@/domain/types";
import type { MockScenarioState } from "@/mocks/scenarios";
import type { ExecutionAdapter } from "./execution.adapter";

// The repeated bytes spell "mock"; this is never a broadcast transaction.
const MOCK_TX_HASH = `0x${"6d6f636b".repeat(8)}`;

export class MockExecutionAdapter implements ExecutionAdapter {
  constructor(private readonly state: MockScenarioState) {}

  async repay(decision: PolicyDecision): Promise<ExecutionResult> {
    const approved = PolicyDecisionSchema.parse(decision);
    if (!approved.triggered || approved.action !== "REPAY") {
      throw new Error("Mock repayment requires an approved REPAY decision.");
    }
    this.state.applyRepay(approved);
    return ExecutionResultSchema.parse({
      success: true,
      action: "REPAY",
      amountUsd: approved.repayAmountUsd,
      txHash: MOCK_TX_HASH,
      timestamp: new Date().toISOString(),
    });
  }
}
