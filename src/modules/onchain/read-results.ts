import { z } from "zod";
import { MarketStateSchema, OnchainEvidenceSchema, OnchainSignalStateSchema, PortfolioStateSchema } from "@/domain/schemas";
import { UNISWAP_POOL_ADDRESS } from "./ethereum-contracts";

// Presentation metadata is outside the frozen domain DTOs.
export const LIVE_READ_SCOPE = {
  portfolioAssets: ["ETH_NATIVE", "USDC"],
  marketSource: "CHAINLINK_ETH_USD",
  volatilityDefinition: "min(100, abs(priceChange1hPct) * 10); price-change proxy, not statistical volatility",
  signalPool: UNISWAP_POOL_ADDRESS,
  signalWindowSeconds: 300,
  signalDefinition: "Single-pool WETH gross sells normalized to ETH; actual USDC output valued at event-block Chainlink USDC/USD",
} as const;
const scope = z.strictObject({
  portfolioAssets: z.tuple([z.literal("ETH_NATIVE"), z.literal("USDC")]),
  marketSource: z.literal(LIVE_READ_SCOPE.marketSource),
  volatilityDefinition: z.literal(LIVE_READ_SCOPE.volatilityDefinition),
  signalPool: z.literal(UNISWAP_POOL_ADDRESS),
  signalWindowSeconds: z.literal(300),
  signalDefinition: z.literal(LIVE_READ_SCOPE.signalDefinition),
});
const metadata = { mode: z.literal("LIVE_READ_ONLY"), network: z.literal("ethereum-mainnet"), scope };
const portfolio = z.strictObject({ state: PortfolioStateSchema, evidence: z.array(OnchainEvidenceSchema) });
const market = z.strictObject({ state: MarketStateSchema, evidence: z.array(OnchainEvidenceSchema) });

export const EthereumDataResultSchema = z.discriminatedUnion("section", [
  z.strictObject({ ...metadata, section: z.literal("portfolio"), portfolio }),
  z.strictObject({ ...metadata, section: z.literal("market"), market }),
  z.strictObject({ ...metadata, section: z.literal("signal"), signal: OnchainSignalStateSchema }),
  z.strictObject({ ...metadata, section: z.literal("all"), portfolio, market, signal: OnchainSignalStateSchema }),
]);
export type EthereumDataResult = z.infer<typeof EthereumDataResultSchema>;
export type ReadSection = EthereumDataResult["section"];
export type ReadRequest = { section: ReadSection; wallet?: string };
