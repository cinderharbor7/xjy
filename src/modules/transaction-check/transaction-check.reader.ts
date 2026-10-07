import {
  decodeEventLog, encodeAbiParameters, encodeEventTopics, formatUnits, maxUint256,
  parseAbiParameters, toEventSelector, TransactionNotFoundError, type Hash, type Hex,
} from "viem";
import {
  TransactionCheckRequestSchema, TransactionObservationSchema,
  type SupportedSwap, type TransactionObservation,
} from "@/domain/schemas/transaction-check";
import type { OnchainEvidence } from "@/domain/types";
import {
  ERC20_ABI, SWAP_EVENT, UNISWAP_POOL_ABI, UNISWAP_POOL_ADDRESS, USDC_ADDRESS, WETH_ADDRESS,
} from "../onchain/ethereum-contracts";
import type { TransactionCheckClient } from "./transaction-check.client";
import { TransactionCheckError } from "./transaction-check.error";

const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const dataPattern = /^0x(?:[0-9a-fA-F]{2})*$/;
const swapTopic = toEventSelector(SWAP_EVENT);
const swapDataParameters = parseAbiParameters("int256,int256,uint160,uint128,int24");
const maxSeconds = 253_402_300_799n;

function invalid(): never { throw new TransactionCheckError("INVALID_CHAIN_DATA"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function hash(value: unknown): Hash {
  if (typeof value !== "string" || !hashPattern.test(value)) invalid();
  return value as Hash;
}
function address(value: unknown): string {
  if (typeof value !== "string" || !addressPattern.test(value)) invalid();
  return value;
}
function same(left: string | null, right: string | null): boolean {
  return left?.toLowerCase() === right?.toLowerCase();
}
function safeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}
function blockNumber(value: unknown): bigint {
  if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return value;
}
function verifiedBlock(value: unknown) {
  const block = object(value);
  const number = blockNumber(block.number);
  const blockHash = hash(block.hash);
  if (typeof block.timestamp !== "bigint" || block.timestamp < 0n || block.timestamp > maxSeconds
    || block.timestamp > BigInt(Math.floor(Date.now() / 1000))) invalid();
  if (!Array.isArray(block.transactions) || !block.transactions.every((item) => typeof item === "string" && hashPattern.test(item))) invalid();
  return { number, hash: blockHash, seconds: block.timestamp, transactions: block.transactions as string[] };
}

async function verifyPool(client: TransactionCheckClient, blockHash: Hash): Promise<void> {
  const pool = { address: UNISWAP_POOL_ADDRESS, abi: UNISWAP_POOL_ABI, blockHash, requireCanonical: true } as const;
  const [token0, token1, fee, usdcDecimals, wethDecimals] = await Promise.all([
    client.readContract({ ...pool, functionName: "token0" }),
    client.readContract({ ...pool, functionName: "token1" }),
    client.readContract({ ...pool, functionName: "fee" }),
    client.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "decimals", blockHash, requireCanonical: true }),
    client.readContract({ address: WETH_ADDRESS, abi: ERC20_ABI, functionName: "decimals", blockHash, requireCanonical: true }),
  ]);
  if (typeof token0 !== "string" || !same(token0, USDC_ADDRESS)
    || typeof token1 !== "string" || !same(token1, WETH_ADDRESS)
    || fee !== 500 || usdcDecimals !== 6 || wethDecimals !== 18) invalid();
}

