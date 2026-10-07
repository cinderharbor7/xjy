import { maxUint256, type Address, type Hash, type ReadContractParameters } from "viem";
import { describe, expect, it, vi } from "vitest";
import { OnchainEvidenceSchema, PortfolioStateSchema } from "@/domain/schemas";
import { ETH_USD_FEED, USDC_ADDRESS, USDC_USD_FEED } from "@/modules/onchain/ethereum-contracts";
import { EthereumSnapshot, type EthereumReadClient, type SnapshotSource } from "@/modules/onchain/ethereum-reader";
import { EthereumReadError } from "@/modules/onchain/read-error";
import { EthereumPortfolioAdapter } from "@/modules/portfolio/ethereum-portfolio.adapter";
import { PortfolioService } from "@/modules/portfolio/portfolio.service";

const wallet = "0xA00000000000000000000000000000000000000B" as Address;
const anchorHash = `0x${"11".repeat(32)}` as Hash;
const replacementHash = `0x${"22".repeat(32)}` as Hash;
const timestamp = new Date(100_070_000).toISOString();

function fixture(options: { ethRaw?: unknown; usdcRaw?: unknown; usdcDecimals?: unknown; ethUsd?: bigint; usdcUsd?: bigint } = {}) {
  const getChainId = vi.fn(async () => 1);
  const getBlock = vi.fn(async (_parameters?: { blockNumber?: bigint; blockTag?: "latest" }) => ({
    number: 3n, hash: anchorHash, timestamp: 100_070n,
  }));
  const getBalance = vi.fn(async (_parameters: Parameters<EthereumReadClient["getBalance"]>[0]) => (options.ethRaw ?? 2_000_000_000_000_000_000n) as bigint);
  const readContract = vi.fn(async (parameters: ReadContractParameters): Promise<unknown> => {
    if (parameters.address === USDC_ADDRESS) {
      if (parameters.functionName === "decimals") return options.usdcDecimals ?? 6;
      if (parameters.functionName === "balanceOf") return options.usdcRaw ?? 1_000_000_000n;
    }
    if (parameters.functionName === "description") return parameters.address === ETH_USD_FEED ? "ETH / USD" : "USDC / USD";
    if (parameters.functionName === "decimals") return 8;
    if (parameters.functionName === "latestRoundData") {
      const answer = parameters.address === ETH_USD_FEED ? options.ethUsd ?? 280_000_000_000n : options.usdcUsd ?? 98_000_000n;
      return [9n, answer, 100_000n, 100_000n, 9n];
    }
    throw new Error("Unexpected fixture read.");
  });
  const getTransaction = vi.fn(async ({ hash }: { hash: Hash }) => ({ hash, from: wallet, blockHash: anchorHash, blockNumber: 3n }));
  const getRawLogs = vi.fn(async () => []);
  const client: EthereumReadClient = {
    getChainId, getBlock, getBalance, readContract: readContract as EthereumReadClient["readContract"], getTransaction, getRawLogs,
  };
  const source = vi.fn(async () => EthereumSnapshot.capture(client));
  const adapter = new EthereumPortfolioAdapter(source);
  return { adapter, client, source, getChainId, getBlock, getBalance, readContract, getTransaction, getRawLogs };
}

