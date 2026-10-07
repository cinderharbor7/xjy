import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, toHex, type Address, type Hash, type ReadContractParameters } from "viem";
import { describe, expect, it, vi } from "vitest";
import { MarketStateSchema, OnchainSignalStateSchema, PortfolioStateSchema, RiskAnalysisSchema } from "@/domain/schemas";
import { analyzeOnchainData, ONCHAIN_ANALYSIS_LIMITATIONS, type OnchainAnalysisResult } from "@/integration/onchain-analysis";
import { ETH_USD_FEED, SWAP_EVENT, UNISWAP_POOL_ADDRESS, USDC_ADDRESS, USDC_USD_FEED, WETH_ADDRESS } from "@/modules/onchain/ethereum-contracts";
import type { EthereumReadClient } from "@/modules/onchain/ethereum-reader";
import { readEthereumData } from "@/modules/onchain/live-data";
import { EthereumReadError } from "@/modules/onchain/read-error";
import { runAnalyzeCli } from "../scripts/analyze-onchain";

const wallet = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const recipient = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const hash = (number: number) => `0x${number.toString(16).padStart(64, "0")}` as Hash;
const seconds = (number: number) => 10_000 + number * 12;
const stamp = (number: number) => new Date(seconds(number) * 1000).toISOString();

function fixture() {
  const logs = [[350, 1, 100], [375, 2, 200], [399, 3, 300]].map(([block, tx, usd]) => ({
    address: UNISWAP_POOL_ADDRESS, blockHash: hash(block + 1000), blockNumber: toHex(block),
    transactionHash: hash(tx), transactionIndex: "0x0", logIndex: toHex(tx), removed: false,
    topics: encodeEventTopics({ abi: [SWAP_EVENT], eventName: "Swap", args: { sender: wallet, recipient } }),
    data: encodeAbiParameters(parseAbiParameters("int256,int256,uint160,uint128,int24"), [-BigInt(usd) * 1_000_000n, 10n ** 18n, 2n ** 96n, 100n, 0]),
  }));
  const getChainId = vi.fn(async () => 1);
  const getBlock = vi.fn(async (parameters?: { blockNumber?: bigint; blockTag?: "latest" }) => {
    const number = parameters?.blockNumber ?? 400n;
    return { number, hash: hash(Number(number) + 1000), timestamp: BigInt(seconds(Number(number))) };
  });
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
    throw new Error("Unexpected fake RPC read.");
  });
  const getTransaction = vi.fn(async ({ hash: txHash }: { hash: Hash }) => {
    const log = logs.find(event => event.transactionHash === txHash)!;
    return { hash: txHash, from: wallet, blockHash: log.blockHash, blockNumber: BigInt(log.blockNumber) };
  });
  // These sentinels are deliberately available but must never be used by the read side.
  const writeContract = vi.fn(), sendRawTransaction = vi.fn();
  const client: EthereumReadClient & { writeContract: typeof writeContract; sendRawTransaction: typeof sendRawTransaction } = {
    getChainId, getBlock, getBalance: vi.fn(async () => 2n * 10n ** 18n),
    readContract: readContract as EthereumReadClient["readContract"], getTransaction,
    getRawLogs: vi.fn(async () => logs), writeContract, sendRawTransaction,
  };
  return { client, getChainId, getBlock, writeContract, sendRawTransaction };
}

