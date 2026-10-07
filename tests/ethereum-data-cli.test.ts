import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, toHex, type Address, type Hash, type ReadContractParameters } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarketStateSchema, OnchainSignalStateSchema, PortfolioStateSchema } from "@/domain/schemas";
import { ETH_USD_FEED, ERC20_ABI, SWAP_EVENT, UNISWAP_POOL_ADDRESS, USDC_ADDRESS, USDC_USD_FEED, WETH_ADDRESS } from "@/modules/onchain/ethereum-contracts";
import type { EthereumReadClient } from "@/modules/onchain/ethereum-reader";
import { createEthereumDataServices, createEthereumReadClient, readEthereumData, validateRpcUrl } from "@/modules/onchain/live-data";
import { parseReadArguments, runReadCli } from "@/modules/onchain/read-cli";
import { EthereumReadError } from "@/modules/onchain/read-error";
import { EthereumDataResultSchema, LIVE_READ_SCOPE, type EthereumDataResult, type ReadRequest, type ReadSection } from "@/modules/onchain/read-results";

const viemFactory = vi.hoisted(() => ({ createPublicClient: vi.fn(), http: vi.fn() }));
vi.mock("viem", async (importOriginal) => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: viemFactory.createPublicClient,
  http: viemFactory.http,
}));

const wallet = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa" as Address;
const recipient = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const hash = (number: number) => `0x${number.toString(16).padStart(64, "0")}` as Hash;
const seconds = (number: number) => 10_000 + number * 12;
const stamp = (number: number) => new Date(seconds(number) * 1000).toISOString();

function sale(block: number, tx: number, usdcRaw: bigint) {
  return {
    address: UNISWAP_POOL_ADDRESS, blockHash: hash(block + 1000), blockNumber: toHex(block),
    transactionHash: hash(tx), transactionIndex: "0x0", logIndex: toHex(tx), removed: false,
    topics: encodeEventTopics({ abi: [SWAP_EVENT], eventName: "Swap", args: { sender: wallet, recipient } }),
    data: encodeAbiParameters(parseAbiParameters("int256,int256,uint160,uint128,int24"), [-usdcRaw, 10n ** 18n, 2n ** 96n, 100n, 0]),
  };
}

/** Exercise real snapshots/adapters with deterministic public-RPC responses, without a network. */
function fixture() {
  const logs = [sale(350, 1, 100_000_000n), sale(375, 2, 200_000_000n), sale(399, 3, 300_000_000n)];
  const getChainId = vi.fn(async () => 1);
  const getBlock = vi.fn(async (parameters?: { blockNumber?: bigint; blockTag?: "latest" }) => {
    const number = parameters?.blockNumber ?? 400n;
    return { number, hash: hash(Number(number) + 1000), timestamp: BigInt(seconds(Number(number))) };
  });
  const getBalance = vi.fn(async (_parameters: Parameters<EthereumReadClient["getBalance"]>[0]) => 2_000_000_000_000_000_000n);
  const readContract = vi.fn(async (parameters: ReadContractParameters): Promise<unknown> => {
    const name = parameters.functionName;
    if (parameters.address === USDC_ADDRESS) {
      if (name === "decimals") return 6;
      if (name === "balanceOf") return 1_000_000_000n;
    }
    if (name === "token0") return USDC_ADDRESS;
    if (name === "token1") return WETH_ADDRESS;
    if (name === "fee") return 500;
    if (name === "description") return parameters.address === ETH_USD_FEED ? "ETH / USD" : "USDC / USD";
    if (name === "decimals") return 8;
    if (name === "latestRoundData") {
      const number = Number(BigInt(parameters.blockHash!)) - 1000;
      const time = BigInt(seconds(number));
      const answer = parameters.address === USDC_USD_FEED ? number < 375 ? 98_000_000n : 102_000_000n
        : number === 400 ? 280_000_000_000n : number === 375 ? 290_000_000_000n : 300_000_000_000n;
      return [BigInt(number + 1), answer, time, time, BigInt(number + 1)];
    }
    throw new Error("Unexpected public-RPC fixture read.");
  });
  const getRawLogs = vi.fn(async () => logs as unknown);
  const getTransaction = vi.fn(async ({ hash: txHash }: { hash: Hash }) => {
    const event = logs.find((entry) => entry.transactionHash === txHash)!;
    return { hash: txHash, from: wallet, blockHash: event.blockHash, blockNumber: BigInt(event.blockNumber) };
  });
  const client: EthereumReadClient = {
    getChainId, getBlock, getBalance, readContract: readContract as EthereumReadClient["readContract"], getTransaction, getRawLogs,
  };
  return { client, logs, getChainId, getBlock, getBalance, readContract, getRawLogs, getTransaction };
}

