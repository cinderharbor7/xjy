import { ExecutionResultSchema, PolicyConfigSchema } from "@/domain/schemas";
import type { ExecutionResult, PolicyConfig, PolicyDecision } from "@/domain/types";
import type { ExecutionAdapter } from "./execution.adapter";
import { validateApprovedSwap } from "./approved-swap";

export class ExecutionService {
  private readonly config: PolicyConfig;

  constructor(private readonly adapter: ExecutionAdapter, trustedConfig: PolicyConfig) {
    this.config = PolicyConfigSchema.parse(trustedConfig);
  }

  async execute(decision: PolicyDecision): Promise<ExecutionResult> {
    const approved = validateApprovedSwap(decision, this.config);

    // Capture the authorization before passing a copy to an external adapter.
    const approvedAction = approved.action;
    const approvedSource = approved.sourceAsset;
    const approvedTarget = approved.targetAsset;
    const approvedReduction = approved.reduceExposurePct;
    const result = ExecutionResultSchema.parse(await this.adapter.execute(approved));
    if (approved.action !== approvedAction || approved.sourceAsset !== approvedSource || approved.targetAsset !== approvedTarget
      || approved.reduceExposurePct !== approvedReduction
      || result.action !== approvedAction || result.sourceAsset !== approvedSource || result.targetAsset !== approvedTarget) {
      throw new Error("Execution result and adapter input must match the original policy-approved action, assets and reduction.");
    }
    return result;
  }
}
