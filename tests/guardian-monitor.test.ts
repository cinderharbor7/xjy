import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuardianStore } from "@/integration/guardian/store";
import { GuardianMonitor, type MonitorRuntime } from "@/integration/guardian/monitor";
import { Recovery } from "@/integration/guardian/contracts";
import { DEMO_POLICY_CONFIG, DEMO_WALLET } from "@/mocks/scenarios";
import { createMockRescueOrchestrator } from "@/integration/rescue";

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); vi.restoreAllMocks(); });
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "guardian-monitor-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const initial = { wallet: DEMO_WALLET, mode: "MOCK" as const, config: DEMO_POLICY_CONFIG, version: 1, enabled: false, halted: false, recoveryCount: 0 };
  const path = join(dir, "state.sqlite");
  const store = new GuardianStore(path, initial); cleanup.push(() => store.close());
  const session = await createMockRescueOrchestrator(DEMO_WALLET).runRescueSession(DEMO_WALLET);
  let clock = Date.now(), calm = false, stale = false, failRead = false;
  const execute = vi.fn().mockResolvedValue(session);
  const resolve = vi.fn<MonitorRuntime["resolve"]>().mockResolvedValue("PENDING");
  const factory = vi.fn<MonitorRuntime["create"]>().mockImplementation(async config => {
    const orch = createMockRescueOrchestrator(DEMO_WALLET, config);
    vi.spyOn(orch, "analyze").mockImplementation(async () => {
      if (failRead) throw new Error("private-rpc-token=secret");
      const { before, market, riskAnalysis, policyDecision } = structuredClone(session);
      before.timestamp = new Date(clock).toISOString(); market.timestamp = new Date(clock - (stale ? 60_000 : 0)).toISOString();
      if (calm) { market.volatilityScore = 20; market.priceChange5mPct = 0; market.priceChange1hPct = -1; }
      return { before, market, riskAnalysis, policyDecision };
    });
    vi.spyOn(orch, "executeAnalysis").mockImplementation(execute);
    return orch;
  });
  const runtime = { create: factory, resolve };
  const monitor = new GuardianMonitor(store, runtime, () => clock);
  cleanup.push(() => monitor.stopLoop());
  return { monitor, store, runtime, initial, path, session, execute, factory, resolve,
    advance: () => { clock += Recovery.intervalMs; }, calm: (value = true) => { calm = value; }, stale: (value = true) => { stale = value; }, failRead: (value = true) => { failRead = value; }, now: () => clock };
}

