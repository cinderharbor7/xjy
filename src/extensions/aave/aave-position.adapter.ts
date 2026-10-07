import { formatUnits, maxUint256, zeroAddress, type Address, type Hash, type PublicClient } from "viem";
import { EthereumAddressSchema, PositionSnapshotSchema } from "./schemas";
import type { AavePositionState, PositionSnapshot } from "./types";
import {
  AAVE_ORACLE_ABI,
  AAVE_POOL_ABI,
  AAVE_PROVIDER_ABI,
  AAVE_PROVIDER_ADDRESS,
  ETH_ASSET_ADDRESS,
  ETH_PRICE_LOOKBACK_BLOCKS,
} from "./aave-contracts";
import type { PositionAdapter } from "./position.adapter";
import { PositionReadError } from "./position-read.error";

// The injected client exposes only the three public read methods this adapter needs.
export type AaveReadClient = Pick<PublicClient, "getChainId" | "readContract"> & {
  getBlock(parameters?: { blockNumber?: bigint }): Promise<{ number: bigint | null; hash: Hash | null; timestamp: bigint }>;
};
type BlockEvidence = { number: number; hash: Hash; timestamp: string; seconds: number };

function invalid(message: string): never {
  throw new PositionReadError("INVALID_CHAIN_DATA", message);
}

function unsigned(value: bigint, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > maxUint256) {
    invalid(`Aave returned an invalid ${label}.`);
  }
  return value;
}

function contractAddress(value: string, label: string): Address {
  const parsed = EthereumAddressSchema.safeParse(value);
  if (!parsed.success || parsed.data.toLowerCase() === zeroAddress) {
    invalid(`Aave returned an invalid ${label} address.`);
  }
  return parsed.data as Address;
}

function blockEvidence(block: { number: bigint | null; hash: Hash | null; timestamp: bigint }): BlockEvidence {
  if (typeof block.number !== "bigint" || block.number < 0n || block.number > BigInt(Number.MAX_SAFE_INTEGER)
    || typeof block.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)
    || typeof block.timestamp !== "bigint" || block.timestamp < 0n || block.timestamp > 253_402_300_799n) {
    invalid("Ethereum returned invalid block evidence.");
  }
  const seconds = Number(block.timestamp);
  return { number: Number(block.number), hash: block.hash, timestamp: new Date(seconds * 1000).toISOString(), seconds };
}

function usdDecimals(currency: Address, unit: bigint): number {
  if (currency.toLowerCase() !== zeroAddress) invalid("Aave oracle base currency is not USD.");
  unsigned(unit, "oracle base currency unit");
  const digits = unit.toString();
  if (!/^10+$/.test(digits)) invalid("Aave oracle USD unit must be a positive power of ten.");
  return digits.length - 1;
}

function amount(raw: bigint, decimals: number, label: string, positive = false): number {
  const value = Number(formatUnits(unsigned(raw, label), decimals));
  if (!Number.isFinite(value) || value < 0 || (positive && value <= 0)) invalid(`Aave returned an invalid ${label}.`);
  return value;
}

function validatedSnapshot(value: PositionSnapshot): PositionSnapshot {
  const parsed = PositionSnapshotSchema.safeParse(value);
  if (!parsed.success) invalid("Aave returned inconsistent position or market evidence.");
  return parsed.data;
}

export class AavePositionAdapter implements PositionAdapter {
  constructor(private readonly client: AaveReadClient) {}

  async getPosition(wallet: string): Promise<AavePositionState> {
    const snapshot = await this.getSnapshot(wallet);
    if (snapshot.status === "NO_DEBT") {
      throw new PositionReadError("NO_DEBT", snapshot.message);
    }
    return snapshot.position;
  }

