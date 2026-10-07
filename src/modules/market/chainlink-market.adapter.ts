import { MarketStateSchema, OnchainEvidenceSchema } from "@/domain/schemas";
import type { MarketState, OnchainEvidence } from "@/domain/types";
import { ETH_USD_FEED } from "../onchain/ethereum-contracts";
import type { EthereumBlock, ReadResult, SnapshotSource } from "../onchain/ethereum-reader";
import { EthereumReadError, withEthereumRead } from "../onchain/read-error";
import type { MarketAdapter } from "./market.adapter";

function observationEvidence(evidence: OnchainEvidence, block: EthereumBlock, label: string): OnchainEvidence {
  const parsed = OnchainEvidenceSchema.safeParse(evidence);
  if (!parsed.success || parsed.data.type !== "BLOCK"
    || parsed.data.blockHash.toLowerCase() !== block.hash.toLowerCase()
    || parsed.data.blockNumber !== Number(block.number)
    || parsed.data.contractAddress?.toLowerCase() !== ETH_USD_FEED.toLowerCase()) {
    throw new EthereumReadError("INVALID_CHAIN_DATA", "The ETH market quote does not match its Ethereum observation evidence.");
  }
  // The reader's cached evidence is frozen; labels belong to this market response.
  return { ...parsed.data, description: `${label}; ${parsed.data.description}` };
}

export class ChainlinkMarketAdapter implements MarketAdapter {
  constructor(private readonly source: SnapshotSource) {}

  async getMarketState(): Promise<MarketState> {
    return (await this.readMarket()).state;
  }

  async readMarket(): Promise<ReadResult<MarketState>> {
    return withEthereumRead(async () => {
      const snapshot = await this.source();
      const fiveMinuteTarget = snapshot.anchor.seconds - 300;
      const oneHourTarget = snapshot.anchor.seconds - 3_600;
      const [fiveMinuteBlock, oneHourBlock] = await Promise.all([
        snapshot.atOrBefore(fiveMinuteTarget), snapshot.atOrBefore(oneHourTarget),
      ]);
      const [current, fiveMinute, oneHour] = await Promise.all([
        snapshot.readUsdPrice("ETH"), snapshot.readUsdPrice("ETH", fiveMinuteBlock), snapshot.readUsdPrice("ETH", oneHourBlock),
      ]);
      if ([current, fiveMinute, oneHour].some((quote) => !Number.isFinite(quote.usd) || quote.usd <= 0 || quote.usd > Number.MAX_SAFE_INTEGER)) {
        throw new EthereumReadError("INVALID_CHAIN_DATA", "The ETH market requires valid positive dollar quotes at all three observation points.");
      }
      const priceChange5mPct = (current.usd / fiveMinute.usd - 1) * 100;
      const priceChange1hPct = (current.usd / oneHour.usd - 1) * 100;
      const parsed = MarketStateSchema.safeParse({
        asset: "ETH", priceUsd: current.usd, priceChange5mPct, priceChange1hPct,
        // User-approved absolute price-change proxy, not statistical volatility.
        volatilityScore: Math.min(100, Math.abs(priceChange1hPct) * 10), timestamp: snapshot.anchor.timestamp,
      });
      if (!parsed.success) throw new EthereumReadError("INVALID_CHAIN_DATA", "Unable to form a valid ETH market observation from the required oracle prices.");
      const evidence = [
        observationEvidence(current.evidence, snapshot.anchor, "CURRENT ETH/USD oracle snapshot; volatilityScore uses the absolute 1h oracle-change proxy"),
        observationEvidence(fiveMinute.evidence, fiveMinuteBlock, `5m ETH/USD target=${new Date(fiveMinuteTarget * 1000).toISOString()}, actualBlockTimestamp=${fiveMinuteBlock.timestamp}`),
        observationEvidence(oneHour.evidence, oneHourBlock, `1h ETH/USD target=${new Date(oneHourTarget * 1000).toISOString()}, actualBlockTimestamp=${oneHourBlock.timestamp}`),
      ];
      await snapshot.verifyCanonical();
      return { state: parsed.data, evidence };
    });
  }
}
