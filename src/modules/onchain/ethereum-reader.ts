import { formatUnits, maxUint256, type Address, type Hash, type PublicClient } from "viem";
import { OnchainEvidenceSchema } from "@/domain/schemas";
import type { OnchainEvidence } from "@/domain/types";
import { CHAINLINK_ABI, ETH_USD_FEED, USDC_USD_FEED } from "./ethereum-contracts";
import { EthereumReadError, withEthereumRead } from "./read-error";

type RpcBlock = { number: bigint | null; hash: Hash | null; timestamp: bigint };
type BlockRequest = { blockNumber: bigint; blockTag?: never } | { blockNumber?: never; blockTag: "latest" };
export type EthereumReadClient = Pick<PublicClient, "getChainId" | "readContract" | "getBalance"> & {
  getBlock(parameters?: BlockRequest): Promise<RpcBlock>;
  getTransaction(parameters: { hash: Hash }): Promise<{ hash: Hash; from: Address; blockHash: Hash | null; blockNumber: bigint | null }>;
  getRawLogs(parameters: { address: Address; topics: readonly Hash[]; fromBlock: bigint; toBlock: bigint }): Promise<unknown>;
};

export type EthereumBlock = { readonly number: bigint; readonly hash: Hash; readonly seconds: number; readonly timestamp: string };
export type ReadResult<T> = { state: T; evidence: OnchainEvidence[] };
export type SnapshotSource = () => Promise<EthereumSnapshot>;
type UsdPrice = { usd: number; evidence: OnchainEvidence };

const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const maxSeconds = 253_402_300_799n;
const maxRoundId = (1n << 80n) - 1n;
const maxPositiveAnswer = (1n << 255n) - 1n;
const feeds = {
  ETH: { address: ETH_USD_FEED, description: "ETH / USD", maxAgeSeconds: 3_600 },
  USDC: { address: USDC_USD_FEED, description: "USDC / USD", maxAgeSeconds: 82_800 },
} as const;

function invalid(message: string): never {
  throw new EthereumReadError("INVALID_CHAIN_DATA", message);
}

function validatedBlock(value: unknown): EthereumBlock {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Ethereum returned invalid block evidence.");
  const block = value as RpcBlock;
  if (typeof block.number !== "bigint" || block.number < 0n || block.number > BigInt(Number.MAX_SAFE_INTEGER)
    || typeof block.hash !== "string" || !hashPattern.test(block.hash)
    || typeof block.timestamp !== "bigint" || block.timestamp < 0n || block.timestamp > maxSeconds) {
    invalid("Ethereum returned invalid block evidence.");
  }
  const seconds = Number(block.timestamp);
  return Object.freeze({ number: block.number, hash: block.hash, seconds, timestamp: new Date(seconds * 1000).toISOString() });
}

export function validateWallet(wallet: string): Address {
  if (typeof wallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(wallet.trim())) {
    throw new EthereumReadError("INVALID_WALLET", "Enter a valid Ethereum wallet address.");
  }
  return wallet.trim() as Address;
}

export function amountFromUnits(raw: bigint, decimals: number, label: string): number {
  if (typeof raw !== "bigint" || raw < 0n || raw > maxUint256
    || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    invalid(`Ethereum returned invalid ${label} units.`);
  }
  const value = Number(formatUnits(raw, decimals));
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER || (raw > 0n && value === 0)) {
    invalid(`Ethereum returned an unsupported ${label} amount.`);
  }
  return value;
}

export function blockEvidence(block: EthereumBlock, description: string, contractAddress?: Address): OnchainEvidence {
  const parsed = OnchainEvidenceSchema.safeParse({
    type: "BLOCK", blockHash: block.hash, blockNumber: Number(block.number),
    description, source: `https://etherscan.io/block/${block.number}`,
    ...(contractAddress === undefined ? {} : { contractAddress }),
  });
  if (!parsed.success) invalid("Unable to form valid Ethereum block evidence.");
  return parsed.data;
}

/** A single read operation owns these caches; new operations capture a new snapshot. */
export class EthereumSnapshot {
  private readonly blocks = new Map<bigint, Promise<EthereumBlock>>();
  private readonly prices = new Map<string, Promise<UsdPrice>>();

  private constructor(readonly client: EthereumReadClient, readonly anchor: EthereumBlock) {
    this.blocks.set(anchor.number, Promise.resolve(anchor));
  }

  static async capture(client: EthereumReadClient): Promise<EthereumSnapshot> {
    return withEthereumRead(async () => {
      if (await client.getChainId() !== 1) {
        throw new EthereumReadError("UNSUPPORTED_NETWORK", "Only Ethereum mainnet is supported.");
      }
      return new EthereumSnapshot(client, validatedBlock(await client.getBlock({ blockTag: "latest" })));
    });
  }

