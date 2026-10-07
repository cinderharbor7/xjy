import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestigationResultSchema } from "@/domain/schemas";
import type { MarketState, OnchainSignalState, PortfolioState, RiskAnalysis } from "@/domain/types";
import { AiInvestigationAdapter } from "@/modules/investigation/ai-investigation.adapter";
import { TransactionCheckReportSchema } from "@/domain/schemas/transaction-check";
import { PolicyService } from "@/modules/policy/policy.service";
import { OnchainSellPressureInvestigationAdapter } from "@/modules/investigation/onchain-investigation.adapter";

const txHash = "0x" + "ab".repeat(32);
const blockHash = "0x" + "cd".repeat(32);
const contractAddress = "0x" + "12".repeat(20);

const signal: OnchainSignalState = {
  signalType: "DEX_SELL_PRESSURE",
  asset: "ETH",
  windowStart: "2026-10-06T12:00:00.000Z",
  windowEnd: "2026-10-06T12:05:00.000Z",
  currentSellVolumeUsd: 300000,
  baselineSellVolumeUsd: 100000,
  anomalyRatio: 3,
  txCount: 12,
  uniqueWallets: 8,
  evidence: [
    { type: "TRANSACTION", txHash, blockNumber: 21000000, description: "Sample ETH sell", source: "MOCK fixture" },
    { type: "BLOCK", blockHash, blockNumber: 21000001, description: "Window end block", source: "MOCK fixture" },
    { type: "CONTRACT_EVENT", txHash, blockNumber: 21000002, contractAddress, description: "DEX swap event", source: "MOCK fixture" },
  ],
};

const portfolio: PortfolioState = {
  wallet: "test-wallet",
  totalUsd: 30000,
  riskAssetUsd: 30000,
  defensiveAssetUsd: 0,
  riskExposurePct: 100,
  assets: [{ symbol: "ETH", amount: 10, usdValue: 30000, category: "RISK" }],
  timestamp: "2026-10-06T12:00:00.000Z",
};

const market: MarketState = {
  asset: "ETH",
  priceUsd: 2700,
  priceChange5mPct: -3,
  priceChange1hPct: -10,
  volatilityScore: 82,
  timestamp: "2026-10-06T12:00:00.000Z",
};

const risk: RiskAnalysis = {
  riskScore: 100,
  confidence: 0.9,
  riskExposurePct: 100,
  stressTests: [
    { priceChangePct: -5, projectedPortfolioUsd: 28500, projectedLossUsd: 1500 },
    { priceChangePct: -10, projectedPortfolioUsd: 27000, projectedLossUsd: 3000 },
    { priceChangePct: -15, projectedPortfolioUsd: 25500, projectedLossUsd: 4500 },
  ],
  investigation: {
    summary: "placeholder",
    primaryCause: "placeholder",
    evidence: [],
    uncertainties: [],
    confidence: 0.9,
  },
  recommendedAction: "SWAP_TO_SAFE",
};

const options = { apiKey: "sk-unit-test", timeoutMs: 1000 };
const template = () => new OnchainSellPressureInvestigationAdapter(signal).investigate(portfolio, market, risk);
async function modelResult() {
  return { ...await template(), summary: "卖压高于前一窗口，但原因未知。", primaryCause: "无法确认交易意图。", confidence: 0.72 };
}
function respond(value: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    choices: [{ message: { content: typeof value === "string" ? value : JSON.stringify(value) } }],
  }));
}
afterEach(() => vi.restoreAllMocks());

