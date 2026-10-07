import { parseAbi, zeroAddress, type Address, type Hash, type PublicClient } from "viem";
import { PortfolioStateSchema } from "@/domain/schemas";
import type { PortfolioState } from "@/domain/types";
import { ERC20_ABI } from "./ethereum-contracts";
import { amountFromUnits, validateWallet } from "./ethereum-reader";
import { EthereumReadError, withEthereumRead } from "./read-error";

const FACTORY_ABI = parseAbi(["function getPair(address,address) view returns (address)"]);
const PAIR_ABI = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)",
]);

export type ForkObservationClient = Pick<PublicClient, "getChainId" | "getBlock" | "readContract">;
export interface ForkObservationConfig {
  chainId: number;
  wallet: Address;
  factory: Address;
  weth: { address: Address; decimals: number };
  usdc: { address: Address; decimals: number };
}
export interface ForkObservation {
  portfolio: PortfolioState;
  priceUsd: number;
  block: { number: number; hash: string; timestamp: string };
}

const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const maxReserve = (1n << 112n) - 1n;
const maxBlockSeconds = 253_402_300_799n;

function sameAddress(value: unknown, expected: string): boolean {
  return typeof value === "string" && addressPattern.test(value) && value.toLowerCase() === expected.toLowerCase();
}

function contractAddress(value: unknown): value is Address {
  return typeof value === "string" && addressPattern.test(value) && value.toLowerCase() !== zeroAddress;
}

function invalid(message: string): never {
  throw new EthereumReadError("INVALID_CHAIN_DATA", message);
}

function readBlock(value: unknown): { number: bigint; hash: Hash; seconds: bigint; timestamp: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("The Fork returned invalid block evidence.");
  const block = value as { number?: unknown; hash?: unknown; timestamp?: unknown };
  if (typeof block.number !== "bigint" || block.number < 0n || block.number > BigInt(Number.MAX_SAFE_INTEGER)
    || typeof block.hash !== "string" || !hashPattern.test(block.hash)
    || typeof block.timestamp !== "bigint" || block.timestamp < 0n || block.timestamp > maxBlockSeconds) {
    invalid("The Fork returned invalid block evidence.");
  }
  return { number: block.number, hash: block.hash as Hash, seconds: block.timestamp,
    timestamp: new Date(Number(block.timestamp) * 1000).toISOString() };
}

/** Reads tradable WETH/USDC only. USDC=$1 is the Fork demo valuation assumption, not an oracle quote. */
export class ForkObservationReader {
  private readonly config: ForkObservationConfig;

  constructor(private readonly client: ForkObservationClient, config: ForkObservationConfig) {
    if (!config || !Number.isSafeInteger(config.chainId) || config.chainId <= 0
      || typeof config.wallet !== "string" || !addressPattern.test(config.wallet)
      || !contractAddress(config.factory) || !config.weth || !config.usdc
      || !contractAddress(config.weth.address) || !contractAddress(config.usdc.address)
      || sameAddress(config.weth.address, config.usdc.address)
      || config.weth.decimals !== 18 || config.usdc.decimals !== 6) {
      throw new EthereumReadError("CONFIGURATION_ERROR", "Configure one Fork wallet, a V2 factory, 18-decimal WETH and 6-decimal USDC.");
    }
    this.config = { ...config, weth: { ...config.weth }, usdc: { ...config.usdc } };
  }

