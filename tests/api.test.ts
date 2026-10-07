import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/rescue/route";
import { GET as getPolicy, PUT as putPolicy } from "@/app/api/policy/route";
import { GET as getStatus, POST as command } from "@/app/api/monitor/route";
import { RescueSessionSchema } from "@/domain/schemas";
import { GuardianProblemSchema } from "@/integration/guardian/contracts";
import { guardianProblem } from "@/integration/guardian/http";
import { createGuardian } from "@/integration/guardian/runtime";
import * as runtime from "@/integration/guardian/runtime";
import * as integration from "@/integration/rescue";
import { DEMO_POLICY_CONFIG, DEMO_WALLET } from "@/mocks/scenarios";
const request = (path: string, body?: unknown, method = "POST", headers = {}) => new Request(`http://localhost:3000/api/${path}`, {
  method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
let dir: string, monitor: ReturnType<typeof createGuardian>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "guardian-api-"));
  vi.stubEnv("GUARDIAN_DB_PATH", join(dir, "state.sqlite")); vi.stubEnv("GUARDIAN_MODE", "MOCK");
  vi.stubEnv("GUARDIAN_WALLET", DEMO_WALLET); vi.stubEnv("GUARDIAN_SIGNAL_FILE", undefined); vi.stubEnv("MOCK_MODE", "true");
  monitor = createGuardian(); vi.spyOn(runtime, "getGuardian").mockReturnValue(monitor);
});
afterEach(() => { monitor.stopLoop(); monitor.store.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("managed Guardian HTTP controls", () => {
  it("preserves trusted errors across instrumentation/route bundle boundaries", async () => {
    const error = Object.assign(new Error("Event retained."), { [Symbol.for("xjy.guardian.control-error")]: true, status: 409, code: "EVENT_OCCUPIED" });
    const response = guardianProblem(error, "/api/rescue"); expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("EVENT_OCCUPIED");
    expect(guardianProblem(Object.assign(new Error("secret"), { status: 409, code: "OTHER" }), "/api/rescue").status).toBe(503);
  });
  it("runs full Mock pipeline and prevents a second swap for the same wallet event", async () => {
    const response = await POST(request("rescue", { wallet: DEMO_WALLET }));
    expect(response.status).toBe(200); expect(response.headers.get("X-Rescue-Mode")).toBe("MOCK");
    const s = RescueSessionSchema.parse(await response.json());
    expect(s.execution).toMatchObject({ sourceAmount: 3, targetAmount: 8100 }); expect(s.verification.status).toBe("PASSED");
    const repeat = await POST(request("rescue", { wallet: DEMO_WALLET }));
    expect([409, 503]).toContain(repeat.status); expect(monitor.status().events).toHaveLength(1);
  });
  it.each([{}, { wallet: " " }, { wallet: 12 }, { wallet: "demo", action: "SWAP_TO_SAFE" }])("rejects malformed or privileged overrides: %j", async body => {
    const r = await POST(request("rescue", body)); expect(r.status).toBe(400);
    expect(GuardianProblemSchema.parse(await r.json()).code).toBe("INVALID_REQUEST");
    expect(r.headers.get("Content-Type")).toContain("application/problem+json"); expect(r.headers.get("Cache-Control")).toBe("no-store");
  });
  it("rejects wallet mismatch and malformed JSON", async () => {
    expect((await POST(request("rescue", { wallet: "different" }))).status).toBe(403);
    const r = await POST(new Request("http://localhost:3000/api/rescue", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }));
    expect(r.status).toBe(400);
  });
  it("policy GET/PUT saves versioned normalized settings without an execution", async () => {
    const a = await getPolicy(request(`policy?wallet=${DEMO_WALLET}`, undefined, "GET")); expect(a.status).toBe(200);
    const input = { wallet: DEMO_WALLET, config: { ...DEMO_POLICY_CONFIG, minConfidence: 0.91 }, version: 1 };
    const b = await putPolicy(request("policy", input, "PUT")); expect(b.status).toBe(200); expect((await b.json()).version).toBe(2);
    expect((await putPolicy(request("policy", input, "PUT"))).status).toBe(409); expect(monitor.status().events).toHaveLength(0);
    expect((await putPolicy(request("policy", { wallet: DEMO_WALLET, config: DEMO_POLICY_CONFIG }, "PUT"))).status).toBe(400);
  });
  it("saved thresholds are used by manual rescue, not the demo default", async () => {
    monitor.savePolicy(DEMO_WALLET, { ...DEMO_POLICY_CONFIG, minRiskScore: 100 }, 1);
    const r = await POST(request("rescue", { wallet: DEMO_WALLET }));
    expect(r.status).toBe(200); expect((await r.json()).execution.action).toBe("NONE"); expect(monitor.status().events).toHaveLength(0);
  });
  it("start and pause retain state, status is no-store", async () => {
    expect((await command(request("monitor", { wallet: DEMO_WALLET, command: "start" }))).status).toBe(200);
    expect(monitor.status().enabled).toBe(true);
    await command(request("monitor", { wallet: DEMO_WALLET, command: "pause" })); expect(monitor.status().enabled).toBe(false);
    expect((await getStatus(request("monitor", undefined, "GET"))).headers.get("Cache-Control")).toBe("no-store");
  });
  it("rejects cross-origin writes, nonlocal hosts and wrong content types", async () => {
    expect((await command(request("monitor", { wallet: DEMO_WALLET, command: "start" }, "POST", { Origin: "https://hostile.example" }))).status).toBe(403);
    expect((await getStatus(new Request("http://hostile.example:3000/api/monitor"))).status).toBe(403);
    expect((await command(request("monitor", {}, "POST", { "Content-Type": "text/plain" }))).status).toBe(415);
  });
  it("accepts the browser Host after Next normalizes request.url to localhost", async () => {
    const r = await command(request("monitor", { wallet: DEMO_WALLET, command: "pause" }, "POST", { Host: "127.0.0.1:3000", "x-forwarded-host": "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" }));
    expect(r.status).toBe(200);
    expect((await command(request("monitor", {}, "POST", { Host: "hostile.example:3000" }))).status).toBe(403);
  });
  it("does not expose raw server/RPC exceptions", async () => {
    vi.spyOn(integration, "runRescueSession").mockRejectedValue(new Error("api_key=private-test-value"));
    const r = await POST(request("rescue", { wallet: DEMO_WALLET })); expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain("private-test-value");
  });
});
