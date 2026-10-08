import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateOnchainReport } from "@/integration/onchain-report";
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
describe("legacy rule report; external AI migration", () => {
  it("runs deterministic rules without any model fetch", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await generateOnchainReport({ wallet });
    expect(OnchainReportSchema.parse(result)).toEqual(result);
    expect(result.investigationMode).toBe("RULES");
    expect(result.signal).toEqual(saved.signal);
    expect(result.riskAnalysis.confidence).toBe(sellPressureConfidence(saved.signal));
    expect(fetcher).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledTimes(1);
  });
  it.each(["", "TEST_ONLY_KEY"])("rejects removed AI regardless of configured credentials", async (key) => {
    vi.stubEnv("LLM_API_KEY", key);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(generateOnchainReport({ wallet, investigationMode: "AI" })).rejects.toMatchObject({ code: "AI_MODE_REMOVED" });
    expect(read).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves rule RPC errors without fallback", async () => {
    read.mockRejectedValue(new EthereumReadError("RPC_READ_FAILED", "safe"));
    await expect(generateOnchainReport({ wallet })).rejects.toMatchObject({ code: "RPC_READ_FAILED" });
  });
});
