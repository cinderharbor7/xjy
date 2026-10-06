import type { PortfolioState } from "@/domain/types";

export interface PortfolioAdapter {
  getPortfolio(wallet: string): Promise<PortfolioState>;
}
