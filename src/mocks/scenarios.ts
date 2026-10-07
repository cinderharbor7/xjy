import { MarketStateSchema, PolicyConfigSchema, PolicyDecisionSchema, PortfolioStateSchema, WalletSchema } from "@/domain/schemas";
import type { MarketState, PolicyConfig, PolicyDecision, PortfolioState } from "@/domain/types";

export const DEMO_WALLET = "0x1111111111111111111111111111111111111111";
export const DEMO_INITIAL_ETH_PRICE = 3_000;
export const DEMO_SHOCK_ETH_PRICE = 2_700;
const policy = PolicyConfigSchema.parse({
  minRiskScore: 80, minConfidence: 0.85, minRiskExposurePct: 70, maxDeRiskPct: 30,
  allowedRiskAssets: ["ETH"], allowedDefensiveAssets: ["USDC"],
});
Object.freeze(policy.allowedRiskAssets);
Object.freeze(policy.allowedDefensiveAssets);
export const DEMO_POLICY_CONFIG: PolicyConfig = Object.freeze(policy);

/** Request-owned simulation of external balances and market prices; never a real wallet. */
export class MockScenarioState {
  private readonly wallet: string;
  private readonly config: PolicyConfig;
  private ethAmount = 10;
  private usdcAmount = 0;
  private ethPrice = DEMO_INITIAL_ETH_PRICE;
  private swapped = false;

  constructor(wallet: string, config: PolicyConfig = DEMO_POLICY_CONFIG, initial?: PortfolioState) {
    this.wallet = WalletSchema.parse(wallet);
    this.config = PolicyConfigSchema.parse(config);
    if (initial) {
      const validated = PortfolioStateSchema.parse(initial);
      const eth = validated.assets.find((asset) => asset.symbol === "ETH");
      const usdc = validated.assets.find((asset) => asset.symbol === "USDC");
      if (validated.wallet !== this.wallet || validated.assets.length !== 2 || !eth || !usdc
        || eth.category !== "RISK" || usdc.category !== "DEFENSIVE"
        || eth.usdValue !== eth.amount * DEMO_INITIAL_ETH_PRICE || usdc.usdValue !== usdc.amount) {
        throw new Error("Mock initial balances must describe ETH at $3000 and USDC at $1 for this wallet.");
      }
      this.ethAmount = eth.amount;
      this.usdcAmount = usdc.amount;
    }
  }

  getPortfolio(wallet: string): PortfolioState {
    if (WalletSchema.parse(wallet) !== this.wallet) throw new Error("Mock scenario wallet does not match this request.");
    const riskAssetUsd = this.ethAmount * this.ethPrice;
    const defensiveAssetUsd = this.usdcAmount;
    const totalUsd = riskAssetUsd + defensiveAssetUsd;
    return PortfolioStateSchema.parse({
      wallet: this.wallet, totalUsd, riskAssetUsd, defensiveAssetUsd,
      riskExposurePct: totalUsd === 0 ? 0 : riskAssetUsd / totalUsd * 100,
      assets: [
        { symbol: "ETH", amount: this.ethAmount, usdValue: riskAssetUsd, category: "RISK" },
        { symbol: "USDC", amount: this.usdcAmount, usdValue: defensiveAssetUsd, category: "DEFENSIVE" },
      ],
      timestamp: new Date().toISOString(),
    });
  }

  getMarketState(): MarketState {
    this.ethPrice = DEMO_SHOCK_ETH_PRICE;
    return MarketStateSchema.parse({
      asset: "ETH", priceUsd: this.ethPrice, priceChange5mPct: -3, priceChange1hPct: -10,
      volatilityScore: 82, timestamp: new Date().toISOString(),
    });
  }

  applySwap(decision: PolicyDecision): { sourceAmount: number; targetAmount: number } {
    const approved = PolicyDecisionSchema.parse(decision);
    if (!approved.triggered || approved.action !== "SWAP_TO_SAFE" || approved.sourceAsset !== "ETH" || approved.targetAsset !== "USDC"
      || !this.config.allowedRiskAssets.includes(approved.sourceAsset) || !this.config.allowedDefensiveAssets.includes(approved.targetAsset)
      || approved.reduceExposurePct === undefined || approved.reduceExposurePct > this.config.maxDeRiskPct) {
      throw new Error("Mock swap requires an approved ETH → user-approved USDC decision within the configured limit.");
    }
    if (this.swapped) throw new Error("Mock scenario swap has already been applied.");
    const current = this.getPortfolio(this.wallet);
    const sourceUsd = current.totalUsd * (approved.reduceExposurePct / 100);
    const sellsEntireBalance = approved.reduceExposurePct === current.riskExposurePct;
    if ((!sellsEntireBalance && sourceUsd > current.riskAssetUsd) || sourceUsd <= 0) throw new Error("Approved exposure reduction exceeds the available risk asset.");
    // Use the held quantity for full conversions instead of dividing rounded USD back into ETH.
    const sourceAmount = sellsEntireBalance ? this.ethAmount : sourceUsd / this.ethPrice;
    const targetAmount = sourceAmount * this.ethPrice; // Demo USDC=$1, no fees or slippage.
    const nextEthAmount = this.ethAmount - sourceAmount;
    const nextUsdcAmount = this.usdcAmount + targetAmount;
    const riskAssetUsd = nextEthAmount * this.ethPrice;
    const totalUsd = riskAssetUsd + nextUsdcAmount;
    // Validate the complete next snapshot before committing any simulated external state.
    PortfolioStateSchema.parse({
      ...current, totalUsd, riskAssetUsd, defensiveAssetUsd: nextUsdcAmount,
      riskExposurePct: totalUsd === 0 ? 0 : riskAssetUsd / totalUsd * 100,
      assets: [
        { symbol: "ETH", amount: nextEthAmount, usdValue: riskAssetUsd, category: "RISK" },
        { symbol: "USDC", amount: nextUsdcAmount, usdValue: nextUsdcAmount, category: "DEFENSIVE" },
      ],
    });
    this.ethAmount = nextEthAmount;
    this.usdcAmount = nextUsdcAmount;
    this.swapped = true;
    return { sourceAmount, targetAmount };
  }
}
