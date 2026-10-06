import { describe, expect, it, vi } from "vitest";
import type { InvestigationResult, PolicyDecision, PositionState } from "@/domain/types";
import { DEMO_POLICY_CONFIG, DEMO_WALLET, MockScenarioState } from "@/mocks/scenarios";
import { PositionService } from "@/modules/position/position.service";
import { MockPositionAdapter } from "@/modules/position/mock-position.adapter";
import { InvestigationService } from "@/modules/investigation/investigation.service";
import { MockInvestigationAdapter } from "@/modules/investigation/mock-investigation.adapter";
import { RiskService } from "@/modules/risk/risk.service";

const approval: PolicyDecision = {
  triggered: true,
  action: "REPAY",
  repayAmountUsd: 20_000,
  reasons: ["Demo policy approved the structured repayment."],
};

describe("request-scoped Mock position", () => {
  it("changes the externally simulated position only after an approved repayment", async () => {
    const state = new MockScenarioState(DEMO_WALLET);
    const service = new PositionService(new MockPositionAdapter(state));
    expect(await service.getPosition(DEMO_WALLET)).toMatchObject({ debtUsd: 100_000, healthFactor: 1.08 });
    state.applyRepay(approval);
    expect(await service.getPosition(DEMO_WALLET)).toMatchObject({ debtUsd: 80_000, healthFactor: 1.34 });
    expect(() => state.applyRepay(approval)).toThrow(/already/);
  });

  it("keeps requests and returned snapshots isolated", () => {
    const first = new MockScenarioState(DEMO_WALLET);
    const second = new MockScenarioState(DEMO_WALLET);
    const snapshot = first.getPosition(DEMO_WALLET);
    snapshot.debtUsd = 0;
    expect(first.getPosition(DEMO_WALLET).debtUsd).toBe(100_000);
    first.applyRepay(approval);
    expect(second.getPosition(DEMO_WALLET).debtUsd).toBe(100_000);
    expect(Object.isFrozen(DEMO_POLICY_CONFIG)).toBe(true);
  });

  it("fails fast for unsupported, unapproved or repeated repayment amounts", () => {
    const state = new MockScenarioState(DEMO_WALLET);
    expect(() => state.applyRepay({ triggered: false, action: "NONE", repayAmountUsd: 0, reasons: ["Not approved"] })).toThrow(/approved/);
    expect(() => state.applyRepay({ ...approval, repayAmountUsd: 10_000 })).toThrow(/20,000/);
    expect(() => state.applyRepay({ ...approval, triggered: false })).toThrow();
    expect(state.getPosition(DEMO_WALLET).debtUsd).toBe(100_000);
  });

  it("rejects empty wallets and a wallet outside the request", async () => {
    expect(() => new MockScenarioState(" ")).toThrow();
    const state = new MockScenarioState(DEMO_WALLET);
    expect(() => state.getPosition("another-wallet")).toThrow(/does not match/);
    const getPosition = vi.fn(async () => state.getPosition(DEMO_WALLET));
    await expect(new PositionService({ getPosition }).getPosition("")).rejects.toThrow();
    expect(getPosition).not.toHaveBeenCalled();
  });

  it("validates adapter output and confirms its wallet", async () => {
    const state = new MockScenarioState(DEMO_WALLET);
    const output = state.getPosition(DEMO_WALLET);
    await expect(new PositionService({ getPosition: async () => ({ ...output, debtUsd: -1 }) }).getPosition(DEMO_WALLET)).rejects.toThrow();
    await expect(new PositionService({ getPosition: async () => ({ ...output, wallet: "other-wallet" }) }).getPosition(DEMO_WALLET)).rejects.toThrow(/different wallet/);
    await expect(new PositionService({ getPosition: async () => ({ ...output, internal: true } as PositionState) }).getPosition(DEMO_WALLET)).rejects.toThrow();
  });
});

describe("investigation service", () => {
  const position = new MockScenarioState(DEMO_WALLET).getPosition(DEMO_WALLET);
  const risk = new RiskService().analyze(position);

  it("returns an explicitly Mock investigation through the contract", async () => {
    const investigation = await new InvestigationService(new MockInvestigationAdapter()).investigate(position, risk);
    expect(investigation.summary).toContain("Mock investigation");
    expect(investigation.confidence).toBe(0.88);
    expect(investigation.evidence.length).toBeGreaterThan(0);
    expect(investigation.uncertainties.join(" ")).toContain("No LLM");
    expect(risk.confidence).toBe(0);
    expect(risk.investigation.summary).toBe("Pending investigation");
  });

  it("rejects invalid or unrelated inputs before calling the Agent", async () => {
    const investigate = vi.fn(async () => new MockInvestigationAdapter().investigate(position, risk));
    const service = new InvestigationService({ investigate });
    await expect(service.investigate({ ...position, debtUsd: -1 }, risk)).rejects.toThrow();
    await expect(service.investigate(position, { ...risk, riskScore: 101 })).rejects.toThrow();
    await expect(service.investigate(position, { ...risk, healthFactor: 2 })).rejects.toThrow(/does not match/);
    expect(investigate).not.toHaveBeenCalled();
  });

  it("rejects Agent outputs outside the frozen contract, including an execution instruction", async () => {
    const investigation = await new MockInvestigationAdapter().investigate(position, risk);
    await expect(new InvestigationService({ investigate: async () => ({ ...investigation, confidence: 2 }) }).investigate(position, risk)).rejects.toThrow();
    await expect(new InvestigationService({ investigate: async () => ({ ...investigation, execute: "REPAY" } as InvestigationResult) }).investigate(position, risk)).rejects.toThrow();
  });
});
