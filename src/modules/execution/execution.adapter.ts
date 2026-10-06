import type { ExecutionResult, PolicyDecision } from "@/domain/types";

export interface ExecutionAdapter {
  execute(decision: PolicyDecision): Promise<ExecutionResult>;
}
