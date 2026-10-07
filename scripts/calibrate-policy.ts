/**
 * Calibrate the Policy thresholds against history.
 *
 *   pnpm exec tsx scripts/calibrate-policy.ts            # human-readable report
 *   pnpm exec tsx scripts/calibrate-policy.ts --json      # machine-readable results
 *
 * Method (see docs/policy-calibration.md):
 *  - Prices only. One venue, one UTC day bucket. No on-chain, no funding, no venue mixing.
 *  - Crash label  = a >=15% fall from today's close to the lowest close in the next 10 trading days.
 *  - Features     = expanding percentiles of six price/volume quantities (no lookahead).
 *  - Model        = walk-forward: every calendar year is scored by a ridge logistic
 *                   regression fitted ONLY on earlier years. No test year is ever fitted.
 *  - Score        = expanding percentile of the model output. `score > 80` therefore
 *                   means "top ~20% of all risk readings so far", not a probability.
 *  - Backtest     = replay the real product rule: sell `deRiskPct` points on a trigger,
 *                   pay one execution cost, refill after 3 calm days. Compared against
 *                   buy-and-hold AND against a static haircut of equal average exposure.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FEATURE_KEYS,
  SPEC,
  buildRankedFeatures,
  expandingPercentile,
  findCrashEvents,
  fitLogistic,
  labelCrash,
  maxDrawdown,
  predictLogistic,
  rocAuc,
  scheduleCutPct,
  simulateDeRisk,
  simulateGraded,
  simulateStatic,
  type BacktestResult,
  type DailyBar,
  type DeRiskConfig,
  type FeatureVector,
  type GradedConfig,
  type GradedResult,
  type ScheduleSpec,
} from "../src/modules/policy/calibration";

type EthFile = {
  id: string;
  source: string;
  instrument: string;
  fetchedAt: string;
  coverage: { from: string; to: string; bars: number };
  bars: [string, number, number, number, number, number][];
};

type CnFile = {
  id: string;
  source: string;
  series: Record<string, { code: string; coverage: { from: string; to: string; bars: number }; bars: EthFile["bars"] }>;
};

const repoRoot = resolve(import.meta.dirname, "..");
const dataDir = resolve(repoRoot, "data");

const asJson = process.argv.includes("--json");

function loadEth(file: string): DailyBar[] {
  const parsed = JSON.parse(readFileSync(resolve(dataDir, file), "utf8")) as EthFile;
  return parsed.bars.map(([date, open, high, low, close, volume]) => ({
    date,
    open,
    high,
    low,
    close,
    volume,
  }));
}

function fmt(value: number, digits = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function table(headers: string[], rows: string[][], aligns: ("l" | "r")[]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => (aligns[index] === "r" ? pad(cell, widths[index]).padStart(widths[index]) : pad(cell, widths[index])))
      .join("  ");
  return [line(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

function section(title: string): void {
  if (!asJson) console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);
}

// ---------------------------------------------------------------- 1. data

const ethFile = JSON.parse(readFileSync(resolve(dataDir, "eth-usd-daily.json"), "utf8")) as EthFile;
const ethSecondary = loadEth("eth-usdt-daily-secondary.json");
const eth = loadEth("eth-usd-daily.json");
const cn = JSON.parse(readFileSync(resolve(dataDir, "cn-index-daily.json"), "utf8")) as CnFile;

section("1. Dataset");
if (!asJson) {
  console.log(
    table(
      ["series", "venue", "from", "to", "bars"],
      [
        ["ETH primary", ethFile.source.split(" ")[0], ethFile.coverage.from, ethFile.coverage.to, String(ethFile.coverage.bars)],
        ["ETH secondary", "OKX (cross-check only)", ethSecondary[0].date, ethSecondary[ethSecondary.length - 1].date, String(ethSecondary.length)],
      ],
      ["l", "l", "l", "l", "r"],
    ),
  );
}

// Cross-venue day-bucket check: if two venues disagree materially on the same
// date label, their daily candles are not the same 24h window.
const primaryByDate = new Map(eth.map((bar) => [bar.date, bar.close]));
const secondaryByDate = new Map(ethSecondary.map((bar) => [bar.date, bar.close]));
const commonDates = [...primaryByDate.keys()].filter((date) => secondaryByDate.has(date)).sort();
const primaryReturns: number[] = [];
const secondaryReturns: number[] = [];
for (let i = 1; i < commonDates.length; i += 1) {
  const a1 = primaryByDate.get(commonDates[i - 1]) as number;
  const a2 = primaryByDate.get(commonDates[i]) as number;
  const b1 = secondaryByDate.get(commonDates[i - 1]) as number;
  const b2 = secondaryByDate.get(commonDates[i]) as number;
  primaryReturns.push(a2 / a1 - 1);
  secondaryReturns.push(b2 / b1 - 1);
}
const meanP = primaryReturns.reduce((s, v) => s + v, 0) / primaryReturns.length;
const meanS = secondaryReturns.reduce((s, v) => s + v, 0) / secondaryReturns.length;
let covAcc = 0;
let varP = 0;
let varS = 0;
for (let i = 0; i < primaryReturns.length; i += 1) {
  covAcc += (primaryReturns[i] - meanP) * (secondaryReturns[i] - meanS);
  varP += (primaryReturns[i] - meanP) ** 2;
  varS += (secondaryReturns[i] - meanS) ** 2;
}
const crossCorr = covAcc / Math.sqrt(varP * varS);
let maxDiff = 0;
for (let i = 0; i < primaryReturns.length; i += 1) {
  maxDiff = Math.max(maxDiff, Math.abs(primaryReturns[i] - secondaryReturns[i]));
}
if (!asJson) {
  console.log(`\nCross-venue day-bucket check on ${commonDates.length} shared dates:`);
  console.log(`  same-date daily-return correlation : ${crossCorr.toFixed(3)}`);
  console.log(`  largest same-date return gap       : ${(maxDiff * 100).toFixed(2)} points`);
  console.log("  => daily candles from different venues are NOT the same 24h window.");
  console.log("  => calibration therefore uses ONE venue (ETH-USD, UTC bucket) and never mixes sources.");
}

// ---------------------------------------------------------------- 2. events

section("2. Crash events (>=15% fall from close to the lowest close within 10 trading days)");
const ethEvents = findCrashEvents(eth);
if (!asJson) {
  console.log(
    table(
      ["#", "trigger date", "trough date", "drop to trough"],
      ethEvents.map((event, index) => [
        String(index + 1),
        eth[event.startIndex].date,
        eth[event.troughIndex].date,
        `${fmt(event.dropPct)}%`,
      ]),
      ["r", "l", "l", "r"],
    ),
  );
  console.log(`\n${ethEvents.length} distinct events in ${eth.length} bars (${eth[0].date} .. ${eth[eth.length - 1].date}).`);
}

// ---------------------------------------------------------------- 3. features + labels

const features = buildRankedFeatures(eth);
const labels = eth.map((_, i) => labelCrash(eth, i));

const usableIndices = features
  .map((vector, index) => (vector && labels[index] ? index : -1))
  .filter((index) => index >= 0);

const firstUsable = eth[usableIndices[0]].date;
if (!asJson) console.log(`\nFeatures complete from ${firstUsable} (warm-up: ${SPEC.minHistory} observations).`);

// ---------------------------------------------------------------- 4. walk-forward fit

section("4. Walk-forward logistic fit (each year scored by earlier data only)");

const scoredFromYear = 2019;
const probabilities: (number | null)[] = new Array(eth.length).fill(null);
const coefficients: {
  testYear: number;
  trainSamples: number;
  trainCrashRatePct: number;
  inSampleAuc: number;
  weights: number[];
  intercept: number;
  converged: boolean;
}[] = [];

for (let year = scoredFromYear; year <= 2026; year += 1) {
  const cutoff = `${year}-01-01`;
  const trainIndex: number[] = [];
  for (const index of usableIndices) {
    if (eth[index].date < cutoff) trainIndex.push(index);
  }
  if (trainIndex.length < 120) continue;

  const x = trainIndex.map((index) => FEATURE_KEYS.map((key) => (features[index] as FeatureVector)[key] / 100));
  const y = trainIndex.map((index) => (labels[index]?.isCrash ? 1 : 0));
  const model = fitLogistic(x, y, SPEC.ridge);

  const inSampleScores = x.map((row) => predictLogistic(model, row));
  coefficients.push({
    testYear: year,
    trainSamples: trainIndex.length,
    trainCrashRatePct: (y.reduce((s, v) => s + v, 0) / y.length) * 100,
    inSampleAuc: rocAuc(inSampleScores, y),
    weights: model.weights,
    intercept: model.intercept,
    converged: model.converged,
  });

  for (let i = 0; i < eth.length; i += 1) {
    const date = eth[i].date;
    if (date < cutoff || date >= `${year + 1}-01-01`) continue;
    if (!features[i]) continue;
    probabilities[i] = predictLogistic(model, FEATURE_KEYS.map((key) => (features[i] as FeatureVector)[key] / 100));
  }
}

if (!asJson) {
  console.log(
    table(
      ["test year", "train n", "train crash %", "in-sample AUC", "converged"],
      coefficients.map((row) => [
        String(row.testYear),
        String(row.trainSamples),
        row.trainCrashRatePct.toFixed(2),
        row.inSampleAuc.toFixed(3),
        row.converged ? "yes" : "no",
      ]),
      ["r", "r", "r", "r", "l"],
    ),
  );
  console.log("\nFeature coefficients, normalised to sum |w| = 1 (sign shows direction):");
  const rows = FEATURE_KEYS.map((key, keyIndex) => {
    const perYear = coefficients.map((row) => {
      const sum = row.weights.reduce((s, v) => s + Math.abs(v), 0) || 1;
      return row.weights[keyIndex] / sum;
    });
    const avg = perYear.reduce((s, v) => s + v, 0) / perYear.length;
    const min = Math.min(...perYear);
    const max = Math.max(...perYear);
    return [key, avg.toFixed(3), min.toFixed(3), max.toFixed(3)];
  });
  console.log(table(["feature", "avg normalised w", "min across years", "max across years"], rows, ["l", "r", "r", "r"]));
}

// ---------------------------------------------------------------- 5. score = expanding percentile

const scoreMinObs = SPEC.minHistory;
const scores: (number | null)[] = new Array(eth.length).fill(null);
for (let i = 0; i < eth.length; i += 1) {
  if (probabilities[i] === null) continue;
  const history: number[] = [];
  for (let k = 0; k <= i; k += 1) {
    const value = probabilities[k];
    if (value !== null) history.push(value);
  }
  scores[i] = expandingPercentile(history, history.length - 1, scoreMinObs);
}

const firstScoredIndex = scores.findIndex((value) => value !== null);
const backtestStart = firstScoredIndex;
if (!asJson) {
  console.log(`\nRisk score available from ${eth[backtestStart].date} (expanding percentile, min ${scoreMinObs} readings).`);
  console.log("The score is a RANK in 0..100, so `score > 80` reads as 'top ~20% of all risk readings so far'.");
}

// ---------------------------------------------------------------- 6. threshold evidence

section("6. What the score actually predicts (walk-forward, out of sample)");

const scoredIndices = scores.map((value, index) => (value !== null && labels[index] ? index : -1)).filter((i) => i >= 0);
const bucketEdges = [0, 20, 40, 60, 70, 80, 90, 100];
const bucketRows: { range: string; samples: number; crashRatePct: number; liftVsBase: number }[] = [];
const baseRate = scoredIndices.filter((i) => labels[i]?.isCrash).length / scoredIndices.length;
for (let b = 0; b < bucketEdges.length - 1; b += 1) {
  const lowEdge = bucketEdges[b];
  const highEdge = bucketEdges[b + 1];
  const inBucket = scoredIndices.filter((i) => {
    const score = scores[i] as number;
    return score >= lowEdge && (b === bucketEdges.length - 2 ? score <= highEdge : score < highEdge);
  });
  if (inBucket.length === 0) continue;
  const crashes = inBucket.filter((i) => labels[i]?.isCrash).length;
  const rate = crashes / inBucket.length;
  bucketRows.push({
    range: `${lowEdge}-${highEdge}`,
    samples: inBucket.length,
    crashRatePct: rate * 100,
    liftVsBase: rate / baseRate,
  });
}
if (!asJson) {
  console.log(`Base rate of a crash on any given day: ${(baseRate * 100).toFixed(2)}% (${scoredIndices.length} scored days).\n`);
  console.log(
    table(
      ["score bucket", "days", "P(crash in 10d)", "lift vs base"],
      bucketRows.map((row) => [row.range, String(row.samples), `${row.crashRatePct.toFixed(2)}%`, `${row.liftVsBase.toFixed(1)}x`]),
      ["l", "r", "r", "r"],
    ),
  );
}

const pooledAuc = rocAuc(
  scoredIndices.map((i) => scores[i] as number),
  scoredIndices.map((i) => (labels[i]?.isCrash ? 1 : 0)),
);
if (!asJson) console.log(`\nPooled out-of-sample AUC of the score: ${pooledAuc.toFixed(3)}`);

// ---------------------------------------------------------------- 7. grid sweep

section("7. Parameter sweep — replaying the product rule out of sample");

const thresholds = [60, 70, 75, 80, 85, 90];
const deRiskSizes = [10, 20, 30, 50, 100];

const buyHold = simulateStatic(eth, backtestStart, 100);
const grids: BacktestResult[] = [];
for (const threshold of thresholds) {
  for (const size of deRiskSizes) {
    const config: DeRiskConfig = {
      label: `${threshold}/${size}`,
      scoreThreshold: threshold,
      deRiskPct: size,
      recoveryDays: SPEC.recoveryDays,
      recoveryMargin: SPEC.recoveryMargin,
      tradeCostPct: SPEC.tradeCostPct,
    };
    grids.push(simulateDeRisk(eth, scores, config, backtestStart));
  }
}

if (!asJson) {
  console.log(`Window: ${eth[backtestStart].date} .. ${eth[eth.length - 1].date} (${buyHold.days} days)\n`);
  console.log(
    table(
      ["theta/d", "total ret", "max DD", "ret/|DD|", "avg exp", "trig", "hit %", "med lead", "med drop left", "cost drag"],
      grids.map((result) => [
        result.label,
        `${fmt(result.totalReturnPct, 1)}%`,
        `${result.maxDrawdownPct.toFixed(1)}%`,
        result.returnOverMaxDrawdown.toFixed(2),
        `${result.averageExposurePct.toFixed(1)}%`,
        String(result.triggers),
        result.triggers === 0 ? "-" : result.hitRatePct.toFixed(0),
        result.medianDaysToTrough === null ? "-" : String(result.medianDaysToTrough),
        result.medianRemainingDropPct === null ? "-" : `${result.medianRemainingDropPct.toFixed(1)}%`,
        `${result.costDragPct.toFixed(1)}%`,
      ]),
      ["l", "r", "r", "r", "r", "r", "r", "r", "r", "r"],
    ),
  );
}

const averageGridExposure = grids.reduce((s, r) => s + r.averageExposurePct, 0) / grids.length;
const controls = [100, 70, 50, 30].map((exposure) => simulateStatic(eth, backtestStart, exposure));
if (!asJson) {
  console.log("\nControls — the test the timing has to beat:");
  console.log(
    table(
      ["strategy", "total ret", "max DD", "ret/|DD|", "avg exposure"],
      controls.map((result) => [
        `static ${result.averageExposurePct.toFixed(0)}%`,
        `${fmt(result.totalReturnPct, 1)}%`,
        `${result.maxDrawdownPct.toFixed(1)}%`,
        result.returnOverMaxDrawdown.toFixed(2),
        `${result.averageExposurePct.toFixed(1)}%`,
      ]),
      ["l", "r", "r", "r", "r"],
    ),
  );
  console.log(`\nMean average exposure across the grid: ${averageGridExposure.toFixed(1)}%`);
}

// ---------------------------------------------------------------- 8. edge cases

section("8. Where the rule fails");

const singleDayWindows = ["2020-03-12", "2021-05-19", "2024-08-05"];
const edgeRows: string[][] = [];
for (const date of singleDayWindows) {
  const index = eth.findIndex((bar) => bar.date === date);
  if (index < 0) continue;
  const scoreBefore = scores[index - 1];
  const oneDay = ((eth[index].close / eth[index - 1].close - 1) * 100).toFixed(1);
  const lowVsPrevClose = ((eth[index].low / eth[index - 1].close - 1) * 100).toFixed(1);
  edgeRows.push([
    date,
    `${oneDay}%`,
    `${lowVsPrevClose}%`,
    scoreBefore === null ? "n/a" : scoreBefore.toFixed(1),
    scoreBefore !== null && scoreBefore > 80 ? "fired" : "MISSED",
  ]);
}
if (!asJson) {
  console.log(
    table(
      ["session", "close-to-close", "worst intraday", "score the day before", "theta=80"],
      edgeRows,
      ["l", "r", "r", "r", "l"],
    ),
  );
  console.log("A daily close-based rule cannot act inside a session that gaps. This is a horizon limit, not a parameter problem.");
}

const whipsawRows: string[][] = [];
for (const result of grids.filter((r) => r.triggers > 0)) {
  const falseTriggers = result.triggers - result.triggerList.filter((t) => t.wasCrash).length;
  whipsawRows.push([
    result.label,
    String(result.triggers),
    String(falseTriggers),
    `${((falseTriggers / result.triggers) * 100).toFixed(0)}%`,
    `${result.costDragPct.toFixed(1)}%`,
  ]);
}
if (!asJson) {
  console.log("\nWhipsaw cost — triggers that were not followed by a crash:");
  console.log(
    table(["theta/d", "triggers", "false", "false %", "total cost drag"], whipsawRows.slice(0, 10), ["l", "r", "r", "r", "r"]),
  );
}

// ---------------------------------------------------------------- 9. cross-market

section("9. Cross-market check — the same method on Chinese small caps");

const cniBars = cn.series["CNI2000_国证2000"].bars.map(([date, open, high, low, close, volume]) => ({
  date,
  open,
  high,
  low,
  close,
  volume,
}));
const csiBars = cn.series["CSI1000_中证1000"].bars.map(([date, open, high, low, close, volume]) => ({
  date,
  open,
  high,
  low,
  close,
  volume,
}));

function walkForward(bars: DailyBar[], fromYear: number) {
  const featureMatrix = buildRankedFeatures(bars);
  const barLabels = bars.map((_, i) => labelCrash(bars, i));
  const usable = featureMatrix.map((v, i) => (v && barLabels[i] ? i : -1)).filter((i) => i >= 0);
  const out: (number | null)[] = new Array(bars.length).fill(null);
  for (let year = fromYear; year <= 2026; year += 1) {
    const cutoff = `${year}-01-01`;
    const train = usable.filter((i) => bars[i].date < cutoff);
    if (train.length < 120) continue;
    const x = train.map((i) => FEATURE_KEYS.map((k) => (featureMatrix[i] as FeatureVector)[k] / 100));
    const y = train.map((i) => (barLabels[i]?.isCrash ? 1 : 0));
    const model = fitLogistic(x, y, SPEC.ridge);
    for (let i = 0; i < bars.length; i += 1) {
      if (bars[i].date < cutoff || bars[i].date >= `${year + 1}-01-01`) continue;
      if (!featureMatrix[i]) continue;
      out[i] = predictLogistic(model, FEATURE_KEYS.map((k) => (featureMatrix[i] as FeatureVector)[k] / 100));
    }
  }
  const scoreSeries: (number | null)[] = new Array(bars.length).fill(null);
  for (let i = 0; i < bars.length; i += 1) {
    if (out[i] === null) continue;
    const history: number[] = [];
    for (let k = 0; k <= i; k += 1) if (out[k] !== null) history.push(out[k] as number);
    scoreSeries[i] = expandingPercentile(history, history.length - 1, SPEC.minHistory);
  }
  return { scoreSeries, barLabels };
}

const cniModel = walkForward(cniBars, 2016);
const cniScored = cniModel.scoreSeries.map((v, i) => (v !== null && cniModel.barLabels[i] ? i : -1)).filter((i) => i >= 0);
const cniAuc = rocAuc(
  cniScored.map((i) => cniModel.scoreSeries[i] as number),
  cniScored.map((i) => (cniModel.barLabels[i]?.isCrash ? 1 : 0)),
);

const cniStart = cniModel.scoreSeries.findIndex((v) => v !== null);
const cniBacktest = simulateDeRisk(
  cniBars,
  cniModel.scoreSeries,
  { label: "80/30", scoreThreshold: 80, deRiskPct: 30, recoveryDays: SPEC.recoveryDays, recoveryMargin: SPEC.recoveryMargin, tradeCostPct: SPEC.tradeCostPct },
  cniStart,
);
const cniBuyHold = simulateStatic(cniBars, cniStart, 100);

const crashWindow = cniBars.map((bar, i) => (bar.date >= "2024-01-01" && bar.date <= "2024-03-15" ? i : -1)).filter((i) => i >= 0);
const windowStart = crashWindow[0];
const windowEnd = crashWindow[crashWindow.length - 1];
const windowRows = crashWindow
  .filter((i) => cniModel.scoreSeries[i] !== null)
  .map((i) => [cniBars[i].date, cniModel.scoreSeries[i]!.toFixed(1), cniBars[i].close.toFixed(0)]);

if (!asJson) {
  console.log(`国证2000 (CNI2000) walk-forward out-of-sample AUC: ${cniAuc.toFixed(3)}`);
  console.log(
    `Replaying theta=80 / d=30 on 国证2000 from ${cniBars[cniStart].date}:\n` +
      table(
        ["strategy", "total ret", "max DD", "triggers", "hit %", "med drop left"],
        [
          [
            "de-risk rule",
            `${fmt(cniBacktest.totalReturnPct, 1)}%`,
            `${cniBacktest.maxDrawdownPct.toFixed(1)}%`,
            String(cniBacktest.triggers),
            cniBacktest.triggers ? cniBacktest.hitRatePct.toFixed(0) : "-",
            cniBacktest.medianRemainingDropPct === null ? "-" : `${cniBacktest.medianRemainingDropPct.toFixed(1)}%`,
          ],
          ["buy & hold", `${fmt(cniBuyHold.totalReturnPct, 1)}%`, `${cniBuyHold.maxDrawdownPct.toFixed(1)}%`, "0", "-", "-"],
        ],
        ["l", "r", "r", "r", "r", "r"],
      ),
  );

  console.log(`\nThe February 2024 small-cap squeeze, day by day (score / index level):`);
  const compact = windowRows.map((row) => `${row[0].slice(5)} ${row[1]}/${row[2]}`);
  for (let i = 0; i < compact.length; i += 4) console.log("  " + compact.slice(i, i + 4).join("   "));

  const csiWindow = csiBars.filter((bar) => bar.date >= "2024-01-02" && bar.date <= "2024-02-23");
  const cniWindow = cniBars.filter((bar) => bar.date >= "2024-01-02" && bar.date <= "2024-02-23");
  if (csiWindow.length > 1 && cniWindow.length > 1) {
    const csiMove = (csiWindow[csiWindow.length - 1].close / csiWindow[0].close - 1) * 100;
    const cniMove = (cniWindow[cniWindow.length - 1].close / cniWindow[0].close - 1) * 100;
    console.log(
      `\n2024-01-02 .. 2024-02-23: 中证1000 ${fmt(csiMove, 1)}%  vs  国证2000 ${fmt(cniMove, 1)}%.`,
    );
    console.log("A rule that reads one price series cannot see a cross-sectional divergence like this.");
  }
}

// ---------------------------------------------------------------- 10. recommendation

section("10. Recommended thresholds");

const scoredGrids = grids.filter((result) => result.triggers >= 3);
const bestByDrawdown = [...scoredGrids].sort((a, b) => b.maxDrawdownPct - a.maxDrawdownPct)[0];
const current = grids.find((result) => result.label === "80/30") as BacktestResult;
const bestByCalmar = [...scoredGrids].sort((a, b) => b.returnOverMaxDrawdown - a.returnOverMaxDrawdown)[0];

const equalExposureControl = simulateStatic(eth, backtestStart, Math.round(averageGridExposure));

if (!asJson) {
  console.log(
    table(
      ["candidate", "total ret", "max DD", "ret/|DD|", "triggers", "hit %"],
      [
        ["buy & hold 100%", `${fmt(buyHold.totalReturnPct, 1)}%`, `${buyHold.maxDrawdownPct.toFixed(1)}%`, buyHold.returnOverMaxDrawdown.toFixed(2), "0", "-"],
        ["current 80/30", `${fmt(current.totalReturnPct, 1)}%`, `${current.maxDrawdownPct.toFixed(1)}%`, current.returnOverMaxDrawdown.toFixed(2), String(current.triggers), current.triggers ? current.hitRatePct.toFixed(0) : "-"],
        [`best drawdown ${bestByDrawdown.label}`, `${fmt(bestByDrawdown.totalReturnPct, 1)}%`, `${bestByDrawdown.maxDrawdownPct.toFixed(1)}%`, bestByDrawdown.returnOverMaxDrawdown.toFixed(2), String(bestByDrawdown.triggers), bestByDrawdown.triggers ? bestByDrawdown.hitRatePct.toFixed(0) : "-"],
        [`best calmar ${bestByCalmar.label}`, `${fmt(bestByCalmar.totalReturnPct, 1)}%`, `${bestByCalmar.maxDrawdownPct.toFixed(1)}%`, bestByCalmar.returnOverMaxDrawdown.toFixed(2), String(bestByCalmar.triggers), bestByCalmar.triggers ? bestByCalmar.hitRatePct.toFixed(0) : "-"],
        [`static ${equalExposureControl.averageExposurePct}% control`, `${fmt(equalExposureControl.totalReturnPct, 1)}%`, `${equalExposureControl.maxDrawdownPct.toFixed(1)}%`, equalExposureControl.returnOverMaxDrawdown.toFixed(2), "0", "-"],
      ],
      ["l", "r", "r", "r", "r", "r"],
    ),
  );
}

// ---------------------------------------------------------------- 11. graded exposure

section("11. Graded exposure — is a ramp better than an on/off switch?");

type GradedVariant = {
  spec: ScheduleSpec;
  recoveryLevel: number;
  rebalanceBandPct: number;
  note: string;
};

const gradedVariants: GradedVariant[] = [
  {
    spec: { kind: "step", label: "fixed 80/-30 (shipped)", threshold: 80, cutPct: 30 },
    recoveryLevel: 80 - SPEC.recoveryMargin,
    rebalanceBandPct: 0,
    note: "binary switch, identical to the rule in production",
  },
  {
    spec: { kind: "linear", label: "linear 60..95 -50", lo: 60, hi: 95, maxCutPct: 50 },
    recoveryLevel: 60,
    rebalanceBandPct: 5,
    note: "1.43 points of cut per score point above 60",
  },
  {
    spec: { kind: "linear", label: "linear 70..90 -40", lo: 70, hi: 90, maxCutPct: 40 },
    recoveryLevel: 70,
    rebalanceBandPct: 5,
    note: "narrower band, 2 points of cut per score point",
  },
  {
    spec: {
      kind: "bands",
      label: "bands 70/80/90 -> 10/25/40",
      bands: [
        { from: 70, cutPct: 10 },
        { from: 80, cutPct: 25 },
        { from: 90, cutPct: 40 },
      ],
    },
    recoveryLevel: 70,
    rebalanceBandPct: 5,
    note: "three steps, still auditable by hand",
  },
  {
    spec: { kind: "power", label: "convex 60..95 -50 (^2)", lo: 60, hi: 95, maxCutPct: 50, exponent: 2 },
    recoveryLevel: 60,
    rebalanceBandPct: 5,
    note: "sits nearly fully invested until the score is extreme",
  },
  {
    spec: {
      kind: "bands",
      label: "tail bands 80/92 -> 30/50",
      bands: [
        { from: 80, cutPct: 30 },
        { from: 92, cutPct: 50 },
      ],
    },
    recoveryLevel: 70,
    rebalanceBandPct: 5,
    note: "same first step as shipped, escalates only in the extreme tail",
  },
];

type GradedRow = {
  variant: GradedVariant;
  result: GradedResult;
  matched: BacktestResult;
  deltaReturnVsMatched: number;
  deltaCalmarVsMatched: number;
};

const gradedRows: GradedRow[] = gradedVariants.map((variant) => {
  const config: GradedConfig = {
    label: variant.spec.label,
    tradeCostPct: SPEC.tradeCostPct,
    rebalanceBandPct: variant.rebalanceBandPct,
    recoveryDays: SPEC.recoveryDays,
    recoveryLevel: variant.recoveryLevel,
  };
  const result = simulateGraded(eth, scores, variant.spec, config, backtestStart);
  // The honest control: the same average exposure held passively. Without this
  // column a lower-exposure variant always looks like a better decision.
  const matched = simulateStatic(eth, backtestStart, Math.round(result.averageExposurePct));
  return {
    variant,
    result,
    matched,
    deltaReturnVsMatched: result.totalReturnPct - matched.totalReturnPct,
    deltaCalmarVsMatched: result.returnOverMaxDrawdown - matched.returnOverMaxDrawdown,
  };
});

const gradedBaseline = gradedRows[0];
const baselineMatchesShipped =
  Math.abs(gradedBaseline.result.totalReturnPct - current.totalReturnPct) < 1e-9 &&
  Math.abs(gradedBaseline.result.maxDrawdownPct - current.maxDrawdownPct) < 1e-9 &&
  gradedBaseline.result.downSwitches === current.triggers;

const gradedExposureControlDelta =
  gradedRows.slice(1).reduce((sum, row) => sum + row.deltaReturnVsMatched, 0) / (gradedRows.length - 1);
const bestGradedByCalmar = [...gradedRows].sort(
  (a, b) => b.result.returnOverMaxDrawdown - a.result.returnOverMaxDrawdown,
)[0];
const bestGradedVsMatched = [...gradedRows].sort((a, b) => b.deltaReturnVsMatched - a.deltaReturnVsMatched)[0];

if (!asJson) {
  const shippedCalmar = gradedBaseline.result.returnOverMaxDrawdown;
  console.log("A. Graded vs the shipped step rule — same data, same cost, same recovery gate:\n");
  console.log(
    table(
      ["schedule", "total ret", "max DD", "ret/|DD|", "vs shipped", "avg exp", "down", "up", "switch/yr", "cost drag"],
      gradedRows.map((row) => [
        row.variant.spec.label,
        `${fmt(row.result.totalReturnPct, 1)}%`,
        `${row.result.maxDrawdownPct.toFixed(1)}%`,
        row.result.returnOverMaxDrawdown.toFixed(2),
        fmt(row.result.returnOverMaxDrawdown - shippedCalmar, 2),
        `${row.result.averageExposurePct.toFixed(1)}%`,
        String(row.result.downSwitches),
        String(row.result.upSwitches),
        (row.result.switches / (row.result.days / 365)).toFixed(1),
        `${row.result.costDragPct.toFixed(2)}%`,
      ]),
      ["l", "r", "r", "r", "r", "r", "r", "r", "r", "r"],
    ),
  );
  const stepRow = gradedRows[0];
  console.log(
    `\nThe shipped step rule reproduces the 80/30 grid point exactly: ` +
      `${baselineMatchesShipped ? "yes" : "NO"} ` +
      `(ret ${stepRow.result.totalReturnPct.toFixed(3)} vs ${current.totalReturnPct.toFixed(3)}, ` +
      `down-switches ${stepRow.result.downSwitches} vs triggers ${current.triggers}).`,
  );

  console.log(
    "\nB. Does an active rule beat a PASSIVE hold at the same average exposure?\n" +
      "   This separates 'better timing' from 'just holding less'. Without this column a\n" +
      "   lower-exposure variant always looks like a better decision.",
  );
  console.log(
    table(
      ["schedule", "avg exp", "matched static ret", "active ret", "vs matched", "verdict"],
      gradedRows.map((row) => [
        row.variant.spec.label,
        `${row.result.averageExposurePct.toFixed(1)}%`,
        `${fmt(row.matched.totalReturnPct, 1)}%`,
        `${fmt(row.result.totalReturnPct, 1)}%`,
        `${fmt(row.deltaReturnVsMatched, 1)}%`,
        row.deltaReturnVsMatched > 0 ? "timing helps" : "timing hurts",
      ]),
      ["l", "r", "r", "r", "r", "l"],
    ),
  );
  console.log(
    "\nExposure path and churn:",
  );
  console.log(
    table(
      ["schedule", "days <70% exp", "min exp", "max exp", "edge vs matched", "note"],
      gradedRows.map((row) => [
        row.variant.spec.label,
        String(row.result.daysBelowSeventyPct),
        `${row.result.minExposurePct.toFixed(0)}%`,
        `${row.result.maxExposurePct.toFixed(0)}%`,
        `${fmt(row.deltaReturnVsMatched, 1)}%`,
        row.variant.note,
      ]),
      ["l", "r", "r", "r", "r", "l"],
    ),
  );

  console.log(
    `\nBest shape by return/drawdown: ${bestGradedByCalmar.variant.spec.label} ` +
      `(${bestGradedByCalmar.result.returnOverMaxDrawdown.toFixed(2)} vs shipped ${shippedCalmar.toFixed(2)}, ` +
      `${fmt(bestGradedByCalmar.result.returnOverMaxDrawdown - shippedCalmar, 2)}).`,
  );
  console.log(
    `Mean edge of a graded shape over its matched control: ${fmt(gradedExposureControlDelta, 1)}% — ` +
      `${gradedExposureControlDelta > 0 ? "the shape adds something beyond being out of the market" : "the shape adds NOTHING beyond being out of the market"}.`,
  );
  const gapProbe = ["2020-03-12", "2021-05-19", "2024-08-05"].map((date) => {
    const index = eth.findIndex((bar) => bar.date === date);
    const before = index > 0 ? scores[index - 1] : null;
    if (before === null) return `${date}: n/a`;
    const cuts = gradedVariants
      .map((variant) => `${variant.spec.label.split(" ")[0]} ${scheduleCutPct(variant.spec, before).toFixed(0)}`)
      .join(" / ");
    return `${date} score ${before.toFixed(1)} -> cut pts: ${cuts}`;
  });
  console.log("\nGap days are untouched by any shape — the score the day before was simply low:");
  for (const line of gapProbe) console.log(`  ${line}`);
}

// ---------------------------------------------------------------- output

const results = {
  generatedFrom: {
    primaryDataset: ethFile.source,
    instrument: ethFile.instrument,
    coverage: ethFile.coverage,
    fetchedAt: ethFile.fetchedAt,
    crossVenueReturnCorrelation: Number(crossCorr.toFixed(4)),
    crossVenueMaxReturnGapPoints: Number((maxDiff * 100).toFixed(2)),
  },
  spec: SPEC,
  events: ethEvents.length,
  crashEvents: ethEvents.map((event) => ({
    triggerDate: eth[event.startIndex].date,
    troughDate: eth[event.troughIndex].date,
    dropPct: Number(event.dropPct.toFixed(2)),
  })),
  walkForward: coefficients.map((row) => ({
    testYear: row.testYear,
    trainSamples: row.trainSamples,
    trainCrashRatePct: Number(row.trainCrashRatePct.toFixed(3)),
    inSampleAuc: Number(row.inSampleAuc.toFixed(4)),
    converged: row.converged,
  })),
  pooledOutOfSampleAuc: Number(pooledAuc.toFixed(4)),
  scoredDays: scoredIndices.length,
  baseRatePct: Number((baseRate * 100).toFixed(3)),
  scoreBuckets: bucketRows.map((row) => ({
    range: row.range,
    days: row.samples,
    crashRatePct: Number(row.crashRatePct.toFixed(3)),
    liftVsBase: Number(row.liftVsBase.toFixed(3)),
  })),
  backtestWindow: { from: eth[backtestStart].date, to: eth[eth.length - 1].date, days: buyHold.days },
  buyHold: {
    totalReturnPct: Number(buyHold.totalReturnPct.toFixed(3)),
    maxDrawdownPct: Number(buyHold.maxDrawdownPct.toFixed(3)),
  },
  grid: grids.map((result) => ({
    label: result.label,
    totalReturnPct: Number(result.totalReturnPct.toFixed(3)),
    maxDrawdownPct: Number(result.maxDrawdownPct.toFixed(3)),
    returnOverMaxDrawdown: Number(result.returnOverMaxDrawdown.toFixed(3)),
    averageExposurePct: Number(result.averageExposurePct.toFixed(3)),
    triggers: result.triggers,
    hitRatePct: Number(result.hitRatePct.toFixed(3)),
    medianDaysToTrough: result.medianDaysToTrough,
    medianRemainingDropPct: result.medianRemainingDropPct === null ? null : Number(result.medianRemainingDropPct.toFixed(3)),
    costDragPct: Number(result.costDragPct.toFixed(3)),
  })),
  controls: controls.map((result) => ({
    exposurePct: result.averageExposurePct,
    totalReturnPct: Number(result.totalReturnPct.toFixed(3)),
    maxDrawdownPct: Number(result.maxDrawdownPct.toFixed(3)),
  })),
  sameExposureControl: {
    exposurePct: equalExposureControl.averageExposurePct,
    totalReturnPct: Number(equalExposureControl.totalReturnPct.toFixed(3)),
    maxDrawdownPct: Number(equalExposureControl.maxDrawdownPct.toFixed(3)),
  },
  selected: {
    currentThresholds: { minRiskScore: 80, maxDeRiskPct: 30 },
    current: {
      totalReturnPct: Number(current.totalReturnPct.toFixed(3)),
      maxDrawdownPct: Number(current.maxDrawdownPct.toFixed(3)),
      triggers: current.triggers,
      hitRatePct: Number(current.hitRatePct.toFixed(3)),
    },
    bestByDrawdown: bestByDrawdown.label,
    bestByCalmar: bestByCalmar.label,
  },
  graded: {
    question: "does a graded (continuous) exposure response beat the shipped on/off switch?",
    control: "a passive hold at each schedule's own average exposure",
    rebalanceBandPctForGraded: 5,
    baselineReproducesShippedRule: baselineMatchesShipped,
    meanEdgeVsMatchedControlPct: Number(gradedExposureControlDelta.toFixed(3)),
    bestByCalmar: {
      label: bestGradedByCalmar.variant.spec.label,
      returnOverMaxDrawdown: Number(bestGradedByCalmar.result.returnOverMaxDrawdown.toFixed(3)),
    },
    bestVsMatchedControl: {
      label: bestGradedVsMatched.variant.spec.label,
      deltaReturnPct: Number(bestGradedVsMatched.deltaReturnVsMatched.toFixed(3)),
    },
    variants: gradedRows.map((row) => ({
      label: row.variant.spec.label,
      spec: row.variant.spec,
      recoveryLevel: row.variant.recoveryLevel,
      totalReturnPct: Number(row.result.totalReturnPct.toFixed(3)),
      maxDrawdownPct: Number(row.result.maxDrawdownPct.toFixed(3)),
      returnOverMaxDrawdown: Number(row.result.returnOverMaxDrawdown.toFixed(3)),
      averageExposurePct: Number(row.result.averageExposurePct.toFixed(3)),
      downSwitches: row.result.downSwitches,
      upSwitches: row.result.upSwitches,
      switches: row.result.switches,
      switchesPerYear: Number((row.result.switches / (row.result.days / 365)).toFixed(3)),
      costDragPct: Number(row.result.costDragPct.toFixed(3)),
      hitRatePct: Number(row.result.hitRatePct.toFixed(3)),
      minExposurePct: Number(row.result.minExposurePct.toFixed(3)),
      daysBelowSeventyPct: row.result.daysBelowSeventyPct,
      matchedStaticReturnPct: Number(row.matched.totalReturnPct.toFixed(3)),
      deltaReturnVsMatchedPct: Number(row.deltaReturnVsMatched.toFixed(3)),
      deltaCalmarVsMatched: Number(row.deltaCalmarVsMatched.toFixed(3)),
    })),
  },
  crossMarket: {
    series: "国证2000 (CNI2000)",
    outOfSampleAuc: Number(cniAuc.toFixed(4)),
    backtestFrom: cniBars[cniStart].date,
    strategy: {
      totalReturnPct: Number(cniBacktest.totalReturnPct.toFixed(3)),
      maxDrawdownPct: Number(cniBacktest.maxDrawdownPct.toFixed(3)),
      triggers: cniBacktest.triggers,
    },
    buyHold: {
      totalReturnPct: Number(cniBuyHold.totalReturnPct.toFixed(3)),
      maxDrawdownPct: Number(cniBuyHold.maxDrawdownPct.toFixed(3)),
    },
    feb2024Window: {
      from: cniBars[windowStart].date,
      to: cniBars[windowEnd].date,
      cniScorePath: windowRows.map((row) => ({ date: row[0], score: Number(row[1]) })),
    },
  },
};

writeFileSync(resolve(dataDir, "policy-calibration-results.json"), `${JSON.stringify(results, null, 1)}\n`);
if (!asJson) console.log(`\nWrote data/policy-calibration-results.json`);
else console.log(JSON.stringify(results, null, 1));
