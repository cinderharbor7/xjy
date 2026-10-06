import { AavePositionStateSchema, WalletSchema } from "./schemas";
import type { AavePositionState } from "./types";
import type { PositionAdapter } from "./position.adapter";

export class PositionService {
  constructor(private readonly adapter: PositionAdapter) {}

  async getPosition(wallet: string): Promise<AavePositionState> {
    const requestedWallet = WalletSchema.parse(wallet);
    const position = AavePositionStateSchema.parse(await this.adapter.getPosition(requestedWallet));
    if (position.wallet !== requestedWallet) {
      throw new Error("Position adapter returned a different wallet.");
    }
    return position;
  }
}
