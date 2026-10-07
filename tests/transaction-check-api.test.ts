import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/transaction-checks/route";
import { checkTransaction, createTransactionCheckService } from "@/integration/transaction-check";
import { TransactionCheckError } from "@/modules/transaction-check/transaction-check.error";
import { TransactionCheckProblemSchema, TransactionCheckReportSchema } from "@/domain/schemas/transaction-check";
import { readFileSync } from "node:fs";
import { TransactionCheckRequestSchema } from "@/domain/schemas/transaction-check";

vi.mock("@/integration/transaction-check", async (original) => ({
  ...(await original<typeof import("@/integration/transaction-check")>()), checkTransaction: vi.fn(),
}));
const check = vi.mocked(checkTransaction);
const txHash = `0x${"ab".repeat(32)}`;
const blockHash = `0x${"cd".repeat(32)}`;
const report = TransactionCheckReportSchema.parse({
  mode: "LIVE_READ_ONLY", network: "ethereum-mainnet", checkedAt: "2026-10-07T06:00:00.000Z",
  classification: "NO_SUPPORTED_SWAP", headline: "未证实卖出", summary: "仅验证外层交易事实。",
  confirmedFacts: ["交易已确认"], uncertainties: ["未核验其他交易池或内部调用"], nextSteps: ["核对原始消息引用"],
  observation: {
    transaction: { hash: txHash, from: `0x${"12".repeat(20)}`, to: null, nativeValueEth: "20059.2", input: "0x", status: "SUCCESS", blockNumber: 20449709, blockHash, timestamp: "2024-08-03T18:08:23.000Z", logCount: 0 },
    supportedSwaps: [],
    evidence: [
      { type: "TRANSACTION", txHash, blockHash, blockNumber: 20449709, description: "外层交易", source: `https://etherscan.io/tx/${txHash}` },
      { type: "BLOCK", blockHash, blockNumber: 20449709, description: "交易所在区块", source: "https://etherscan.io/block/20449709" },
    ],
    scope: { protocol: "UNISWAP_V3", poolAddress: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640", poolLabel: "Uniswap V3 WETH/USDC 0.05%", asset: "WETH", quoteAsset: "USDC", fee: 500 },
  },
});
const request = (body: unknown, overrides: Record<string, string> = {}) => {
  const headers = new Headers({ "Content-Type": "application/json" });
  Object.entries(overrides).forEach(([name, value]) => headers.set(name, value));
  return new Request("http://localhost:3000/api/transaction-checks", { method: "POST", headers, body: JSON.stringify(body) });
};
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("live readonly transaction-check HTTP", () => {
  it("returns a validated live report without caching", async () => {
    check.mockResolvedValue(report);
    const response = await POST(request({ txHash }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Transaction-Check-Mode")).toBe("LIVE_READ_ONLY");
    expect(await response.json()).toEqual(report);
    expect(check).toHaveBeenCalledExactlyOnceWith(txHash);
  });
  it.each([{}, { txHash: "0x123" }, { txHash, wallet: "any" }, { txHash, rpcUrl: "https://example.com" }])("rejects invalid/extra request fields before RPC: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(check).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON before RPC", async () => {
    const response = await POST(new Request("http://localhost:3000/api/transaction-checks", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }));
    expect(response.status).toBe(400);
    expect(check).not.toHaveBeenCalled();
  });
  it.each([
    [{ origin: "https://evil.example" }, "ORIGIN_REJECTED", 403],
    [{ "sec-fetch-site": "cross-site" }, "ORIGIN_REJECTED", 403],
    [{ host: "evil.example:3000" }, "LOCAL_ONLY", 403],
    [{ "x-forwarded-host": "evil.example:3000" }, "LOCAL_ONLY", 403],
    [{ "content-type": "text/plain" }, "JSON_REQUIRED", 415],
    [{ "content-type": "application/json-extra" }, "JSON_REQUIRED", 415],
  ] as const)("enforces local same-origin access: %j", async (headers, code, status) => {
    const response = await POST(request({ txHash }, headers));
    expect(response.status).toBe(status);
    expect(TransactionCheckProblemSchema.parse(await response.json()).code).toBe(code);
    expect(check).not.toHaveBeenCalled();
  });
  it.each([
    ["TRANSACTION_NOT_FOUND", 404], ["TRANSACTION_PENDING", 409], ["CONFIGURATION_ERROR", 503],
    ["UNSUPPORTED_NETWORK", 503], ["INVALID_CHAIN_DATA", 503], ["REORG_DETECTED", 503], ["RPC_READ_FAILED", 503],
  ] as const)("preserves %s safe status", async (code, status) => {
    check.mockRejectedValue(new TransactionCheckError(code));
    const response = await POST(request({ txHash }));
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    expect(TransactionCheckProblemSchema.parse(await response.json()).code).toBe(code);
  });
  it("sanitizes raw provider errors without a retry or Mock response", async () => {
    check.mockRejectedValue(new Error("https://user:secret@rpc.example/API_KEY"));
    const response = await POST(request({ txHash }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|rpc\.example|API_KEY/);
    expect(check).toHaveBeenCalledTimes(1);
  });
  it("rejects inconsistent output instead of showing an unsupported sell conclusion", async () => {
    check.mockResolvedValue({ ...report, classification: "SUPPORTED_POOL_SELL" });
    const response = await POST(request({ txHash }));
    expect(response.status).toBe(503);
    expect(TransactionCheckProblemSchema.parse(await response.json()).code).toBe("INVALID_CHAIN_DATA");
  });
  it("rejects a sell report without supporting contract-event references", async () => {
    check.mockResolvedValue({ ...report, classification: "SUPPORTED_POOL_SELL", observation: {
      ...report.observation, transaction: { ...report.observation.transaction, logCount: 1 },
      supportedSwaps: [{ logIndex: 0, poolAddress: report.observation.scope.poolAddress, direction: "SELL_ETH", wethAmount: "1", usdcAmount: "2800" }],
    } });
    const response = await POST(request({ txHash }));
    expect(response.status).toBe(503);
    expect(TransactionCheckProblemSchema.parse(await response.json()).code).toBe("INVALID_CHAIN_DATA");
  });
});

describe("transaction-check server composition", () => {
  it.each([undefined, "", "not-a-url", "file:///tmp/rpc"])("requires usable server RPC configuration: %s", (rpc) => {
    vi.stubEnv("ETHEREUM_RPC_URL", rpc);
    expect(() => createTransactionCheckService()).toThrow(TransactionCheckError);
  });
  it("has no signing or guardian-mode requirement", () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "https://example.com");
    vi.stubEnv("MOCK_MODE", "true"); vi.stubEnv("GUARDIAN_MODE", "MOCK");
    vi.stubEnv("PRIVATE_KEY", undefined); vi.stubEnv("FORK_PRIVATE_KEY", undefined);
    expect(createTransactionCheckService().check).toBeTypeOf("function");
  });
});

describe("published transaction-check OpenAPI", () => {
  const document = JSON.parse(readFileSync(new URL("../docs/transaction-check-api.openapi.json", import.meta.url), "utf8"));
  const endpoint = document.paths["/api/transaction-checks"].post;
  it("publishes a schema-valid request and safe error examples", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(TransactionCheckRequestSchema.parse(endpoint.requestBody.content["application/json"].example).txHash).toMatch(/^0x[0-9a-f]{64}$/);
    for (const [status, response] of Object.entries(endpoint.responses)) {
      if (status === "200") continue;
      const value = (response as { content: Record<string, { example: unknown }> }).content["application/problem+json"].example;
      expect(TransactionCheckProblemSchema.parse(value).status).toBe(Number(status));
    }
  });
  it("has resolvable internal references and pins exact amounts and live scope", () => {
    function visit(value: unknown) {
      if (!value || typeof value !== "object") return;
      if ("$ref" in value && typeof value.$ref === "string") {
        expect(value.$ref.startsWith("#/components/schemas/")).toBe(true);
        expect(document.components.schemas[value.$ref.split("/").at(-1)!]).toBeDefined();
      }
      Object.values(value).forEach(visit);
    }
    visit(document);
    const reportSchema = document.components.schemas.TransactionCheckReport;
    expect(reportSchema.properties.mode.const).toBe("LIVE_READ_ONLY");
    expect(reportSchema.properties.observation.properties.transaction.properties.nativeValueEth.type).toBe("string");
    expect(reportSchema.properties.observation.properties.scope.properties.fee.const).toBe(500);
    expect(reportSchema.additionalProperties).toBe(false);
    expect(TransactionCheckReportSchema.safeParse(report).success).toBe(true);
  });
});
