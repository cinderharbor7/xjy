import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/onchain-analysis/route";
import { generateOnchainReport } from "@/integration/onchain-report";
import { EthereumReadError } from "@/modules/onchain/read-error";
import { AiInvestigationError } from "@/modules/investigation/ai-investigation.adapter";
import { OnchainReportSchema } from "@/integration/onchain-report.contracts";
import { historicalReport } from "./helpers/onchain-report";

vi.mock("@/integration/onchain-report", () => ({ generateOnchainReport: vi.fn() }));
const generate = vi.mocked(generateOnchainReport);
const wallet = historicalReport().portfolio.state.wallet;
const request = (body: unknown = { wallet }, headers = {}) => new Request("http://localhost:3000/api/onchain-analysis", {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("onchain report HTTP boundary", () => {
  it("defaults to rules and returns a validated same-wallet snapshot without caching", async () => {
    generate.mockResolvedValue(historicalReport());
    const response = await POST(request({ wallet: wallet.toLowerCase() }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Onchain-Mode")).toBe("LIVE_READ_ONLY");
    expect(OnchainReportSchema.parse(await response.json())).toEqual(historicalReport());
    expect(generate).toHaveBeenCalledExactlyOnceWith({ wallet: wallet.toLowerCase(), investigationMode: "RULES" });
  });
  it.each([{}, { wallet: "" }, { wallet: "0x1" }, { wallet, investigationMode: "MOCK" },
    { wallet, apiKey: "SECRET" }, { wallet, rpcUrl: "https://example.com" }, { wallet, action: "SWAP" }])("rejects malformed or extra inputs before reads: %j", async (input) => {
    expect((await POST(request(input))).status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each([
    [{ origin: "https://evil.example" }, 403], [{ "sec-fetch-site": "cross-site" }, 403],
    [{ host: "evil.example:3000" }, 403], [{ "content-type": "text/plain" }, 415],
    [{ "content-type": "application/json-extra" }, 415],
  ])("enforces local same-origin JSON requests: %j", async (headers, status) => {
    expect((await POST(request({ wallet }, headers))).status).toBe(status);
    expect(generate).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("http://localhost:3000/api/onchain-analysis", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    }));
    expect(response.status).toBe(400); expect(generate).not.toHaveBeenCalled();
  });
  it.each(["RPC_READ_FAILED", "EMPTY_BASELINE", "REORG_DETECTED", "STALE_PRICE", "UNSUPPORTED_NETWORK", "INVALID_CHAIN_DATA", "CONFIGURATION_ERROR"] as const)("returns a safe explicit %s failure", async (code) => {
    generate.mockRejectedValue(new EthereumReadError(code, "secret provider error"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    const body = await response.json(); expect(body.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each(["AI_CONFIGURATION_REQUIRED", "AI_REQUEST_FAILED", "AI_OUTPUT_INVALID"] as const)("does not return a rule report on %s", async (code) => {
    generate.mockRejectedValue(new AiInvestigationError(code));
    const response = await POST(request({ wallet, investigationMode: "AI" }));
    expect(response.status).toBe(503); expect((await response.json()).code).toBe(code);
    expect(generate).toHaveBeenCalledExactlyOnceWith({ wallet, investigationMode: "AI" });
  });
  it("never serializes unknown provider errors or credentials", async () => {
    generate.mockRejectedValue(new Error("https://secret@rpc.invalid/API_KEY"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|rpc\.invalid|API_KEY/);
  });
  it.each(["wallet", "mode", "snapshot"])("rejects mismatched report %s", async (field) => {
    const report = historicalReport();
    if (field === "wallet") report.portfolio.state.wallet = `0x${"ab".repeat(20)}`;
    if (field === "mode") report.investigationMode = "AI";
    if (field === "snapshot") report.market.state.timestamp = "2026-10-01T00:00:00.000Z";
    generate.mockResolvedValue(report);
    expect((await POST(request())).status).toBe(503);
  });
});
