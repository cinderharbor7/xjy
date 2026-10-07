import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGuardian } from "@/integration/guardian/runtime";
import type { GuardianMonitor } from "@/integration/guardian/monitor";
import { privateKeyToAccount } from "viem/accounts";
import { ForkReadBridge } from "@/integration/guardian/fork";
import { ForkExecutionAdapter, ETHEREUM_FORK_TOKENS } from "@/modules/execution/fork-execution.adapter";
import { PortfolioStateSchema } from "@/domain/schemas";

let guardian: GuardianMonitor | undefined;
let directory: string | undefined;
afterEach(() => {
  guardian?.stopLoop(); guardian?.store.close(); guardian = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined; vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe("assembled Guardian runtime", () => {
  it("retains traded balances after recovery, NONE observations and reopening the store", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T03:00:00.000Z"));
    directory = mkdtempSync(join(tmpdir(), "guardian-runtime-"));
    const signalFile = join(directory, "signal.json");
    vi.stubEnv("GUARDIAN_MODE", "MOCK"); vi.stubEnv("MOCK_MODE", "true");
    vi.stubEnv("GUARDIAN_WALLET", "runtime-test-wallet");
    vi.stubEnv("GUARDIAN_DB_PATH", join(directory, "state.sqlite"));
    vi.stubEnv("GUARDIAN_SIGNAL_FILE", signalFile);
    const sample = (calm: boolean) => {
      vi.setSystemTime(Date.now() + 10_000);
      writeFileSync(signalFile, JSON.stringify({ timestamp: new Date().toISOString(),
        priceChange5mPct: calm ? 0 : -3, priceChange1hPct: calm ? 0 : -10,
        volatilityScore: calm ? 20 : 82 }));
    };
    guardian = createGuardian();
    sample(false);
    const first = await guardian.tick(true);
    expect(first?.verification.status).toBe("PASSED");
    expect(first?.after?.assets.map(asset => asset.amount)).toEqual([7, 8100]);
    guardian.command("runtime-test-wallet", "start");
    for (let i = 0; i < 3; i++) { sample(true); await guardian.tick(false); }
    expect(guardian.status().activeEvent).toBeUndefined();
    const policy = guardian.policy();
    guardian.savePolicy(policy.wallet, { ...policy.config, minRiskScore: 100 }, policy.version);
    for (let i = 0; i < 2; i++) {
      sample(true);
      const none = await guardian.tick(true);
      expect(none?.policyDecision.triggered).toBe(false);
      expect(none?.before.assets.map(asset => asset.amount)).toEqual([7, 8100]);
    }
    guardian.store.close(); guardian = createGuardian();
    sample(true);
    expect((await guardian.tick(true))?.before.assets.map(asset => asset.amount)).toEqual([7, 8100]);
    expect(guardian.status().events).toHaveLength(1);
  });
  it("freezes one Fork balance/quote observation and independently reads after", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T03:00:00.000Z"));
    directory = mkdtempSync(join(tmpdir(), "guardian-fork-runtime-"));
    const key = `0x${"23".repeat(32)}` as const;
    const wallet = privateKeyToAccount(key).address;
    vi.stubEnv("GUARDIAN_MODE", "FORK"); vi.stubEnv("GUARDIAN_WALLET", wallet);
    vi.stubEnv("FORK_PRIVATE_KEY", key); vi.stubEnv("FORK_RPC_URL", "http://127.0.0.1:8545");
    vi.stubEnv("GUARDIAN_DB_PATH", join(directory, "state.sqlite")); vi.stubEnv("GUARDIAN_SIGNAL_FILE", "");
    vi.spyOn(ForkReadBridge.prototype, "preflight").mockResolvedValue();
    const portfolio = (eth: number, usdc: number, price: number, block: number) => PortfolioStateSchema.parse({
      wallet, totalUsd: eth * price + usdc, riskAssetUsd: eth * price, defensiveAssetUsd: usdc,
      riskExposurePct: eth * price / (eth * price + usdc) * 100, timestamp: new Date().toISOString(), blockNumber: block,
      assets: [{ symbol: "ETH", tokenAddress: ETHEREUM_FORK_TOKENS.ETH.address, amount: eth, usdValue: eth * price, category: "RISK" },
        { symbol: "USDC", tokenAddress: ETHEREUM_FORK_TOKENS.USDC.address, amount: usdc, usdValue: usdc, category: "DEFENSIVE" }],
    });
    const before = portfolio(10, 0, 2700, 100), after = portfolio(7, 8100, 2600, 101);
    const observe = vi.spyOn(ForkReadBridge.prototype, "observation")
      .mockResolvedValueOnce({ portfolio: before, priceUsd: 2700, block: { number: 100, hash: `0x${"ab".repeat(32)}`, timestamp: before.timestamp } })
      .mockResolvedValueOnce({ portfolio: after, priceUsd: 2600, block: { number: 101, hash: `0x${"cd".repeat(32)}`, timestamp: after.timestamp } });
    vi.spyOn(ForkExecutionAdapter.prototype, "execute").mockResolvedValue({ success: true, action: "SWAP_TO_SAFE",
      sourceAsset: "ETH", targetAsset: "USDC", sourceAmount: 3, targetAmount: 8100,
      timestamp: new Date().toISOString(), txHash: `0x${"ef".repeat(32)}` });
    vi.spyOn(ForkReadBridge.prototype, "confirmedExecution").mockImplementation(async result => result);
    guardian = createGuardian(); const session = await guardian.tick(true);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(session?.before).toEqual(before); expect(session?.after).toEqual(after);
    expect(session?.market.priceUsd).toBe(2700);
    expect(session?.verification.status).toBe("PASSED");
    expect(session?.after?.blockNumber).toBe(101);
  });
});