describe("A -> B one-shot read-only composition", () => {
  it("reads one actual adapter snapshot and feeds the frozen contracts to B", async () => {
    const context = fixture();
    const result = await analyzeOnchainData(context.client, wallet);
    expect(result).toMatchObject({ mode: "LIVE_READ_ONLY", section: "all", network: "ethereum-mainnet", analysisMethod: "SELL_PRESSURE_HEURISTIC" });
    expect(PortfolioStateSchema.parse(result.portfolio.state)).toEqual(result.portfolio.state);
    expect(MarketStateSchema.parse(result.market.state)).toEqual(result.market.state);
    expect(OnchainSignalStateSchema.parse(result.signal)).toEqual(result.signal);
    expect(RiskAnalysisSchema.parse(result.riskAnalysis)).toEqual(result.riskAnalysis);
    expect(result.portfolio.state.totalUsd).toBe(6620);
    expect(result.signal).toMatchObject({ currentSellVolumeUsd: 510, baselineSellVolumeUsd: 98, txCount: 2, uniqueWallets: 1 });
    expect(result.riskAnalysis.riskScore).toBe(100);
    expect(result.riskAnalysis.confidence).toBe(0.6);
    expect(result.riskAnalysis.confidence).toBe(result.riskAnalysis.investigation.confidence);
    expect(result.riskAnalysis.riskExposurePct).toBe(result.portfolio.state.riskExposurePct);
    expect(result.portfolio.state.timestamp).toBe(stamp(400));
    expect(result.market.state.timestamp).toBe(result.portfolio.state.timestamp);
    expect(result.signal.windowEnd).toBe(result.market.state.timestamp);
    expect(context.getChainId).toHaveBeenCalledOnce();
    expect(context.getBlock.mock.calls.filter(([request]) => request?.blockTag === "latest")).toHaveLength(1);
    expect(context.writeContract).not.toHaveBeenCalled();
    expect(context.sendRawTransaction).not.toHaveBeenCalled();
    expect(result.riskAnalysis.investigation.evidence.join("\n")).toContain(`https://etherscan.io/tx/${hash(2)}`);
    expect(result.riskAnalysis.investigation.evidence.join("\n")).toContain(UNISWAP_POOL_ADDRESS);
    expect(result.limitations).toEqual(ONCHAIN_ANALYSIS_LIMITATIONS);
    expect(result).not.toHaveProperty("execution");
    expect(result).not.toHaveProperty("policyDecision");
  });

  it("rejects an invalid wallet before reading", async () => {
    const context = fixture();
    const read = vi.fn(readEthereumData);
    await expect(analyzeOnchainData(context.client, "not-wallet", read)).rejects.toMatchObject({ code: "INVALID_WALLET" });
    expect(read).not.toHaveBeenCalled();
  });

  it("propagates a safe A failure exactly once without producing fallback data", async () => {
    const context = fixture();
    const error = new EthereumReadError("EMPTY_BASELINE", "No positive preceding-window baseline.");
    const read = vi.fn<typeof readEthereumData>().mockRejectedValue(error);
    await expect(analyzeOnchainData(context.client, wallet, read)).rejects.toBe(error);
    expect(read).toHaveBeenCalledExactlyOnceWith(context.client, { section: "all", wallet });
    expect(context.writeContract).not.toHaveBeenCalled();
  });

  it("lets A sanitize raw RPC failures and does not return partial analysis", async () => {
    const context = fixture();
    context.getBlock.mockRejectedValue(new Error("https://rpc.invalid/SECRET_KEY", { cause: new Error("TOKEN") }));
    const error = await analyzeOnchainData(context.client, wallet).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EthereumReadError);
    expect(error).toMatchObject({ code: "RPC_READ_FAILED" });
    expect(String(error)).not.toMatch(/SECRET_KEY|TOKEN|rpc\.invalid/);
    expect(context.writeContract).not.toHaveBeenCalled();
    expect(context.sendRawTransaction).not.toHaveBeenCalled();
  });

  it.each(["incomplete", "wrong-wallet", "different-anchor", "unknown-field"] as const)("rejects %s data at the A/B boundary", async (change) => {
    const context = fixture();
    const all = await readEthereumData(context.client, { section: "all", wallet });
    if (all.section !== "all") throw new Error("Expected complete fixture");
    const bad = change === "incomplete" ? { ...all, section: "market" }
      : change === "wrong-wallet" ? { ...all, portfolio: { ...all.portfolio, state: { ...all.portfolio.state, wallet: recipient } } }
        : change === "different-anchor" ? { ...all, market: { ...all.market, state: { ...all.market.state, timestamp: stamp(399) } } }
          : { ...all, authority: "APPROVED" };
    const read = vi.fn<typeof readEthereumData>().mockResolvedValue(bad as typeof all);
    await expect(analyzeOnchainData(context.client, wallet, read)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
    expect(context.writeContract).not.toHaveBeenCalled();
  });
});

