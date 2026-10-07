import { maxUint256, zeroAddress, type Address, type Hash, type ReadContractParameters } from "viem";
import { describe, expect, it, vi } from "vitest";
import { PortfolioStateSchema } from "@/domain/schemas";
import { USDC_ADDRESS, WETH_ADDRESS } from "@/modules/onchain/ethereum-contracts";
import { ForkObservationReader, type ForkObservationClient, type ForkObservationConfig } from "@/modules/onchain/fork-observation-reader";
import { EthereumReadError } from "@/modules/onchain/read-error";

const wallet = "0xA00000000000000000000000000000000000000B" as Address;
const factory = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f" as Address;
const pair = "0xB4e16d0168e52d35CaCD2c6185b44281Ec28C9Dc" as Address;
const blockHash = `0x${"ab".repeat(32)}` as Hash;
const otherHash = `0x${"cd".repeat(32)}` as Hash;
const chainBlock = { number: 31n, hash: blockHash, timestamp: 1_791_331_200n };
const timestamp = new Date(Number(chainBlock.timestamp) * 1000).toISOString();

function config(): ForkObservationConfig {
  return { chainId: 1, wallet, factory,
    weth: { address: WETH_ADDRESS, decimals: 18 }, usdc: { address: USDC_ADDRESS, decimals: 6 } };
}

function fixture(options: {
  pair?: unknown; token0?: unknown; token1?: unknown; reserves?: unknown;
  wethDecimals?: unknown; usdcDecimals?: unknown; wethRaw?: unknown; usdcRaw?: unknown;
} = {}) {
  const state = { pair, token0: USDC_ADDRESS, token1: WETH_ADDRESS,
    reserves: [2_800_000_000_000n, 1_000_000_000_000_000_000_000n, 0],
    wethDecimals: 18, usdcDecimals: 6, wethRaw: 2_000_000_000_000_000_000n, usdcRaw: 500_000_000n, ...options };
  const getChainId = vi.fn(async () => 1);
  const getBlock = vi.fn(async (_parameters: { blockNumber?: bigint; blockTag?: string }) => chainBlock as unknown);
  const readContract = vi.fn(async (parameters: ReadContractParameters): Promise<unknown> => {
    if (parameters.functionName === "getPair") return state.pair;
    if (parameters.functionName === "token0") return state.token0;
    if (parameters.functionName === "token1") return state.token1;
    if (parameters.functionName === "getReserves") return state.reserves;
    if (parameters.address?.toLowerCase() === WETH_ADDRESS.toLowerCase()) {
      if (parameters.functionName === "decimals") return state.wethDecimals;
      if (parameters.functionName === "balanceOf") return state.wethRaw;
    }
    if (parameters.address?.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
      if (parameters.functionName === "decimals") return state.usdcDecimals;
      if (parameters.functionName === "balanceOf") return state.usdcRaw;
    }
    throw new Error("Unexpected fixture contract read.");
  });
  const client: ForkObservationClient = { getChainId,
    getBlock: getBlock as ForkObservationClient["getBlock"],
    readContract: readContract as ForkObservationClient["readContract"] };
  return { reader: new ForkObservationReader(client, config()), client, state, getChainId, getBlock, readContract };
}

