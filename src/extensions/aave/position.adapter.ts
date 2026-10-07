import type { AavePositionState } from "./types";

export interface PositionAdapter {
  getPosition(wallet: string): Promise<AavePositionState>;
}
