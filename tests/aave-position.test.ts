import { createPublicClient, http, maxUint256, zeroAddress, type Hash, type ReadContractParameters } from "viem";
import { mainnet } from "viem/chains";
import { describe, expect, it, vi } from "vitest";
import { PositionSnapshotSchema } from "@/extensions/aave/schemas";
import { AavePositionAdapter, type AaveReadClient } from "@/extensions/aave/aave-position.adapter";
import { AAVE_PROVIDER_ADDRESS, ETH_ASSET_ADDRESS, ETH_PRICE_LOOKBACK_BLOCKS } from "@/extensions/aave/aave-contracts";
import { PositionReadError } from "@/extensions/aave/position-read.error";
import { PositionService } from "@/extensions/aave/position.service";

const wallet = "0x485c028c475dba482297656229d11b4eaf22357b";
const pool = "0x1111111111111111111111111111111111111111";
const oracle = "0x2222222222222222222222222222222222222222";
const previousOracle = "0x3333333333333333333333333333333333333333";
const currentNumber = 26_000_000n;
const previousNumber = currentNumber - BigInt(ETH_PRICE_LOOKBACK_BLOCKS);
const currentTimestamp = 1_800_000_000n;
const previousTimestamp = currentTimestamp - 86_843n;
const currentHash = `0x${"ab".repeat(32)}` as Hash;
const previousHash = `0x${"cd".repeat(32)}` as Hash;

type Overrides = {
  chainId?: number;
  collateral?: bigint;
  debt?: bigint;
  healthFactor?: bigint;
  unit?: bigint;
  previousUnit?: bigint;
  currency?: string;
  previousCurrency?: string;
  price?: bigint;
  previousPrice?: bigint;
  nonCanonicalHash?: Hash;
};

function fixture(overrides: Overrides = {}) {
  const getChainId = vi.fn(async () => overrides.chainId ?? 1);
  const getBlock = vi.fn(async (args?: { blockNumber?: bigint }) => args?.blockNumber === previousNumber
    ? { number: previousNumber, hash: previousHash, timestamp: previousTimestamp }
    : { number: currentNumber, hash: currentHash, timestamp: currentTimestamp });
  const readContract = vi.fn(async (request: ReadContractParameters): Promise<unknown> => {
    if (request.blockHash === overrides.nonCanonicalHash && request.requireCanonical === true) {
      throw new Error("block is not canonical: https://rpc.invalid/secret-token");
    }
    const previous = request.blockHash === previousHash;
    switch (request.functionName) {
      case "getPool": return pool;
      case "getPriceOracle": return previous ? previousOracle : oracle;
      case "getUserAccountData": return [
        overrides.collateral ?? 20_000_012_345_678n,
        overrides.debt ?? 10_000_087_654_321n,
        0n, 8_000n, 7_500n, overrides.healthFactor ?? 1_080_000_000_000_000_000n,
      ];
      case "BASE_CURRENCY": return previous ? overrides.previousCurrency ?? zeroAddress : overrides.currency ?? zeroAddress;
      case "BASE_CURRENCY_UNIT": return previous ? overrides.previousUnit ?? 1_000_000n : overrides.unit ?? 100_000_000n;
      case "getAssetPrice": return previous ? overrides.previousPrice ?? 3_000_000_000n : overrides.price ?? 280_000_000_000n;
      default: throw new Error("Unexpected read in Aave test fixture.");
    }
  });
  const client: AaveReadClient = {
    getChainId,
    getBlock,
    readContract: readContract as AaveReadClient["readContract"],
  };
  return { adapter: new AavePositionAdapter(client), getChainId, getBlock, readContract };
}

