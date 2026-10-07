import { PortfolioStateSchema, WalletSchema } from "@/domain/schemas";
import type { PortfolioState } from "@/domain/types";
import type { PortfolioAdapter } from "./portfolio.adapter";

export class PortfolioService {
  constructor(private readonly adapter: PortfolioAdapter) {}

  async getPortfolio(wallet: string): Promise<PortfolioState> {
    const requested = WalletSchema.parse(wallet);
    const portfolio = PortfolioStateSchema.parse(await this.adapter.getPortfolio(requested));
    if (portfolio.wallet !== requested) throw new Error("Portfolio adapter returned a different wallet.");
    return portfolio;
  }
}
