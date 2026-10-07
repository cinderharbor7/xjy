import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/position/route";
import { createAavePositionAdapter, getAavePositionSnapshot } from "@/extensions/aave/integration";
import { PositionProblemSchema, PositionSnapshotSchema } from "@/extensions/aave/schemas";
import { PositionReadError } from "@/extensions/aave/position-read.error";

vi.mock("@/extensions/aave/integration", async (original) => ({
  ...(await original<typeof import("@/extensions/aave/integration")>()), getAavePositionSnapshot: vi.fn(),
}));
const read = vi.mocked(getAavePositionSnapshot);
const wallet = `0x${"11".repeat(20)}`;
const evidence = {
  chainId: 1 as const, network: "ethereum-mainnet" as const, protocol: "aave-v3" as const,
  providerAddress: wallet, poolAddress: wallet, oracleAddress: wallet, ethAssetAddress: wallet,
  blockNumber: 20000, blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "2026-10-06T12:00:00.000Z",
};
const active = PositionSnapshotSchema.parse({
  mode: "LIVE", status: "ACTIVE", wallet, evidence,
  position: { wallet, collateralUsd: 200000, debtUsd: 100000, healthFactor: 1.08, ethPrice: 2800, timestamp: evidence.blockTimestamp, blockNumber: 20000 },
  marketChanges: {
    ethChangePct: -5, previousEthPrice: 2900, referenceBlockNumber: 12800,
    referenceBlockHash: `0x${"cd".repeat(32)}`, referenceTimestamp: "2026-10-05T12:00:00.000Z",
    referenceOracleAddress: wallet, lookbackBlocks: 7200, lookbackSeconds: 86400,
  },
});
const request = (body: unknown) => new Request("http://localhost/api/position", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("independent live position API", () => {
  it("returns a validated active result clearly labeled LIVE", async () => {
    read.mockResolvedValue(active);
    const response = await POST(request({ wallet }));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Position-Mode")).toBe("LIVE");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(active);
    expect(read).toHaveBeenCalledWith(wallet);
  });
  it("returns NO_DEBT without an invented PositionState or HF", async () => {
    const noDebt = PositionSnapshotSchema.parse({ mode: "LIVE", status: "NO_DEBT", wallet, position: null, message: "No borrowed debt. HF is not applicable.", evidence });
    read.mockResolvedValue(noDebt);
    const response = await POST(request({ wallet }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(noDebt);
  });
  it.each([{}, { wallet: "demo-wallet" }, { wallet, rpcUrl: "https://example.com" }])("rejects bad input before RPC: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    expect((await POST(new Request("http://localhost/api/position", { method: "POST", body: "{" }))).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });
  it("returns a problem response for missing configuration", async () => {
    read.mockRejectedValue(new PositionReadError("CONFIGURATION_ERROR", "Configure ETHEREUM_RPC_URL."));
    const response = await POST(request({ wallet }));
    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    expect(PositionProblemSchema.parse(await response.json()).code).toBe("CONFIGURATION_ERROR");
  });
  it.each(["UNSUPPORTED_NETWORK", "INVALID_CHAIN_DATA", "RPC_READ_FAILED"] as const)("reports %s without returning partial data", async (code) => {
    read.mockRejectedValue(new PositionReadError(code, "Required data is unavailable."));
    const response = await POST(request({ wallet }));
    expect(response.status).toBe(502);
    expect(PositionProblemSchema.parse(await response.json()).code).toBe(code);
  });
  it("sanitizes unknown upstream errors and never falls back to Mock", async () => {
    read.mockRejectedValue(new Error("https://user:secret@rpc.example/api-key"));
    const response = await POST(request({ wallet }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toMatch(/secret|rpc\.example|api-key/);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed output instead of claiming a successful live position", async () => {
    read.mockResolvedValue({ ...active, position: { ...active.position!, debtUsd: -1 } } as typeof active);
    expect((await POST(request({ wallet }))).status).toBe(502);
  });
});

describe("server-only position composition configuration", () => {
  it.each([undefined, "", "not-a-url", "file:///tmp/rpc"])("rejects unusable RPC configuration %s", (rpc) => {
    vi.stubEnv("AAVE_NETWORK", "ethereum-mainnet");
    vi.stubEnv("ETHEREUM_RPC_URL", rpc);
    expect(() => createAavePositionAdapter()).toThrow(PositionReadError);
  });
  it("rejects unsupported configured markets", () => {
    vi.stubEnv("AAVE_NETWORK", "arbitrum");
    expect(() => createAavePositionAdapter()).toThrow(/ethereum-mainnet/);
  });
  it("creates a read-only adapter independently of rescue Mock mode or signing keys", () => {
    vi.stubEnv("AAVE_NETWORK", "ethereum-mainnet");
    vi.stubEnv("ETHEREUM_RPC_URL", "https://example.com");
    vi.stubEnv("MOCK_MODE", "true");
    vi.stubEnv("PRIVATE_KEY", undefined);
    expect(createAavePositionAdapter().getSnapshot).toBeTypeOf("function");
  });
});