function cliDependencies(result?: EthereumDataResult) {
  return {
    configuration: vi.fn(() => "https://rpc.invalid/TEST_CREDENTIAL"),
    read: vi.fn(async (_url: string, _request: ReadRequest) => {
      if (!result) throw new Error("CLI fixture has no selected result.");
      return result;
    }),
    stdout: vi.fn((_text: string) => {}),
    stderr: vi.fn((_text: string) => {}),
  };
}

beforeEach(() => {
  viemFactory.createPublicClient.mockReset();
  viemFactory.http.mockReset().mockReturnValue({ configuredTransport: true });
});

describe("Ethereum read CLI argument contract", () => {
  it("defaults to all, preserves wallet case and accepts flags in any order", () => {
    expect(parseReadArguments(["--json", "--wallet", ` ${wallet} `])).toEqual({
      help: false, json: true, request: { section: "all", wallet },
    });
    expect(parseReadArguments(["--wallet", wallet, "--only", "portfolio"])).toMatchObject({ request: { section: "portfolio", wallet } });
  });

  it.each(["market", "signal"])("allows %s without a wallet", (section) => {
    expect(parseReadArguments(["--only", section])).toEqual({ help: false, json: false, request: { section } });
  });

  it.each([
    ["--wat"], ["--wallet=0x123"], [wallet], ["--json", "true"], ["--json", "--json"],
    ["--help", "--help"], ["--only", "market", "--only", "signal"], ["--wallet", wallet, "--wallet", wallet],
    ["--only"], ["--wallet"], ["--wallet", "--json"], ["--only", "--help"], ["--only", ""],
    ["--only", "ALL"], ["--only", "position"], ["--only", "market", "extra"],
  ].map((argv) => ({ argv })))("rejects malformed/duplicate/missing options %#", ({ argv }) => {
    expect(() => parseReadArguments(argv)).toThrow(expect.objectContaining({ code: "INVALID_ARGUMENT" }));
  });

  it.each([[], ["--json"], ["--only", "all"], ["--only", "portfolio"], ["--wallet", "demo-wallet"], ["--wallet", "0x1"]].map((argv) => ({ argv })))("requires a real wallet before an all/portfolio read %#", ({ argv }) => {
    expect(() => parseReadArguments(argv)).toThrow(expect.objectContaining({ code: "INVALID_WALLET" }));
  });

  it.each([["--help"], ["--help", "--json"], ["--only", "signal", "--help"]].map((argv) => ({ argv })))("prints help without configuration or any RPC dependency %#", async ({ argv }) => {
    const dependencies = cliDependencies();
    expect(await runReadCli(argv, dependencies)).toBe(0);
    expect(dependencies.configuration).not.toHaveBeenCalled();
    expect(dependencies.read).not.toHaveBeenCalled();
    expect(dependencies.stderr).not.toHaveBeenCalled();
    expect(dependencies.stdout).toHaveBeenCalledOnce();
    const text = dependencies.stdout.mock.calls[0][0];
    expect(text).toContain("LIVE_READ_ONLY");
    expect(text).toContain("--wallet");
    expect(text).toContain("--only");
    expect(text).toContain("does not start monitoring");
  });

  it("rejects an invalid wallet without loading configuration, connecting or writing stdout", async () => {
    const dependencies = cliDependencies();
    expect(await runReadCli(["--wallet", "bad-wallet", "--json"], dependencies)).toBe(1);
    expect(dependencies.configuration).not.toHaveBeenCalled();
    expect(dependencies.read).not.toHaveBeenCalled();
    expect(dependencies.stdout).not.toHaveBeenCalled();
    expect(JSON.parse(dependencies.stderr.mock.calls[0][0])).toEqual({
      error: { code: "INVALID_WALLET", message: "Enter a valid Ethereum wallet address." },
    });
  });
});

