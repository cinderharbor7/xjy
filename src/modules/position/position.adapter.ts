import type { PositionState } from "@/domain/types";

export interface PositionAdapter {
  getPosition(wallet: string): Promise<PositionState>;
}
