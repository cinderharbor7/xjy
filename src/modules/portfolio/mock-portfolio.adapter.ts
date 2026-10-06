import type { PortfolioState } from "@/domain/types";
import type { MockScenarioState } from "@/mocks/scenarios";
import type { PortfolioAdapter } from "./portfolio.adapter";

export class MockPortfolioAdapter implements PortfolioAdapter {
  constructor(private readonly state: MockScenarioState) {}
  async getPortfolio(wallet: string): Promise<PortfolioState> { return this.state.getPortfolio(wallet); }
}
