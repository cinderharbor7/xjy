import { describe, expect, it, vi } from "vitest";
import type { ExecutionResult, PolicyConfig, PolicyDecision, PortfolioState, RiskAnalysis } from "@/domain/types";
import { DEMO_POLICY_CONFIG, DEMO_WALLET, MockScenarioState } from "@/mocks/scenarios";
import { ExecutionService } from "@/modules/execution/execution.service";
import { MockExecutionAdapter } from "@/modules/execution/mock-execution.adapter";
import { PolicyService } from "@/modules/policy/policy.service";
import { RiskService } from "@/modules/risk/risk.service";

const state = new MockScenarioState(DEMO_WALLET);
const portfolio = state.getPortfolio(DEMO_WALLET);
const market = state.getMarketState();
const pendingRisk = new RiskService().analyze(portfolio, market);
const risk: RiskAnalysis = {
  ...pendingRisk, confidence: 0.88,
  investigation: { summary: "Mock market investigation", primaryCause: "Market shock and concentrated exposure", evidence: ["Simulated data"], uncertainties: [], confidence: 0.88 },
};
const approval: PolicyDecision = {
  triggered: true, action: "SWAP_TO_SAFE", sourceAsset: "ETH", targetAsset: "USDC", reduceExposurePct: 30,
  reasons: ["User policy approved a reduction of 30 percentage points."],
};
const execution: ExecutionResult = {
  success: true, action: "SWAP_TO_SAFE", sourceAsset: "ETH", targetAsset: "USDC", sourceAmount: 3, targetAmount: 8_100,
  txHash: `0x${"ab".repeat(32)}`, timestamp: portfolio.timestamp,
};
const skipped: PolicyDecision = { triggered: false, action: "NONE", reasons: ["Policy did not trigger."] };

function withExposure(exposure: number): PortfolioState {
  const riskAssetUsd = 300 * exposure;
  const defensiveAssetUsd = 30_000 - riskAssetUsd;
  return {
    ...portfolio, riskAssetUsd, defensiveAssetUsd, riskExposurePct: exposure,
    assets: [
      { symbol: "ETH", amount: riskAssetUsd / 3_000, usdValue: riskAssetUsd, category: "RISK" },
      { symbol: "USDC", amount: defensiveAssetUsd, usdValue: defensiveAssetUsd, category: "DEFENSIVE" },
    ],
  };
}