describe("persistent single-event Guardian", () => {
  it("one swap across repeated/manual/automatic ticks and process recreation", async () => {
    const f = await fixture(); f.monitor.command(DEMO_WALLET, "start");
    await f.monitor.tick(false); f.advance(); await f.monitor.tick(false); f.advance();
    await expect(f.monitor.tick(true)).rejects.toMatchObject({ code: "EVENT_OCCUPIED" });
    const secondStore = new GuardianStore(f.path, f.initial); cleanup.push(() => secondStore.close());
    const restarted = new GuardianMonitor(secondStore, f.runtime, f.now);
    f.advance(); await restarted.tick(false);
    expect(f.execute).toHaveBeenCalledTimes(1); expect(restarted.status().events).toHaveLength(1);
  });
  it("rearms only after 3 fresh market recoveries, then executes on the next full-policy trigger", async () => {
    const f = await fixture(); f.monitor.command(DEMO_WALLET, "start"); await f.monitor.tick(false);
    f.calm(); for (let i = 0; i < 3; i++) { f.advance(); await f.monitor.tick(false); }
    expect(f.monitor.status().activeEvent).toBeUndefined(); expect(f.execute).toHaveBeenCalledTimes(1);
    f.calm(false); f.advance(); await f.monitor.tick(false); expect(f.execute).toHaveBeenCalledTimes(2);
  });
  it("stale, repeated and failed observations cannot count as recovery", async () => {
    const f = await fixture(); f.monitor.command(DEMO_WALLET, "start"); await f.monitor.tick(false); f.calm();
    f.advance(); await f.monitor.tick(false); expect(f.monitor.status().recoveryCount).toBe(1);
    await f.monitor.tick(false); expect(f.monitor.status().recoveryCount).toBe(0);
    f.advance(); f.stale(); await f.monitor.tick(false); expect(f.monitor.status().recoveryCount).toBe(0);
    f.stale(false); f.failRead(); f.advance(); await f.monitor.tick(false);
    expect(JSON.stringify(f.monitor.status())).not.toContain("private-rpc-token"); expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("pause/resume, confidence or exposure changes and config edits never clear an event", async () => {
    const f = await fixture(); await f.monitor.tick(true); const id = f.monitor.status().activeEvent;
    f.monitor.command(DEMO_WALLET, "pause"); f.monitor.savePolicy(DEMO_WALLET, { ...DEMO_POLICY_CONFIG, maxDeRiskPct: 50 }, 1);
    f.monitor.command(DEMO_WALLET, "start"); f.advance(); await f.monitor.tick(false);
    expect(f.monitor.status().activeEvent).toBe(id); expect(f.store.event(id!).config.maxDeRiskPct).toBe(30); expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("uses one lease across two independent store connections", async () => {
    const f = await fixture(); let unblock!: () => void;
    f.execute.mockImplementation(() => new Promise(r => { unblock = () => r(f.session); }));
    const one = f.monitor.tick(true); await vi.waitFor(() => expect(f.execute).toHaveBeenCalled());
    const db2 = new GuardianStore(f.path, f.initial); cleanup.push(() => db2.close());
    const second = new GuardianMonitor(db2, f.runtime, f.now);
    await expect(second.tick(true)).rejects.toMatchObject({ code: "BUSY" }); unblock(); await one;
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("interrupted reservation without a swap hash halts and cannot be restarted by API", async () => {
    const f = await fixture(); await f.monitor.tick(true);
    f.store.change((_s, save) => { const e = f.store.event(f.store.read().activeEvent!); e.status = "RESERVED"; delete e.session; save(e); });
    f.advance(); await expect(f.monitor.tick(true)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" });
    expect(() => f.monitor.command(DEMO_WALLET, "start")).toThrow(); expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("unknown hash is only queried while paused, then independently verified", async () => {
    const f = await fixture(); await f.monitor.tick(true);
    f.store.change((_s, save) => { const e = f.store.event(f.store.read().activeEvent!); e.status = "SUBMITTED_UNKNOWN"; delete e.session; e.submissions.push({ kind: "SWAP", hash: f.session.execution.txHash!, timestamp: f.session.execution.timestamp }); save(e); });
    f.monitor.command(DEMO_WALLET, "pause"); f.advance(); await f.monitor.tick(false);
    expect(f.resolve).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1);
    f.resolve.mockResolvedValue(f.session); f.advance(); await f.monitor.tick(false);
    expect(f.monitor.status().events[0].status).toBe("CONFIRMED"); expect(f.monitor.status().events[0].session?.verification.status).toBe("PASSED");
  });
  it("failed verification blocks future trading even on recovered market data", async () => {
    const f = await fixture();
    const bad = structuredClone(f.session); bad.after!.riskExposurePct = 100; bad.after = structuredClone(bad.before); bad.after.timestamp = new Date(Date.now() + 1000).toISOString();
    bad.verification.status = "FAILED"; f.execute.mockResolvedValue(bad);
    await f.monitor.tick(true); expect(f.monitor.status().halted).toBe(true);
    f.calm(); f.advance(); await expect(f.monitor.tick(true)).rejects.toMatchObject({ code: "REVIEW_REQUIRED" }); expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("config validation, version conflict and wallet binding persist across connections", async () => {
    const f = await fixture();
    const saved = f.monitor.savePolicy(DEMO_WALLET.toUpperCase(), { ...DEMO_POLICY_CONFIG, minConfidence: 0.9, allowedRiskAssets: [" eth "] }, 1);
    expect(saved.version).toBe(2); expect(saved.config.allowedRiskAssets).toEqual(["ETH"]);
    expect(() => f.monitor.savePolicy(DEMO_WALLET, DEMO_POLICY_CONFIG, 1)).toThrow(/Reload/);
    expect(() => f.monitor.savePolicy("another", DEMO_POLICY_CONFIG, 2)).toThrow(/wallet/);
    expect(() => f.monitor.savePolicy(DEMO_WALLET, { ...DEMO_POLICY_CONFIG, allowedRiskAssets: ["USDC"], allowedDefensiveAssets: ["ETH"] }, 2)).toThrow(/WETH/);
    expect(() => new GuardianStore(f.path, { ...f.initial, wallet: "different" })).toThrow(/another wallet/);
  });
  it("server timer observes and executes without browser polling", async () => {
    const f = await fixture(); f.monitor.command(DEMO_WALLET, "start"); f.monitor.startLoop();
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1)); f.monitor.stopLoop();
  });
});