describe("Ethereum data factory uses real adapters with selected frozen results", () => {
  it.each(["portfolio", "market", "signal", "all"] as const)("returns only the selected %s section and its declared scope", async (section) => {
    const context = fixture();
    const result = await readEthereumData(context.client, { section, ...(section === "portfolio" || section === "all" ? { wallet } : {}) });
    expect(EthereumDataResultSchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({ section, mode: "LIVE_READ_ONLY", network: "ethereum-mainnet", scope: LIVE_READ_SCOPE });
    expect(Object.keys(result).sort()).toEqual(["mode", "network", "scope", "section", ...(section === "all" ? ["portfolio", "market", "signal"] : [section])].sort());
    expect(context.getChainId).toHaveBeenCalledOnce();
    expect(context.getBlock.mock.calls.filter(([request]) => request?.blockTag === "latest")).toHaveLength(1);
    if ("portfolio" in result) {
      expect(PortfolioStateSchema.parse(result.portfolio.state)).toEqual(result.portfolio.state);
      expect(result.portfolio.state).toMatchObject({ wallet, totalUsd: 6620, riskAssetUsd: 5600, defensiveAssetUsd: 1020, timestamp: stamp(400), blockNumber: 400 });
      expect(result.portfolio.evidence).toHaveLength(4);
    }
    if ("market" in result) {
      expect(MarketStateSchema.parse(result.market.state)).toEqual(result.market.state);
      expect(result.market.state).toMatchObject({ asset: "ETH", priceUsd: 2800, timestamp: stamp(400) });
      expect(result.market.state.priceChange5mPct).toBeCloseTo((2800 / 2900 - 1) * 100);
      expect(result.market.state.priceChange1hPct).toBeCloseTo((2800 / 3000 - 1) * 100);
      expect(result.market.evidence).toHaveLength(3);
    }
    if ("signal" in result) {
      expect(OnchainSignalStateSchema.parse(result.signal)).toEqual(result.signal);
      expect(result.signal).toMatchObject({ windowStart: stamp(375), windowEnd: stamp(400), currentSellVolumeUsd: 510, baselineSellVolumeUsd: 98, txCount: 2, uniqueWallets: 1 });
    }
  });

  it("shares exactly one all-read anchor and request-local oracle cache across sections", async () => {
    const context = fixture();
    const result = await readEthereumData(context.client, { section: "all", wallet });
    if (result.section !== "all") throw new Error("Expected the all-data fixture result.");
    expect(result.portfolio.state.timestamp).toBe(result.market.state.timestamp);
    expect(result.signal.windowEnd).toBe(result.portfolio.state.timestamp);
    expect(context.readContract.mock.calls.filter(([request]) => request.address === ETH_USD_FEED
      && request.blockHash === hash(1400) && request.functionName === "latestRoundData")).toHaveLength(1);
    expect(context.getBlock.mock.calls.filter(([request]) => request?.blockNumber === 400n)).toHaveLength(3);
    expect(result.portfolio.evidence.every((evidence) => evidence.blockHash === hash(1400))).toBe(true);
    expect(result.market.evidence[0].blockHash).toBe(hash(1400));
    expect(result.signal.evidence[0].blockHash).toBe(hash(1400));
  });

  it.each(["portfolio", "market", "signal"] as const)("avoids unrelated RPC work for a %s-only read", async (section) => {
    const context = fixture();
    await readEthereumData(context.client, { section, ...(section === "portfolio" ? { wallet } : {}) });
    if (section !== "portfolio") expect(context.getBalance).not.toHaveBeenCalled();
    if (section !== "signal") {
      expect(context.getRawLogs).not.toHaveBeenCalled();
      expect(context.getTransaction).not.toHaveBeenCalled();
      expect(context.readContract.mock.calls.some(([request]) => request.address === UNISWAP_POOL_ADDRESS)).toBe(false);
    }
    if (section === "market") expect(context.readContract.mock.calls.every(([request]) => request.address === ETH_USD_FEED)).toBe(true);
    if (section === "signal") expect(context.readContract.mock.calls.some(([request]) => request.address === ETH_USD_FEED)).toBe(false);
    if (section === "portfolio") expect(context.getBlock.mock.calls.some(([request]) => request?.blockNumber !== undefined && request.blockNumber !== 400n)).toBe(false);
  });

  it.each(["all", "portfolio"] as const)("validates the %s wallet before any RPC", async (section) => {
    const context = fixture();
    await expect(readEthereumData(context.client, { section, wallet: "invalid" })).rejects.toMatchObject({ code: "INVALID_WALLET" });
    expect(context.getChainId).not.toHaveBeenCalled();
    expect(context.getBlock).not.toHaveBeenCalled();
  });

  it("rejects an unknown section without touching the RPC", async () => {
    const context = fixture();
    await expect(readEthereumData(context.client, { section: "execution" as ReadSection, wallet })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(context.getChainId).not.toHaveBeenCalled();
  });

  it("fails the entire all-data result when signal collection fails after portfolio and market", async () => {
    const context = fixture();
    context.getRawLogs.mockRejectedValue(new Error("https://rpc.invalid/SECRET_KEY", { cause: new Error("API_TOKEN") }));
    const error = await readEthereumData(context.client, { section: "all", wallet }).catch((caught: unknown) => caught);
    expect(context.getBalance).toHaveBeenCalledOnce();
    expect(context.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: ETH_USD_FEED, blockHash: hash(1100), functionName: "latestRoundData" }));
    expect(error).toBeInstanceOf(EthereumReadError);
    expect(error).toMatchObject({ code: "RPC_READ_FAILED" });
    expect(error).not.toHaveProperty("portfolio");
    expect(error).not.toHaveProperty("market");
    expect(String(error)).not.toMatch(/SECRET_KEY|API_TOKEN|rpc\.invalid/);
    expect(context.getRawLogs).toHaveBeenCalledOnce();
  });

  it("preserves zero-baseline failures instead of fabricating a valid all-data result", async () => {
    const context = fixture();
    context.getRawLogs.mockResolvedValue([]);
    await expect(readEthereumData(context.client, { section: "all", wallet })).rejects.toMatchObject({ code: "EMPTY_BASELINE" });
  });

  it("creates only three reading services and captures a new snapshot on each getter", async () => {
    const context = fixture();
    const services = createEthereumDataServices(context.client);
    expect(Object.keys(services).sort()).toEqual(["market", "portfolio", "signal"]);
    await services.portfolio.getPortfolio(wallet);
    await services.portfolio.getPortfolio(wallet);
    await services.market.getMarketState();
    await services.market.getMarketState();
    await services.signal.getSignal();
    await services.signal.getSignal();
    expect(context.getChainId).toHaveBeenCalledTimes(6);
    expect(context.getBlock.mock.calls.filter(([request]) => request?.blockTag === "latest")).toHaveLength(6);
    expect(context.getBalance).toHaveBeenCalledTimes(2);
    expect(context.getRawLogs).toHaveBeenCalledTimes(2);
  });
});

