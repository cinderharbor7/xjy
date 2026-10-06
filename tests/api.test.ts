import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/rescue/route";
import { RescueSessionSchema } from "@/domain/schemas";

const request = (body: unknown) => new Request("http://localhost/api/rescue", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/rescue", () => {
  it("returns a complete schema-valid Mock session without keys", async () => {
    vi.stubEnv("MOCK_MODE", undefined);
    for (const key of ["ETHEREUM_RPC_URL", "AAVE_NETWORK", "LLM_API_KEY", "PRIVATE_KEY"]) vi.stubEnv(key, undefined);
    const response = await POST(request({ wallet: "  arbitrary-test-wallet  " }));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Rescue-Mode")).toBe("MOCK");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const session = RescueSessionSchema.parse(await response.json());
    expect(session.before.wallet).toBe("arbitrary-test-wallet");
    expect(session.before.healthFactor).toBe(1.08);
    expect(session.after!.healthFactor).toBe(1.34);
  });

  it.each([{}, { wallet: " " }, { wallet: 12 }, { wallet: "demo", action: "REPAY" }])("rejects malformed or extra request fields: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(new Request("http://localhost/api/rescue", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
  });

  it("returns an explicit configuration error for unavailable real adapters", async () => {
    vi.stubEnv("MOCK_MODE", "false");
    const response = await POST(request({ wallet: "demo" }));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("real adapters have not been implemented");
  });
});
