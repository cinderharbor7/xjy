import type { MarketState } from "@/domain/types";

export interface MarketAdapter {
  getMarketState(): Promise<MarketState>;
}