function decodeSupportedSwap(log: Record<string, unknown>): SupportedSwap | undefined {
  const topics = log.topics as string[];
  // Other event signatures at the supported pool are outside this report's swap classification.
  if (!topics.length || !same(topics[0], swapTopic)) return undefined;
  if (topics.length !== 3 || typeof log.data !== "string" || !/^0x[0-9a-fA-F]{320}$/.test(log.data)) invalid();
  let amount0: bigint;
  let amount1: bigint;
  try {
    const decoded = decodeEventLog({ abi: [SWAP_EVENT], data: log.data as Hex, topics: topics as [Hex, ...Hex[]], strict: true });
    const canonicalData = encodeAbiParameters(swapDataParameters,
      [decoded.args.amount0, decoded.args.amount1, decoded.args.sqrtPriceX96, decoded.args.liquidity, decoded.args.tick]);
    const canonicalTopics = encodeEventTopics({ abi: [SWAP_EVENT], eventName: "Swap", args: { sender: decoded.args.sender, recipient: decoded.args.recipient } });
    if (!same(canonicalData, log.data) || canonicalTopics.some((topic, index) => typeof topic !== "string" || !same(topic, topics[index]))) invalid();
    ({ amount0, amount1 } = decoded.args);
  } catch { invalid(); }
  if ((amount0 > 0n && amount1 > 0n) || (amount0 < 0n && amount1 < 0n)) invalid();
  if (amount0 === 0n || amount1 === 0n) return undefined;
  const direction = amount1 > 0n ? "SELL_ETH" : "BUY_ETH";
  return {
    logIndex: safeCount(log.logIndex), poolAddress: UNISWAP_POOL_ADDRESS, direction,
    wethAmount: formatUnits(amount1 < 0n ? -amount1 : amount1, 18),
    usdcAmount: formatUnits(amount0 < 0n ? -amount0 : amount0, 6),
  };
}

