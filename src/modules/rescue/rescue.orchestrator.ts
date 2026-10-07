import {
  ExecutionResultSchema, InvestigationResultSchema, MarketStateSchema, PolicyDecisionSchema,
  PortfolioStateSchema, RescueSessionSchema, RiskAnalysisSchema, WalletSchema,
} from "@/domain/schemas";
import type { RescueSession } from "@/domain/types";
import { verifyRescueOutcome } from "@/domain/verification";
import type { PortfolioService } from "../portfolio/portfolio.service";
import type { MarketService } from "../market/market.service";
import type { RiskService } from "../risk/risk.service";
import type { InvestigationService } from "../investigation/investigation.service";
import type { PolicyService } from "../policy/policy.service";
import type { ExecutionService } from "../execution/execution.service";

export interface RescueServices {
  portfolioService: Pick<PortfolioService, "getPortfolio">;
  marketService: Pick<MarketService, "getMarketState">;
  riskService: Pick<RiskService, "analyze">;
  investigationService: Pick<InvestigationService, "investigate">;
  policyService: Pick<PolicyService, "evaluate">;
  executionService: Pick<ExecutionService, "execute">;
}

/** Owns sequencing and independent verification; adapters are chosen by integration. */
export class RescueOrchestrator {
  constructor(private readonly services: RescueServices) {}

  async runRescueSession(wallet: string): Promise<RescueSession> {
    return this.executeAnalysis(await this.analyze(wallet));
  }

  /** Read-only phase; monitoring can inspect recovery without authorizing another swap. */
  async analyze(wallet: string): Promise<Pick<RescueSession, "before" | "market" | "riskAnalysis" | "policyDecision">> {
    const requestedWallet = WalletSchema.parse(wallet);
    const before = PortfolioStateSchema.parse(await this.services.portfolioService.getPortfolio(requestedWallet));
    if (before.wallet !== requestedWallet) throw new Error("Portfolio does not belong to the requested wallet.");
    const market = MarketStateSchema.parse(await this.services.marketService.getMarketState());
    const preliminaryRisk = RiskAnalysisSchema.parse(this.services.riskService.analyze(before, market));
    const investigation = InvestigationResultSchema.parse(
      await this.services.investigationService.investigate(before, market, preliminaryRisk),
    );
    const riskAnalysis = RiskAnalysisSchema.parse({
      ...preliminaryRisk, investigation, confidence: investigation.confidence,
    });
    const policyDecision = PolicyDecisionSchema.parse(this.services.policyService.evaluate(before, riskAnalysis));

    return { before, market, riskAnalysis, policyDecision };
  }

  /** Integration reserves the durable event before entering the execution phase. */
  async executeAnalysis(analysis: Pick<RescueSession, "before" | "market" | "riskAnalysis" | "policyDecision">): Promise<RescueSession> {
    const { before, market, riskAnalysis, policyDecision } = analysis;
    const requestedWallet = before.wallet;

    const execution = policyDecision.triggered
      ? ExecutionResultSchema.parse(await this.services.executionService.execute(PolicyDecisionSchema.parse(policyDecision)))
      : ExecutionResultSchema.parse({ success: false, action: "NONE", timestamp: new Date().toISOString() });

    // The Executor supplies a receipt only. Balances must come from a fresh Portfolio read.
    const after = execution.success
      ? PortfolioStateSchema.parse(await this.services.portfolioService.getPortfolio(requestedWallet))
      : undefined;
    const verification = verifyRescueOutcome(before, after, policyDecision, execution, market);
    return RescueSessionSchema.parse({
      before, market, riskAnalysis, policyDecision, execution, ...(after ? { after } : {}), verification,
    });
  }
}