describe("ForkObservationReader WETH/USDC observation", () => {
  it("returns one block's tradable portfolio, V2 quote and verifiable block identity", async () => {
    const result = await fixture().reader.read(wallet);
    expect(result).toEqual({ priceUsd: 2800, block: { number: 31, hash: blockHash, timestamp },
      portfolio: { wallet, totalUsd: 6100, riskAssetUsd: 5600, defensiveAssetUsd: 500,
        riskExposurePct: 5600 / 6100 * 100, blockNumber: 31, timestamp,
        assets: [
          { symbol: "ETH", tokenAddress: WETH_ADDRESS, amount: 2, usdValue: 5600, category: "RISK" },
          { symbol: "USDC", tokenAddress: USDC_ADDRESS, amount: 500, usdValue: 500, category: "DEFENSIVE" },
        ] } });
    expect(PortfolioStateSchema.parse(result.portfolio)).toEqual(result.portfolio);
    expect(result.portfolio.timestamp).toBe(result.block.timestamp);
  });

  it("pins factory, pair, decimals and balances to the same canonical hash without reading native ETH", async () => {
    const f = fixture();
    await f.reader.read(wallet);
    expect(f.readContract).toHaveBeenCalledTimes(8);
    for (const [request] of f.readContract.mock.calls) {
      expect(request).toMatchObject({ blockHash, requireCanonical: true });
      expect(request).not.toHaveProperty("blockNumber");
      expect(request).not.toHaveProperty("blockTag");
    }
    expect(f.readContract.mock.calls.filter(([r]) => r.functionName === "balanceOf").map(([r]) => r.address)).toEqual([WETH_ADDRESS, USDC_ADDRESS]);
    expect(f.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: WETH_ADDRESS, functionName: "decimals" }));
    expect(f.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: USDC_ADDRESS, functionName: "decimals" }));
    expect(f.getBlock.mock.calls).toEqual([[{ blockTag: "latest" }], [{ blockNumber: 31n }]]);
    expect(f.client).not.toHaveProperty("getBalance");
  });

  it("accepts either valid on-chain token order and scales each reserve correctly", async () => {
    const f = fixture({ token0: WETH_ADDRESS.toLowerCase(), token1: USDC_ADDRESS.toLowerCase(),
      reserves: [1_000_000_000_000_000_000_000n, 2_800_000_000_000n, 0xffff_ffff] });
    expect((await f.reader.read(wallet)).priceUsd).toBe(2800);
  });

  it("binds wallet case-insensitively and returns the configured wallet identity", async () => {
    const f = fixture();
    const result = await f.reader.read(` \n${wallet.toLowerCase()}\t `);
    expect(result.portfolio.wallet).toBe(wallet);
    for (const [request] of f.readContract.mock.calls.filter(([r]) => r.functionName === "balanceOf")) expect(request.args).toEqual([wallet]);
  });

  it.each(["", "demo-wallet", "alice.eth", "0x1", `0x${"g".repeat(40)}`, null, undefined])("rejects malformed wallet %s before RPC", async value => {
    const f = fixture();
    await expect(f.reader.read(value as string)).rejects.toMatchObject({ code: "INVALID_WALLET" });
    expect(f.getChainId).not.toHaveBeenCalled();
    expect(f.getBlock).not.toHaveBeenCalled();
    expect(f.readContract).not.toHaveBeenCalled();
  });

  it("rejects another valid wallet before RPC", async () => {
    const f = fixture();
    await expect(f.reader.read(`0x${"11".repeat(20)}`)).rejects.toMatchObject({ code: "INVALID_WALLET" });
    expect(f.getChainId).not.toHaveBeenCalled();
  });

  it.each([
    { wethRaw: 0n, usdcRaw: 500_000_000n, total: 500, exposure: 0 },
    { wethRaw: 0n, usdcRaw: 0n, total: 0, exposure: 0 },
    { wethRaw: 2_000_000_000_000_000_000n, usdcRaw: 0n, total: 5600, exposure: 100 },
  ])("keeps market price available with total=$total exposure=$exposure", async values => {
    const result = await fixture(values).reader.read(wallet);
    expect(result.priceUsd).toBe(2800);
    expect(result.portfolio.totalUsd).toBe(values.total);
    expect(result.portfolio.riskExposurePct).toBe(values.exposure);
  });

  it("preserves one WETH wei and one USDC base unit", async () => {
    const result = await fixture({ wethRaw: 1n, usdcRaw: 1n }).reader.read(wallet);
    expect(result.portfolio.assets.map(a => a.amount)).toEqual([1e-18, 1e-6]);
    expect(result.portfolio.riskAssetUsd).toBe(2.8e-15);
  });

  it("captures a new block and balances on every read without reusing mutable output", async () => {
    const f = fixture();
    const before = await f.reader.read(wallet);
    before.portfolio.assets[0].amount = 999;
    f.state.wethRaw = 0n;
    f.getBlock.mockResolvedValue({ number: 32n, hash: otherHash, timestamp: chainBlock.timestamp + 12n });
    const after = await f.reader.read(wallet);
    expect(after.portfolio.assets[0].amount).toBe(0);
    expect(after.block).toEqual({ number: 32, hash: otherHash, timestamp: new Date(Number(chainBlock.timestamp + 12n) * 1000).toISOString() });
    expect(f.getChainId).toHaveBeenCalledTimes(2);
    expect(f.getBlock).toHaveBeenCalledTimes(4);
    expect(f.readContract).toHaveBeenCalledTimes(16);
  });

  it("copies configuration so callers cannot change the approved identity during later reads", async () => {
    const f = fixture(), input = config();
    const reader = new ForkObservationReader(f.client, input);
    input.wallet = `0x${"11".repeat(20)}`;
    input.weth.address = input.usdc.address;
    input.usdc.decimals = 18;
    const result = await reader.read(wallet);
    expect(result.portfolio.wallet).toBe(wallet);
    expect(result.portfolio.assets.map(a => a.tokenAddress)).toEqual([WETH_ADDRESS, USDC_ADDRESS]);
  });

  it.each([
    { chainId: 0 }, { chainId: 1.5 }, { chainId: NaN }, { chainId: Number.MAX_SAFE_INTEGER + 1 },
    { wallet: "invalid" }, { factory: zeroAddress }, { factory: "invalid" },
    { weth: { address: WETH_ADDRESS, decimals: 6 } },
    { usdc: { address: USDC_ADDRESS, decimals: 18 } },
    { weth: { address: zeroAddress, decimals: 18 } },
    { usdc: { address: WETH_ADDRESS, decimals: 6 } },
  ])("rejects invalid trusted configuration %# without RPC", change => {
    const f = fixture();
    expect(() => new ForkObservationReader(f.client, { ...config(), ...change } as ForkObservationConfig)).toThrow(EthereumReadError);
    expect(f.getChainId).not.toHaveBeenCalled();
  });

  it("rejects the wrong chain before capturing blocks or reading contracts", async () => {
    const f = fixture(); f.getChainId.mockResolvedValue(1337);
    await expect(f.reader.read(wallet)).rejects.toMatchObject({ code: "UNSUPPORTED_NETWORK" });
    expect(f.getBlock).not.toHaveBeenCalled(); expect(f.readContract).not.toHaveBeenCalled();
  });

  it.each([zeroAddress, "0x1", null, undefined, 123])("rejects missing or invalid pair %# without attempting pair reads", async value => {
    const f = fixture({ pair: value });
    await expect(f.reader.read(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    expect(f.readContract).toHaveBeenCalledOnce();
  });

  it.each([
    { token0: WETH_ADDRESS, token1: WETH_ADDRESS },
    { token0: USDC_ADDRESS, token1: USDC_ADDRESS },
    { token0: zeroAddress }, { token1: zeroAddress }, { token0: "0x1" }, { token1: null },
    { token0: `0x${"11".repeat(20)}`, token1: WETH_ADDRESS },
  ])("rejects wrong token identity/order %#", async values => {
    await expect(fixture(values).reader.read(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([0, 8, 18, 6n, "6", NaN, undefined])("rejects mismatched or malformed USDC decimals %#", async usdcDecimals => {
    await expect(fixture({ usdcDecimals }).reader.read(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });
  it.each([0, 6, 18n, "18", NaN, undefined])("rejects mismatched or malformed WETH decimals %#", async wethDecimals => {
    await expect(fixture({ wethDecimals }).reader.read(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([
    [], [1n, 1n], [1n, 1n, 0, 0], [0n, 1n, 0], [1n, 0n, 0], [-1n, 1n, 0],
    [1n << 112n, 1n, 0], [1n, 1n << 112n, 0], [1, 1n, 0], [1n, "1", 0],
    [1n, 1n, -1], [1n, 1n, 0x1_0000_0000], [1n, 1n, 0n], [1n, 1n, NaN], null,
  ])("rejects malformed, zero or out-of-ABI reserves %#", async reserves => {
    await expect(fixture({ reserves }).reader.read(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each(["wethRaw", "usdcRaw"] as const)("rejects malformed or unsupported %s balances", async field => {
    for (const value of [-1n, maxUint256 + 1n, maxUint256, "1", 1, null]) {
      await expect(fixture({ [field]: value }).reader.read(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    }
  });

  it("rejects a quote beyond the safe number range", async () => {
    await expect(fixture({ reserves: [9_000_000_000_000_000_000_000n, 1n, 0] }).reader.read(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });
  it("rejects an aggregate valuation beyond the safe number range", async () => {
    await expect(fixture({ wethRaw: 9_000_000_000_000_000_000_000_000_000_000_000n }).reader.read(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([
    null, [], {}, { ...chainBlock, number: null }, { ...chainBlock, number: -1n },
    { ...chainBlock, number: BigInt(Number.MAX_SAFE_INTEGER) + 1n }, { ...chainBlock, number: 31 },
    { ...chainBlock, hash: "0x1" }, { ...chainBlock, hash: null },
    { ...chainBlock, timestamp: -1n }, { ...chainBlock, timestamp: 1 },
    { ...chainBlock, timestamp: 253_402_300_800n },
  ])("rejects invalid captured block evidence %# without contract reads", async block => {
    const f = fixture(); f.getBlock.mockResolvedValue(block);
    await expect(f.reader.read(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    expect(f.readContract).not.toHaveBeenCalled();
  });

  it("returns the chain's historical UTC time rather than the computer time", async () => {
    const f = fixture(); f.getBlock.mockResolvedValue({ ...chainBlock, timestamp: 100_000n });
    expect((await f.reader.read(wallet)).portfolio.timestamp).toBe("1970-01-02T03:46:40.000Z");
  });

  it("accepts block hashes with different hexadecimal casing at canonical verification", async () => {
    const f = fixture();
    f.getBlock.mockResolvedValueOnce(chainBlock).mockResolvedValueOnce({ ...chainBlock, hash: `0x${"AB".repeat(32)}` });
    expect((await f.reader.read(wallet)).block.hash).toBe(blockHash);
  });

  it.each([
    { block: { ...chainBlock, hash: otherHash }, code: "REORG_DETECTED" },
    { block: { ...chainBlock, number: 32n }, code: "INVALID_CHAIN_DATA" },
    { block: { ...chainBlock, timestamp: chainBlock.timestamp + 1n }, code: "INVALID_CHAIN_DATA" },
    { block: { ...chainBlock, hash: null }, code: "INVALID_CHAIN_DATA" },
  ])("rejects changed canonical evidence %# before returning a result", async ({ block, code }) => {
    const f = fixture(); f.getBlock.mockResolvedValueOnce(chainBlock).mockResolvedValueOnce(block);
    await expect(f.reader.read(wallet)).rejects.toMatchObject({ code });
    expect(f.getBlock).toHaveBeenCalledTimes(2);
  });

  it("waits for final canonical verification before exposing portfolio or quote", async () => {
    const f = fixture(); let release!: (block: unknown) => void;
    f.getBlock.mockResolvedValueOnce(chainBlock).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.reader.read(wallet); let finished = false;
    pending.then(() => { finished = true; });
    await vi.waitFor(() => expect(f.getBlock).toHaveBeenCalledTimes(2));
    expect(finished).toBe(false);
    release(chainBlock); expect((await pending).priceUsd).toBe(2800);
  });

  it.each(["chain", "anchor", "pair", "metadata", "canonical"])("sanitizes %s RPC failures and does not retry or provide partial data", async stage => {
    const f = fixture();
    const rawError = new Error("https://rpc.invalid/SECRET_KEY request=private", { cause: new Error("API_TOKEN") });
    if (stage === "chain") f.getChainId.mockRejectedValue(rawError);
    if (stage === "anchor") f.getBlock.mockRejectedValue(rawError);
    if (stage === "pair") f.readContract.mockRejectedValue(rawError);
    if (stage === "metadata") f.readContract.mockResolvedValueOnce(pair).mockRejectedValue(rawError);
    if (stage === "canonical") f.getBlock.mockResolvedValueOnce(chainBlock).mockRejectedValue(rawError);
    const error = await f.reader.read(wallet).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EthereumReadError);
    expect(error).toMatchObject({ code: "RPC_READ_FAILED" });
    expect(String(error)).not.toMatch(/SECRET_KEY|API_TOKEN|request=private|rpc\.invalid/);
    expect(error).not.toHaveProperty("cause");
    expect(f.getChainId).toHaveBeenCalledOnce();
    expect(f.getBlock.mock.calls.length).toBeLessThanOrEqual(2);
    expect(f.readContract.mock.calls.filter(([request]) => request.functionName === "getPair")).toHaveLength(["chain", "anchor"].includes(stage) ? 0 : 1);
  });

  it("preserves an explicit trusted read failure without converting it to a price", async () => {
    const f = fixture(); const error = new EthereumReadError("REORG_DETECTED", "Canonical read rejected.");
    f.readContract.mockRejectedValue(error);
    await expect(f.reader.read(wallet)).rejects.toBe(error);
  });
});
