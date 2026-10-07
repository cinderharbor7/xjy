import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, toHex, type Address, type Hash, type ReadContractParameters } from "viem";
import { describe, expect, it, vi } from "vitest";
import { OnchainSignalStateSchema } from "@/domain/schemas";
import { SWAP_EVENT, UNISWAP_POOL_ADDRESS, USDC_ADDRESS, WETH_ADDRESS } from "@/modules/onchain/ethereum-contracts";
import { EthereumSnapshot, type EthereumReadClient } from "@/modules/onchain/ethereum-reader";
import { OnchainSignalService } from "@/modules/onchain/onchain-signal.service";
import { UniswapSellPressureAdapter } from "@/modules/onchain/uniswap-sell-pressure.adapter";

const hash = (number: number) => `0x${number.toString(16).padStart(64, "0")}` as Hash;
const origin = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as Address;
const otherOrigin = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const seconds = (number: number) => 10_000 + number * 12;
type RawLog = ReturnType<typeof log>;
function log(block: number, id: number, usdc: bigint, weth = 10n ** 18n, index = id) {
  return { address: UNISWAP_POOL_ADDRESS, blockHash: hash(block + 1000), blockNumber: toHex(block),
    transactionHash: hash(id), transactionIndex: "0x0", logIndex: toHex(index), removed: false,
    topics: encodeEventTopics({ abi: [SWAP_EVENT], eventName: "Swap", args: { sender: origin, recipient: otherOrigin } }),
    data: encodeAbiParameters(parseAbiParameters("int256,int256,uint160,uint128,int24"), [-usdc, weth, 2n ** 96n, 100n, 0]) };
}

function fixture(initial: RawLog[] = [log(350, 1, 100_000_000n), log(375, 2, 200_000_000n), log(399, 3, 300_000_000n)]) {
  const logs = initial;
  const getBlock = vi.fn(async (parameters?: { blockNumber?: bigint; blockTag?: "latest" }) => {
    const number = parameters?.blockNumber ?? 400n;
    return { number, hash: hash(Number(number) + 1000), timestamp: BigInt(seconds(Number(number))) };
  });
  const getRawLogs = vi.fn(async () => logs as unknown);
  const readContract = vi.fn(async (parameters: ReadContractParameters): Promise<unknown> => {
    if (parameters.functionName === "token0") return USDC_ADDRESS;
    if (parameters.functionName === "token1") return WETH_ADDRESS;
    if (parameters.functionName === "fee") return 500;
    if (parameters.functionName === "description") return "USDC / USD";
    if (parameters.functionName === "decimals") return 8;
    if (parameters.functionName === "latestRoundData") {
      const number = Number(BigInt(parameters.blockHash!)) - 1000;
      const time = BigInt(seconds(number));
      return [1n, number < 375 ? 98_000_000n : 102_000_000n, time, time, 1n];
    }
    throw new Error("Unexpected fixture call.");
  });
  const getTransaction = vi.fn(async ({ hash: txHash }: { hash: Hash }) => {
    const sale = logs.find((entry) => entry.transactionHash.toLowerCase() === txHash.toLowerCase())!;
    return { hash: txHash, from: origin, blockHash: sale.blockHash, blockNumber: BigInt(sale.blockNumber) };
  });
  const client: EthereumReadClient = { getChainId: vi.fn(async () => 1), getBlock,
    readContract: readContract as EthereumReadClient["readContract"], getBalance: vi.fn(), getTransaction, getRawLogs };
  const source = vi.fn(() => EthereumSnapshot.capture(client));
  const adapter = new UniswapSellPressureAdapter(source);
  return { adapter, source, client, logs, getBlock, getTransaction, readContract, getRawLogs };
}

