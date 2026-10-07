import { decodeEventLog, encodeAbiParameters, encodeEventTopics, parseAbiParameters, toEventSelector, type Hash, type Hex } from "viem";
import { OnchainSignalStateSchema } from "@/domain/schemas";
import type { OnchainEvidence, OnchainSignalState } from "@/domain/types";
import { SWAP_EVENT, UNISWAP_POOL_ABI, UNISWAP_POOL_ADDRESS, USDC_ADDRESS, WETH_ADDRESS } from "./ethereum-contracts";
import { amountFromUnits, blockEvidence, type EthereumSnapshot, type SnapshotSource } from "./ethereum-reader";
import type { OnchainSignalAdapter } from "./onchain-signal.adapter";
import { EthereumReadError, withEthereumRead } from "./read-error";

const swapTopic = toEventSelector(SWAP_EVENT);
const swapDataParameters = parseAbiParameters("int256,int256,uint160,uint128,int24");
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const evidenceLimit = 20;
type Swap = {
  blockNumber: bigint; blockHash: Hash; txHash: Hash; logIndex: bigint;
  amount0: bigint; amount1: bigint; fingerprint: string;
};

function invalid(message: string): never {
  throw new EthereumReadError("INVALID_CHAIN_DATA", message);
}

function quantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) invalid("Ethereum returned an invalid log quantity.");
  const number = BigInt(value);
  if (number > BigInt(Number.MAX_SAFE_INTEGER)) invalid("Ethereum returned an unsupported log quantity.");
  return number;
}

/** Decode every raw log; viem's filtered getLogs helper can silently drop malformed events. */
function decodeSwap(value: unknown): Swap {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Ethereum returned an invalid Swap log.");
  const log = value as Record<string, unknown>;
  if (typeof log.address !== "string" || log.address.toLowerCase() !== UNISWAP_POOL_ADDRESS.toLowerCase()
    || log.removed !== false || typeof log.blockHash !== "string" || !hashPattern.test(log.blockHash)
    || typeof log.transactionHash !== "string" || !hashPattern.test(log.transactionHash)
    || typeof log.data !== "string" || !/^0x[0-9a-fA-F]{320}$/.test(log.data)
    || !Array.isArray(log.topics) || log.topics.length !== 3
    || !log.topics.every((topic) => typeof topic === "string" && hashPattern.test(topic))
    || log.topics[0].toLowerCase() !== swapTopic.toLowerCase()) {
    invalid("Ethereum returned an incomplete or inconsistent pool event.");
  }
  const blockNumber = quantity(log.blockNumber);
  const logIndex = quantity(log.logIndex);
  const transactionIndex = quantity(log.transactionIndex);
  let amounts: { amount0: bigint; amount1: bigint };
  try {
    const decoded = decodeEventLog({ abi: [SWAP_EVENT], data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]], strict: true });
    // strict decoding alone permits nonzero address padding and out-of-range small integers.
    const canonicalData = encodeAbiParameters(swapDataParameters, [decoded.args.amount0, decoded.args.amount1, decoded.args.sqrtPriceX96, decoded.args.liquidity, decoded.args.tick]);
    const canonicalTopics = encodeEventTopics({ abi: [SWAP_EVENT], eventName: "Swap", args: { sender: decoded.args.sender, recipient: decoded.args.recipient } });
    if (canonicalData.toLowerCase() !== log.data.toLowerCase()
      || canonicalTopics.some((topic, index) => topic!.toString().toLowerCase() !== (log.topics as string[])[index].toLowerCase())) {
      invalid("The pool event is not canonically ABI encoded.");
    }
    amounts = decoded.args;
  } catch {
    invalid("Unable to strictly decode a pool Swap event.");
  }
  if ((amounts.amount0 > 0n && amounts.amount1 > 0n) || (amounts.amount0 < 0n && amounts.amount1 < 0n)) {
    invalid("The pool Swap amounts have inconsistent directions.");
  }
  return {
    blockNumber, blockHash: log.blockHash as Hash, txHash: log.transactionHash as Hash, logIndex, ...amounts,
    fingerprint: [log.address, log.blockHash, log.transactionHash, blockNumber, logIndex, transactionIndex, log.data, ...log.topics].join(":").toLowerCase(),
  };
}

async function mapFour<T, R>(items: T[], operation: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await operation(items[index]);
    }
  }));
  return output;
}

export class UniswapSellPressureAdapter implements OnchainSignalAdapter {
  constructor(private readonly source: SnapshotSource) {}