describe("EthereumPortfolioAdapter real read boundary", () => {
  it("values native ETH and USDC with separate dollar prices and returns the frozen domain contract", async () => {
    const { adapter } = fixture();
    const state = await adapter.getPortfolio(wallet);
    expect(state).toEqual({
      wallet,
      totalUsd: 6580,
      riskAssetUsd: 5600,
      defensiveAssetUsd: 980,
      riskExposurePct: 5600 / 6580 * 100,
      assets: [
        { symbol: "ETH", amount: 2, usdValue: 5600, category: "RISK" },
        { symbol: "USDC", tokenAddress: USDC_ADDRESS, amount: 1000, usdValue: 980, category: "DEFENSIVE" },
      ],
      timestamp,
      blockNumber: 3,
    });
    expect(PortfolioStateSchema.parse(state)).toEqual(state);
    expect(state).not.toHaveProperty("evidence");
    expect(state.assets[0]).not.toHaveProperty("tokenAddress");
  });

  it("handles 18-decimal ETH and 6-decimal USDC without treating wei as whole ETH", async () => {
    const { adapter } = fixture({ ethRaw: 1_234_567_890_000_000_000n, usdcRaw: 1_234_567n });
    const state = await adapter.getPortfolio(wallet);
    expect(state.assets.map((asset) => asset.amount)).toEqual([1.23456789, 1.234567]);
    expect(state.riskAssetUsd).toBeCloseTo(3456.790092, 8);
    expect(state.defensiveAssetUsd).toBeCloseTo(1.20987566, 8);
  });

  it("preserves one wei and one USDC base unit as positive balances", async () => {
    const state = await fixture({ ethRaw: 1n, usdcRaw: 1n }).adapter.getPortfolio(wallet);
    expect(state.assets.map((asset) => asset.amount)).toEqual([1e-18, 1e-6]);
    expect(state.riskAssetUsd).toBeGreaterThan(0);
    expect(state.defensiveAssetUsd).toBeGreaterThan(0);
    expect(PortfolioStateSchema.safeParse(state).success).toBe(true);
  });

  it("supports an empty wallet with zero total and zero exposure", async () => {
    const state = await fixture({ ethRaw: 0n, usdcRaw: 0n }).adapter.getPortfolio(wallet);
    expect(state).toMatchObject({ totalUsd: 0, riskAssetUsd: 0, defensiveAssetUsd: 0, riskExposurePct: 0 });
    expect(state.assets.map((asset) => [asset.amount, asset.usdValue])).toEqual([[0, 0], [0, 0]]);
    expect(PortfolioStateSchema.safeParse(state).success).toBe(true);
  });

  it.each([
    { ethRaw: 0n, usdcRaw: 1_000_000n, exposure: 0 },
    { ethRaw: 1_000_000_000_000_000_000n, usdcRaw: 0n, exposure: 100 },
  ])("computes exposure at the asset-only boundary $exposure", async ({ ethRaw, usdcRaw, exposure }) => {
    expect((await fixture({ ethRaw, usdcRaw }).adapter.getPortfolio(wallet)).riskExposurePct).toBe(exposure);
  });

  it("uses the same canonical hash for native balance, USDC metadata/balance and all prices", async () => {
    const { adapter, getBalance, readContract, getBlock, getTransaction, getRawLogs } = fixture();
    await adapter.getPortfolio(wallet);
    expect(getBalance).toHaveBeenCalledExactlyOnceWith({ address: wallet, blockHash: anchorHash, requireCanonical: true });
    const tokenReads = readContract.mock.calls.map(([parameters]) => parameters).filter((parameters) => parameters.address === USDC_ADDRESS);
    expect(tokenReads).toHaveLength(2);
    expect(tokenReads).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: USDC_ADDRESS, functionName: "decimals" }),
      expect.objectContaining({ address: USDC_ADDRESS, functionName: "balanceOf", args: [wallet] }),
    ]));
    for (const [parameters] of readContract.mock.calls) {
      expect(parameters).toMatchObject({ blockHash: anchorHash, requireCanonical: true });
      expect(parameters).not.toHaveProperty("blockNumber");
      expect(parameters).not.toHaveProperty("blockTag");
    }
    expect(getBlock.mock.calls).toEqual([[{ blockTag: "latest" }], [{ blockNumber: 3n }]]);
    expect(getTransaction).not.toHaveBeenCalled();
    expect(getRawLogs).not.toHaveBeenCalled();
  });

  it("returns independently identifiable balance and real price BLOCK evidence in the read wrapper", async () => {
    const { adapter } = fixture();
    const result = await adapter.readPortfolio(wallet);
    expect(Object.keys(result).sort()).toEqual(["evidence", "state"]);
    expect(result.evidence).toHaveLength(4);
    result.evidence.forEach((evidence) => {
      expect(OnchainEvidenceSchema.safeParse(evidence).success).toBe(true);
      expect(evidence).toMatchObject({ type: "BLOCK", blockHash: anchorHash, blockNumber: 3, source: "https://etherscan.io/block/3" });
      expect(evidence).not.toHaveProperty("txHash");
    });
    expect(result.evidence[0].description).toContain(wallet);
    expect(result.evidence[0].description).toContain("2 ETH");
    expect(result.evidence[0]).not.toHaveProperty("contractAddress");
    expect(result.evidence[1]).toMatchObject({ contractAddress: USDC_ADDRESS });
    expect(result.evidence[1].description).toContain("1000 USDC");
    expect(result.evidence.slice(2).map((evidence) => evidence.contractAddress)).toEqual([ETH_USD_FEED, USDC_USD_FEED]);
    expect(result.evidence[2].description).toMatch(/Chainlink ETH\/USD.*roundId=9.*updatedAt=100000/);
    expect(result.evidence[3].description).toMatch(/Chainlink USDC\/USD.*roundId=9.*updatedAt=100000/);
  });

  it.each(["", " ", "demo-wallet", "alice.eth", "0x1", `0x${"g".repeat(40)}`, `0x${"1".repeat(41)}`, null, undefined, 1])("rejects invalid wallet %s before capturing a snapshot or reading RPC", async (value) => {
    const { adapter, source, getChainId, getBlock, getBalance, readContract } = fixture();
    await expect(adapter.readPortfolio(value as string)).rejects.toMatchObject({ code: "INVALID_WALLET" });
    await expect(adapter.getPortfolio(value as string)).rejects.toMatchObject({ code: "INVALID_WALLET" });
    for (const operation of [source, getChainId, getBlock, getBalance, readContract]) expect(operation).not.toHaveBeenCalled();
  });

  it("trims the address while preserving its original casing across the existing PortfolioService", async () => {
    const { adapter, getBalance, readContract } = fixture();
    const state = await new PortfolioService(adapter).getPortfolio(` \n${wallet}\t `);
    expect(state.wallet).toBe(wallet);
    expect(getBalance).toHaveBeenCalledWith(expect.objectContaining({ address: wallet }));
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "balanceOf", args: [wallet] }));
  });

  it("captures a new snapshot and reads current balances for every getter and wrapper operation", async () => {
    const { adapter, source, getBlock, getBalance, readContract } = fixture();
    const before = await adapter.getPortfolio(wallet);
    getBalance.mockResolvedValue(1_000_000_000_000_000_000n);
    const after = await adapter.getPortfolio(wallet);
    await adapter.readPortfolio(wallet);
    expect(before.assets[0].amount).toBe(2);
    expect(after.assets[0].amount).toBe(1);
    expect(source).toHaveBeenCalledTimes(3);
    expect(getBalance).toHaveBeenCalledTimes(3);
    expect(getBlock).toHaveBeenCalledTimes(6);
    expect(readContract.mock.calls.filter(([parameters]) => parameters.functionName === "latestRoundData")).toHaveLength(6);
  });

  it("does not share mutable portfolio results between reads", async () => {
    const { adapter } = fixture();
    const first = await adapter.getPortfolio(wallet);
    first.assets[0].amount = 0;
    first.riskAssetUsd = 0;
    const second = await adapter.getPortfolio(wallet);
    expect(second.assets[0].amount).toBe(2);
    expect(second.riskAssetUsd).toBe(5600);
  });

  it.each([0, 8, 18, -1, 6n, "6", 6.5, NaN])("rejects USDC decimals %s instead of scaling or guessing", async (usdcDecimals) => {
    await expect(fixture({ usdcDecimals }).adapter.getPortfolio(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([-1n, maxUint256 + 1n, maxUint256, "1000", 1, NaN])("rejects malformed or unsupported native ETH balance %s", async (ethRaw) => {
    await expect(fixture({ ethRaw }).adapter.getPortfolio(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([-1n, maxUint256 + 1n, maxUint256, "1000", 1, NaN])("rejects malformed or unsupported USDC balance %s", async (usdcRaw) => {
    await expect(fixture({ usdcRaw }).adapter.getPortfolio(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("propagates a wrong network without reading balances", async () => {
    const { adapter, getChainId, getBalance, readContract } = fixture();
    getChainId.mockResolvedValue(10);
    await expect(adapter.getPortfolio(wallet)).rejects.toMatchObject({ code: "UNSUPPORTED_NETWORK" });
    expect(getBalance).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
  });

  it.each(["ETH", "USDC"])("rejects an unavailable %s price even for an empty wallet", async (asset) => {
    const { adapter, readContract } = fixture({ ethRaw: 0n, usdcRaw: 0n, ...(asset === "ETH" ? { ethUsd: 0n } : { usdcUsd: 0n }) });
    await expect(adapter.getPortfolio(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: asset === "ETH" ? ETH_USD_FEED : USDC_USD_FEED, functionName: "latestRoundData",
    }));
  });

  it("rejects a reorg discovered after balances and quotes were read", async () => {
    const { adapter, getBlock } = fixture();
    getBlock.mockResolvedValueOnce({ number: 3n, hash: anchorHash, timestamp: 100_070n });
    getBlock.mockResolvedValueOnce({ number: 3n, hash: replacementHash, timestamp: 100_070n });
    await expect(adapter.readPortfolio(wallet)).rejects.toMatchObject({ code: "REORG_DETECTED" });
    expect(getBlock).toHaveBeenCalledTimes(2);
  });

  it("waits for canonical verification before exposing a result", async () => {
    const { adapter, client } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const verification = vi.spyOn(snapshot, "verifyCanonical").mockImplementation(() => pending);
    const source: SnapshotSource = async () => snapshot;
    const operation = new EthereumPortfolioAdapter(source).readPortfolio(wallet);
    let completed = false;
    operation.then(() => { completed = true; });
    await vi.waitFor(() => expect(verification).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    release();
    expect((await operation).state.wallet).toBe(wallet);
    expect(adapter).toBeInstanceOf(EthereumPortfolioAdapter);
  });

  it("reports output validation as invalid chain data without exposing schema internals", async () => {
    const { client } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    const realQuote = await snapshot.readUsdPrice("ETH");
    vi.spyOn(snapshot, "readUsdPrice").mockResolvedValue({ ...realQuote, usd: Infinity });
    const error = await new EthereumPortfolioAdapter(async () => snapshot).getPortfolio(wallet).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EthereumReadError);
    expect(error).toMatchObject({ code: "INVALID_CHAIN_DATA", message: "Ethereum returned an inconsistent portfolio snapshot." });
    expect(error).not.toHaveProperty("issues");
  });

  it.each(["source", "balance", "token", "canonical"])("sanitizes %s RPC failures instead of returning partial or fallback values", async (operation) => {
    const { adapter, client, getBalance, readContract, getBlock } = fixture();
    const rawError = new Error("https://rpc.invalid/SECRET_KEY wallet=secret", { cause: new Error("API_TOKEN") });
    let selected = adapter;
    if (operation === "source") selected = new EthereumPortfolioAdapter(async () => { throw rawError; });
    if (operation === "balance") getBalance.mockRejectedValue(rawError);
    if (operation === "token") readContract.mockRejectedValue(rawError);
    if (operation === "canonical") {
      const snapshot = await EthereumSnapshot.capture(client);
      getBlock.mockRejectedValue(rawError);
      selected = new EthereumPortfolioAdapter(async () => snapshot);
    }
    const error = await selected.readPortfolio(wallet).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EthereumReadError);
    expect(error).toMatchObject({ code: "RPC_READ_FAILED" });
    expect(String(error)).not.toMatch(/SECRET_KEY|API_TOKEN|wallet=secret|rpc\.invalid/);
    expect(error).not.toHaveProperty("cause");
  });
});
