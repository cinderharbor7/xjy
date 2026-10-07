import { maxUint256, type Address, type Hash, type ReadContractParameters } from "viem";
import { describe, expect, it, vi } from "vitest";
import { OnchainEvidenceSchema } from "@/domain/schemas";
import { CHAINLINK_ABI, ETH_USD_FEED, USDC_USD_FEED, USDC_ADDRESS, WETH_ADDRESS, UNISWAP_POOL_ADDRESS, ERC20_ABI, UNISWAP_POOL_ABI, SWAP_EVENT } from "@/modules/onchain/ethereum-contracts";
import { EthereumSnapshot, amountFromUnits, blockEvidence, validateWallet, type EthereumReadClient } from "@/modules/onchain/ethereum-reader";
import { EthereumReadError, withEthereumRead } from "@/modules/onchain/read-error";

const wallet = "0xA00000000000000000000000000000000000000B" as Address;
const hashes = ["11", "22", "33", "44"].map((part) => `0x${part.repeat(32)}` as Hash);
const times = [100_000n, 100_012n, 100_050n, 100_070n];
const rounds = (updatedAt = 100_000n, answer = 280_000_000_000n) => [9n, answer, updatedAt, updatedAt, 9n];

function fixture() {
  const getChainId = vi.fn(async () => 1);
  const getBlock = vi.fn(async (parameters?: { blockNumber?: bigint; blockTag?: "latest" }) => {
    const number = parameters?.blockNumber ?? 3n;
    return { number, hash: hashes[Number(number)], timestamp: times[Number(number)] };
  });
  const readContract = vi.fn(async (parameters: ReadContractParameters): Promise<unknown> => {
    switch (parameters.functionName) {
      case "description": return parameters.address === ETH_USD_FEED ? "ETH / USD" : "USDC / USD";
      case "decimals": return 8;
      case "latestRoundData": return rounds(100_000n, parameters.address === ETH_USD_FEED ? 280_000_000_000n : 99_990_000n);
      default: throw new Error("Unexpected fixture call.");
    }
  });
  const getBalance = vi.fn(async () => 1_000_000_000_000_000_000n);
  const getTransaction = vi.fn(async ({ hash }: { hash: Hash }) => ({ hash, from: wallet, blockHash: hashes[3], blockNumber: 3n }));
  const getRawLogs = vi.fn(async () => []);
  const client: EthereumReadClient = {
    getChainId, getBlock, readContract: readContract as EthereumReadClient["readContract"], getBalance, getTransaction, getRawLogs,
  };
  const setRound = (round: unknown, metadata?: { decimals?: unknown; description?: unknown }) => readContract.mockImplementation(async (parameters) => {
    if (parameters.functionName === "decimals") return metadata?.decimals ?? 8;
    if (parameters.functionName === "description") return metadata?.description ?? (parameters.address === ETH_USD_FEED ? "ETH / USD" : "USDC / USD");
    return round;
  });
  return { client, getChainId, getBlock, readContract, setRound };
}