describe("Strict selected JSON wrapper", () => {
  it("round-trips real selected results through JSON and preserves domain DTOs", async () => {
    const result = await readEthereumData(fixture().client, { section: "all", wallet });
    const json = JSON.parse(JSON.stringify(result));
    expect(EthereumDataResultSchema.parse(json)).toEqual(result);
    expect(json.scope.portfolioAssets).toEqual(["ETH_NATIVE", "USDC"]);
    expect(json.scope.signalPool).toBe(UNISWAP_POOL_ADDRESS);
    expect(json.scope.signalWindowSeconds).toBe(300);
    expect(json.scope.volatilityDefinition).toContain("not statistical volatility");
  });

  it.each([
    ["unknown wrapper field", (value: Record<string, any>) => { value.approved = true; }],
    ["wrong section", (value: Record<string, any>) => { value.section = "portfolio"; }],
    ["missing selected section", (value: Record<string, any>) => { delete value.signal; }],
    ["wrong mode", (value: Record<string, any>) => { value.mode = "MOCK"; }],
    ["wrong network", (value: Record<string, any>) => { value.network = "base-mainnet"; }],
    ["unknown scope", (value: Record<string, any>) => { value.scope.execute = true; }],
    ["wrong asset scope", (value: Record<string, any>) => { value.scope.portfolioAssets.push("WETH"); }],
    ["wrong pool", (value: Record<string, any>) => { value.scope.signalPool = USDC_ADDRESS; }],
    ["wrong window", (value: Record<string, any>) => { value.scope.signalWindowSeconds = 600; }],
    ["unknown read-result field", (value: Record<string, any>) => { value.portfolio.blockHash = hash(1400); }],
    ["unknown portfolio DTO field", (value: Record<string, any>) => { value.portfolio.state.evidence = []; }],
    ["unknown market DTO field", (value: Record<string, any>) => { value.market.state.approve = true; }],
    ["unknown signal DTO field", (value: Record<string, any>) => { value.signal.action = "SWAP_TO_SAFE"; }],
    ["broken category totals", (value: Record<string, any>) => { value.portfolio.state.totalUsd = 1; }],
    ["broken ratio", (value: Record<string, any>) => { value.signal.anomalyRatio = 999; }],
  ] as const)("rejects %s", async (_name, mutate) => {
    const valid = await readEthereumData(fixture().client, { section: "all", wallet });
    const changed = JSON.parse(JSON.stringify(valid));
    mutate(changed);
    expect(EthereumDataResultSchema.safeParse(changed).success).toBe(false);
  });

  it("rejects cross-section fields even when their domain DTOs are valid", async () => {
    const all = await readEthereumData(fixture().client, { section: "all", wallet });
    if (all.section !== "all") throw new Error("Expected all sections.");
    const { portfolio: omittedPortfolio, signal: omittedSignal, ...market } = all;
    expect(omittedPortfolio.state.wallet).toBe(wallet);
    expect(omittedSignal.signalType).toBe("DEX_SELL_PRESSURE");
    expect(EthereumDataResultSchema.safeParse({ ...market, section: "market" }).success).toBe(true);
    expect(EthereumDataResultSchema.safeParse({ ...market, section: "market", signal: all.signal }).success).toBe(false);
  });
});