  async getBlock(number: bigint): Promise<EthereumBlock> {
    return withEthereumRead(async () => {
      if (typeof number !== "bigint" || number < 0n || number > this.anchor.number) {
        throw new EthereumReadError("INVALID_ARGUMENT", "Read a block within the captured Ethereum snapshot.");
      }
      const cached = this.blocks.get(number);
      if (cached) return cached;
      const pending = withEthereumRead(async () => {
        const block = validatedBlock(await this.client.getBlock({ blockNumber: number }));
        if (block.number !== number || block.seconds >= this.anchor.seconds) {
          invalid("Ethereum returned inconsistent historical block evidence.");
        }
        return block;
      });
      this.blocks.set(number, pending);
      return pending;
    });
  }

  async atOrBefore(seconds: number): Promise<EthereumBlock> {
    return withEthereumRead(async () => {
      if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > this.anchor.seconds) {
        throw new EthereumReadError("INVALID_ARGUMENT", "The observation time must be within the captured Ethereum snapshot.");
      }
      if (seconds === this.anchor.seconds) return this.anchor;
      let low = 0n;
      let high = this.anchor.number;
      while (low < high) {
        const middle = (low + high + 1n) / 2n;
        if ((await this.getBlock(middle)).seconds <= seconds) low = middle;
        else high = middle - 1n;
      }
      const selected = await this.getBlock(low);
      if (selected.seconds > seconds || low === this.anchor.number) {
        invalid("Ethereum has no valid block for the requested observation time.");
      }
      const next = await this.getBlock(low + 1n);
      if (next.seconds <= seconds || next.seconds <= selected.seconds) {
        invalid("Ethereum returned inconsistent observation-time boundaries.");
      }
      return selected;
    });
  }

  async readUsdPrice(asset: "ETH" | "USDC", block = this.anchor): Promise<UsdPrice> {
    return withEthereumRead(async () => {
      if (asset !== "ETH" && asset !== "USDC") {
        throw new EthereumReadError("INVALID_ARGUMENT", "Only ETH and USDC dollar quotes are supported.");
      }
      if (!block || typeof block.number !== "bigint") invalid("The price observation must use verified block evidence.");
      const observed = await this.getBlock(block.number);
      if (block.hash !== observed.hash || block.seconds !== observed.seconds || block.timestamp !== observed.timestamp) {
        invalid("The price observation must use the captured Ethereum block evidence.");
      }
      const feed = feeds[asset];
      const key = `${feed.address}:${observed.hash}`;
      const cached = this.prices.get(key);
      if (cached) return cached;
      const pending = withEthereumRead(async () => {
        const parameters = { address: feed.address, abi: CHAINLINK_ABI, blockHash: observed.hash, requireCanonical: true } as const;
        const [description, decimals, round] = await Promise.all([
          this.client.readContract({ ...parameters, functionName: "description" }),
          this.client.readContract({ ...parameters, functionName: "decimals" }),
          this.client.readContract({ ...parameters, functionName: "latestRoundData" }),
        ]);
        if (description !== feed.description || decimals !== 8 || !Array.isArray(round) || round.length !== 5) {
          invalid("Chainlink returned inconsistent dollar-feed metadata.");
        }
        const [roundId, answer, startedAt, updatedAt, answeredInRound] = round;
        if (typeof roundId !== "bigint" || roundId <= 0n || roundId > maxRoundId
          || typeof answer !== "bigint" || answer <= 0n || answer > maxPositiveAnswer
          || typeof startedAt !== "bigint" || startedAt < 0n || startedAt > maxUint256
          || typeof updatedAt !== "bigint" || updatedAt <= 0n || updatedAt > BigInt(observed.seconds) || startedAt > updatedAt
          || typeof answeredInRound !== "bigint" || answeredInRound < 0n || answeredInRound > maxRoundId) {
          invalid("Chainlink returned an invalid or incomplete price round.");
        }
        if (BigInt(observed.seconds) - updatedAt > BigInt(feed.maxAgeSeconds)) {
          throw new EthereumReadError("STALE_PRICE", `Chainlink ${asset}/USD is older than the approved observation-time limit.`);
        }
        const usd = amountFromUnits(answer, decimals, `${asset}/USD price`);
        const evidence = blockEvidence(observed,
          `Chainlink ${asset}/USD roundId=${roundId}, updatedAt=${updatedAt} (${new Date(Number(updatedAt) * 1000).toISOString()}), answeredInRound=${answeredInRound}; observed at block=${observed.number}, timestamp=${observed.timestamp}.`,
          feed.address);
        return Object.freeze({ usd, evidence: Object.freeze(evidence) });
      });
      this.prices.set(key, pending);
      return pending;
    });
  }

  async verifyCanonical(): Promise<void> {
    return withEthereumRead(async () => {
      // Bypass the operation-local cache so a changed canonical anchor cannot pass.
      const current = validatedBlock(await this.client.getBlock({ blockNumber: this.anchor.number }));
      if (current.number !== this.anchor.number) invalid("Ethereum returned the wrong canonical block number.");
      if (current.hash !== this.anchor.hash) {
        throw new EthereumReadError("REORG_DETECTED", "The captured Ethereum block is no longer canonical. Run a new read.");
      }
      if (current.seconds !== this.anchor.seconds) invalid("Ethereum returned inconsistent canonical block timestamps.");
    });
  }
}
