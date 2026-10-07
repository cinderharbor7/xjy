import type { MarketState } from "@/domain/types";
import type { MockScenarioState } from "@/mocks/scenarios";
import type { MarketAdapter } from "./market.adapter";

export class MockMarketAdapter implements MarketAdapter {
  constructor(private readonly state: MockScenarioState) {}
  async getMarketState(): Promise<MarketState> { return this.state.getMarketState(); }
}
