import type { PositionState } from "@/domain/types";
import type { MockScenarioState } from "@/mocks/scenarios";
import type { PositionAdapter } from "./position.adapter";

export class MockPositionAdapter implements PositionAdapter {
  constructor(private readonly state: MockScenarioState) {}

  async getPosition(wallet: string): Promise<PositionState> {
    return this.state.getPosition(wallet);
  }
}
