import { WalletSchema } from "@/domain/schemas";
import type { PolicyConfig, RescueSession } from "@/domain/types";
import { DEMO_POLICY_CONFIG, MockScenarioState } from "@/mocks/scenarios";
import { MockPositionAdapter } from "@/modules/position/mock-position.adapter";
import { PositionService } from "@/modules/position/position.service";
import { RiskService } from "@/modules/risk/risk.service";
import { MockInvestigationAdapter } from "@/modules/investigation/mock-investigation.adapter";
import { InvestigationService } from "@/modules/investigation/investigation.service";
import { PolicyService } from "@/modules/policy/policy.service";
import { MockExecutionAdapter } from "@/modules/execution/mock-execution.adapter";
import { ExecutionService } from "@/modules/execution/execution.service";
import { RescueOrchestrator } from "@/modules/rescue/rescue.orchestrator";

/** Composition root: the only place where the concrete adapters are chosen. */
export function createMockRescueOrchestrator(wallet: string, policyConfig: PolicyConfig = DEMO_POLICY_CONFIG): RescueOrchestrator {
  const state = new MockScenarioState(WalletSchema.parse(wallet));
  return new RescueOrchestrator({
    positionService: new PositionService(new MockPositionAdapter(state)),
    riskService: new RiskService(),
    investigationService: new InvestigationService(new MockInvestigationAdapter()),
    policyService: new PolicyService(policyConfig),
    executionService: new ExecutionService(new MockExecutionAdapter(state)),
  });
}

export async function runRescueSession(wallet: string): Promise<RescueSession> {
  const mode = process.env.MOCK_MODE ?? "true";
  if (mode !== "true") {
    throw new Error(mode === "false"
      ? "MOCK_MODE=false is unsupported: real adapters have not been implemented."
      : "MOCK_MODE must be true for this demo.");
  }
  // A fresh state per request keeps repeated and concurrent demo runs independent.
  return createMockRescueOrchestrator(wallet).runRescueSession(wallet);
}
