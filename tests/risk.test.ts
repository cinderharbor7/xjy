import { describe, expect, it } from "vitest";
import type { PositionState } from "@/domain/types";
import { DEMO_WALLET, MockScenarioState } from "@/mocks/scenarios";
import { RiskService } from "@/modules/risk/risk.service";
import { runStressTest } from "@/modules/risk/stress-test";

const position = new MockScenarioState(DEMO_WALLET).getPosition(DEMO_WALLET);

describe("demo risk service", () => {
  it("returns the demo score and pending investigation without inventing Agent confidence", () => {
    const risk = new RiskService().analyze(position);
    expect(risk).toMatchObject({
      riskScore: 91,
      confidence: 0,
      healthFactor: 1.08,
      recommendedAction: "REPAY",
      investigation: { summary: "Pending investigation", confidence: 0 },
    });
    expect(risk.stressTests).toEqual([
      { ethChangePct: -5, projectedHealthFactor: 1.03, liquidationRisk: false },
      { ethChangePct: -10, projectedHealthFactor: 0.97, liquidationRisk: true },
      { ethChangePct: -15, projectedHealthFactor: 0.92, liquidationRisk: true },
    ]);
  });

  it("has no repayment recommendation or liquidation risk when debt is zero", () => {
    const risk = new RiskService().analyze({ ...position, debtUsd: 0, healthFactor: 0 });
    expect(risk.riskScore).toBe(0);
    expect(risk.recommendedAction).toBe("NONE");
    expect(risk.stressTests.every((stress) => !stress.liquidationRisk)).toBe(true);
  });

  it.each([
    [1.1, 91, "REPAY"],
    [1.10001, 75, "NONE"],
    [1.3, 50, "NONE"],
    [1.5, 20, "NONE"],
  ])("keeps simple demo band boundary HF %s explicit", (healthFactor, score, action) => {
    const risk = new RiskService().analyze({ ...position, healthFactor: healthFactor as number });
    expect(risk.riskScore).toBe(score);
    expect(risk.recommendedAction).toBe(action);
  });

  it("validates positions before calculating risk", () => {
    expect(() => new RiskService().analyze({ ...position, debtUsd: -1 })).toThrow();
    expect(() => new RiskService().analyze({ ...position, hidden: "private" } as PositionState)).toThrow();
  });
});

describe("demo linear stress test", () => {
  it("marks the liquidation threshold itself as at risk", () => {
    expect(runStressTest({ ...position, healthFactor: 1 }, 0)).toEqual({
      ethChangePct: 0, projectedHealthFactor: 1, liquidationRisk: true,
    });
    expect(runStressTest({ ...position, healthFactor: 1.01 }, 0).liquidationRisk).toBe(false);
  });

  it("handles a full price loss and a single zero-shock scenario", () => {
    expect(runStressTest(position, -100).projectedHealthFactor).toBe(0);
    expect(runStressTest(position, 0).projectedHealthFactor).toBe(1.08);
  });

  it.each([-101, Infinity, NaN])("rejects an invalid price shock %s", (shock) => {
    expect(() => runStressTest(position, shock)).toThrow();
  });
});
