import { OnchainSignalStateSchema } from "@/domain/schemas";
import type { OnchainSignalState } from "@/domain/types";
import type { OnchainSignalAdapter } from "./onchain-signal.adapter";
import { EthereumReadError, withEthereumRead } from "./read-error";

export class OnchainSignalService {
  constructor(private readonly adapter: OnchainSignalAdapter) {}

  async getSignal(): Promise<OnchainSignalState> {
    return withEthereumRead(async () => {
      const result = OnchainSignalStateSchema.safeParse(await this.adapter.getSignal());
      if (!result.success) throw new EthereumReadError("INVALID_CHAIN_DATA", "The onchain signal does not satisfy its frozen contract.");
      return result.data;
    });
  }
}
