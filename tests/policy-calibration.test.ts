import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEMO_POLICY_CONFIG } from "@/mocks/scenarios";
import {
  CALIBRATION_CLAIMS,
  CALIBRATION_PROVENANCE,
  GRADED_EXPOSURE_CLAIMS,
  GRADED_EXPOSURE_EVIDENCE,
  POLICY_THRESHOLDS_CALIBRATED,
  POLICY_THRESHOLDS_IN_USE,
  REJECTED_CANDIDATES,
} from "@/modules/policy/calibrated-defaults";
import {
  SPEC,
  buildRankedFeatures,
  expandingPercentile,
  findCrashEvents,
  fitLogistic,
  labelCrash,
  maxDrawdown,
  percentileRank,
  predictLogistic,
  rocAuc,
  scheduleCutPct,
  scheduleExposure,
  simulateDeRisk,
  simulateGraded,
  simulateStatic,
  solveLinearSystem,
  type DailyBar,
  type ScheduleSpec,
} from "@/modules/policy/calibration";

function bar(date: string, close: number, volume = 100): DailyBar {
  return { date, open: close, high: close, low: close, close, volume };
}

function series(closes: number[]): DailyBar[] {
  return closes.map((close, index) => bar(`2020-01-${String(index + 1).padStart(2, "0")}`, close, 100 + index * 7));
}

/** Deterministic noisy series — no Math.random, so failures reproduce exactly. */
function noisySeries(length: number, seed = 1): DailyBar[] {
  const bars: DailyBar[] = [];
  let price = 100;
  for (let i = 0; i < length; i += 1) {
    price *= 1 + Math.sin((i + seed) * 1.7) * 0.04 + Math.cos(i * 0.31) * 0.02;
    const date = new Date(Date.UTC(2019, 0, 1) + i * 86400000).toISOString().slice(0, 10);
    bars.push(bar(date, price, 100 + (i % 37)));
  }
  return bars;
}

function noisyScores(length: number, warmup = 40): (number | null)[] {
  return Array.from({ length }, (_, i) =>
    i < warmup ? null : Math.max(0, Math.min(100, 50 + Math.sin(i / 3) * 45 + (i % 11))),
  );
}

describe("expandingPercentile", () => {
  it("counts ties as at-or-below and spans 0..100", () => {
    expect(percentileRank([1, 2, 3, 4], 1)).toBeCloseTo(25, 6);
    expect(percentileRank([1, 2, 3, 4], 4)).toBeCloseTo(100, 6);
    expect(percentileRank([5, 5, 5], 5)).toBeCloseTo(100, 6);
  });

  it("withholds a reading until the minimum observation count exists", () => {
    const values = [1, 2, 3, 4, 5];
    expect(expandingPercentile(values, 2, 5)).toBeNull();
    expect(expandingPercentile(values, 4, 5)).not.toBeNull();
  });

  it("never changes a past reading when future data is appended", () => {
    const head = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5];
    const extended = [...head, 8, 9, 7, 9, 3, 2, 3, 8, 4, 6, 2, 6, 4];
    for (let i = 4; i < head.length; i += 1) {
      expect(expandingPercentile(extended, i, 3)).toBe(expandingPercentile(head, i, 3));
    }
  });
});