function cliDependencies(result?: OnchainAnalysisResult) {
  return {
    configuration: vi.fn(() => "https://rpc.invalid/CONFIG_SECRET"),
    analyze: vi.fn(async (_url: string, _wallet: string) => {
      if (!result) throw new Error("Missing fake CLI result");
      return result;
    }),
    stdout: vi.fn((_text: string) => {}), stderr: vi.fn((_text: string) => {}),
  };
}

describe("one-shot analysis CLI", () => {
  it("serves help without configuration or reads", async () => {
    const dependencies = cliDependencies();
    expect(await runAnalyzeCli(["--help"], dependencies)).toBe(0);
    expect(dependencies.configuration).not.toHaveBeenCalled();
    expect(dependencies.analyze).not.toHaveBeenCalled();
    expect(dependencies.stdout.mock.calls[0][0]).toContain("LIVE_READ_ONLY");
  });

  it.each([
    { argv: [] }, { argv: ["--wallet", "bad"] },
    { argv: ["--wallet", wallet, "--only", "all"] }, { argv: ["--wallet", wallet, "--wallet", wallet] },
  ])("rejects unsupported or missing arguments $argv before reading", async ({ argv }) => {
    const dependencies = cliDependencies();
    expect(await runAnalyzeCli(argv, dependencies)).toBe(1);
    expect(dependencies.configuration).not.toHaveBeenCalled();
    expect(dependencies.analyze).not.toHaveBeenCalled();
    expect(dependencies.stdout).not.toHaveBeenCalled();
  });

  it("writes complete JSON with public references and heuristic limitations", async () => {
    const result = await analyzeOnchainData(fixture().client, wallet);
    const dependencies = cliDependencies(result);
    expect(await runAnalyzeCli(["--wallet", wallet, "--json"], dependencies)).toBe(0);
    expect(JSON.parse(dependencies.stdout.mock.calls[0][0])).toEqual(result);
    expect(dependencies.stdout.mock.calls[0][0]).not.toContain("CONFIG_SECRET");
    expect(dependencies.stderr).not.toHaveBeenCalled();
    expect(dependencies.analyze).toHaveBeenCalledExactlyOnceWith("https://rpc.invalid/CONFIG_SECRET", wallet);
  });

  it("labels the human result and provides no complete payload without --json", async () => {
    const result = await analyzeOnchainData(fixture().client, wallet);
    const dependencies = cliDependencies(result);
    expect(await runAnalyzeCli(["--wallet", wallet], dependencies)).toBe(0);
    const text = dependencies.stdout.mock.calls[0][0];
    expect(text).toContain("SELL_PRESSURE_HEURISTIC");
    expect(text).toContain("not a fitted or calibrated prediction model");
    expect(text).toContain("No LLM");
    expect(text).toContain("Use --json");
    expect(text).not.toContain("CONFIG_SECRET");
  });

  it.each([false, true])("sanitizes unexpected errors and produces no success output (json=%s)", async (json) => {
    const dependencies = cliDependencies();
    dependencies.analyze.mockRejectedValue(new Error("RPC https://rpc.invalid/SECRET_KEY", { cause: new Error("API_TOKEN") }));
    expect(await runAnalyzeCli(["--wallet", wallet, ...(json ? ["--json"] : [])], dependencies)).toBe(1);
    expect(dependencies.stdout).not.toHaveBeenCalled();
    expect(dependencies.analyze).toHaveBeenCalledOnce();
    const output = dependencies.stderr.mock.calls[0][0];
    expect(output).not.toMatch(/SECRET_KEY|API_TOKEN|CONFIG_SECRET|rpc\.invalid|stack|cause/);
    if (json) expect(JSON.parse(output)).toMatchObject({ error: { code: "RPC_READ_FAILED" } });
  });

  it("preserves safe A error codes without a fallback", async () => {
    const dependencies = cliDependencies();
    dependencies.analyze.mockRejectedValue(new EthereumReadError("EMPTY_BASELINE", "No positive preceding-window baseline."));
    expect(await runAnalyzeCli(["--wallet", wallet, "--json"], dependencies)).toBe(1);
    expect(JSON.parse(dependencies.stderr.mock.calls[0][0])).toEqual({ error: { code: "EMPTY_BASELINE", message: "No positive preceding-window baseline." } });
    expect(dependencies.stdout).not.toHaveBeenCalled();
    expect(dependencies.analyze).toHaveBeenCalledOnce();
  });
});
