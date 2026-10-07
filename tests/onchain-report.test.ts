import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiReportConfiguration, generateOnchainReport } from "@/integration/onchain-report";
import { readEthereumData } from "@/modules/onchain/live-data";
import { OnchainReportSchema } from "@/integration/onchain-report.contracts";
import { sellPressureConfidence } from "@/modules/investigation/onchain-investigation.adapter";
import { EthereumReadError } from "@/modules/onchain/read-error";
import { historicalReport } from "./helpers/onchain-report";

vi.mock("@/modules/onchain/live-data", async (original) => ({
  ...(await original<typeof import("@/modules/onchain/live-data")>()), readEthereumData: vi.fn(),
}));
const read = vi.mocked(readEthereumData);
const saved = historicalReport();
const wallet = saved.portfolio.state.wallet;
function observation() {
  const { analysisMethod, riskAnalysis, limitations, investigationMode, checkedAt, ...data } = historicalReport();
  return data;
}
beforeEach(() => {
  vi.stubEnv("ETHEREUM_RPC_URL", "https://example.com");
  vi.stubEnv("LLM_THINKING_MODE", ""); vi.stubEnv("LLM_API_KEY", ""); vi.stubEnv("LLM_API_URL", ""); vi.stubEnv("LLM_MODEL", "");
  read.mockResolvedValue(observation());
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function modelReply() {
  return vi.fn(async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    const input = JSON.parse(body.messages[1].content);
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      summary: "当前观察不足以确认异动原因。", primaryCause: "仅能描述单池卖出变化。",
      evidence: [input.evidenceCatalog[0]], uncertainties: ["没有身份与意图证据。"], confidence: 0.88,
    }) } }] });
  });
}
describe("explicit real report composition (controlled dependencies)", () => {
  it("reads only an explicit validated server thinking mode", () => {
    vi.stubEnv("LLM_API_KEY", "TEST_ONLY_KEY");
    vi.stubEnv("LLM_THINKING_MODE", "disabled");
    expect(aiReportConfiguration()).toMatchObject({ thinkingMode: "disabled" });
    vi.stubEnv("LLM_THINKING_MODE", "not-a-mode");
    expect(() => aiReportConfiguration()).toThrow("AI_CONFIGURATION_REQUIRED");
  });

  it("runs rules on one complete observation with no model fetch", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await generateOnchainReport({ wallet });
    expect(OnchainReportSchema.parse(result)).toEqual(result);
    expect(result.investigationMode).toBe("RULES");
    expect(result.signal).toEqual(saved.signal);
    expect(result.riskAnalysis.confidence).toBe(sellPressureConfidence(saved.signal));
    expect(fetcher).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(1);
  });
  it("rejects missing AI configuration before RPC", async () => {
    await expect(generateOnchainReport({ wallet, investigationMode: "AI" })).rejects.toMatchObject({ code: "AI_CONFIGURATION_REQUIRED" });
    expect(read).not.toHaveBeenCalled();
  });
  it("uses only configured server model and retains the evidence confidence ceiling", async () => {
    vi.stubEnv("LLM_API_KEY", "TEST_ONLY_KEY");
    vi.stubEnv("LLM_API_URL", "https://model.example/chat/completions"); vi.stubEnv("LLM_MODEL", "test-model");
    const fetcher = modelReply(); vi.stubGlobal("fetch", fetcher);
    const result = await generateOnchainReport({ wallet, investigationMode: "AI" });
    expect(result.investigationMode).toBe("AI");
    expect(result.riskAnalysis.investigation.summary).toContain("未经独立核实");
    expect(result.riskAnalysis.confidence).toBeLessThanOrEqual(sellPressureConfidence(saved.signal));
    expect(result.limitations.join(" ")).not.toContain("No LLM,");
    expect(JSON.stringify(result)).not.toMatch(/TEST_ONLY_KEY|model\.example|test-model/);
    expect(fetcher.mock.calls[0][0]).toBe("https://model.example/chat/completions");
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string).model).toBe("test-model");
  });
  it("keeps AI evidence-poor observations low confidence without manufacturing evidence", async () => {
    const data = observation(); data.signal.evidence = []; data.signal.txCount = 1; data.signal.uniqueWallets = 1;
    read.mockResolvedValue(data);
    vi.stubEnv("LLM_API_KEY", "TEST_ONLY_KEY"); vi.stubGlobal("fetch", modelReply());
    const result = await generateOnchainReport({ wallet, investigationMode: "AI" });
    expect(result.riskAnalysis.confidence).toBeLessThan(0.1);
    expect(result.signal.evidence).toEqual([]);
    expect(result.riskAnalysis.investigation.uncertainties.length).toBeGreaterThan(3);
  });
  it.each(["fetch", "output"])("fails AI %s without generating a rules report", async (failure) => {
    vi.stubEnv("LLM_API_KEY", "TEST_ONLY_KEY");
    const fetcher = failure === "fetch" ? vi.fn(async () => { throw new Error("secret"); }) : vi.fn(async () => Response.json({ choices: [{ message: { content: "{}" } }] }));
    vi.stubGlobal("fetch", fetcher);
    await expect(generateOnchainReport({ wallet, investigationMode: "AI" })).rejects.toMatchObject({ code: failure === "fetch" ? "AI_REQUEST_FAILED" : "AI_OUTPUT_INVALID" });
    expect(read).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("preserves RPC failures before making any model call", async () => {
    vi.stubEnv("LLM_API_KEY", "TEST_ONLY_KEY"); const fetcher = modelReply(); vi.stubGlobal("fetch", fetcher);
    read.mockRejectedValue(new EthereumReadError("RPC_READ_FAILED", "safe"));
    await expect(generateOnchainReport({ wallet, investigationMode: "AI" })).rejects.toMatchObject({ code: "RPC_READ_FAILED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