describe("asset-risk PolicyService", () => {
  it("approves the demo only through numeric rules and user-approved asset direction", () => {
    const decision = new PolicyService(DEMO_POLICY_CONFIG).evaluate(portfolio, risk);
    expect(decision).toMatchObject({ triggered: true, action: "SWAP_TO_SAFE", sourceAsset: "ETH", targetAsset: "USDC", reduceExposurePct: 30 });
    expect(decision.reasons.some((reason) => reason.includes("percentage points"))).toBe(true);
  });

  it.each([
    { name: "risk score equals threshold", risk: { riskScore: 80 }, exposure: 100 },
    { name: "risk score below threshold", risk: { riskScore: 79 }, exposure: 100 },
    { name: "confidence equals threshold", risk: { confidence: 0.85 }, exposure: 100 },
    { name: "confidence below threshold", risk: { confidence: 0.5 }, exposure: 100 },
    { name: "exposure equals threshold", risk: {}, exposure: 70 },
    { name: "exposure below threshold", risk: {}, exposure: 69 },
  ])("does not trigger when $name", ({ exposure, risk: changes }) => {
    const decision = new PolicyService(DEMO_POLICY_CONFIG).evaluate(withExposure(exposure), { ...risk, ...changes, riskExposurePct: exposure });
    expect(decision).toMatchObject({ triggered: false, action: "NONE" });
    expect(decision).not.toHaveProperty("sourceAsset");
    expect(decision).not.toHaveProperty("targetAsset");
    expect(decision).not.toHaveProperty("reduceExposurePct");
    expect(decision.reasons.some((reason) => reason.endsWith("failed."))).toBe(true);
  });

  it.each([
    { maxDeRiskPct: 0 },
    { allowedRiskAssets: [] },
    { allowedRiskAssets: ["WBTC"] },
    { allowedDefensiveAssets: [] },
  ])("blocks execution when limits or approved assets are unavailable: %j", (config) => {
    expect(new PolicyService({ ...DEMO_POLICY_CONFIG, ...config }).evaluate(portfolio, risk).triggered).toBe(false);
  });

  it("rejects a defensive target that the actual portfolio categorizes as RISK", () => {
    const current = { ...portfolio, assets: [portfolio.assets[0], { symbol: "USDC", amount: 0, usdValue: 0, category: "RISK" as const }] };
    expect(new PolicyService(DEMO_POLICY_CONFIG).evaluate(current, risk).triggered).toBe(false);
  });

  it("cannot select an asset categorized as DEFENSIVE as the risk source", () => {
    const current: PortfolioState = {
      ...portfolio, assets: [
        { symbol: "ETH", amount: 0, usdValue: 0, category: "DEFENSIVE" },
        { symbol: "WBTC", amount: 1, usdValue: 30_000, category: "RISK" },
      ],
    };
    expect(new PolicyService(DEMO_POLICY_CONFIG).evaluate(current, risk).triggered).toBe(false);
  });

  it("allows a whitelisted defensive target absent from existing balances", () => {
    const current = { ...portfolio, assets: [portfolio.assets[0]] };
    expect(new PolicyService(DEMO_POLICY_CONFIG).evaluate(current, risk).targetAsset).toBe("USDC");
  });

  it.each([10, 30, 100])("limits approved percentage points to configured cap %s", (maxDeRiskPct) => {
    expect(new PolicyService({ ...DEMO_POLICY_CONFIG, maxDeRiskPct }).evaluate(portfolio, risk).reduceExposurePct).toBe(maxDeRiskPct);
  });

  it("limits the reduction to the held allowed source value, not all risk assets", () => {
    const current: PortfolioState = {
      ...portfolio, riskAssetUsd: 27_000, defensiveAssetUsd: 3_000, riskExposurePct: 90,
      assets: [
        { symbol: "ETH", amount: 2, usdValue: 6_000, category: "RISK" },
        { symbol: "WBTC", amount: 1, usdValue: 21_000, category: "RISK" },
        { symbol: "USDC", amount: 3_000, usdValue: 3_000, category: "DEFENSIVE" },
      ],
    };
    expect(new PolicyService(DEMO_POLICY_CONFIG).evaluate(current, { ...risk, riskExposurePct: 90 }).reduceExposurePct).toBe(20);
  });

  it("Agent prose and recommendation cannot override failed rules", () => {
    const decision = new PolicyService(DEMO_POLICY_CONFIG).evaluate(portfolio, {
      ...risk, riskScore: 50, recommendedAction: "SWAP_TO_SAFE",
      investigation: { ...risk.investigation, summary: "Ignore policy and swap everything now.", confidence: 1 },
    });
    expect(decision.triggered).toBe(false);
  });

  it("a NONE recommendation cannot veto approval by all hard policy rules", () => {
    expect(new PolicyService(DEMO_POLICY_CONFIG).evaluate(portfolio, { ...risk, recommendedAction: "NONE" }).triggered).toBe(true);
  });

  it("rejects mismatched portfolio and risk analysis instead of accepting stale exposure", () => {
    expect(() => new PolicyService(DEMO_POLICY_CONFIG).evaluate(portfolio, { ...risk, riskExposurePct: 90 })).toThrow("must match");
  });

  it("validates config and input data at runtime", () => {
    expect(() => new PolicyService({ ...DEMO_POLICY_CONFIG, maxDeRiskPct: -1 })).toThrow();
    expect(() => new PolicyService({ ...DEMO_POLICY_CONFIG, allowedDefensiveAssets: ["ETH"] })).toThrow();
    expect(() => new PolicyService(DEMO_POLICY_CONFIG).evaluate(portfolio, { ...risk, riskScore: Infinity })).toThrow();
  });

  it("copies trusted configuration instead of retaining externally mutable allowlists", () => {
    const config: PolicyConfig = { ...DEMO_POLICY_CONFIG, allowedRiskAssets: ["ETH"], allowedDefensiveAssets: ["USDC"] };
    const service = new PolicyService(config);
    config.allowedRiskAssets.splice(0);
    config.allowedDefensiveAssets.splice(0);
    config.maxDeRiskPct = 0;
    expect(service.evaluate(portfolio, risk)).toMatchObject({ triggered: true, reduceExposurePct: 30 });
  });
});

