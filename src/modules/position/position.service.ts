import { PositionStateSchema, WalletSchema } from "@/domain/schemas";
import type { PositionState } from "@/domain/types";
import type { PositionAdapter } from "./position.adapter";

export class PositionService {
  constructor(private readonly adapter: PositionAdapter) {}

  async getPosition(wallet: string): Promise<PositionState> {
    const requestedWallet = WalletSchema.parse(wallet);
    const position = PositionStateSchema.parse(await this.adapter.getPosition(requestedWallet));
    if (position.wallet !== requestedWallet) {
      throw new Error("Position adapter returned a different wallet.");
    }
    return position;
  }
}