describe("Ethereum readonly helpers", () => {
  it("preserves a trimmed wallet's original casing", () => {
    expect(validateWallet(`  ${wallet}\n`)).toBe(wallet);
    expect(validateWallet(`0x${"0".repeat(40)}`)).toBe(`0x${"0".repeat(40)}`);
  });

  it.each(["", "   ", "demo-wallet", "alice.eth", "0x1", `0x${"g".repeat(40)}`, `0x${"1".repeat(41)}`, undefined, null, 1])("rejects an invalid live wallet %s", (value) => {
    expect(() => validateWallet(value as string)).toThrow(expect.objectContaining({ code: "INVALID_WALLET" }));
  });

  it("normalizes ETH and USDC units without converting raw wei to an imprecise number", () => {
    expect(amountFromUnits(1_234_567_890_000_000_000n, 18, "ETH")).toBe(1.23456789);
    expect(amountFromUnits(1_234_567n, 6, "USDC")).toBe(1.234567);
    expect(amountFromUnits(0n, 6, "USDC")).toBe(0);
    expect(amountFromUnits(BigInt(Number.MAX_SAFE_INTEGER), 0, "amount")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    [-1n, 18], [maxUint256 + 1n, 18], [1, 18], [1n, -1], [1n, 256], [1n, 1.5], [1n, NaN],
    [BigInt(Number.MAX_SAFE_INTEGER) + 1n, 0], [maxUint256, 18],
  ])("rejects unsupported raw amount/decimals %s / %s", (raw, decimals) => {
    expect(() => amountFromUnits(raw as bigint, decimals as number, "amount")).toThrow(expect.objectContaining({ code: "INVALID_CHAIN_DATA" }));
  });

  it("uses the approved contracts and exposes only view functions plus the Swap event", () => {
    expect([ETH_USD_FEED, USDC_USD_FEED, USDC_ADDRESS, WETH_ADDRESS, UNISWAP_POOL_ADDRESS]).toEqual([
      "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",
    ]);
    for (const item of [...CHAINLINK_ABI, ...ERC20_ABI, ...UNISWAP_POOL_ABI]) {
      if (item.type === "function") expect(item.stateMutability).toBe("view");
    }
    expect(SWAP_EVENT).toMatchObject({ type: "event", name: "Swap" });
    const { client } = fixture();
    if (false) {
      // @ts-expect-error The shared client provides no unrestricted JSON-RPC entry point.
      client.request;
      // @ts-expect-error The shared client provides no transaction sender.
      client.sendTransaction;
      // @ts-expect-error The shared client provides no signer.
      client.signMessage;
    }
  });

  it("preserves known domain errors and values", async () => {
    const error = new EthereumReadError("EMPTY_BASELINE", "No positive preceding-window baseline.");
    await expect(withEthereumRead(async () => { throw error; })).rejects.toBe(error);
    await expect(withEthereumRead(async () => 42)).resolves.toBe(42);
  });

  it("strips unknown RPC messages, URLs, nested causes and request data", async () => {
    const error = await withEthereumRead(async () => {
      throw new Error("https://rpc.invalid/SECRET_KEY { wallet: secret }", { cause: new Error("API_TOKEN") });
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EthereumReadError);
    expect(error).toMatchObject({ code: "RPC_READ_FAILED" });
    expect(String(error)).not.toMatch(/SECRET_KEY|API_TOKEN|secret|rpc\.invalid/);
    expect(error).not.toHaveProperty("cause");
  });
});

describe("EthereumSnapshot capture and historical blocks", () => {
  it("captures an explicit mainnet latest anchor and produces frozen UTC block evidence", async () => {
    const { client, getChainId, getBlock } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    expect(getChainId).toHaveBeenCalledOnce();
    expect(getBlock).toHaveBeenCalledWith({ blockTag: "latest" });
    expect(snapshot.anchor).toEqual({ number: 3n, hash: hashes[3], seconds: 100_070, timestamp: new Date(100_070_000).toISOString() });
    expect(Object.isFrozen(snapshot.anchor)).toBe(true);
    const evidence = blockEvidence(snapshot.anchor, "Ethereum balance observation", USDC_ADDRESS);
    expect(OnchainEvidenceSchema.parse(evidence)).toMatchObject({ type: "BLOCK", blockHash: hashes[3], blockNumber: 3, contractAddress: USDC_ADDRESS });
    expect(evidence).not.toHaveProperty("txHash");
    expect(evidence.source).toBe("https://etherscan.io/block/3");
  });

  it("rejects the wrong chain before any block reads", async () => {
    const { client, getChainId, getBlock } = fixture();
    getChainId.mockResolvedValue(10);
    await expect(EthereumSnapshot.capture(client)).rejects.toMatchObject({ code: "UNSUPPORTED_NETWORK" });
    expect(getBlock).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { number: null, hash: hashes[3], timestamp: 100_070n },
    { number: -1n, hash: hashes[3], timestamp: 100_070n },
    { number: BigInt(Number.MAX_SAFE_INTEGER) + 1n, hash: hashes[3], timestamp: 100_070n },
    { number: 3n, hash: null, timestamp: 100_070n }, { number: 3n, hash: "0x1", timestamp: 100_070n },
    { number: 3n, hash: hashes[3], timestamp: -1n }, { number: 3n, hash: hashes[3], timestamp: 253_402_300_800n },
    { number: 3n, hash: hashes[3], timestamp: 100_070 },
  ])("rejects invalid anchor evidence case %#", async (value) => {
    const { client, getBlock } = fixture();
    getBlock.mockResolvedValue(value as never);
    await expect(EthereumSnapshot.capture(client)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("deduplicates simultaneous historical reads only within one snapshot", async () => {
    const { client, getBlock } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    const [first, second] = await Promise.all([snapshot.getBlock(1n), snapshot.getBlock(1n)]);
    expect(first).toBe(second);
    expect(getBlock.mock.calls).toEqual([[{ blockTag: "latest" }], [{ blockNumber: 1n }]]);
    const next = await EthereumSnapshot.capture(client);
    await next.getBlock(1n);
    expect(getBlock).toHaveBeenCalledTimes(4);
  });

  it("selects the greatest timestamp at or before a target despite skipped slots", async () => {
    const { client, getBlock } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    expect((await snapshot.atOrBefore(100_049)).number).toBe(1n);
    expect((await snapshot.atOrBefore(100_050)).number).toBe(2n);
    expect((await snapshot.atOrBefore(100_069)).number).toBe(2n);
    expect(getBlock).toHaveBeenCalledWith({ blockNumber: 2n });
    expect((await snapshot.atOrBefore(100_070)).number).toBe(3n);
    expect((await snapshot.atOrBefore(100_000)).number).toBe(0n);
    await expect(snapshot.atOrBefore(99_999)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("handles a chain with one observed block without requesting an unavailable next block", async () => {
    const { client, getBlock } = fixture();
    getBlock.mockResolvedValue({ number: 0n, hash: hashes[0], timestamp: 100_000n });
    const snapshot = await EthereumSnapshot.capture(client);
    expect((await snapshot.atOrBefore(100_000)).number).toBe(0n);
    expect(getBlock).toHaveBeenCalledOnce();
    await expect(snapshot.atOrBefore(99_999)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([-1, 100_071, 100_000.5, NaN, Infinity])("rejects observation time outside the snapshot %s", async (seconds) => {
    const { client } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    await expect(snapshot.atOrBefore(seconds)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it.each([-1n, 4n, 1])("rejects block number outside the snapshot %s", async (number) => {
    const { client } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    await expect(snapshot.getBlock(number as bigint)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("rejects a wrong historical block number or non-earlier timestamp", async () => {
    const { client, getBlock } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    getBlock.mockResolvedValueOnce({ number: 2n, hash: hashes[1], timestamp: 100_012n });
    await expect(snapshot.getBlock(1n)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    getBlock.mockResolvedValueOnce({ number: 2n, hash: hashes[2], timestamp: 100_070n });
    await expect(snapshot.getBlock(2n)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("sanitizes missing-history exceptions and never retries a failed cached read", async () => {
    const { client, getBlock } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    getBlock.mockRejectedValue(new Error("Historical state unavailable at https://rpc.invalid/SECRET"));
    await expect(snapshot.getBlock(1n)).rejects.toMatchObject({ code: "RPC_READ_FAILED" });
    await expect(snapshot.getBlock(1n)).rejects.toThrow("Unable to read the required Ethereum data.");
    expect(getBlock).toHaveBeenCalledTimes(2);
  });
});

describe("Chainlink USD observations", () => {
  it("reads ETH and USDC on the same canonical hash and retains update/round evidence", async () => {
    const { client, readContract } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    const [eth, usdc] = await Promise.all([snapshot.readUsdPrice("ETH"), snapshot.readUsdPrice("USDC")]);
    expect(eth.usd).toBe(2800);
    expect(usdc.usd).toBe(0.9999);
    expect(eth.evidence).toMatchObject({ type: "BLOCK", blockNumber: 3, blockHash: hashes[3], contractAddress: ETH_USD_FEED });
    expect(eth.evidence.description).toContain("roundId=9");
    expect(eth.evidence.description).toContain("updatedAt=100000");
    expect(eth.evidence.description).toContain(snapshot.anchor.timestamp);
    for (const [parameters] of readContract.mock.calls) {
      expect(parameters.blockHash).toBe(hashes[3]);
      expect(parameters.requireCanonical).toBe(true);
      expect(parameters).not.toHaveProperty("blockNumber");
    }
  });

  it("deduplicates simultaneous quotes by feed and block hash, and protects cached observations", async () => {
    const { client, readContract } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    const [first, second] = await Promise.all([snapshot.readUsdPrice("ETH"), snapshot.readUsdPrice("ETH")]);
    expect(first).toBe(second);
    expect(readContract).toHaveBeenCalledTimes(3);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.evidence)).toBe(true);
    await snapshot.readUsdPrice("ETH", await snapshot.getBlock(2n));
    expect(readContract).toHaveBeenCalledTimes(6);
    const next = await EthereumSnapshot.capture(client);
    await next.readUsdPrice("ETH");
    expect(readContract).toHaveBeenCalledTimes(9);
  });

  it.each([
    { asset: "ETH", age: 3600, expected: true }, { asset: "ETH", age: 3601, expected: false },
    { asset: "USDC", age: 82800, expected: true }, { asset: "USDC", age: 82801, expected: false },
  ] as const)("checks $asset freshness at the exact age $age boundary", async ({ asset, age, expected }) => {
    const { client, setRound } = fixture();
    setRound(rounds(BigInt(100_070 - age)));
    const snapshot = await EthereumSnapshot.capture(client);
    if (expected) await expect(snapshot.readUsdPrice(asset)).resolves.toHaveProperty("usd", 2800);
    else await expect(snapshot.readUsdPrice(asset)).rejects.toMatchObject({ code: "STALE_PRICE" });
  });

  it("compares historical answer age with its historical block rather than today's anchor", async () => {
    const { client, setRound } = fixture();
    setRound(rounds(96_412n));
    const snapshot = await EthereumSnapshot.capture(client);
    const historical = await snapshot.getBlock(1n);
    await expect(snapshot.readUsdPrice("ETH", historical)).resolves.toHaveProperty("usd", 2800);
    await expect(snapshot.readUsdPrice("ETH")).rejects.toMatchObject({ code: "STALE_PRICE" });
  });

  it.each([
    { name: "wrong description", metadata: { description: "ETH / EUR" } },
    { name: "wrong decimals", metadata: { decimals: 6 } },
    { name: "coerced decimals", metadata: { decimals: "8" } },
  ])("rejects $name", async ({ metadata }) => {
    const { client, setRound } = fixture();
    setRound(rounds(), metadata);
    const snapshot = await EthereumSnapshot.capture(client);
    await expect(snapshot.readUsdPrice("ETH")).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each([
    ["short tuple", [9n, 1n]], ["non-array", { roundId: 9n }], ["zero round", [0n, 1n, 100_000n, 100_000n, 0n]],
    ["negative round", [-1n, 1n, 100_000n, 100_000n, 9n]], ["unsafe round", [1n << 80n, 1n, 100_000n, 100_000n, 9n]],
    ["number round", [9, 1n, 100_000n, 100_000n, 9n]], ["zero answer", [9n, 0n, 100_000n, 100_000n, 9n]],
    ["negative answer", [9n, -1n, 100_000n, 100_000n, 9n]], ["out-of-int256 answer", [9n, 1n << 255n, 100_000n, 100_000n, 9n]],
    ["number answer", [9n, 2800, 100_000n, 100_000n, 9n]], ["unrepresentable USD", [9n, 10n ** 24n, 100_000n, 100_000n, 9n]],
    ["negative startedAt", [9n, 1n, -1n, 100_000n, 9n]], ["started after answer", [9n, 1n, 100_001n, 100_000n, 9n]],
    ["zero updatedAt", [9n, 1n, 0n, 0n, 9n]], ["future updatedAt", [9n, 1n, 100_071n, 100_071n, 9n]],
    ["number updatedAt", [9n, 1n, 100_000n, 100_000, 9n]], ["negative answeredInRound", [9n, 1n, 100_000n, 100_000n, -1n]],
    ["out-of-uint80 answeredInRound", [9n, 1n, 100_000n, 100_000n, 1n << 80n]],
  ])("rejects invalid oracle round: %s", async (_name, round) => {
    const { client, setRound } = fixture();
    setRound(round);
    const snapshot = await EthereumSnapshot.capture(client);
    await expect(snapshot.readUsdPrice("ETH")).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("allows the same round across time points and does not use deprecated answeredInRound as the freshness test", async () => {
    const { client, setRound } = fixture();
    setRound([9n, 280_000_000_000n, 100_000n, 100_000n, 0n]);
    const snapshot = await EthereumSnapshot.capture(client);
    const current = await snapshot.readUsdPrice("ETH");
    const past = await snapshot.readUsdPrice("ETH", await snapshot.getBlock(1n));
    expect(current.usd).toBe(past.usd);
    expect(current.evidence.description).toContain("answeredInRound=0");
    expect(current.evidence.blockHash).not.toBe(past.evidence.blockHash);
  });

  it("rejects unsupported assets and forged block references before requesting a quote", async () => {
    const { client, readContract } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    await expect(snapshot.readUsdPrice("BTC" as "ETH")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(snapshot.readUsdPrice("ETH", { ...snapshot.anchor, hash: hashes[1] })).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    await expect(snapshot.readUsdPrice("ETH", { ...snapshot.anchor, seconds: 100_069 })).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    await expect(snapshot.readUsdPrice("ETH", { ...snapshot.anchor, timestamp: "1970-01-01T00:00:00.000Z" })).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    expect(readContract).not.toHaveBeenCalled();
  });

  it("sanitizes oracle RPC errors without retrying or substituting prices", async () => {
    const { client, readContract } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    readContract.mockRejectedValue(new Error("RPC rejected canonical hash at https://rpc.invalid/SECRET"));
    await expect(snapshot.readUsdPrice("ETH")).rejects.toMatchObject({ code: "RPC_READ_FAILED" });
    await expect(snapshot.readUsdPrice("ETH")).rejects.toThrow("Unable to read the required Ethereum data.");
    expect(readContract).toHaveBeenCalledTimes(3);
  });
});

describe("canonical verification", () => {
  it("bypasses the anchor cache each time", async () => {
    const { client, getBlock } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    await snapshot.getBlock(3n);
    await snapshot.verifyCanonical();
    await snapshot.verifyCanonical();
    expect(getBlock.mock.calls).toEqual([[{ blockTag: "latest" }], [{ blockNumber: 3n }], [{ blockNumber: 3n }]]);
  });

  it("detects an anchor reorg instead of retaining a successful cached observation", async () => {
    const { client, getBlock } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    await snapshot.readUsdPrice("ETH");
    getBlock.mockResolvedValueOnce({ number: 3n, hash: hashes[1], timestamp: 100_070n });
    await expect(snapshot.verifyCanonical()).rejects.toMatchObject({ code: "REORG_DETECTED" });
  });

  it.each([
    { number: 2n, hash: hashes[3], timestamp: 100_070n },
    { number: 3n, hash: hashes[3], timestamp: 100_071n },
  ])("rejects inconsistent canonical metadata case %#", async (value) => {
    const { client, getBlock } = fixture();
    const snapshot = await EthereumSnapshot.capture(client);
    getBlock.mockResolvedValueOnce(value);
    await expect(snapshot.verifyCanonical()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("sanitizes failures in capture and final canonical verification", async () => {
    const first = fixture();
    first.getChainId.mockRejectedValueOnce(new Error("SECRET capture URL"));
    await expect(EthereumSnapshot.capture(first.client)).rejects.toMatchObject({ code: "RPC_READ_FAILED" });
    const second = fixture();
    const snapshot = await EthereumSnapshot.capture(second.client);
    second.getBlock.mockRejectedValueOnce(new Error("SECRET canonical URL"));
    await expect(snapshot.verifyCanonical()).rejects.toThrow("Unable to read the required Ethereum data.");
  });
});
