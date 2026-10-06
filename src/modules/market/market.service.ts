import { MarketStateSchema } from "@/domain/schemas";
import type { MarketState } from "@/domain/types";
import type { MarketAdapter } from "./market.adapter";

export class MarketService {
  constructor(private readonly adapter: MarketAdapter) {}
  async getMarketState(): Promise<MarketState> { return MarketStateSchema.parse(await this.adapter.getMarketState()); }
}