/** One request = fresh independent reads. No state, retry, mock or price inference. */
export async function readTransactionObservation(client: TransactionCheckClient, txHash: string): Promise<TransactionObservation> {
  const request = TransactionCheckRequestSchema.safeParse({ txHash });
  if (!request.success) throw new TransactionCheckError("INVALID_REQUEST");
  try {
    if (await client.getChainId() !== 1) throw new TransactionCheckError("UNSUPPORTED_NETWORK");
    let rawTransaction: unknown;
    try { rawTransaction = await client.getTransaction({ hash: txHash as Hash }); }
    catch (error) {
      if (error instanceof TransactionNotFoundError) throw new TransactionCheckError("TRANSACTION_NOT_FOUND");
      throw error;
    }
    if (rawTransaction === null || rawTransaction === undefined) throw new TransactionCheckError("TRANSACTION_NOT_FOUND");
    const tx = object(rawTransaction);
    const requestedHash = hash(tx.hash);
    if (!same(requestedHash, txHash)) invalid();
    const from = address(tx.from);
    const to = tx.to === null ? null : address(tx.to);
    if (typeof tx.value !== "bigint" || tx.value < 0n || tx.value > maxUint256
      || typeof tx.input !== "string" || !dataPattern.test(tx.input)) invalid();
    if (tx.blockHash === null && tx.blockNumber === null) throw new TransactionCheckError("TRANSACTION_PENDING");
    const txBlockHash = hash(tx.blockHash);
    const txBlockNumber = blockNumber(tx.blockNumber);
    const transactionIndex = safeCount(tx.transactionIndex);
    const [rawReceipt, rawBlock] = await Promise.all([
      client.getTransactionReceipt({ hash: requestedHash }),
      client.getBlock({ blockHash: txBlockHash }),
    ]);
    const receipt = object(rawReceipt);
    const block = verifiedBlock(rawBlock);
    const receiptTo = receipt.to === null ? null : address(receipt.to);
    if (!same(hash(receipt.transactionHash), requestedHash) || !same(hash(receipt.blockHash), txBlockHash)
      || blockNumber(receipt.blockNumber) !== txBlockNumber || safeCount(receipt.transactionIndex) !== transactionIndex
      || !same(address(receipt.from), from) || !same(receiptTo, to)
      || block.number !== txBlockNumber || !same(block.hash, txBlockHash)
      || !same(block.transactions[transactionIndex] ?? null, requestedHash)
      || (receipt.status !== "success" && receipt.status !== "reverted") || !Array.isArray(receipt.logs)) invalid();
    if (receipt.status === "reverted" && receipt.logs.length !== 0) invalid();
    await verifyPool(client, txBlockHash);
    const supportedSwaps: SupportedSwap[] = [];
    const seen = new Set<number>();
    for (const rawLog of receipt.logs) {
      const log = object(rawLog);
      const logIndex = safeCount(log.logIndex);
      if (seen.has(logIndex) || log.removed !== false
        || !same(hash(log.transactionHash), requestedHash) || !same(hash(log.blockHash), txBlockHash)
        || blockNumber(log.blockNumber) !== txBlockNumber || safeCount(log.transactionIndex) !== transactionIndex
        || typeof log.data !== "string" || !dataPattern.test(log.data)
        || !Array.isArray(log.topics) || log.topics.length > 4
        || !log.topics.every((topic) => typeof topic === "string" && hashPattern.test(topic))) invalid();
      seen.add(logIndex);
      const logAddress = address(log.address);
      if (same(logAddress, UNISWAP_POOL_ADDRESS)) {
        const swap = decodeSupportedSwap(log);
        if (swap) supportedSwaps.push(swap);
      }
    }
    supportedSwaps.sort((left, right) => left.logIndex - right.logIndex);
    const evidence: OnchainEvidence[] = [
      { type: "TRANSACTION", txHash: requestedHash, blockHash: txBlockHash, blockNumber: Number(txBlockNumber),
        description: "核验外层交易的发送、接收、原生 ETH 金额、输入数据与回执状态。", source: `https://etherscan.io/tx/${requestedHash}` },
      { type: "BLOCK", blockHash: txBlockHash, blockNumber: Number(txBlockNumber),
        description: "核验交易所在区块、时间与交易索引；查询结束时再次检查主链区块哈希。", source: `https://etherscan.io/block/${txBlockNumber}` },
      ...supportedSwaps.map((swap): OnchainEvidence => ({ type: "CONTRACT_EVENT", txHash: requestedHash,
        blockHash: txBlockHash, blockNumber: Number(txBlockNumber), contractAddress: UNISWAP_POOL_ADDRESS,
        description: `本池 Swap 日志 ${swap.logIndex}：${swap.direction === "SELL_ETH" ? "WETH 流入池、USDC 流出池" : "USDC 流入池、WETH 流出池"}；WETH=${swap.wethAmount}，USDC=${swap.usdcAmount}。`,
        source: `https://etherscan.io/tx/${requestedHash}#eventlog` })),
    ];
    const observation = TransactionObservationSchema.safeParse({
      transaction: { hash: requestedHash, from, to, nativeValueEth: formatUnits(tx.value, 18), input: tx.input,
        status: receipt.status === "success" ? "SUCCESS" : "REVERTED", blockNumber: Number(txBlockNumber),
        blockHash: txBlockHash, timestamp: new Date(Number(block.seconds) * 1000).toISOString(), logCount: receipt.logs.length },
      supportedSwaps, evidence,
      scope: { protocol: "UNISWAP_V3", poolAddress: UNISWAP_POOL_ADDRESS, poolLabel: "Uniswap V3 WETH/USDC 0.05%（Ethereum 主网单池）", asset: "WETH", quoteAsset: "USDC", fee: 500 },
    });
    if (!observation.success) invalid();
    const canonical = verifiedBlock(await client.getBlock({ blockNumber: txBlockNumber }));
    if (canonical.number !== block.number) invalid();
    if (!same(canonical.hash, block.hash)) throw new TransactionCheckError("REORG_DETECTED");
    if (canonical.seconds !== block.seconds || !same(canonical.transactions[transactionIndex] ?? null, requestedHash)) invalid();
    return observation.data;
  } catch (error) {
    if (error instanceof TransactionCheckError) throw error;
    throw new TransactionCheckError("RPC_READ_FAILED");
  }
}