  async getSnapshot(wallet: string): Promise<PositionSnapshot> {
    const parsedWallet = EthereumAddressSchema.safeParse(wallet);
    if (!parsedWallet.success) invalid("Enter a valid Ethereum wallet address.");
    const requestedWallet = parsedWallet.data as Address;

    try {
      if (await this.client.getChainId() !== 1) {
        throw new PositionReadError("UNSUPPORTED_NETWORK", "Only Ethereum mainnet Aave V3 Core is supported.");
      }
      const current = blockEvidence(await this.client.getBlock());
      const blockNumber = BigInt(current.number);
      // Bind reads to the evidenced hash; a reorg must fail instead of silently replacing the block.
      const currentBlock = { blockHash: current.hash, requireCanonical: true } as const;
      const [poolResult, oracleResult] = await Promise.all([
        this.client.readContract({ address: AAVE_PROVIDER_ADDRESS, abi: AAVE_PROVIDER_ABI, functionName: "getPool", ...currentBlock }),
        this.client.readContract({ address: AAVE_PROVIDER_ADDRESS, abi: AAVE_PROVIDER_ABI, functionName: "getPriceOracle", ...currentBlock }),
      ]);
      const poolAddress = contractAddress(poolResult, "pool");
      const oracleAddress = contractAddress(oracleResult, "oracle");
      const account = await this.client.readContract({
        address: poolAddress, abi: AAVE_POOL_ABI, functionName: "getUserAccountData", args: [requestedWallet], ...currentBlock,
      });
      if (!Array.isArray(account) || account.length !== 6) invalid("Aave returned invalid user account data.");
      account.forEach((value) => unsigned(value, "user account data"));
      const [collateralBase, debtBase, , , , healthFactorRaw] = account;
      const evidence = {
        chainId: 1 as const,
        network: "ethereum-mainnet" as const,
        protocol: "aave-v3" as const,
        providerAddress: AAVE_PROVIDER_ADDRESS,
        poolAddress,
        oracleAddress,
        ethAssetAddress: ETH_ASSET_ADDRESS,
        blockNumber: current.number,
        blockHash: current.hash,
        blockTimestamp: current.timestamp,
      };

      if (debtBase === 0n) {
        return validatedSnapshot({
          status: "NO_DEBT", mode: "LIVE", wallet: requestedWallet, position: null, evidence,
          message: "This wallet has no Aave V3 Core borrowing position. Health Factor is not applicable.",
        });
      }
      if (healthFactorRaw === maxUint256) invalid("Aave returned an undefined Health Factor for a borrowing position.");
      if (current.number < ETH_PRICE_LOOKBACK_BLOCKS) invalid("Ethereum block height is insufficient for the required price window.");

      const ethPrice = await this.readEthPrice(oracleAddress, current.hash);
      const position: AavePositionState = {
        wallet: requestedWallet,
        collateralUsd: amount(collateralBase, ethPrice.decimals, "collateral"),
        debtUsd: amount(debtBase, ethPrice.decimals, "debt", true),
        healthFactor: amount(healthFactorRaw, 18, "Health Factor"),
        ethPrice: ethPrice.usd,
        timestamp: current.timestamp,
        blockNumber: current.number,
      };
      const referenceNumber = blockNumber - BigInt(ETH_PRICE_LOOKBACK_BLOCKS);
      const reference = blockEvidence(await this.client.getBlock({ blockNumber: referenceNumber }));
      if (reference.number !== Number(referenceNumber) || reference.seconds >= current.seconds) {
        invalid("Ethereum returned an inconsistent historical price window.");
      }
      const referenceOracleAddress = contractAddress(await this.client.readContract({
        address: AAVE_PROVIDER_ADDRESS, abi: AAVE_PROVIDER_ABI, functionName: "getPriceOracle", blockHash: reference.hash, requireCanonical: true,
      }), "historical oracle");
      const previous = await this.readEthPrice(referenceOracleAddress, reference.hash);

      return validatedSnapshot({
        status: "ACTIVE", mode: "LIVE", wallet: requestedWallet, position, evidence,
        marketChanges: {
          ethChangePct: (ethPrice.usd / previous.usd - 1) * 100,
          previousEthPrice: previous.usd,
          referenceBlockNumber: reference.number,
          referenceBlockHash: reference.hash,
          referenceTimestamp: reference.timestamp,
          referenceOracleAddress,
          lookbackBlocks: ETH_PRICE_LOOKBACK_BLOCKS,
          lookbackSeconds: current.seconds - reference.seconds,
        },
      });
    } catch (error) {
      if (error instanceof PositionReadError) throw error;
      // RPC errors may contain endpoint credentials, request bodies, or nested URLs.
      throw new PositionReadError("RPC_READ_FAILED", "Unable to read the required Ethereum/Aave data. Check the server RPC configuration.");
    }
  }

  private async readEthPrice(oracleAddress: Address, blockHash: Hash): Promise<{ usd: number; decimals: number }> {
    const block = { blockHash, requireCanonical: true } as const;
    const [currency, unit, price] = await Promise.all([
      this.client.readContract({ address: oracleAddress, abi: AAVE_ORACLE_ABI, functionName: "BASE_CURRENCY", ...block }),
      this.client.readContract({ address: oracleAddress, abi: AAVE_ORACLE_ABI, functionName: "BASE_CURRENCY_UNIT", ...block }),
      this.client.readContract({ address: oracleAddress, abi: AAVE_ORACLE_ABI, functionName: "getAssetPrice", args: [ETH_ASSET_ADDRESS], ...block }),
    ]);
    if (!EthereumAddressSchema.safeParse(currency).success) invalid("Aave returned an invalid oracle base currency.");
    const decimals = usdDecimals(currency, unit);
    return { usd: amount(price, decimals, "ETH price", true), decimals };
  }
}
