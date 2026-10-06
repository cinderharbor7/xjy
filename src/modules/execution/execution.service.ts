import { ExecutionResultSchema, PolicyDecisionSchema } from "@/domain/schemas";
import type { ExecutionResult, PolicyDecision } from "@/domain/types";
import type { ExecutionAdapter } from "./execution.adapter";

export class ExecutionService {
  constructor(private readonly adapter: ExecutionAdapter) {}

  async execute(decision: PolicyDecision): Promise<ExecutionResult> {
    const approved = PolicyDecisionSchema.parse(decision);
    if (!approved.triggered || approved.action !== "REPAY" || approved.repayAmountUsd <= 0) {
      throw new Error("Execution requires a policy-approved positive REPAY.");
    }

    // Capture the authorization before passing a copy to an external adapter.
    const approvedAction = approved.action;
    const approvedAmountUsd = approved.repayAmountUsd;
    const result = ExecutionResultSchema.parse(await this.adapter.repay(approved));
    if (result.action !== approvedAction || result.amountUsd !== approvedAmountUsd) {
      throw new Error("Execution result must match the policy-approved action and amount.");
    }
    return result;
  }
}
