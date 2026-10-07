import { type Hash, type ReadContractParameters } from "viem";
import { describe, expect, it, vi } from "vitest";
import { MarketStateSchema, OnchainEvidenceSchema } from "@/domain/schemas";
import { ChainlinkMarketAdapter } from "@/modules/market/chainlink-market.adapter";
import { MarketService } from "@/modules/market/market.service";
import { ETH_USD_FEED, USDC_USD_FEED } from "@/modules/onchain/ethereum-contracts";
import { EthereumSnapshot, blockEvidence, type EthereumReadClient, type SnapshotSource } from "@/modules/onchain/ethereum-reader";
import { EthereumReadError } from "@/modules/onchain/read-error";

const anchorSeconds = 1_800_000_000;
function blockHash(number: bigint): Hash { return `0x${number.toString(16).padStart(64, "0")}`; }

function fixture(options: { current?: number; fiveMinute?: number; oneHour?: number; offset?: bigint; sameRound?: boolean } = {}) {
  const offset = options.offset ?? 0n;
  const anchor = 4n + offset;
  // Targets fall into skipped-slot gaps: floor blocks are not exactly T-300 / T-3600.
  const times = [anchorSeconds - 7_200, anchorSeconds - 3_605, anchorSeconds - 3_590, anchorSeconds - 307, anchorSeconds];
  const getBlock = vi.fn(async (parameters?: { blockNumber?: bigint; blockTag?: "latest" }) => {
    const number = parameters?.blockNumber ?? anchor;
    return { number, hash: blockHash(number), timestamp: BigInt(times[Number(number - offset)]) };
  });
  const readContract = vi.fn(async (parameters: ReadContractParameters): Promise<unknown> => {
    if (parameters.functionName === "description") return "ETH / USD";
    if (parameters.functionName === "decimals") return 8;
    if (parameters.functionName !== "latestRoundData") throw new Error("Unexpected fixture function.");
    const number = BigInt(parameters.blockHash!);
    const seconds = BigInt(times[Number(number - offset)]);
    const price = number === anchor ? options.current ?? 2700
      : number === 3n + offset ? options.fiveMinute ?? 2800 : options.oneHour ?? 3000;
    const roundId = options.sameRound ? 9n : number + 10n;
    return [roundId, BigInt(Math.round(price * 1e8)), seconds - 60n, seconds - 60n, roundId];
  });
  const client: EthereumReadClient = {
    getChainId: vi.fn(async () => 1), getBlock, readContract: readContract as EthereumReadClient["readContract"],
    getBalance: vi.fn(async () => 0n),
    getTransaction: vi.fn(async ({ hash }: { hash: Hash }) => ({ hash, from: "0x1111111111111111111111111111111111111111" as const, blockHash: blockHash(anchor), blockNumber: anchor })),
    getRawLogs: vi.fn(async () => []),
  };
  const source = vi.fn(async () => EthereumSnapshot.capture(client));
  return { client, anchor, source, getBlock, readContract, adapter: new ChainlinkMarketAdapter(source) };
}