describe("Uniswap single-pool sell-pressure adapter", () => {
  it("uses exact adjacent UTC windows, gross sells and per-event USDC/USD quotes", async () => {
    const f = fixture();
    const result = await f.adapter.getSignal();
    expect(OnchainSignalStateSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ asset: "ETH", signalType: "DEX_SELL_PRESSURE", currentSellVolumeUsd: 510,
      baselineSellVolumeUsd: 98, anomalyRatio: 510 / 98, txCount: 2, uniqueWallets: 1,
      windowStart: new Date(seconds(375) * 1000).toISOString(), windowEnd: new Date(seconds(400) * 1000).toISOString() });
    expect(f.getRawLogs).toHaveBeenCalledWith(expect.objectContaining({ address: UNISWAP_POOL_ADDRESS, fromBlock: 350n, toBlock: 399n }));
    expect(f.readContract.mock.calls.filter(([args]) => ["token0", "token1", "fee"].includes(args.functionName!)))
      .toEqual(expect.arrayContaining([ [expect.objectContaining({ blockHash: hash(1400), requireCanonical: true })] ]));
    expect(result.evidence.some((item) => item.type === "CONTRACT_EVENT" && item.description.includes("logIndex=2") && item.contractAddress === UNISWAP_POOL_ADDRESS)).toBe(true);
    expect(result.evidence.some((item) => item.description.includes("USDC/USD roundId="))).toBe(true);
    expect(result.evidence.every((item) => item.source.startsWith("https://etherscan.io/"))).toBe(true);
    expect(f.getBlock).toHaveBeenLastCalledWith({ blockNumber: 400n });
  });

  it("does not subtract buys, and counts a legitimate zero-USDC-output sell", async () => {
    const f = fixture([log(350, 1, 100_000_000n), log(375, 2, -500_000_000n, -1n), log(399, 3, 0n)]);
    const result = await f.adapter.getSignal();
    expect(result).toMatchObject({ currentSellVolumeUsd: 0, anomalyRatio: 0, txCount: 1, uniqueWallets: 1 });
    expect(f.getTransaction).toHaveBeenCalledTimes(2); // Baseline and the zero-output sell; not the buy.
  });

  it("counts all unique events but deduplicates transaction hashes and originating wallets case-insensitively", async () => {
    const a = log(375, 2, 200_000_000n);
    const f = fixture([log(350, 1, 100_000_000n), a, { ...a }, log(375, 2, 300_000_000n, 10n ** 18n, 3), log(399, 4, 400_000_000n)]);
    const base = f.getTransaction.getMockImplementation()!;
    f.getTransaction.mockImplementation(async (args) => ({ ...await base(args), from: args.hash === hash(4) ? origin.toLowerCase() as Address : origin }));
    expect(await f.adapter.getSignal()).toMatchObject({ currentSellVolumeUsd: 918, txCount: 2, uniqueWallets: 1 });
    expect(f.getTransaction).toHaveBeenCalledTimes(3);
  });

  it("uses tx.from, not the event sender or recipient, for wallet counts", async () => {
    const f = fixture();
    const base = f.getTransaction.getMockImplementation()!;
    f.getTransaction.mockImplementation(async (args) => ({ ...await base(args), from: args.hash === hash(3) ? otherOrigin : origin }));
    expect(await f.adapter.getSignal()).toMatchObject({ txCount: 2, uniqueWallets: 2 });
  });

  it("calculates from all events when evidence is sampled and completes a partial final batch", async () => {
    const logs = [log(350, 1, 100_000_000n), ...Array.from({ length: 22 }, (_, index) => log(375, index + 2, 1_000_000n))];
    const f = fixture(logs);
    const result = await f.adapter.getSignal();
    expect(result.currentSellVolumeUsd).toBeCloseTo(22 * 1.02);
    expect(result.txCount).toBe(22);
    expect(result.evidence.filter((item) => item.type === "CONTRACT_EVENT")).toHaveLength(20);
    expect(f.getTransaction).toHaveBeenCalledTimes(23);
  });

  it.each([[[]], [[log(375, 2, 1n)]], [[log(350, 1, 0n), log(375, 2, 1n)]]])("fails with EMPTY_BASELINE rather than returning an invented ratio (%#)", async (logs) => {
    await expect(fixture(logs).adapter.getSignal()).rejects.toMatchObject({ code: "EMPTY_BASELINE" });
  });

  it("supports a positive baseline and an empty current window", async () => {
    expect(await fixture([log(350, 1, 100_000_000n)]).adapter.getSignal()).toMatchObject({ currentSellVolumeUsd: 0, txCount: 0, uniqueWallets: 0 });
  });

  it("captures fresh data on each getter, not a persistent snapshot", async () => {
    const f = fixture();
    await f.adapter.getSignal();
    await f.adapter.getSignal();
    expect(f.source).toHaveBeenCalledTimes(2);
    expect(f.getRawLogs).toHaveBeenCalledTimes(2);
  });

  it.each([
    { removed: true }, { removed: undefined }, { blockHash: null }, { blockHash: "0x1" }, { transactionHash: null },
    { address: USDC_ADDRESS }, { blockNumber: "0x15d" }, { blockNumber: "0x190" }, { logIndex: "0x00" },
    { transactionIndex: null }, { data: "0x12" }, { data: `${log(375, 2, 1n).data}00` }, { topics: [] },
    { topics: [hash(1), hash(2), hash(3)] }, { logIndex: "0x20000000000000" },
  ])("rejects missing, malformed, removed, wrong-pool or out-of-range event data (%#)", async (patch) => {
    const f = fixture();
    Object.assign(f.logs[1], patch);
    await expect(f.adapter.getSignal()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("rejects a non-array raw response instead of silently treating it as empty", async () => {
    const f = fixture();
    f.getRawLogs.mockResolvedValue({ logs: f.logs });
    await expect(f.adapter.getSignal()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([2, 3, 4])("rejects noncanonical or out-of-range uint160/uint128/int24 data word %s", async (word) => {
    const f = fixture();
    const data = f.logs[1].data;
    const badWord = word === 4 ? "0".repeat(56) + "00800000" : "f".repeat(64);
    f.logs[1].data = `${data.slice(0, 2 + word * 64)}${badWord}${data.slice(2 + (word + 1) * 64)}` as `0x${string}`;
    await expect(f.adapter.getSignal()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("rejects nonzero indexed address padding rather than truncating it", async () => {
    const f = fixture();
    f.logs[1].topics[1] = `0x${"f".repeat(24)}${f.logs[1].topics[1]!.slice(26)}`;
    await expect(f.adapter.getSignal()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("rejects duplicate event identities with conflicting payloads", async () => {
    const f = fixture();
    f.logs.push({ ...f.logs[1], data: log(375, 2, 201n).data });
    await expect(f.adapter.getSignal()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([log(375, 2, -1n, 1n), log(375, 2, 1n, -1n)])("rejects impossible pool balance directions (%#)", async (bad) => {
    const f = fixture([log(350, 1, 100_000_000n), bad]);
    await expect(f.adapter.getSignal()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("rejects a log block hash which disagrees with the actual block", async () => {
    const f = fixture();
    f.logs[1].blockHash = hash(9999);
    await expect(f.adapter.getSignal()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([{ from: "0x1" }, { blockNumber: 1n }, { blockHash: hash(9999) }, { hash: hash(9999) }, { blockHash: null }])("rejects inconsistent transaction evidence (%#)", async (patch) => {
    const f = fixture();
    const base = f.getTransaction.getMockImplementation()!;
    f.getTransaction.mockImplementation(async (args) => ({ ...await base(args), ...patch }) as never);
    await expect(f.adapter.getSignal()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("rejects a transaction hash reported in two different blocks", async () => {
    const f = fixture([log(350, 1, 100_000_000n), log(375, 2, 1n), log(399, 2, 2n)]);
    await expect(f.adapter.getSignal()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([ ["fee", 3000], ["token0", WETH_ADDRESS], ["token1", USDC_ADDRESS] ])("rejects a different pool definition: %s", async (name, value) => {
    const f = fixture();
    const base = f.readContract.getMockImplementation()!;
    f.readContract.mockImplementation((args) => args.functionName === name ? Promise.resolve(value) : base(args));
    await expect(f.adapter.getSignal()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    expect(f.getRawLogs).not.toHaveBeenCalled();
  });

  it("fails on a changed canonical anchor after collecting logs", async () => {
    const f = fixture();
    const base = f.getBlock.getMockImplementation()!;
    f.getBlock.mockImplementation(async (args) => ({ ...await base(args), ...(args?.blockNumber === 400n ? { hash: hash(9999) } : {}) }));
    await expect(f.adapter.getSignal()).rejects.toMatchObject({ code: "REORG_DETECTED" });
  });

  it("does not retry, fabricate volume, or leak a raw RPC exception", async () => {
    const f = fixture();
    f.getRawLogs.mockRejectedValue(new Error("https://rpc.invalid/SECRET_API_KEY"));
    await expect(f.adapter.getSignal()).rejects.toMatchObject({ code: "RPC_READ_FAILED" });
    expect(f.getRawLogs).toHaveBeenCalledOnce();
    await expect(f.adapter.getSignal()).rejects.not.toThrow("SECRET_API_KEY");
  });

  it("validates the frozen contract at the service boundary", async () => {
    const valid = await fixture().adapter.getSignal();
    await expect(new OnchainSignalService({ getSignal: async () => valid }).getSignal()).resolves.toEqual(valid);
    await expect(new OnchainSignalService({ getSignal: async () => ({ ...valid, baselineSellVolumeUsd: 0 }) }).getSignal())
      .rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });
});
