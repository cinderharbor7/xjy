import type { ExecutionResult, PolicyDecision } from "@/domain/types";

export interface ExecutionAdapter {
  repay(decision: PolicyDecision): Promise<ExecutionResult>;
}