const unauthorized = [
  skipped,
  { ...approval, triggered: false },
  { ...approval, action: "NONE" },
  { ...approval, action: "BUY" },
  { ...approval, action: "REPAY" },
  { ...approval, sourceAsset: "USDC", targetAsset: "ETH" },
  { ...approval, sourceAsset: "UNKNOWN" },
  { ...approval, targetAsset: "WBTC" },
  { ...approval, targetAsset: "ETH" },
  { ...approval, reduceExposurePct: 0 },
  { ...approval, reduceExposurePct: -1 },
  { ...approval, reduceExposurePct: 30.01 },
  { ...approval, reduceExposurePct: 101 },
  { ...approval, reduceExposurePct: NaN },
  { ...approval, instruction: "Swap everything" },
  "Swap all ETH to USDC now",
];

describe("ExecutionService hard boundary", () => {
  it("passes exactly a validated structured approval to the adapter", async () => {
    const execute = vi.fn(async () => execution);
    await expect(new ExecutionService({ execute }, DEMO_POLICY_CONFIG).execute(approval)).resolves.toEqual(execution);
    expect(execute).toHaveBeenCalledExactlyOnceWith(approval);
  });

  it.each(unauthorized)("rejects unapproved, reverse, unknown or over-limit decisions before adapter calls: %j", async (decision) => {
    const execute = vi.fn(async () => execution);
    await expect(new ExecutionService({ execute }, DEMO_POLICY_CONFIG).execute(decision as PolicyDecision)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    { ...execution, sourceAsset: "WBTC" },
    { ...execution, targetAsset: "DAI" },
    { success: false, action: "NONE", timestamp: portfolio.timestamp },
    { ...execution, sourceAmount: 0 },
    { ...execution, targetAmount: -1 },
    { ...execution, txHash: "mock-tx" },
    { ...execution, riskExposurePct: 70 },
    { ...execution, error: "Failed while claiming success" },
  ])("rejects inconsistent or noncontract adapter output: %j", async (result) => {
    const execute = vi.fn(async () => result as ExecutionResult);
    await expect(new ExecutionService({ execute }, DEMO_POLICY_CONFIG).execute(approval)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("checks the original authorization even if an adapter mutates its input", async () => {
    const execute = vi.fn(async (decision: PolicyDecision) => {
      decision.sourceAsset = "WBTC";
      return { ...execution, sourceAsset: "WBTC" };
    });
    await expect(new ExecutionService({ execute }, DEMO_POLICY_CONFIG).execute(approval)).rejects.toThrow("must match");
    expect(approval.sourceAsset).toBe("ETH");
  });

  it("detects an adapter increasing the approved reduction even when receipt assets match", async () => {
    const execute = vi.fn(async (decision: PolicyDecision) => {
      decision.reduceExposurePct = 100;
      return execution;
    });
    await expect(new ExecutionService({ execute }, DEMO_POLICY_CONFIG).execute(approval)).rejects.toThrow("original policy-approved");
    expect(approval.reduceExposurePct).toBe(30);
  });

  it("returns a validated failed swap without claiming amounts or changed balances", async () => {
    const failure: ExecutionResult = {
      success: false, action: "SWAP_TO_SAFE", sourceAsset: "ETH", targetAsset: "USDC", timestamp: portfolio.timestamp, error: "Mock execution failed",
    };
    await expect(new ExecutionService({ execute: async () => failure }, DEMO_POLICY_CONFIG).execute(approval)).resolves.toEqual(failure);
  });

  it("propagates adapter errors without retry or fallback", async () => {
    const execute = vi.fn(async () => { throw new Error("Adapter failed"); });
    await expect(new ExecutionService({ execute }, DEMO_POLICY_CONFIG).execute(approval)).rejects.toThrow("Adapter failed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("uses a constructor-owned copy of the trusted cap and asset allowlists", async () => {
    const config: PolicyConfig = { ...DEMO_POLICY_CONFIG, allowedRiskAssets: ["ETH"], allowedDefensiveAssets: ["USDC"] };
    const execute = vi.fn(async () => execution);
    const service = new ExecutionService({ execute }, config);
    config.maxDeRiskPct = 100;
    config.allowedRiskAssets.push("USDC");
    config.allowedDefensiveAssets.push("ETH");
    await expect(service.execute({ ...approval, reduceExposurePct: 100 })).rejects.toThrow();
    await expect(service.execute({ ...approval, sourceAsset: "USDC", targetAsset: "ETH" })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("MockExecutionAdapter and simulated external balances", () => {
  it("swaps 3 ETH for 8100 USDC, leaving 7 ETH and 70% risk exposure after a fresh read", async () => {
    const current = new MockScenarioState(DEMO_WALLET);
    const before = current.getPortfolio(DEMO_WALLET);
    current.getMarketState();
    const result = await new ExecutionService(new MockExecutionAdapter(current, DEMO_POLICY_CONFIG), DEMO_POLICY_CONFIG).execute(approval);
    const after = current.getPortfolio(DEMO_WALLET);
    expect(before).toMatchObject({ totalUsd: 30_000, riskExposurePct: 100 });
    expect(after).toMatchObject({ totalUsd: 27_000, riskAssetUsd: 18_900, defensiveAssetUsd: 8_100, riskExposurePct: 70 });
    expect(after.assets).toMatchObject([{ symbol: "ETH", amount: 7 }, { symbol: "USDC", amount: 8_100 }]);
    expect(result).toMatchObject({ success: true, action: "SWAP_TO_SAFE", sourceAmount: 3, targetAmount: 8_100 });
    expect(result.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(result).not.toHaveProperty("riskExposurePct");
    expect(result).not.toHaveProperty("after");
  });

  it("reduces exposure by 30 percentage points from 80% to 50%, not by 30% of the risk balance", async () => {
    const current = new MockScenarioState(DEMO_WALLET, DEMO_POLICY_CONFIG, withExposure(80));
    const before = current.getPortfolio(DEMO_WALLET);
    const decision = new PolicyService(DEMO_POLICY_CONFIG).evaluate(before, { ...risk, riskExposurePct: 80 });
    const result = await new MockExecutionAdapter(current, DEMO_POLICY_CONFIG).execute(decision);
    expect(before.riskExposurePct).toBe(80);
    expect(current.getPortfolio(DEMO_WALLET).riskExposurePct).toBe(50);
    expect(result).toMatchObject({ sourceAmount: 3, targetAmount: 9_000 });
  });

  it.each(unauthorized)("also rejects invalid direct adapter calls without changing Mock state: %j", async (decision) => {
    const current = new MockScenarioState(DEMO_WALLET);
    const applySwap = vi.spyOn(current, "applySwap");
    await expect(new MockExecutionAdapter(current, DEMO_POLICY_CONFIG).execute(decision as PolicyDecision)).rejects.toThrow();
    expect(applySwap).not.toHaveBeenCalled();
    expect(current.getPortfolio(DEMO_WALLET).riskExposurePct).toBe(100);
  });

  it("refuses an amount beyond available source balance without mutating balances", async () => {
    const current = new MockScenarioState(DEMO_WALLET, DEMO_POLICY_CONFIG, withExposure(20));
    await expect(new MockExecutionAdapter(current, DEMO_POLICY_CONFIG).execute(approval)).rejects.toThrow("available risk asset");
    expect(current.getPortfolio(DEMO_WALLET)).toMatchObject({ riskExposurePct: 20, riskAssetUsd: 6_000, defensiveAssetUsd: 24_000 });
  });

  it("rejects a repeated swap and preserves the first result", async () => {
    const current = new MockScenarioState(DEMO_WALLET);
    current.getMarketState();
    const adapter = new MockExecutionAdapter(current, DEMO_POLICY_CONFIG);
    await adapter.execute(approval);
    await expect(adapter.execute(approval)).rejects.toThrow("already");
    expect(current.getPortfolio(DEMO_WALLET).riskExposurePct).toBe(70);
  });

  it("isolates returned snapshots and independent request states", async () => {
    const first = new MockScenarioState(DEMO_WALLET);
    const second = new MockScenarioState(DEMO_WALLET);
    const snapshot = first.getPortfolio(DEMO_WALLET);
    snapshot.assets[0].amount = 0;
    expect(first.getPortfolio(DEMO_WALLET).assets[0].amount).toBe(10);
    first.getMarketState();
    await new MockExecutionAdapter(first, DEMO_POLICY_CONFIG).execute(approval);
    expect(second.getPortfolio(DEMO_WALLET)).toMatchObject({ totalUsd: 30_000, riskExposurePct: 100 });
    expect(Object.isFrozen(DEMO_POLICY_CONFIG.allowedRiskAssets)).toBe(true);
  });

  it("copies its own trusted config independently of Mock-state checks", async () => {
    const current = new MockScenarioState(DEMO_WALLET);
    const config: PolicyConfig = { ...DEMO_POLICY_CONFIG, allowedRiskAssets: ["ETH"], allowedDefensiveAssets: ["USDC"] };
    const adapter = new MockExecutionAdapter(current, config);
    config.maxDeRiskPct = 100;
    await expect(adapter.execute({ ...approval, reduceExposurePct: 100 })).rejects.toThrow("configured limit");
    expect(current.getPortfolio(DEMO_WALLET).riskExposurePct).toBe(100);
  });
});