describe("read-only AavePositionAdapter", () => {
  it("accepts a real viem mainnet PublicClient without a wallet client", () => {
    const client = createPublicClient({ chain: mainnet, transport: http("https://example.invalid", { retryCount: 0 }) });
    expect(new AavePositionAdapter(client)).toBeInstanceOf(AavePositionAdapter);
  });

  it("converts account/oracle decimals and the 1e18 Health Factor into the extension AavePositionState", async () => {
    const { adapter } = fixture();
    const snapshot = await adapter.getSnapshot(wallet);
    expect(PositionSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.status).toBe("ACTIVE");
    if (snapshot.status !== "ACTIVE") throw new Error("Expected active fixture.");
    expect(snapshot.position).toEqual({
      wallet,
      collateralUsd: 200_000.12345678,
      debtUsd: 100_000.87654321,
      healthFactor: 1.08,
      ethPrice: 2_800,
      timestamp: new Date(Number(currentTimestamp) * 1000).toISOString(),
      blockNumber: Number(currentNumber),
    });
    expect(snapshot.mode).toBe("LIVE");
    expect(snapshot.evidence).toMatchObject({
      chainId: 1, network: "ethereum-mainnet", protocol: "aave-v3",
      providerAddress: AAVE_PROVIDER_ADDRESS, poolAddress: pool, oracleAddress: oracle,
      ethAssetAddress: ETH_ASSET_ADDRESS, blockNumber: Number(currentNumber), blockHash: currentHash,
    });
    expect(snapshot.evidence).not.toHaveProperty("txHash");
  });

  it("pins every contract call to its respective canonical current/historical block hash", async () => {
    const { adapter, getBlock, readContract } = fixture();
    await adapter.getSnapshot(wallet);
    expect(getBlock.mock.calls).toEqual([[], [{ blockNumber: previousNumber }]]);
    const requests = readContract.mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(10);
    expect(requests.filter((request) => request.blockHash === currentHash)).toHaveLength(6);
    expect(requests.filter((request) => request.blockHash === previousHash)).toHaveLength(4);
    expect(requests.every((request) => request.requireCanonical === true)).toBe(true);
    expect(requests.every((request) => !Object.hasOwn(request, "blockNumber") && !Object.hasOwn(request, "blockTag") && !Object.hasOwn(request, "account"))).toBe(true);
    expect(requests.find((request) => request.functionName === "getUserAccountData")).toMatchObject({ address: pool, blockHash: currentHash, requireCanonical: true, args: [wallet] });
    expect(requests.filter((request) => request.functionName === "getAssetPrice")).toMatchObject([
      { address: oracle, blockHash: currentHash, requireCanonical: true, args: [ETH_ASSET_ADDRESS] },
      { address: previousOracle, blockHash: previousHash, requireCanonical: true, args: [ETH_ASSET_ADDRESS] },
    ]);
  });

  it("uses the past oracle's own units and reports the actual 7200-block elapsed window", async () => {
    const { adapter } = fixture();
    const snapshot = await adapter.getSnapshot(wallet);
    if (snapshot.status !== "ACTIVE") throw new Error("Expected active fixture.");
    expect(snapshot.marketChanges.ethChangePct).toBeCloseTo(-6.666666666666665);
    expect(snapshot.marketChanges).toMatchObject({
      previousEthPrice: 3_000,
      referenceBlockNumber: Number(previousNumber),
      referenceBlockHash: previousHash,
      referenceTimestamp: new Date(Number(previousTimestamp) * 1000).toISOString(),
      referenceOracleAddress: previousOracle,
      lookbackBlocks: 7_200,
      lookbackSeconds: 86_843,
    });
  });

  it("preserves the caller's address case for extension PositionService equality validation", async () => {
    const requestedWallet = `0x${wallet.slice(2).toUpperCase()}`;
    const { adapter } = fixture();
    expect((await new PositionService(adapter).getPosition(requestedWallet)).wallet).toBe(requestedWallet);
  });

  it.each([0n, 20_000_000_000_000n])("returns explicit NO_DEBT for collateral %s, without a fabricated HF or price window", async (collateral) => {
    const { adapter, getBlock, readContract } = fixture({ collateral, debt: 0n, healthFactor: maxUint256 });
    const snapshot = await adapter.getSnapshot(wallet);
    expect(snapshot).toMatchObject({ status: "NO_DEBT", mode: "LIVE", wallet, position: null });
    expect(snapshot).not.toHaveProperty("marketChanges");
    expect(snapshot).not.toHaveProperty("healthFactor");
    expect(getBlock).toHaveBeenCalledTimes(1);
    expect(readContract.mock.calls.map(([request]) => request.functionName)).toEqual(["getPool", "getPriceOracle", "getUserAccountData"]);
    expect(PositionSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("makes NO_DEBT getPosition an identifiable error instead of a fake PositionState", async () => {
    const { adapter } = fixture({ debt: 0n, healthFactor: maxUint256 });
    await expect(adapter.getPosition(wallet)).rejects.toMatchObject({ name: "PositionReadError", code: "NO_DEBT" });
  });

  it.each(["", "test-wallet", "0x1234", `0x${"g".repeat(40)}`])("rejects invalid wallet %s before making RPC calls", async (invalidWallet) => {
    const { adapter, getChainId, getBlock, readContract } = fixture();
    await expect(adapter.getSnapshot(invalidWallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    expect(getChainId).not.toHaveBeenCalled();
    expect(getBlock).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
  });

  it("rejects a different network before reading contracts", async () => {
    const { adapter, getBlock, readContract } = fixture({ chainId: 8453 });
    await expect(adapter.getSnapshot(wallet)).rejects.toMatchObject({ code: "UNSUPPORTED_NETWORK" });
    expect(getBlock).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
  });

  it.each([
    { unit: 0n }, { unit: -1n }, { unit: 1n }, { unit: 200n },
    { currency: ETH_ASSET_ADDRESS }, { currency: "not-an-address" },
    { previousUnit: 0n }, { previousCurrency: ETH_ASSET_ADDRESS },
  ])("rejects unsupported USD currency/unit %s", async (overrides) => {
    await expect(fixture(overrides).adapter.getSnapshot(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([{ price: 0n }, { price: -1n }, { previousPrice: 0n }, { previousPrice: -1n }])("rejects invalid ETH price %s", async (overrides) => {
    await expect(fixture(overrides).adapter.getSnapshot(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([{ healthFactor: maxUint256 }, { healthFactor: -1n }, { debt: -1n }, { collateral: -1n }])("rejects invalid borrowing account data %s", async (overrides) => {
    await expect(fixture(overrides).adapter.getSnapshot(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("keeps a genuine zero Health Factor when a debt position has no collateral", async () => {
    const { adapter } = fixture({ collateral: 0n, healthFactor: 0n });
    const position = await adapter.getPosition(wallet);
    expect(position).toMatchObject({ collateralUsd: 0, healthFactor: 0 });
    expect(position.debtUsd).toBeGreaterThan(0);
  });

  it("rejects incomplete current block evidence", async () => {
    const { adapter, getBlock, readContract } = fixture();
    getBlock.mockResolvedValueOnce({ number: currentNumber, hash: null as unknown as Hash, timestamp: currentTimestamp });
    await expect(adapter.getSnapshot(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    expect(readContract).not.toHaveBeenCalled();
  });

  it("rejects an insufficient current block height", async () => {
    const { adapter, getBlock } = fixture();
    getBlock.mockResolvedValueOnce({ number: 7_199n, hash: currentHash, timestamp: currentTimestamp });
    await expect(adapter.getSnapshot(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    expect(getBlock).toHaveBeenCalledTimes(1);
  });

  it("allows the exact 7200-block boundary using block zero as the reference", async () => {
    const { adapter, getBlock, readContract } = fixture();
    getBlock.mockResolvedValueOnce({ number: 7_200n, hash: currentHash, timestamp: currentTimestamp });
    getBlock.mockResolvedValueOnce({ number: 0n, hash: previousHash, timestamp: previousTimestamp });
    const snapshot = await adapter.getSnapshot(wallet);
    expect(snapshot.status).toBe("ACTIVE");
    if (snapshot.status !== "ACTIVE") throw new Error("Expected active fixture.");
    expect(snapshot.marketChanges.referenceBlockNumber).toBe(0);
    expect(readContract.mock.calls.every(([request]) => request.blockHash === currentHash || request.blockHash === previousHash)).toBe(true);
  });

  it("rejects a current block number that cannot be represented safely in JSON", async () => {
    const { adapter, getBlock, readContract } = fixture();
    getBlock.mockResolvedValueOnce({ number: BigInt(Number.MAX_SAFE_INTEGER) + 1n, hash: currentHash, timestamp: currentTimestamp });
    await expect(adapter.getSnapshot(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    expect(readContract).not.toHaveBeenCalled();
  });

  it("rejects an unavailable pool address instead of calling an unrelated contract", async () => {
    const { adapter, readContract } = fixture();
    readContract.mockResolvedValueOnce(zeroAddress);
    await expect(adapter.getSnapshot(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    expect(readContract.mock.calls.some(([request]) => request.functionName === "getUserAccountData")).toBe(false);
  });

  it("rejects a malformed account tuple instead of producing partial JSON", async () => {
    const { adapter, readContract } = fixture();
    readContract.mockResolvedValueOnce(pool).mockResolvedValueOnce(oracle).mockResolvedValueOnce([1n, 2n]);
    await expect(adapter.getSnapshot(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([
    { number: previousNumber + 1n, hash: previousHash, timestamp: previousTimestamp },
    { number: previousNumber, hash: previousHash, timestamp: currentTimestamp },
  ])("rejects inconsistent historical evidence %s", async (historicalBlock) => {
    const { adapter, getBlock } = fixture();
    getBlock.mockResolvedValueOnce({ number: currentNumber, hash: currentHash, timestamp: currentTimestamp });
    getBlock.mockResolvedValueOnce(historicalBlock);
    await expect(adapter.getSnapshot(wallet)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("fails the entire read when history is unavailable and redacts underlying endpoint credentials", async () => {
    const { adapter, getBlock } = fixture();
    getBlock.mockResolvedValueOnce({ number: currentNumber, hash: currentHash, timestamp: currentTimestamp });
    getBlock.mockRejectedValueOnce(new Error("history unavailable: https://rpc.invalid/secret-api-key"));
    const error = await adapter.getSnapshot(wallet).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PositionReadError);
    expect(error).toMatchObject({ code: "RPC_READ_FAILED" });
    expect(String(error)).not.toContain("secret-api-key");
    expect(getBlock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["current", currentHash, 2],
    ["historical", previousHash, 7],
  ] as const)("rejects the entire snapshot if the %s block becomes noncanonical without reading a replacement block", async (_, nonCanonicalHash, expectedReads) => {
    const { adapter, readContract } = fixture({ nonCanonicalHash });
    const error = await adapter.getSnapshot(wallet).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(PositionReadError);
    expect(error).toMatchObject({ code: "RPC_READ_FAILED" });
    expect(String(error)).not.toContain("secret-token");
    expect(readContract).toHaveBeenCalledTimes(expectedReads);
    expect(readContract.mock.calls.every(([request]) => request.requireCanonical === true && !Object.hasOwn(request, "blockNumber") && !Object.hasOwn(request, "blockTag"))).toBe(true);
  });

  it("does not retry, fall back, or fabricate data on a current RPC failure", async () => {
    const { adapter, getChainId, getBlock, readContract } = fixture();
    getChainId.mockRejectedValueOnce(new Error("failed: https://rpc.invalid/secret-token"));
    await expect(adapter.getSnapshot(wallet)).rejects.toMatchObject({ code: "RPC_READ_FAILED" });
    expect(getChainId).toHaveBeenCalledTimes(1);
    expect(getBlock).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
  });
});