describe("buildRankedFeatures", () => {
  it("emits nothing during warm-up and a complete vector afterwards", () => {
    const closes = Array.from({ length: 600 }, (_, index) => 100 + Math.sin(index / 5) * 10 + index * 0.05);
    const features = buildRankedFeatures(series(closes));
    expect(features[SPEC.trendWindow - 2]).toBeNull();
    expect(features[SPEC.trendWindow]).not.toBeNull();
    const later = features[features.length - 1];
    expect(later).not.toBeNull();
    for (const value of Object.values(later as Record<string, number>)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe("labelCrash / findCrashEvents", () => {
  it("labels a 15% ten-day fall and returns null when the horizon runs off the end", () => {
    const bars = series([100, 100, 100, 100, 100, 84, 84, 84, 84, 84, 84]);
    const label = labelCrash(bars, 0);
    expect(label?.isCrash).toBe(true);
    expect(label?.troughIndex).toBe(5);
    expect(labelCrash(bars, bars.length - 1)).toBeNull();
  });

  it("does not label a gentle decline", () => {
    const bars = series([100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90]);
    expect(labelCrash(bars, 0)?.isCrash).toBe(false);
  });

  it("collapses a sustained sell-off into a single event", () => {
    const bars = series([100, 100, 90, 80, 70, 60, 55, 55, 55, 55, 55, 55, 55, 55, 55, 55, 55, 55, 55, 55, 55, 55]);
    const events = findCrashEvents(bars);
    expect(events).toHaveLength(1);
    expect(events[0].startIndex).toBe(0);
  });
});

describe("logistic fit", () => {
  it("solves a known linear system", () => {
    const solution = solveLinearSystem(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
    );
    expect(solution).not.toBeNull();
    expect((solution as number[])[0]).toBeCloseTo(1, 8);
    expect((solution as number[])[1]).toBeCloseTo(3, 8);
  });

  it("returns null for a singular system instead of inventing an answer", () => {
    expect(
      solveLinearSystem(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull();
  });

  it("recovers the sign of a separable signal and ranks it perfectly", () => {
    const x: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const high = i % 2 === 0;
      x.push([high ? 0.9 : 0.1, high ? 0.8 : 0.2]);
      y.push(high ? 1 : 0);
    }
    const model = fitLogistic(x, y, SPEC.ridge);
    expect(model.converged).toBe(true);
    expect(model.weights[0]).toBeGreaterThan(0);
    expect(rocAuc(x.map((row) => predictLogistic(model, row)), y)).toBeCloseTo(1, 6);
  });

  it("returns 0.5 when only one class is present", () => {
    expect(rocAuc([0.1, 0.9], [0, 0])).toBe(0.5);
  });

  it("scores between 0 and 1", () => {
    const model = fitLogistic(
      [
        [0.1, 0.1],
        [0.9, 0.9],
      ],
      [0, 1],
      SPEC.ridge,
    );
    expect(predictLogistic(model, [0, 0])).toBeGreaterThanOrEqual(0);
    expect(predictLogistic(model, [1, 1])).toBeLessThanOrEqual(1);
  });
});

describe("drawdown and simulation", () => {
  it("measures the worst peak-to-trough fall", () => {
    expect(maxDrawdown([1, 1.2, 0.6, 0.9])).toBeCloseTo(-50, 6);
    expect(maxDrawdown([1, 2, 3])).toBe(0);
  });

  it("compounds a constant exposure exactly", () => {
    const bars = series([100, 110, 121]);
    const result = simulateStatic(bars, 0, 50);
    expect(result.totalReturnPct).toBeCloseTo(((1 + 0.5 * 0.1) ** 2 - 1) * 100, 6);
    expect(result.averageExposurePct).toBe(50);
  });

  it("fires once, cuts exposure through the fall and refills only after the calm gate", () => {
    const closes = [100, 100, 100, 100, 100, 100, 100, 90, 80, 70, 60, 60, 60, 100, 100, 100];
    const bars = series(closes);
    const scores: (number | null)[] = [null, null, null, null, null, 90, 95, 95, 95, 95, 10, 10, 10, 10, 10, 10];

    const result = simulateDeRisk(
      bars,
      scores,
      { label: "test", scoreThreshold: 80, deRiskPct: 50, recoveryDays: 3, recoveryMargin: 10, tradeCostPct: 0 },
      0,
    );

    expect(result.triggers).toBe(1);
    expect(result.triggerList[0].date).toBe("2020-01-06");
    expect(result.triggerList[0].wasCrash).toBe(true);
    expect(result.averageExposurePct).toBeLessThan(100);
    expect(result.averageExposurePct).toBeGreaterThan(50);

    const passive = simulateStatic(bars, 0, 100);
    expect(result.totalReturnPct).toBeGreaterThan(passive.totalReturnPct);
  });

  it("does not refill early when the recovery margin is never met", () => {
    const bars = series([100, 100, 100, 100, 100, 100, 80, 60, 90, 120]);
    const scores: (number | null)[] = [null, null, null, null, null, 90, 90, 90, 90, 90];
    const result = simulateDeRisk(
      bars,
      scores,
      { label: "no recovery", scoreThreshold: 80, deRiskPct: 50, recoveryDays: 2, recoveryMargin: 10, tradeCostPct: 0 },
      0,
    );
    expect(result.triggers).toBe(1);
    expect(result.averageExposurePct).toBeLessThan(100);
  });

  it("charges a cost on every switch", () => {
    const bars = series([100, 100, 100, 100, 100, 100, 100, 100]);
    const scores: (number | null)[] = [null, null, null, 90, 0, 0, 90, 0];
    const free = simulateDeRisk(bars, scores, { label: "free", scoreThreshold: 80, deRiskPct: 50, recoveryDays: 2, recoveryMargin: 10, tradeCostPct: 0 }, 0);
    const costly = simulateDeRisk(bars, scores, { label: "costly", scoreThreshold: 80, deRiskPct: 50, recoveryDays: 2, recoveryMargin: 10, tradeCostPct: 5 }, 0);
    expect(costly.costDragPct).toBeGreaterThan(0);
    expect(costly.totalReturnPct).toBeLessThan(free.totalReturnPct);
  });
});

describe("exposure schedules (graded response)", () => {
  const step: ScheduleSpec = { kind: "step", label: "step", threshold: 80, cutPct: 30 };
  const linear: ScheduleSpec = { kind: "linear", label: "linear", lo: 60, hi: 95, maxCutPct: 50 };
  const power: ScheduleSpec = { kind: "power", label: "power", lo: 60, hi: 95, maxCutPct: 50, exponent: 2 };
  const bands: ScheduleSpec = {
    kind: "bands",
    label: "bands",
    bands: [
      { from: 70, cutPct: 10 },
      { from: 80, cutPct: 25 },
      { from: 90, cutPct: 40 },
    ],
  };

  it("a step is all-or-nothing and the boundary is exclusive", () => {
    expect(scheduleCutPct(step, 79.9)).toBe(0);
    expect(scheduleCutPct(step, 80)).toBe(0);
    expect(scheduleCutPct(step, 80.1)).toBe(30);
    expect(scheduleCutPct(step, 100)).toBe(30);
  });

  it("a linear ramp is continuous and saturates at both ends", () => {
    expect(scheduleCutPct(linear, 0)).toBe(0);
    expect(scheduleCutPct(linear, 60)).toBe(0);
    expect(scheduleCutPct(linear, 77.5)).toBeCloseTo(25, 9);
    expect(scheduleCutPct(linear, 95)).toBeCloseTo(50, 9);
    expect(scheduleCutPct(linear, 100)).toBeCloseTo(50, 9);
  });

  it("a convex ramp cuts less than a linear one in the middle", () => {
    for (const score of [65, 70, 77.5, 85, 90]) {
      expect(scheduleCutPct(power, score)).toBeLessThan(scheduleCutPct(linear, score));
    }
    expect(scheduleCutPct(power, 95)).toBeCloseTo(scheduleCutPct(linear, 95), 9);
  });

  it("bands select the highest step that applies, so they never step down", () => {
    expect(scheduleCutPct(bands, 69)).toBe(0);
    expect(scheduleCutPct(bands, 70)).toBe(10);
    expect(scheduleCutPct(bands, 85)).toBe(25);
    expect(scheduleCutPct(bands, 90)).toBe(40);
    expect(scheduleCutPct(bands, 100)).toBe(40);
  });

  it("treats a degenerate span as a step instead of dividing by zero", () => {
    const degenerate: ScheduleSpec = { kind: "linear", label: "d", lo: 80, hi: 80, maxCutPct: 40 };
    expect(scheduleCutPct(degenerate, 79)).toBe(0);
    expect(scheduleCutPct(degenerate, 80)).toBe(40);
    expect(Number.isFinite(scheduleCutPct(degenerate, 100))).toBe(true);
  });

  it("keeps exposure inside 0..100 for every shape and score", () => {
    for (const spec of [step, linear, power, bands]) {
      for (let score = 0; score <= 100; score += 1) {
        const exposure = scheduleExposure(spec, score);
        expect(exposure).toBeGreaterThanOrEqual(0);
        expect(exposure).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("simulateGraded", () => {
  const bars = noisySeries(900);
  const scores = noisyScores(900);

  it("is bit-identical to simulateDeRisk when the schedule is the shipped step", () => {
    const step = simulateGraded(
      bars,
      scores,
      { kind: "step", label: "step", threshold: 80, cutPct: 30 },
      { label: "step", tradeCostPct: SPEC.tradeCostPct, rebalanceBandPct: 0, recoveryDays: SPEC.recoveryDays, recoveryLevel: 80 - SPEC.recoveryMargin },
      0,
    );
    const shipped = simulateDeRisk(
      bars,
      scores,
      { label: "80/30", scoreThreshold: 80, deRiskPct: 30, recoveryDays: SPEC.recoveryDays, recoveryMargin: SPEC.recoveryMargin, tradeCostPct: SPEC.tradeCostPct },
      0,
    );

    expect(step.equity).toHaveLength(shipped.equity.length);
    for (let i = 0; i < shipped.equity.length; i += 1) {
      expect(step.equity[i]).toBeCloseTo(shipped.equity[i], 12);
    }
    expect(step.totalReturnPct).toBeCloseTo(shipped.totalReturnPct, 9);
    expect(step.maxDrawdownPct).toBeCloseTo(shipped.maxDrawdownPct, 9);
    expect(step.costDragPct).toBeCloseTo(shipped.costDragPct, 9);
    expect(step.downSwitches).toBe(shipped.triggers);
    expect(step.triggerList.map((entry) => entry.date)).toEqual(shipped.triggerList.map((entry) => entry.date));
    expect(step.triggerList.map((entry) => entry.remainingDropPct)).toEqual(
      shipped.triggerList.map((entry) => entry.remainingDropPct),
    );
    expect(step.downSwitches + step.upSwitches).toBe(step.switches);
    expect(step.minExposurePct).toBeCloseTo(100 - 30, 9);
  });

  it("never lets exposure rise before the recovery gate is satisfied", () => {
    // Score collapses to 0 for exactly two days, then snaps back to 100.
    const closes = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
    const testBars = series(closes);
    const testScores: (number | null)[] = [null, null, 95, 95, 0, 0, 100, 100, 0, 0, 0, 0];
    const result = simulateGraded(
      testBars,
      testScores,
      { kind: "linear", label: "ramp", lo: 60, hi: 95, maxCutPct: 50 },
      { label: "ramp", tradeCostPct: 0, rebalanceBandPct: 5, recoveryDays: 3, recoveryLevel: 60 },
      0,
    );
    const rises = result.switchList.filter((entry) => entry.direction === "up");
    expect(rises.length).toBeGreaterThan(0);
    // The first rise can only happen once three consecutive calm days exist.
    const firstRise = rises[0];
    expect(firstRise.index).toBeGreaterThanOrEqual(10);
  });

  it("suppresses trades the schedule itself would not notice (rebalance band)", () => {
    const config = { label: "ramp", tradeCostPct: 0, recoveryDays: 3, recoveryLevel: 60 };
    const wide = simulateGraded(bars, scores, { kind: "linear", label: "l", lo: 60, hi: 95, maxCutPct: 50 }, { ...config, rebalanceBandPct: 5 }, 0);
    const none = simulateGraded(bars, scores, { kind: "linear", label: "l", lo: 60, hi: 95, maxCutPct: 50 }, { ...config, rebalanceBandPct: 0 }, 0);
    expect(wide.switches).toBeLessThan(none.switches);
    expect(wide.switches).toBeGreaterThan(0);
  });

  it("charges cost on every switch in both directions", () => {
    const free = simulateGraded(bars, scores, { kind: "linear", label: "l", lo: 60, hi: 95, maxCutPct: 50 }, { label: "l", tradeCostPct: 0, rebalanceBandPct: 5, recoveryDays: 3, recoveryLevel: 60 }, 0);
    const costly = simulateGraded(bars, scores, { kind: "linear", label: "l", lo: 60, hi: 95, maxCutPct: 50 }, { label: "l", tradeCostPct: 5, rebalanceBandPct: 5, recoveryDays: 3, recoveryLevel: 60 }, 0);
    expect(free.costDragPct).toBe(0);
    expect(costly.costDragPct).toBeGreaterThan(0);
    expect(costly.totalReturnPct).toBeLessThan(free.totalReturnPct);
  });

  it("holds a lower average exposure than the binary rule for the same score series", () => {
    const ramp = simulateGraded(bars, scores, { kind: "linear", label: "l", lo: 60, hi: 95, maxCutPct: 50 }, { label: "l", tradeCostPct: 0, rebalanceBandPct: 5, recoveryDays: 3, recoveryLevel: 60 }, 0);
    const step = simulateGraded(bars, scores, { kind: "step", label: "s", threshold: 80, cutPct: 30 }, { label: "s", tradeCostPct: 0, rebalanceBandPct: 0, recoveryDays: 3, recoveryLevel: 70 }, 0);
    expect(ramp.averageExposurePct).toBeLessThan(step.averageExposurePct);
  });
});

describe("calibrated thresholds stay tied to the recorded evidence", () => {
  type Results = {
    pooledOutOfSampleAuc: number;
    baseRatePct?: number;
    scoreBuckets: { range: string; days: number; crashRatePct: number; liftVsBase: number }[];
    grid: {
      label: string;
      totalReturnPct: number;
      maxDrawdownPct: number;
      returnOverMaxDrawdown: number;
      triggers: number;
      hitRatePct: number;
      costDragPct: number;
    }[];
    buyHold: { totalReturnPct: number; maxDrawdownPct: number };
    events: number;
    backtestWindow: { days: number };
    selected: { currentThresholds: { minRiskScore: number; maxDeRiskPct: number } };
    crossMarket: { outOfSampleAuc: number; strategy: { totalReturnPct: number }; buyHold: { totalReturnPct: number } };
    generatedFrom: { crossVenueReturnCorrelation: number; crossVenueMaxReturnGapPoints: number };
    graded: {
      baselineReproducesShippedRule: boolean;
      meanEdgeVsMatchedControlPct: number;
      bestByCalmar: { label: string; returnOverMaxDrawdown: number };
      bestVsMatchedControl: { label: string; deltaReturnPct: number };
      variants: {
        label: string;
        totalReturnPct: number;
        maxDrawdownPct: number;
        returnOverMaxDrawdown: number;
        averageExposurePct: number;
        downSwitches: number;
        upSwitches: number;
        switches: number;
        switchesPerYear: number;
        costDragPct: number;
        matchedStaticReturnPct: number;
        deltaReturnVsMatchedPct: number;
      }[];
    };
  };

  const results = JSON.parse(
    readFileSync(fileURLToPath(new URL("../data/policy-calibration-results.json", import.meta.url)), "utf8"),
  ) as Results;

  const find = (label: string) => {
    const entry = results.grid.find((row) => row.label === label);
    expect(entry, `grid point ${label} missing from the results file`).toBeDefined();
    return entry as Results["grid"][number];
  };

  it("mirrors the demo configuration it claims to mirror", () => {
    expect(POLICY_THRESHOLDS_IN_USE.minRiskScore).toBe(DEMO_POLICY_CONFIG.minRiskScore);
    expect(POLICY_THRESHOLDS_IN_USE.minConfidence).toBe(DEMO_POLICY_CONFIG.minConfidence);
    expect(POLICY_THRESHOLDS_IN_USE.minRiskExposurePct).toBe(DEMO_POLICY_CONFIG.minRiskExposurePct);
    expect(POLICY_THRESHOLDS_IN_USE.maxDeRiskPct).toBe(DEMO_POLICY_CONFIG.maxDeRiskPct);
    expect(results.selected.currentThresholds.minRiskScore).toBe(DEMO_POLICY_CONFIG.minRiskScore);
  });

  it("moves only the risk-score trigger, and that move is the documented grid point", () => {
    expect(POLICY_THRESHOLDS_CALIBRATED.minRiskScore).not.toBe(POLICY_THRESHOLDS_IN_USE.minRiskScore);
    expect(POLICY_THRESHOLDS_CALIBRATED.minConfidence).toBe(POLICY_THRESHOLDS_IN_USE.minConfidence);
    expect(POLICY_THRESHOLDS_CALIBRATED.minRiskExposurePct).toBe(POLICY_THRESHOLDS_IN_USE.minRiskExposurePct);
    expect(POLICY_THRESHOLDS_CALIBRATED.maxDeRiskPct).toBe(POLICY_THRESHOLDS_IN_USE.maxDeRiskPct);

    const recommended = find(`${POLICY_THRESHOLDS_CALIBRATED.minRiskScore}/${POLICY_THRESHOLDS_CALIBRATED.maxDeRiskPct}`);
    const current = find(`${POLICY_THRESHOLDS_IN_USE.minRiskScore}/${POLICY_THRESHOLDS_IN_USE.maxDeRiskPct}`);

    expect(recommended.triggers).toBeLessThan(current.triggers);
    expect(recommended.hitRatePct).toBeGreaterThan(current.hitRatePct);
    expect(recommended.returnOverMaxDrawdown).toBeGreaterThan(current.returnOverMaxDrawdown);
    expect(recommended.maxDrawdownPct).toBeGreaterThan(current.maxDrawdownPct);
    expect(recommended.costDragPct).toBeLessThan(current.costDragPct);
    expect(recommended.triggers).toBeGreaterThanOrEqual(10);
  });

  it("records why the best-looking grid point was rejected", () => {
    const rejected = find("90/50");
    expect(rejected.triggers).toBeLessThanOrEqual(10);
    expect(rejected.returnOverMaxDrawdown).toBeGreaterThan(find("80/30").returnOverMaxDrawdown);
    expect(REJECTED_CANDIDATES.some((entry) => entry.candidate.includes("90"))).toBe(true);
  });

  it("keeps the claim that the score does not predict crashes", () => {
    expect(results.pooledOutOfSampleAuc).toBeGreaterThan(0.5);
    expect(results.pooledOutOfSampleAuc).toBeLessThan(0.56);
    expect(CALIBRATION_CLAIMS.refuted.some((claim) => claim.includes("0.524"))).toBe(true);
  });

  it("keeps the 2.1x lift that justifies the 80 threshold", () => {
    const bucket = results.scoreBuckets.find((row) => row.range === "80-90");
    expect(bucket).toBeDefined();
    expect((bucket as { liftVsBase: number }).liftVsBase).toBeGreaterThan(1.9);
    expect((bucket as { liftVsBase: number }).liftVsBase).toBeLessThan(2.4);
    expect((bucket as { days: number }).days).toBeGreaterThan(100);
  });

  it("keeps the cross-venue day-bucket warning", () => {
    expect(results.generatedFrom.crossVenueReturnCorrelation).toBeLessThan(0.5);
    expect(results.generatedFrom.crossVenueMaxReturnGapPoints).toBeGreaterThan(20);
    expect(CALIBRATION_PROVENANCE.dataset.crossVenueCheck).toContain("different 24h bucket");
  });

  it("keeps the cross-market failure case a failure", () => {
    expect(results.crossMarket.outOfSampleAuc).toBeGreaterThan(0.7);
    expect(results.crossMarket.strategy.totalReturnPct).toBeLessThan(results.crossMarket.buyHold.totalReturnPct);
  });

  it("reports a non-trivial evaluation window", () => {
    expect(results.events).toBeGreaterThan(50);
    expect(results.backtestWindow.days).toBeGreaterThan(2000);
  });

  it("proves the graded baseline is the shipped rule, not a lookalike", () => {
    expect(results.graded.baselineReproducesShippedRule).toBe(true);
    expect(GRADED_EXPOSURE_EVIDENCE.baselineReproducesShippedRule).toBe(true);

    const stepRow = results.graded.variants.find((row) => row.label.includes("shipped"));
    expect(stepRow, "the graded table must contain the shipped step as its baseline").toBeDefined();
    const shippedGrid = find(`${POLICY_THRESHOLDS_IN_USE.minRiskScore}/${POLICY_THRESHOLDS_IN_USE.maxDeRiskPct}`);
    expect((stepRow as { downSwitches: number }).downSwitches).toBe(shippedGrid.triggers);
    expect((stepRow as { totalReturnPct: number }).totalReturnPct).toBeCloseTo(shippedGrid.totalReturnPct, 6);
    expect((stepRow as { maxDrawdownPct: number }).maxDrawdownPct).toBeCloseTo(shippedGrid.maxDrawdownPct, 6);
  });

  it("keeps the graded result marginal, and keeps the churn it costs", () => {
    const shipped = results.graded.variants.find((row) => row.label.includes("shipped")) as Results["graded"]["variants"][number];
    const best = results.graded.variants.find((row) => row.label === results.graded.bestByCalmar.label) as Results["graded"]["variants"][number];

    expect(results.graded.bestByCalmar.label).toBe(GRADED_EXPOSURE_EVIDENCE.bestShape);
    expect(best.returnOverMaxDrawdown).toBeGreaterThan(shipped.returnOverMaxDrawdown);
    // The win is real but small, and it is paid for in trades.
    expect(best.returnOverMaxDrawdown - shipped.returnOverMaxDrawdown).toBeLessThan(
      GRADED_EXPOSURE_EVIDENCE.bestShapeEdgeOverShipped + 0.05,
    );
    expect(best.switchesPerYear).toBeGreaterThan(shipped.switchesPerYear * 2);
    expect(best.costDragPct).toBeGreaterThan(shipped.costDragPct);
    expect(GRADED_EXPOSURE_CLAIMS.refuted.some((claim) => claim.includes("+0.72"))).toBe(true);
  });

  it("keeps every active shape losing to a passive hold at the same exposure", () => {
    for (const row of results.graded.variants) {
      expect(row.deltaReturnVsMatchedPct, `${row.label} should not beat its matched control`).toBeLessThan(0);
      expect(row.matchedStaticReturnPct).toBeGreaterThan(row.totalReturnPct);
    }
    expect(results.graded.meanEdgeVsMatchedControlPct).toBeLessThan(-100);
    expect(GRADED_EXPOSURE_EVIDENCE.meanEdgeOverMatchedControlPct).toBeLessThan(0);
  });

  it("keeps the tail-escalation variant recorded as a failure", () => {
    const tail = results.graded.variants.find((row) => row.label === GRADED_EXPOSURE_EVIDENCE.worstShape);
    expect(tail, `${GRADED_EXPOSURE_EVIDENCE.worstShape} missing from the graded table`).toBeDefined();
    const shipped = results.graded.variants.find((row) => row.label.includes("shipped")) as Results["graded"]["variants"][number];
    expect((tail as Results["graded"]["variants"][number]).returnOverMaxDrawdown).toBeLessThan(shipped.returnOverMaxDrawdown);
    expect((tail as Results["graded"]["variants"][number]).maxDrawdownPct).toBeLessThan(shipped.maxDrawdownPct);
    expect(GRADED_EXPOSURE_CLAIMS.refuted.some((claim) => claim.includes("80/92"))).toBe(true);
  });
});