describe("ChainlinkMarketAdapter", () => {
  it("preserves the existing MarketAdapter/MarketService contract", async () => {
    const { adapter } = fixture();
    const market = await new MarketService(adapter).getMarketState();
    expect(MarketStateSchema.parse(market)).toEqual(market);
    expect(Object.keys(market).sort()).toEqual(["asset", "priceUsd", "priceChange5mPct", "priceChange1hPct", "volatilityScore", "timestamp"].sort());
    expect(market).toMatchObject({ asset: "ETH", priceUsd: 2700, timestamp: new Date(anchorSeconds * 1000).toISOString() });
    expect(market.priceChange5mPct).toBeCloseTo((2700 / 2800 - 1) * 100);
    expect(market.priceChange1hPct).toBeCloseTo(-10);
    expect(market.volatilityScore).toBeCloseTo(100);
  });

  it("requests exact time targets and reads the verified floor blocks rather than estimated block counts", async () => {
    const context = fixture();
    const snapshot = await EthereumSnapshot.capture(context.client);
    const atOrBefore = vi.spyOn(snapshot, "atOrBefore");
    const readUsdPrice = vi.spyOn(snapshot, "readUsdPrice");
    const verifyCanonical = vi.spyOn(snapshot, "verifyCanonical");
    const adapter = new ChainlinkMarketAdapter(async () => snapshot);
    await adapter.readMarket();
    expect(atOrBefore.mock.calls).toEqual([[anchorSeconds - 300], [anchorSeconds - 3600]]);
    expect(readUsdPrice.mock.calls).toHaveLength(3);
    expect(readUsdPrice.mock.calls[0]).toEqual(["ETH"]);
    expect(readUsdPrice.mock.calls[1][1]).toMatchObject({ number: 3n, seconds: anchorSeconds - 307 });
    expect(readUsdPrice.mock.calls[2][1]).toMatchObject({ number: 1n, seconds: anchorSeconds - 3605 });
    expect(verifyCanonical).toHaveBeenCalledOnce();
    for (const [request] of context.readContract.mock.calls) {
      expect(request.address).toBe(ETH_USD_FEED);
      expect(request.requireCanonical).toBe(true);
      expect([blockHash(4n), blockHash(3n), blockHash(1n)]).toContain(request.blockHash);
    }
  });

  it.each([
    { current: 105, baseline: 100, pct: 5, proxy: 50 },
    { current: 95, baseline: 100, pct: -5, proxy: 50 },
    { current: 120, baseline: 100, pct: 20, proxy: 100 },
    { current: 80, baseline: 100, pct: -20, proxy: 100 },
    { current: 100, baseline: 100, pct: 0, proxy: 0 },
    { current: 100.75, baseline: 100, pct: 0.75, proxy: 7.5 },
  ])("uses the approved signed changes and absolute proxy for $pct%", async ({ current, baseline, pct, proxy }) => {
    const { adapter } = fixture({ current, fiveMinute: baseline, oneHour: baseline });
    const market = await adapter.getMarketState();
    expect(market.priceChange5mPct).toBeCloseTo(pct);
    expect(market.priceChange1hPct).toBeCloseTo(pct);
    expect(market.volatilityScore).toBeCloseTo(proxy);
  });

  it("allows three unchanged oracle observations with zero changes and zero proxy", async () => {
    const { adapter } = fixture({ current: 2700, fiveMinute: 2700, oneHour: 2700, sameRound: true });
    const result = await adapter.readMarket();
    expect(result.state).toMatchObject({ priceChange5mPct: 0, priceChange1hPct: 0, volatilityScore: 0 });
    expect(result.evidence.every((item) => item.description.includes("roundId=9"))).toBe(true);
    expect(new Set(result.evidence.map((item) => item.blockHash)).size).toBe(3);
  });

  it("returns labeled evidence with target, actual block time and original oracle update information", async () => {
    const { adapter } = fixture();
    const result = await adapter.readMarket();
    expect(result.evidence).toHaveLength(3);
    result.evidence.forEach((item) => expect(OnchainEvidenceSchema.safeParse(item).success).toBe(true));
    expect(result.evidence.map((item) => item.blockNumber)).toEqual([4, 3, 1]);
    expect(result.evidence[0].description).toMatch(/CURRENT.*absolute 1h oracle-change proxy/);
    expect(result.evidence[1].description).toContain(`5m ETH/USD target=${new Date((anchorSeconds - 300) * 1000).toISOString()}`);
    expect(result.evidence[1].description).toContain(`actualBlockTimestamp=${new Date((anchorSeconds - 307) * 1000).toISOString()}`);
    expect(result.evidence[2].description).toContain(`1h ETH/USD target=${new Date((anchorSeconds - 3600) * 1000).toISOString()}`);
    expect(result.evidence.every((item) => item.description.includes("updatedAt=") && item.contractAddress === ETH_USD_FEED)).toBe(true);
  });

  it("copies frozen quote evidence before adding labels", async () => {
    const context = fixture();
    const snapshot = await EthereumSnapshot.capture(context.client);
    const quote = await snapshot.readUsdPrice("ETH");
    const original = quote.evidence.description;
    const result = await new ChainlinkMarketAdapter(async () => snapshot).readMarket();
    expect(quote.evidence.description).toBe(original);
    expect(result.evidence[0]).not.toBe(quote.evidence);
    expect(result.evidence[0].description).toContain(original);
    result.evidence[0].description = "Caller-local change";
    expect((await snapshot.readUsdPrice("ETH")).evidence.description).toBe(original);
  });

  it("captures a new snapshot for every readMarket/getMarketState call", async () => {
    const first = fixture({ current: 100, fiveMinute: 100, oneHour: 100 });
    const second = fixture({ current: 120, fiveMinute: 100, oneHour: 100, offset: 1n });
    const source = vi.fn<SnapshotSource>()
      .mockImplementationOnce(() => EthereumSnapshot.capture(first.client))
      .mockImplementationOnce(() => EthereumSnapshot.capture(second.client));
    const adapter = new ChainlinkMarketAdapter(source);
    const before = await adapter.readMarket();
    const latest = await adapter.getMarketState();
    expect(source).toHaveBeenCalledTimes(2);
    expect(before.state.priceUsd).toBe(100);
    expect(latest.priceUsd).toBe(120);
    expect(latest.priceChange1hPct).toBeCloseTo(20);
    expect(first.getBlock).toHaveBeenCalledWith({ blockTag: "latest" });
    expect(second.getBlock).toHaveBeenCalledWith({ blockTag: "latest" });
  });

  it.each([0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects a malformed quote value %s instead of deriving a market", async (invalid) => {
    const context = fixture();
    const snapshot = await EthereumSnapshot.capture(context.client);
    vi.spyOn(snapshot, "readUsdPrice").mockImplementation(async (_asset, block = snapshot.anchor) => ({ usd: invalid, evidence: blockEvidence(block, "Malformed fixture quote", ETH_USD_FEED) }));
    const verifyCanonical = vi.spyOn(snapshot, "verifyCanonical");
    await expect(new ChainlinkMarketAdapter(async () => snapshot).readMarket()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    expect(verifyCanonical).not.toHaveBeenCalled();
  });

  it("rejects a bad historical quote even when the current quote is valid", async () => {
    const context = fixture();
    const snapshot = await EthereumSnapshot.capture(context.client);
    const original = snapshot.readUsdPrice.bind(snapshot);
    vi.spyOn(snapshot, "readUsdPrice").mockImplementation(async (asset, block = snapshot.anchor) => block.number === 1n
      ? { usd: 0, evidence: blockEvidence(block, "Bad previous observation", ETH_USD_FEED) }
      : original(asset, block));
    await expect(new ChainlinkMarketAdapter(async () => snapshot).readMarket()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("rejects nonfinite derived changes at the MarketState boundary", async () => {
    const context = fixture();
    const snapshot = await EthereumSnapshot.capture(context.client);
    vi.spyOn(snapshot, "readUsdPrice").mockImplementation(async (_asset, block = snapshot.anchor) => ({
      usd: block.number === snapshot.anchor.number ? 2800 : Number.MIN_VALUE,
      evidence: blockEvidence(block, "Overflow fixture observation", ETH_USD_FEED),
    }));
    await expect(new ChainlinkMarketAdapter(async () => snapshot).readMarket()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it.each(["wrong block", "wrong feed", "wrong type", "unknown field"])("rejects quote evidence with %s", async (failure) => {
    const context = fixture();
    const snapshot = await EthereumSnapshot.capture(context.client);
    vi.spyOn(snapshot, "readUsdPrice").mockImplementation(async (_asset, block = snapshot.anchor) => {
      const evidence = blockEvidence(block, "Corrupted quote fixture", ETH_USD_FEED);
      if (failure === "wrong block") evidence.blockHash = blockHash(99n);
      if (failure === "wrong feed") evidence.contractAddress = USDC_USD_FEED;
      if (failure === "wrong type") (evidence as { type: string }).type = "TRANSACTION";
      if (failure === "unknown field") Object.assign(evidence, { execute: "SWAP" });
      return { usd: 2800, evidence };
    });
    await expect(new ChainlinkMarketAdapter(async () => snapshot).readMarket()).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });

  it("does not return a market if final canonical verification detects a reorg", async () => {
    const context = fixture();
    const snapshot = await EthereumSnapshot.capture(context.client);
    const error = new EthereumReadError("REORG_DETECTED", "The observed block is no longer canonical.");
    vi.spyOn(snapshot, "verifyCanonical").mockRejectedValue(error);
    await expect(new ChainlinkMarketAdapter(async () => snapshot).readMarket()).rejects.toBe(error);
  });

  it("keeps stale-price domain errors and supplies no fallback data", async () => {
    const context = fixture();
    const snapshot = await EthereumSnapshot.capture(context.client);
    const error = new EthereumReadError("STALE_PRICE", "ETH quote is stale.");
    vi.spyOn(snapshot, "readUsdPrice").mockRejectedValue(error);
    const verifyCanonical = vi.spyOn(snapshot, "verifyCanonical");
    await expect(new ChainlinkMarketAdapter(async () => snapshot).getMarketState()).rejects.toBe(error);
    expect(verifyCanonical).not.toHaveBeenCalled();
  });

  it.each(["source", "historical point", "quote", "canonical verification"])("sanitizes external errors from %s", async (stage) => {
    const context = fixture();
    const snapshot = await EthereumSnapshot.capture(context.client);
    const secret = new Error("https://rpc.invalid/SECRET_KEY", { cause: new Error("nested credential") });
    const source = vi.fn<SnapshotSource>().mockResolvedValue(snapshot);
    if (stage === "source") source.mockRejectedValue(secret);
    if (stage === "historical point") vi.spyOn(snapshot, "atOrBefore").mockRejectedValue(secret);
    if (stage === "quote") vi.spyOn(snapshot, "readUsdPrice").mockRejectedValue(secret);
    if (stage === "canonical verification") vi.spyOn(snapshot, "verifyCanonical").mockRejectedValue(secret);
    const error = await new ChainlinkMarketAdapter(source).readMarket().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EthereumReadError);
    expect(error).toMatchObject({ code: "RPC_READ_FAILED" });
    expect(String(error)).not.toMatch(/SECRET_KEY|rpc\.invalid|credential/);
    expect(source).toHaveBeenCalledOnce();
  });
});
