import {
  ExecutionResultSchema, InvestigationResultSchema, PolicyDecisionSchema,
  PositionStateSchema, RescueSessionSchema, RiskAnalysisSchema, WalletSchema,
} from "@/domain/schemas";
import type { RescueSession } from "@/domain/types";
import type { PositionService } from "../position/position.service";
import type { RiskService } from "../risk/risk.service";
import type { InvestigationService } from "../investigation/investigation.service";
import type { PolicyService } from "../policy/policy.service";
import type { ExecutionService } from "../execution/execution.service";

export interface RescueServices {
  positionService: Pick<PositionService, "getPosition">;
  riskService: Pick<RiskService, "analyze">;
  investigationService: Pick<InvestigationService, "investigate">;
  policyService: Pick<PolicyService, "evaluate">;
  executionService: Pick<ExecutionService, "execute">;
}

/** Owns sequencing only. External adapters are supplied by the integration layer. */
export class RescueOrchestrator {
  constructor(private readonly services: RescueServices) {}

  async runRescueSession(wallet: string): Promise<RescueSession> {
    const requestedWallet = WalletSchema.parse(wallet);
    const before = PositionStateSchema.parse(await this.services.positionService.getPosition(requestedWallet));
    const preliminaryRisk = RiskAnalysisSchema.parse(this.services.riskService.analyze(before));
    const investigation = InvestigationResultSchema.parse(
      await this.services.investigationService.investigate(before, preliminaryRisk),
    );
    const riskAnalysis = RiskAnalysisSchema.parse({
      ...preliminaryRisk,
      investigation,
      confidence: investigation.confidence,
    });
    const policyDecision = PolicyDecisionSchema.parse(this.services.policyService.evaluate(before, riskAnalysis));

    if (!policyDecision.triggered) {
      return RescueSessionSchema.parse({
        before, riskAnalysis, policyDecision,
        execution: {
          success: false, action: "NONE", amountUsd: 0,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const execution = ExecutionResultSchema.parse(await this.services.executionService.execute(policyDecision));
    // Executor never supplies after/HF. Always read the position adapter again after success.
    const after = execution.success
      ? PositionStateSchema.parse(await this.services.positionService.getPosition(requestedWallet))
      : undefined;

    return RescueSessionSchema.parse({ before, riskAnalysis, policyDecision, execution, ...(after ? { after } : {}) });
  }
}