describe("CLI output and safe failure behavior", () => {
  it("writes one strict JSON value to stdout and no progress/errors", async () => {
    const result = await readEthereumData(fixture().client, { section: "all", wallet });
    const dependencies = cliDependencies(result);
    expect(await runReadCli(["--wallet", wallet, "--json"], dependencies)).toBe(0);
    expect(dependencies.configuration).toHaveBeenCalledOnce();
    expect(dependencies.read).toHaveBeenCalledExactlyOnceWith("https://rpc.invalid/TEST_CREDENTIAL", { section: "all", wallet });
    expect(dependencies.stdout).toHaveBeenCalledOnce();
    expect(dependencies.stderr).not.toHaveBeenCalled();
    const output = dependencies.stdout.mock.calls[0][0];
    expect(EthereumDataResultSchema.parse(JSON.parse(output))).toEqual(result);
    expect(output).not.toContain("TEST_CREDENTIAL");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("displays actual holdings, scope, proxy and single-pool evidence in human output", async () => {
    const result = await readEthereumData(fixture().client, { section: "all", wallet });
    const dependencies = cliDependencies(result);
    expect(await runReadCli(["--wallet", wallet], dependencies)).toBe(0);
    const text = dependencies.stdout.mock.calls[0][0];
    expect(text).toContain("LIVE_READ_ONLY");
    expect(text).toContain(wallet);
    expect(text).toContain("ETH: 2 ($5600.00)");
    expect(text).toContain("USDC: 1000 ($1020.00)");
    expect(text).toContain("Total: $6620.00");
    expect(text).toContain("other tokens excluded");
    expect(text).toContain("not statistical volatility");
    expect(text).toContain("single WETH/USDC 0.05% pool");
    expect(text).toContain("sell transactions: 2; unique tx.from: 1");
    expect(text).not.toContain("TEST_CREDENTIAL");
    expect(dependencies.stderr).not.toHaveBeenCalled();
  });

  it.each([false, true])("strips generic RPC error details with json=%s and exits nonzero without partial stdout", async (json) => {
    const dependencies = cliDependencies();
    dependencies.read.mockRejectedValue(new Error("https://rpc.invalid/SECRET_KEY wallet=secret", { cause: new Error("API_TOKEN") }));
    expect(await runReadCli(["--only", "market", ...(json ? ["--json"] : [])], dependencies)).toBe(1);
    expect(dependencies.stdout).not.toHaveBeenCalled();
    expect(dependencies.stderr).toHaveBeenCalledOnce();
    expect(dependencies.read).toHaveBeenCalledOnce();
    const error = dependencies.stderr.mock.calls[0][0];
    expect(error).not.toMatch(/SECRET_KEY|API_TOKEN|TEST_CREDENTIAL|wallet=secret|rpc\.invalid|cause|stack/);
    if (json) expect(JSON.parse(error)).toEqual({ error: { code: "RPC_READ_FAILED", message: "Unable to complete the required Ethereum read." } });
    else expect(error).toBe("RPC_READ_FAILED: Unable to complete the required Ethereum read.\n");
  });

  it("preserves a safe domain error code while never writing a success result", async () => {
    const dependencies = cliDependencies();
    dependencies.read.mockRejectedValue(new EthereumReadError("EMPTY_BASELINE", "No positive preceding-window baseline."));
    expect(await runReadCli(["--only", "signal", "--json"], dependencies)).toBe(1);
    expect(JSON.parse(dependencies.stderr.mock.calls[0][0])).toEqual({ error: { code: "EMPTY_BASELINE", message: "No positive preceding-window baseline." } });
    expect(dependencies.stdout).not.toHaveBeenCalled();
  });

  it("fails missing configuration before constructing any read client", async () => {
    const dependencies = cliDependencies();
    dependencies.configuration.mockImplementation(() => validateRpcUrl(undefined));
    expect(await runReadCli(["--only", "market"], dependencies)).toBe(1);
    expect(dependencies.read).not.toHaveBeenCalled();
    expect(dependencies.stdout).not.toHaveBeenCalled();
    expect(dependencies.stderr.mock.calls[0][0]).toMatch(/^CONFIGURATION_ERROR:/);
    expect(viemFactory.createPublicClient).not.toHaveBeenCalled();
  });
});

describe("Restricted real-RPC client configuration and concurrency", () => {
  it.each([undefined, "", " ", "not-a-url", "file:///tmp/rpc", "ftp://rpc.invalid", "ws://rpc.invalid"])("rejects missing or non-HTTP(S) configuration %s without a client", (url) => {
    expect(() => createEthereumReadClient(url as string)).toThrow(expect.objectContaining({ code: "CONFIGURATION_ERROR" }));
    expect(viemFactory.createPublicClient).not.toHaveBeenCalled();
    expect(viemFactory.http).not.toHaveBeenCalled();
  });

  it("configures mainnet, finite timeout, no retries/cache and exposes public read methods only", async () => {
    const base = {
      getChainId: vi.fn(async () => 1), getBlock: vi.fn(), getBalance: vi.fn(), readContract: vi.fn(),
      getTransaction: vi.fn(), request: vi.fn(async () => []), sendTransaction: vi.fn(), signMessage: vi.fn(),
    };
    viemFactory.createPublicClient.mockReturnValue(base);
    const client = createEthereumReadClient(" https://rpc.invalid/TEST_CREDENTIAL ");
    expect(viemFactory.http).toHaveBeenCalledExactlyOnceWith("https://rpc.invalid/TEST_CREDENTIAL", { retryCount: 0, timeout: 10_000 });
    expect(viemFactory.createPublicClient).toHaveBeenCalledWith(expect.objectContaining({ chain: expect.objectContaining({ id: 1 }), cacheTime: 0 }));
    expect(Object.keys(client).sort()).toEqual(["getBalance", "getBlock", "getChainId", "getRawLogs", "getTransaction", "readContract"]);
    expect(client).not.toHaveProperty("request");
    expect(client).not.toHaveProperty("sendTransaction");
    expect(client).not.toHaveProperty("signMessage");
    await client.getRawLogs({ address: UNISWAP_POOL_ADDRESS, topics: [hash(1)], fromBlock: 350n, toBlock: 399n });
    expect(base.request).toHaveBeenCalledExactlyOnceWith({ method: "eth_getLogs", params: [{
      address: UNISWAP_POOL_ADDRESS, topics: [hash(1)], fromBlock: "0x15e", toBlock: "0x18f",
    }] });
    expect(base.sendTransaction).not.toHaveBeenCalled();
    expect(base.signMessage).not.toHaveBeenCalled();
    if (false) {
      // @ts-expect-error B/D cannot use the A client to issue unrestricted RPC requests.
      client.request;
      // @ts-expect-error The A read client cannot send a transaction.
      client.sendTransaction;
      // @ts-expect-error The A read client cannot sign a message.
      client.signMessage;
    }
  });

  it("limits all six public-read methods together to four in-flight requests", async () => {
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const delayed = vi.fn(() => new Promise<undefined>((resolve) => {
      active++;
      peak = Math.max(peak, active);
      releases.push(() => { active--; resolve(undefined); });
    }));
    viemFactory.createPublicClient.mockReturnValue({
      getChainId: delayed, getBlock: delayed, getBalance: delayed, readContract: delayed, getTransaction: delayed, request: delayed,
    });
    const client = createEthereumReadClient("https://rpc.invalid");
    const batch = () => [
      client.getChainId(), client.getBlock({ blockTag: "latest" }),
      client.getBalance({ address: wallet, blockHash: hash(1400), requireCanonical: true }),
      client.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "decimals", blockHash: hash(1400), requireCanonical: true }),
      client.getTransaction({ hash: hash(2) }),
      client.getRawLogs({ address: UNISWAP_POOL_ADDRESS, topics: [hash(1)], fromBlock: 350n, toBlock: 399n }),
    ];
    const operations = [...batch(), ...batch()];
    expect(delayed).toHaveBeenCalledTimes(4);
    for (let index = 0; index < operations.length; index++) {
      await vi.waitFor(() => expect(releases[index]).toBeTypeOf("function"));
      releases[index]();
    }
    await Promise.all(operations);
    expect(delayed).toHaveBeenCalledTimes(12);
    expect(peak).toBe(4);
    expect(active).toBe(0);
  });

  it("releases queued reads after a failed request and does not retry it", async () => {
    const releases: ((fail?: boolean) => void)[] = [];
    const delayed = vi.fn(() => new Promise<number>((resolve, reject) => {
      releases.push((fail) => fail ? reject(new Error("Public RPC read failed.")) : resolve(1));
    }));
    viemFactory.createPublicClient.mockReturnValue({ getChainId: delayed });
    const client = createEthereumReadClient("https://rpc.invalid");
    const operations = Array.from({ length: 5 }, () => client.getChainId());
    const settled = Promise.allSettled(operations);
    expect(delayed).toHaveBeenCalledTimes(4);
    releases[0](true);
    await vi.waitFor(() => expect(delayed).toHaveBeenCalledTimes(5));
    releases.slice(1).forEach((release) => release());
    const results = await settled;
    expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
    expect(delayed).toHaveBeenCalledTimes(5);
  });
});
