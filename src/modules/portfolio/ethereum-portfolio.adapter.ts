import { PortfolioStateSchema } from "@/domain/schemas";
import type { PortfolioState } from "@/domain/types";
import { ERC20_ABI, USDC_ADDRESS } from "../onchain/ethereum-contracts";
import { amountFromUnits, blockEvidence, validateWallet, type ReadResult, type SnapshotSource } from "../onchain/ethereum-reader";
import { EthereumReadError, withEthereumRead } from "../onchain/read-error";
import type { PortfolioAdapter } from "./portfolio.adapter";

/** Reads native ETH and USDC only; other tokens are outside this portfolio's scope. */
export class EthereumPortfolioAdapter implements PortfolioAdapter {
  constructor(private readonly source: SnapshotSource) {}

  async getPortfolio(wallet: string): Promise<PortfolioState> {
    return (await this.readPortfolio(wallet)).state;
  }

  async readPortfolio(wallet: string): Promise<ReadResult<PortfolioState>> {
    // Reject invalid live addresses before capturing a snapshot or calling the RPC.
    const requestedWallet = validateWallet(wallet);
    return withEthereumRead(async () => {
      const snapshot = await this.source();
      const block = { blockHash: snapshot.anchor.hash, requireCanonical: true } as const;
      const [ethRaw, usdcDecimals, usdcRaw, ethPrice, usdcPrice] = await Promise.all([
        snapshot.client.getBalance({ address: requestedWallet, ...block }),
        snapshot.client.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "decimals", ...block }),
        snapshot.client.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [requestedWallet], ...block }),
        snapshot.readUsdPrice("ETH"),
        snapshot.readUsdPrice("USDC"),
      ]);
      if (usdcDecimals !== 6) {
        throw new EthereumReadError("INVALID_CHAIN_DATA", "Ethereum returned inconsistent USDC decimals.");
      }
      const ethAmount = amountFromUnits(ethRaw, 18, "ETH balance");
      const usdcAmount = amountFromUnits(usdcRaw, usdcDecimals, "USDC balance");
      const riskAssetUsd = ethAmount * ethPrice.usd;
      const defensiveAssetUsd = usdcAmount * usdcPrice.usd;
      const totalUsd = riskAssetUsd + defensiveAssetUsd;
      const parsed = PortfolioStateSchema.safeParse({
        wallet: requestedWallet,
        totalUsd,
        riskAssetUsd,
        defensiveAssetUsd,
        riskExposurePct: totalUsd === 0 ? 0 : riskAssetUsd / totalUsd * 100,
        assets: [
          { symbol: "ETH", amount: ethAmount, usdValue: riskAssetUsd, category: "RISK" },
          { symbol: "USDC", tokenAddress: USDC_ADDRESS, amount: usdcAmount, usdValue: defensiveAssetUsd, category: "DEFENSIVE" },
        ],
        timestamp: snapshot.anchor.timestamp,
        blockNumber: Number(snapshot.anchor.number),
      });
      if (!parsed.success) {
        throw new EthereumReadError("INVALID_CHAIN_DATA", "Ethereum returned an inconsistent portfolio snapshot.");
      }
      const evidence = [
        blockEvidence(snapshot.anchor, `Native ETH balance for ${requestedWallet}: ${ethAmount} ETH.`),
        blockEvidence(snapshot.anchor, `USDC balance for ${requestedWallet}: ${usdcAmount} USDC.`, USDC_ADDRESS),
        ethPrice.evidence,
        usdcPrice.evidence,
      ];
      await snapshot.verifyCanonical();
      return { state: parsed.data, evidence };
    });
  }
}