describe("explicit AI investigation", () => {
  it("sends an explicitly configured non-thinking request without changing the default", async () => {
    const fetcher = respond(await modelResult());
    const configured = { ...options, thinkingMode: "disabled" as const };
    await new AiInvestigationAdapter(signal, configured).investigate(portfolio, market, risk);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).thinking).toEqual({ type: "disabled" });
    fetcher.mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(await modelResult()) } }] }));
    await new AiInvestigationAdapter(signal, options).investigate(portfolio, market, risk);
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).not.toHaveProperty("thinking");
  });

  it.each([undefined, "", "  "])("rejects missing key instead of returning a rule report (%s)", (apiKey) => {
    expect(() => new AiInvestigationAdapter(signal, { apiKey })).toThrow("AI_CONFIGURATION_REQUIRED");
  });
  it.each([0, -1, NaN, Infinity, 2147483648])("rejects invalid timeout %s", (timeoutMs) => {
    expect(() => new AiInvestigationAdapter(signal, { ...options, timeoutMs })).toThrow("AI_CONFIGURATION_REQUIRED");
  });
  it("propagates a sanitized network failure without fallback or retry", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("SECRET provider detail"));
    await expect(new AiInvestigationAdapter(signal, options).investigate(portfolio, market, risk)).rejects.toThrow("AI_REQUEST_FAILED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not expose HTTP error bodies or return rules", async () => {
    respond({});
    vi.mocked(fetch).mockResolvedValue(new Response("sk-secret provider body", { status: 401 }));
    await expect(new AiInvestigationAdapter(signal, options).investigate(portfolio, market, risk)).rejects.toThrow(/^AI_REQUEST_FAILED$/);
  });
  it("rejects malformed JSON", async () => {
    respond("not-json");
    await expect(new AiInvestigationAdapter(signal, options).investigate(portfolio, market, risk)).rejects.toThrow("AI_OUTPUT_INVALID");
  });
  it("returns labelled interpretation with catalog evidence and mandatory limitations", async () => {
    const output = await modelResult(); output.uncertainties = [];
    const fetcher = respond(output);
    const result = await new AiInvestigationAdapter(signal, options).investigate(portfolio, market, risk);
    expect(result.summary).toContain("AI 推断（未经独立核实）");
    expect(result.confidence).toBe(0.72);
    expect(result.evidence).toEqual(output.evidence);
    expect(result.uncertainties).toEqual(expect.arrayContaining((await template()).uncertainties));
    expect(InvestigationResultSchema.safeParse(result).success).toBe(true);
    const request = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    const input = JSON.parse(request.messages[1].content);
    expect(input.evidenceCatalog).toEqual(output.evidence);
    expect(input.risk).not.toHaveProperty("recommendedAction");
    expect(result).not.toHaveProperty("action");
  });
  it("cannot raise confidence beyond a no-reference observation's coverage", async () => {
    const sparse = { ...signal, evidence: [] };
    const baseline = await new OnchainSellPressureInvestigationAdapter(sparse).investigate(portfolio, market, risk);
    respond({ ...baseline, confidence: 0.99 });
    const result = await new AiInvestigationAdapter(sparse, options).investigate(portfolio, market, risk);
    expect(result.confidence).toBe(0.36);
    const policy = new PolicyService({ minRiskScore: 80, minConfidence: 0.85,
      minRiskExposurePct: 50, maxDeRiskPct: 30, allowedRiskAssets: ["ETH"], allowedDefensiveAssets: ["USDC"] });
    const decision = policy.evaluate(portfolio, { ...risk, confidence: result.confidence, investigation: result });
    expect(decision.triggered).toBe(false);
    expect(decision.action).toBe("NONE");
  });
  it("rejects empty or fabricated evidence instead of manufacturing proof", async () => {
    const output = await modelResult();
    const fetcher = respond({ ...output, evidence: [] });
    const adapter = new AiInvestigationAdapter(signal, options);
    await expect(adapter.investigate(portfolio, market, risk)).rejects.toThrow("AI_OUTPUT_INVALID");
    fetcher.mockResolvedValue(Response.json({ choices: [{ message: { content: JSON.stringify({ ...output, evidence: ["invented fact"] }) } }] }));
    await expect(adapter.investigate(portfolio, market, risk)).rejects.toThrow("AI_OUTPUT_INVALID");
  });
  it("rejects a fabricated hash even in otherwise schema-valid model prose", async () => {
    respond({ ...await modelResult(), summary: `Unknown transaction 0x${"ee".repeat(32)}` });
    await expect(new AiInvestigationAdapter(signal, options).investigate(portfolio, market, risk)).rejects.toThrow("AI_OUTPUT_INVALID");
  });
  it("rejects fabricated block references in interpretation", async () => {
    respond({ ...await modelResult(), primaryCause: "block 999999 is the cause" });
    await expect(new AiInvestigationAdapter(signal, options).investigate(portfolio, market, risk)).rejects.toThrow("AI_OUTPUT_INVALID");
  });
  it("rejects execution fields in model output", async () => {
    respond({ ...await modelResult(), action: "SWAP_TO_SAFE" });
    await expect(new AiInvestigationAdapter(signal, options).investigate(portfolio, market, risk)).rejects.toThrow("AI_OUTPUT_INVALID");
  });
  it("keeps the validated signal snapshot when caller mutates its object", async () => {
    const copy = structuredClone(signal);
    const adapter = new AiInvestigationAdapter(copy, options);
    copy.currentSellVolumeUsd = 1;
    copy.evidence[0].description = "changed";
    const fetcher = respond(await modelResult());
    await adapter.investigate(portfolio, market, risk);
    const input = JSON.parse(JSON.parse(fetcher.mock.calls[0][1]!.body as string).messages[1].content);
    expect(input.signal).toEqual(signal);
  });
  it("copies schema-validated optional reports and preserves their unknowns", async () => {
    const report = TransactionCheckReportSchema.parse({
      mode: "LIVE_READ_ONLY", network: "ethereum-mainnet", checkedAt: signal.windowEnd,
      classification: "NO_SUPPORTED_SWAP", headline: "No supported swap", summary: "Only outer facts",
      confirmedFacts: ["Receipt succeeded"], uncertainties: ["Other pools not checked"], nextSteps: ["Check original source"],
      observation: {
        transaction: { hash: txHash, from: contractAddress, to: null, nativeValueEth: "0", input: "0x",
          status: "SUCCESS", blockNumber: 21000000, blockHash, timestamp: signal.windowStart, logCount: 0 },
        supportedSwaps: [], scope: { protocol: "UNISWAP_V3", poolAddress: contractAddress,
          poolLabel: "Unit-test pool", asset: "WETH", quoteAsset: "USDC", fee: 500 },
        evidence: [
          { type: "TRANSACTION", txHash, blockNumber: 21000000, description: "Unit-test tx", source: "MOCK fixture" },
          { type: "BLOCK", blockHash, blockNumber: 21000000, description: "Unit-test block", source: "MOCK fixture" },
        ],
      },
    });
    const adapter = new AiInvestigationAdapter(signal, { ...options, reports: [report] });
    report.confirmedFacts[0] = "Changed after construction";
    report.uncertainties[0] = "Changed unknown";
    const fetcher = respond(await modelResult());
    const result = await adapter.investigate(portfolio, market, risk);
    const input = JSON.parse(JSON.parse(fetcher.mock.calls[0][1]!.body as string).messages[1].content);
    expect(input.transactionChecks[0].confirmedFacts).toEqual(["Receipt succeeded"]);
    expect(result.uncertainties).toContain("Other pools not checked");
  });
  it("schema-validates optional reports at construction", () => {
    expect(() => new AiInvestigationAdapter(signal, { ...options, reports: [{}] as never })).toThrow();
  });
  it("times out even if headers arrive and response body hangs", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, json: () => new Promise(() => {}),
    } as Response);
    const adapter = new AiInvestigationAdapter(signal, { ...options, timeoutMs: 15 });
    await expect(adapter.investigate(portfolio, market, risk)).rejects.toThrow("AI_REQUEST_FAILED");
    expect((fetcher.mock.calls[0][1]!.signal as AbortSignal).aborted).toBe(true);
  });
});