  async read(wallet: string): Promise<ForkObservation> {
    const requested = validateWallet(wallet);
    if (!sameAddress(requested, this.config.wallet)) {
      throw new EthereumReadError("INVALID_WALLET", "Only the configured Fork wallet can be read.");
    }
    return withEthereumRead(async () => {
      const { chainId, wallet: owner, factory, weth, usdc } = this.config;
      if (await this.client.getChainId() !== chainId) {
        throw new EthereumReadError("UNSUPPORTED_NETWORK", "The Fork RPC chain does not match the configured chain.");
      }
      const anchor = readBlock(await this.client.getBlock({ blockTag: "latest" }));
      const at = { blockHash: anchor.hash, requireCanonical: true } as const;
      const pair = await this.client.readContract({ address: factory, abi: FACTORY_ABI, functionName: "getPair", args: [weth.address, usdc.address], ...at });
      if (!contractAddress(pair)) invalid("The configured Fork asset pair does not exist.");
      const [token0, token1, reserves, wethDecimals, usdcDecimals, wethRaw, usdcRaw] = await Promise.all([
        this.client.readContract({ address: pair, abi: PAIR_ABI, functionName: "token0", ...at }),
        this.client.readContract({ address: pair, abi: PAIR_ABI, functionName: "token1", ...at }),
        this.client.readContract({ address: pair, abi: PAIR_ABI, functionName: "getReserves", ...at }),
        this.client.readContract({ address: weth.address, abi: ERC20_ABI, functionName: "decimals", ...at }),
        this.client.readContract({ address: usdc.address, abi: ERC20_ABI, functionName: "decimals", ...at }),
        this.client.readContract({ address: weth.address, abi: ERC20_ABI, functionName: "balanceOf", args: [owner], ...at }),
        this.client.readContract({ address: usdc.address, abi: ERC20_ABI, functionName: "balanceOf", args: [owner], ...at }),
      ]);
      const wethFirst = sameAddress(token0, weth.address) && sameAddress(token1, usdc.address);
      const usdcFirst = sameAddress(token0, usdc.address) && sameAddress(token1, weth.address);
      if (!wethFirst && !usdcFirst) invalid("The Fork pair does not contain exactly the approved WETH and USDC assets.");
      if (wethDecimals !== weth.decimals || usdcDecimals !== usdc.decimals) invalid("The Fork token decimals do not match the configured assets.");
      if (!Array.isArray(reserves) || reserves.length !== 3
        || reserves.slice(0, 2).some((value) => typeof value !== "bigint" || value <= 0n || value > maxReserve)
        || !Number.isSafeInteger(reserves[2]) || reserves[2] < 0 || reserves[2] > 0xffff_ffff) {
        invalid("The Fork pair returned invalid or empty reserves.");
      }
      const wethReserve = amountFromUnits(reserves[wethFirst ? 0 : 1], wethDecimals, "Fork WETH reserve");
      const usdcReserve = amountFromUnits(reserves[wethFirst ? 1 : 0], usdcDecimals, "Fork USDC reserve");
      const priceUsd = usdcReserve / wethReserve;
      if (!Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd > Number.MAX_SAFE_INTEGER) invalid("The Fork pair returned an unsupported WETH quote.");
      const amount = amountFromUnits(wethRaw, wethDecimals, "Fork WETH balance");
      const safeAmount = amountFromUnits(usdcRaw, usdcDecimals, "Fork USDC balance");
      const riskAssetUsd = amount * priceUsd;
      const totalUsd = riskAssetUsd + safeAmount;
      if (!Number.isFinite(riskAssetUsd) || !Number.isFinite(totalUsd) || totalUsd > Number.MAX_SAFE_INTEGER) invalid("The Fork portfolio value exceeds the supported numeric range.");
      const parsed = PortfolioStateSchema.safeParse({
        wallet: owner, totalUsd, riskAssetUsd, defensiveAssetUsd: safeAmount,
        riskExposurePct: totalUsd === 0 ? 0 : riskAssetUsd / totalUsd * 100,
        timestamp: anchor.timestamp, blockNumber: Number(anchor.number),
        assets: [
          { symbol: "ETH", tokenAddress: weth.address, amount, usdValue: riskAssetUsd, category: "RISK" },
          { symbol: "USDC", tokenAddress: usdc.address, amount: safeAmount, usdValue: safeAmount, category: "DEFENSIVE" },
        ],
      });
      if (!parsed.success) invalid("The Fork observation does not satisfy the portfolio contract.");
      // Fresh RPC read by number, never the initially captured block or a cached balance.
      const canonical = readBlock(await this.client.getBlock({ blockNumber: anchor.number }));
      if (canonical.number !== anchor.number) invalid("The Fork returned an inconsistent canonical block number.");
      if (canonical.hash.toLowerCase() !== anchor.hash.toLowerCase()) {
        throw new EthereumReadError("REORG_DETECTED", "The captured Fork block is no longer canonical. Run a new observation.");
      }
      if (canonical.seconds !== anchor.seconds) invalid("The Fork returned inconsistent canonical block timestamps.");
      return { portfolio: parsed.data, priceUsd, block: { number: Number(anchor.number), hash: anchor.hash, timestamp: anchor.timestamp } };
    });
  }
}
