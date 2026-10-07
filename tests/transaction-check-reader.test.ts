import {
  encodeAbiParameters, encodeEventTopics, parseAbiParameters, TransactionNotFoundError,
  type Hash,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import { TransactionObservationSchema } from "@/domain/schemas/transaction-check";
import { SWAP_EVENT, UNISWAP_POOL_ADDRESS, USDC_ADDRESS, WETH_ADDRESS } from "@/modules/onchain/ethereum-contracts";
import { createTransactionCheckClient, type TransactionCheckClient } from "@/modules/transaction-check/transaction-check.client";
import { readTransactionObservation } from "@/modules/transaction-check/transaction-check.reader";

const hash = (n: number): Hash => `0x${n.toString(16).padStart(64, "0")}`;
const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const to = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const txHash = hash(1);
const blockHash = hash(2);
function swap(amount0 = -123_456_789n, amount1 = 1_000_000_000_000_000_001n, index = 5) {
  return {
    address: UNISWAP_POOL_ADDRESS, blockNumber: 100n, blockHash, transactionHash: txHash,
    transactionIndex: 0, logIndex: index, removed: false,
    topics: encodeEventTopics({ abi: [SWAP_EVENT], eventName: "Swap", args: { sender: from, recipient: to } }),
    data: encodeAbiParameters(parseAbiParameters("int256,int256,uint160,uint128,int24"), [amount0, amount1, 2n ** 96n, 100n, 0]),
  };
}
function fixture(logs: unknown[] = []) {
  const transaction: Record<string, unknown> = { hash: txHash, from, to, value: 20_059_200_000_000_000_000_000n,
    input: "0x", blockNumber: 100n, blockHash, transactionIndex: 0 };
  const receipt: Record<string, unknown> = { transactionHash: txHash, from, to,
    blockNumber: 100n, blockHash, transactionIndex: 0, status: "success", logs };
  const block: Record<string, unknown> = { number: 100n, hash: blockHash, timestamp: 1_700_000_000n, transactions: [txHash] };
  const getChainId = vi.fn(async (): Promise<unknown> => 1);
  const getTransaction = vi.fn(async (): Promise<unknown> => transaction);
  const getTransactionReceipt = vi.fn(async (): Promise<unknown> => receipt);
  const getBlock = vi.fn(async (): Promise<unknown> => block);
  const readContract = vi.fn(async (parameters: Parameters<TransactionCheckClient["readContract"]>[0]): Promise<unknown> => {
    if (parameters.functionName === "token0") return USDC_ADDRESS;
    if (parameters.functionName === "token1") return WETH_ADDRESS;
    if (parameters.functionName === "fee") return 500;
    if (parameters.functionName === "decimals") return parameters.address === WETH_ADDRESS ? 18 : 6;
    throw new Error("Unexpected fixture call");
  });
  const client = { getChainId, getTransaction, getTransactionReceipt, getBlock, readContract } satisfies TransactionCheckClient;
  return { client, transaction, receipt, block, logs, getChainId, getTransaction, getTransactionReceipt, getBlock, readContract };
}

describe("transaction evidence reader", () => {
  it("reads exact outer ETH facts without claiming a transfer is a sell", async () => {
    const f = fixture();
    const result = await readTransactionObservation(f.client, txHash);
    expect(TransactionObservationSchema.parse(result)).toEqual(result);
    expect(result.transaction).toMatchObject({ nativeValueEth: "20059.2", input: "0x", status: "SUCCESS", logCount: 0 });
    expect(result.supportedSwaps).toEqual([]);
    expect(result.evidence.map((item) => item.type)).toEqual(["TRANSACTION", "BLOCK"]);
    expect(f.getBlock.mock.calls).toHaveLength(2);
    expect(f.readContract).toHaveBeenCalledTimes(5);
    expect(f.readContract.mock.calls.every(([parameters]) => parameters.blockHash === blockHash && parameters.requireCanonical === true)).toBe(true);
  });

  it("preserves 18 and 6 decimal amounts and records a matching sell event", async () => {
    const result = await readTransactionObservation(fixture([swap()]).client, txHash);
    expect(result.supportedSwaps).toEqual([{ logIndex: 5, poolAddress: UNISWAP_POOL_ADDRESS,
      direction: "SELL_ETH", wethAmount: "1.000000000000000001", usdcAmount: "123.456789" }]);
    expect(result.evidence[2]).toMatchObject({ type: "CONTRACT_EVENT", txHash, blockHash, contractAddress: UNISWAP_POOL_ADDRESS });
  });

  it("preserves both directions and orders by global log index", async () => {
    const result = await readTransactionObservation(fixture([swap(10n, -1n, 7), swap(-1n, 2n, 6)]).client, txHash);
    expect(result.supportedSwaps.map((event) => [event.logIndex, event.direction])).toEqual([[6, "SELL_ETH"], [7, "BUY_ETH"]]);
    expect(result.supportedSwaps[0].wethAmount).toBe("0.000000000000000002");
  });

  it("does not classify a Swap emitted by an unsupported contract", async () => {
    const result = await readTransactionObservation(fixture([{ ...swap(), address: USDC_ADDRESS }]).client, txHash);
    expect(result.supportedSwaps).toEqual([]);
    expect(result.transaction.logCount).toBe(1);
  });

  it.each([[0n, 1n], [-1n, 0n], [0n, 0n]])("does not invent a nonzero direction from zero amounts (%#)", async (amount0, amount1) => {
    expect((await readTransactionObservation(fixture([swap(amount0, amount1)]).client, txHash)).supportedSwaps).toEqual([]);
  });

  it("supports reverted receipts and contract creation without fabricating success", async () => {
    const f = fixture();
    f.transaction.to = null;
    f.receipt.to = null;
    f.receipt.status = "reverted";
    expect((await readTransactionObservation(f.client, txHash)).transaction).toMatchObject({ to: null, status: "REVERTED", logCount: 0 });
  });

  it("compares addresses and hashes without case sensitivity", async () => {
    const f = fixture([{ ...swap(), address: UNISWAP_POOL_ADDRESS.toUpperCase().replace("0X", "0x") }]);
    f.receipt.from = from.toUpperCase().replace("0X", "0x");
    f.transaction.input = "0xaBcD";
    expect((await readTransactionObservation(f.client, txHash)).supportedSwaps).toHaveLength(1);
  });

  it("rejects malformed hashes before any RPC read", async () => {
    const f = fixture();
    await expect(readTransactionObservation(f.client, "0x123")).rejects.toMatchObject({ code: "INVALID_REQUEST", status: 400 });
    expect(f.getChainId).not.toHaveBeenCalled();
  });

  it.each([null, undefined])("reports missing transactions as 404 (%#)", async (value) => {
    const f = fixture();
    f.getTransaction.mockResolvedValue(value);
    await expect(readTransactionObservation(f.client, txHash)).rejects.toMatchObject({ code: "TRANSACTION_NOT_FOUND", status: 404 });
    expect(f.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("recognizes viem's missing-transaction error without matching provider text", async () => {
    const f = fixture();
    f.getTransaction.mockRejectedValue(new TransactionNotFoundError({ hash: txHash }));
    await expect(readTransactionObservation(f.client, txHash)).rejects.toMatchObject({ code: "TRANSACTION_NOT_FOUND" });
  });

  it("reports pending as 409 and reads no receipt or historic pool", async () => {
    const f = fixture();
    f.transaction.blockHash = null;
    f.transaction.blockNumber = null;
    f.transaction.transactionIndex = null;
    await expect(readTransactionObservation(f.client, txHash)).rejects.toMatchObject({ code: "TRANSACTION_PENDING", status: 409 });
    expect(f.getTransactionReceipt).not.toHaveBeenCalled();
    expect(f.readContract).not.toHaveBeenCalled();
  });

  it("rejects wrong network before reading transactions", async () => {
    const f = fixture();
    f.getChainId.mockResolvedValue(31337);
    await expect(readTransactionObservation(f.client, txHash)).rejects.toMatchObject({ code: "UNSUPPORTED_NETWORK" });
    expect(f.getTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { hash: hash(5) }, { from: "invalid" }, { to: undefined }, { value: -1n }, { value: 2n ** 256n },
    { value: 1 }, { input: "0x1" }, { blockNumber: 100 }, { blockNumber: -1n },
    { blockHash: null }, { blockNumber: null }, { transactionIndex: -1 },
  ])("rejects malformed or mismatched transactions (%#)", async (patch) => {
    const f = fixture(); Object.assign(f.transaction, patch);
    await expect(readTransactionObservation(f.client, txHash)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([
    { transactionHash: hash(5) }, { blockHash: hash(5) }, { blockNumber: 101n }, { transactionIndex: 1 },
    { from: to }, { to: from }, { status: "0x1" }, { logs: null },
    { status: "reverted", logs: [swap()] },
  ])("rejects inconsistent receipts (%#)", async (patch) => {
    const f = fixture(); Object.assign(f.receipt, patch);
    await expect(readTransactionObservation(f.client, txHash)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([
    { number: 101n }, { hash: hash(5) }, { timestamp: -1n }, { timestamp: 253_402_300_800n },
    { timestamp: BigInt(Math.floor(Date.now() / 1000) + 3600) }, { transactions: [] }, { transactions: [hash(5)] },
    { transactions: [{ hash: txHash }] },
  ])("rejects inconsistent historic blocks (%#)", async (patch) => {
    const f = fixture(); Object.assign(f.block, patch);
    await expect(readTransactionObservation(f.client, txHash)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([
    { address: "0x123" }, { removed: true }, { removed: undefined }, { transactionHash: hash(5) }, { blockHash: hash(5) },
    { blockNumber: 101n }, { transactionIndex: 1 }, { logIndex: -1 }, { logIndex: Number.MAX_SAFE_INTEGER + 1 },
    { topics: null }, { topics: ["0x12"] }, { data: "0x1" }, { data: "0x12" },
    { topics: [swap().topics[0]] }, { topics: [hash(1), hash(2), hash(3), hash(4), hash(5)] },
  ])("rejects malformed, removed or mismatched event provenance (%#)", async (patch) => {
    const f = fixture([{ ...swap(), ...patch }]);
    await expect(readTransactionObservation(f.client, txHash)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([2, 3, 4])("rejects noncanonical or out-of-range small ABI integer word %s", async (word) => {
    const log = swap();
    const bad = word === 4 ? "0".repeat(56) + "00800000" : "f".repeat(64);
    log.data = `${log.data.slice(0, 2 + word * 64)}${bad}${log.data.slice(2 + (word + 1) * 64)}` as `0x${string}`;
    await expect(readTransactionObservation(fixture([log]).client, txHash)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("rejects indexed address padding that permissive decoders can truncate", async () => {
    const log = swap();
    log.topics[1] = `0x${"f".repeat(24)}${log.topics[1]!.toString().slice(26)}`;
    await expect(readTransactionObservation(fixture([log]).client, txHash)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([[1n, 1n], [-1n, -1n]])("rejects impossible same-sign Swap amounts (%#)", async (amount0, amount1) => {
    await expect(readTransactionObservation(fixture([swap(amount0, amount1)]).client, txHash)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("rejects duplicate receipt log identities rather than counting them twice", async () => {
    const log = swap();
    await expect(readTransactionObservation(fixture([log, { ...log }]).client, txHash)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([
    ["token0", WETH_ADDRESS], ["token1", USDC_ADDRESS], ["fee", 3000], ["decimals", 8],
  ])("rejects different historic pool/token metadata (%#)", async (name, value) => {
    const f = fixture(); const base = f.readContract.getMockImplementation()!;
    f.readContract.mockImplementation((parameters) => parameters.functionName === name ? Promise.resolve(value) : base(parameters));
    await expect(readTransactionObservation(f.client, txHash)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("detects a canonical block hash change without returning the earlier observation", async () => {
    const f = fixture();
    f.getBlock.mockResolvedValueOnce(f.block).mockResolvedValueOnce({ ...f.block, hash: hash(6) });
    await expect(readTransactionObservation(f.client, txHash)).rejects.toMatchObject({ code: "REORG_DETECTED" });
  });

  it("rejects a changed timestamp even if a provider repeats the same block hash", async () => {
    const f = fixture();
    f.getBlock.mockResolvedValueOnce(f.block).mockResolvedValueOnce({ ...f.block, timestamp: 1_700_000_001n });
    await expect(readTransactionObservation(f.client, txHash)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each(["getChainId", "getTransaction", "getTransactionReceipt", "getBlock", "readContract"] as const)("redacts provider failures from %s and does not retry", async (method) => {
    const f = fixture();
    f[method].mockRejectedValue(new Error("https://private-rpc.example/secret-api-key"));
    const error = await readTransactionObservation(f.client, txHash).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "RPC_READ_FAILED", status: 503 });
    expect(String(error)).not.toContain("secret-api-key");
    expect(String(error)).not.toContain("private-rpc");
  });

  it("takes fresh independent snapshots on repeated calls", async () => {
    const f = fixture();
    await readTransactionObservation(f.client, txHash);
    f.transaction.value = 1n;
    expect((await readTransactionObservation(f.client, txHash)).transaction.nativeValueEth).toBe("0.000000000000000001");
    expect(f.getTransaction).toHaveBeenCalledTimes(2);
    expect(f.getBlock).toHaveBeenCalledTimes(4);
  });
});

describe("readonly client configuration", () => {
  it.each(["", "invalid", "file:///etc/passwd", "wss://provider.example"])("rejects unsupported RPC configuration (%s)", (url) => {
    expect(() => createTransactionCheckClient(url)).toThrow(expect.objectContaining({ code: "CONFIGURATION_ERROR" }));
  });
});
