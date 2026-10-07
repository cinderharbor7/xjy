import { ExecutionResultSchema, PolicyConfigSchema } from "@/domain/schemas";
import type { ExecutionResult, PolicyConfig, PolicyDecision } from "@/domain/types";
import type { MockScenarioState } from "@/mocks/scenarios";
import type { ExecutionAdapter } from "./execution.adapter";
import { validateApprovedSwap } from "./approved-swap";

// The repeated bytes spell "mock"; this is never a broadcast transaction.
const MOCK_TX_HASH = `0x${"6d6f636b".repeat(8)}`;

export class MockExecutionAdapter implements ExecutionAdapter {
  private readonly config: PolicyConfig;

  constructor(private readonly state: MockScenarioState, trustedConfig: PolicyConfig) {
    this.config = PolicyConfigSchema.parse(trustedConfig);
  }

  async execute(decision: PolicyDecision): Promise<ExecutionResult> {
    const approved = validateApprovedSwap(decision, this.config);
    const amounts = this.state.applySwap(approved);
    return ExecutionResultSchema.parse({
      success: true,
      action: "SWAP_TO_SAFE",
      sourceAsset: approved.sourceAsset,
      targetAsset: approved.targetAsset,
      ...amounts,
      txHash: MOCK_TX_HASH,
      timestamp: new Date().toISOString(),
    });
  }
}