  async getSignal(): Promise<OnchainSignalState> {
    return withEthereumRead(async () => {
      const snapshot = await this.source();
      const end = snapshot.anchor.seconds;
      if (end < 601) invalid("Ethereum history does not cover both observation windows.");
      await this.verifyPool(snapshot);
      const first = (await snapshot.atOrBefore(end - 601)).number + 1n;
      const last = snapshot.anchor.number - 1n; // The anchor timestamp is the exclusive window end.
      const raw = first <= last ? await snapshot.client.getRawLogs({
        address: UNISWAP_POOL_ADDRESS, topics: [swapTopic], fromBlock: first, toBlock: last,
      }) : [];
      if (!Array.isArray(raw)) invalid("Ethereum returned an invalid pool-log response.");
      const unique = new Map<string, Swap>();
      for (const value of raw) {
        const swap = decodeSwap(value);
        if (swap.blockNumber < first || swap.blockNumber > last) invalid("A pool event is outside the requested block range.");
        const key = `${swap.blockHash.toLowerCase()}:${swap.logIndex}`;
        const previous = unique.get(key);
        if (previous && previous.fingerprint !== swap.fingerprint) invalid("Ethereum returned conflicting duplicate pool events.");
        unique.set(key, swap);
      }
      const swaps = [...unique.values()].sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex < b.logIndex ? -1 : a.logIndex > b.logIndex ? 1 : 0);
      const sales = (await mapFour(swaps, async (swap) => {
        const block = await snapshot.getBlock(swap.blockNumber);
        if (block.hash.toLowerCase() !== swap.blockHash.toLowerCase() || block.seconds < end - 600 || block.seconds >= end) {
          invalid("A pool event has inconsistent block or time evidence.");
        }
        if (swap.amount1 <= 0n) return undefined;
        const price = await snapshot.readUsdPrice("USDC", block);
        const usdc = amountFromUnits(-swap.amount0, 6, "USDC sell output");
        const usd = usdc * price.usd;
        if (!Number.isFinite(usd) || usd > Number.MAX_SAFE_INTEGER) invalid("The pool sell value exceeds the supported numeric range.");
        return { swap, block, price, usdc, usd, current: block.seconds >= end - 300 };
      })).filter((sale) => sale !== undefined);

      const transactions = new Map<string, typeof sales[number]>();
      for (const sale of sales) {
        const key = sale.swap.txHash.toLowerCase();
        const prior = transactions.get(key);
        if (prior && (prior.swap.blockNumber !== sale.swap.blockNumber || prior.swap.blockHash.toLowerCase() !== sale.swap.blockHash.toLowerCase())) {
          invalid("A sell transaction is referenced by inconsistent blocks.");
        }
        transactions.set(key, sale);
      }
      const origins = new Map<string, string>(await mapFour([...transactions.entries()], async ([hash, sale]) => {
        const tx = await snapshot.client.getTransaction({ hash: sale.swap.txHash });
        if (!tx || typeof tx.hash !== "string" || tx.hash.toLowerCase() !== hash
          || typeof tx.from !== "string" || !addressPattern.test(tx.from)
          || typeof tx.blockHash !== "string" || tx.blockHash.toLowerCase() !== sale.swap.blockHash.toLowerCase()
          || tx.blockNumber !== sale.swap.blockNumber) invalid("A sell transaction has inconsistent originating-wallet evidence.");
        return [hash, tx.from.toLowerCase()] as const;
      }));
      let current = 0;
      let baseline = 0;
      const currentTx = new Set<string>();
      const wallets = new Set<string>();
      for (const sale of sales) {
        if (sale.current) {
          current += sale.usd;
          const key = sale.swap.txHash.toLowerCase();
          currentTx.add(key);
          wallets.add(origins.get(key)!);
        } else baseline += sale.usd;
      }
      if (!Number.isFinite(current) || !Number.isFinite(baseline) || current > Number.MAX_SAFE_INTEGER || baseline > Number.MAX_SAFE_INTEGER) {
        invalid("The total sell value exceeds the supported numeric range.");
      }
      if (baseline === 0) throw new EthereumReadError("EMPTY_BASELINE", "The preceding five-minute window has no positive sell baseline; no valid anomaly signal can be generated.");
      const evidence: OnchainEvidence[] = [blockEvidence(snapshot.anchor,
        `Uniswap V3 WETH/USDC 0.05% single pool; ETH gross sells, not net flow. Current [${new Date((end - 300) * 1000).toISOString()}, ${snapshot.anchor.timestamp}); baseline is the immediately preceding equal window. Statistics use all ${swaps.length} unique Swap events; event evidence is limited to ${evidenceLimit} samples.`, UNISWAP_POOL_ADDRESS)];
      for (const sale of sales.slice(0, evidenceLimit)) {
        evidence.push({ type: "CONTRACT_EVENT", txHash: sale.swap.txHash, blockHash: sale.swap.blockHash,
          blockNumber: Number(sale.swap.blockNumber), contractAddress: UNISWAP_POOL_ADDRESS,
          description: `${sale.current ? "Current" : "Baseline"} WETH sell (normalized to ETH), logIndex=${sale.swap.logIndex}; USDC output=${sale.usdc}, USD=${sale.usd}; tx.from=${origins.get(sale.swap.txHash.toLowerCase())}; timestamp=${sale.block.timestamp}.`,
          source: `https://etherscan.io/tx/${sale.swap.txHash}` });
        evidence.push(sale.price.evidence);
      }
      const result = OnchainSignalStateSchema.safeParse({ signalType: "DEX_SELL_PRESSURE", asset: "ETH",
        windowStart: new Date((end - 300) * 1000).toISOString(), windowEnd: snapshot.anchor.timestamp,
        currentSellVolumeUsd: current, baselineSellVolumeUsd: baseline, anomalyRatio: current / baseline,
        txCount: currentTx.size, uniqueWallets: wallets.size, evidence });
      if (!result.success) invalid("The sell-pressure observation does not satisfy its frozen contract.");
      await snapshot.verifyCanonical();
      return result.data;
    });
  }

  private async verifyPool(snapshot: EthereumSnapshot): Promise<void> {
    const parameters = { address: UNISWAP_POOL_ADDRESS, abi: UNISWAP_POOL_ABI, blockHash: snapshot.anchor.hash, requireCanonical: true } as const;
    const [token0, token1, fee] = await Promise.all([
      snapshot.client.readContract({ ...parameters, functionName: "token0" }),
      snapshot.client.readContract({ ...parameters, functionName: "token1" }),
      snapshot.client.readContract({ ...parameters, functionName: "fee" }),
    ]);
    if (typeof token0 !== "string" || token0.toLowerCase() !== USDC_ADDRESS.toLowerCase()
      || typeof token1 !== "string" || token1.toLowerCase() !== WETH_ADDRESS.toLowerCase() || fee !== 500) {
      invalid("The configured pool is not the approved Ethereum USDC/WETH 0.05% pool.");
    }
  }
}
