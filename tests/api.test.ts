import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/rescue/route";
import { RescueProblemSchema, RescueSessionSchema } from "@/domain/schemas";
import * as integration from "@/integration/rescue";

const request = (body: unknown) => new Request("http://localhost/api/rescue", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("POST /api/rescue", () => {
  it("returns the complete Guardian Mock session without RPC, keys or LLM", async () => {
    vi.stubEnv("MOCK_MODE", undefined);
    for (const key of ["ETHEREUM_RPC_URL", "AAVE_NETWORK", "LLM_API_KEY", "PRIVATE_KEY"]) vi.stubEnv(key, undefined);
    const response = await POST(request({ wallet: "  arbitrary-test-wallet  " }));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Rescue-Mode")).toBe("MOCK");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const session = RescueSessionSchema.parse(await response.json());
    expect(session.before.wallet).toBe("arbitrary-test-wallet");
    expect(session.before.riskExposurePct).toBe(100);
    expect(session.after!.riskExposurePct).toBe(70);
    expect(session.execution).toMatchObject({ sourceAmount: 3, targetAmount: 8100 });
    expect(session.verification.status).toBe("PASSED");
  });

  it.each([{}, { wallet: " " }, { wallet: 12 }, { wallet: "demo", action: "SWAP_TO_SAFE" }])("rejects malformed or extra fields with a structured problem: %j", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(RescueProblemSchema.parse(await response.json())).toMatchObject({
      type: "urn:xjy:rescue:INVALID_REQUEST", status: 400, code: "INVALID_REQUEST", instance: "/api/rescue",
    });
  });

  it("rejects malformed JSON with the same problem contract", async () => {
    const response = await POST(new Request("http://localhost/api/rescue", { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(RescueProblemSchema.parse(await response.json()).code).toBe("INVALID_REQUEST");
  });

  it("returns a sanitized problem for unavailable real mode", async () => {
    vi.stubEnv("MOCK_MODE", "false");
    const response = await POST(request({ wallet: "demo" }));
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(RescueProblemSchema.parse(await response.json())).toMatchObject({ status: 500, code: "RESCUE_FAILED" });
  });

  it("never exposes raw adapter exceptions in the public response", async () => {
    vi.spyOn(integration, "runRescueSession").mockRejectedValue(new Error("RPC rejected api_key=private-test-value"));
    const response = await POST(request({ wallet: "demo" }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(RescueProblemSchema.parse(body).code).toBe("RESCUE_FAILED");
    expect(JSON.stringify(body)).not.toContain("private-test-value");
    expect(JSON.stringify(body)).not.toContain("api_key");
  });
});
