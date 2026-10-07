import { WalletSchema } from "@/domain/schemas";
import type { PolicyConfig, RescueSession } from "@/domain/types";
import { DEMO_POLICY_CONFIG, MockScenarioState } from "@/mocks/scenarios";
import { MockPortfolioAdapter } from "@/modules/portfolio/mock-portfolio.adapter";
import { PortfolioService } from "@/modules/portfolio/portfolio.service";
import { MockMarketAdapter } from "@/modules/market/mock-market.adapter";
import { MarketService } from "@/modules/market/market.service";
import { RiskService } from "@/modules/risk/risk.service";
import { MockInvestigationAdapter } from "@/modules/investigation/mock-investigation.adapter";
import { InvestigationService } from "@/modules/investigation/investigation.service";
import { PolicyService } from "@/modules/policy/policy.service";
import { MockExecutionAdapter } from "@/modules/execution/mock-execution.adapter";
import { ExecutionService } from "@/modules/execution/execution.service";
import { RescueOrchestrator } from "@/modules/rescue/rescue.orchestrator";

/** Composition root: core services never choose or inspect concrete adapters. */
export function createMockRescueOrchestrator(wallet: string, policyConfig: PolicyConfig = DEMO_POLICY_CONFIG): RescueOrchestrator {
  const state = new MockScenarioState(WalletSchema.parse(wallet), policyConfig);
  return new RescueOrchestrator({
    portfolioService: new PortfolioService(new MockPortfolioAdapter(state)),
    marketService: new MarketService(new MockMarketAdapter(state)),
    riskService: new RiskService(),
    investigationService: new InvestigationService(new MockInvestigationAdapter()),
    policyService: new PolicyService(policyConfig),
    executionService: new ExecutionService(new MockExecutionAdapter(state, policyConfig), policyConfig),
  });
}

export async function runRescueSession(wallet: string): Promise<RescueSession> {
  const { getGuardian } = await import("./guardian/runtime");
  const monitor = getGuardian();
  monitor.assertWallet(wallet);
  const session = await monitor.tick(true);
  if (!session) throw new Error("No session available.");
  return session;
}
