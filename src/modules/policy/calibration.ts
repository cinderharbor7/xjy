/**
 * Policy threshold calibration — pure functions, no I/O.
 *
 * Everything here answers one question: where do the numbers in PolicyConfig
 * come from? The pipeline lives in `scripts/calibrate-policy.ts`, the frozen
 * rationale lives in `docs/policy-calibration.md`.
 *
 * Design rules that keep the result honest:
 *  1. No lookahead. Every feature at day `i` uses only bars with index <= i.
 *     Every percentile is an EXPANDING window that starts at the series head.
 *  2. One venue, one day boundary. Daily candles from different venues use
 *     different UTC day buckets, so mixing them is not a rounding error — it
 *     is a different measurement. Callers must pass a single-venue series.
 *  3. The score is a RANK, not a probability. A fitted crash probability sits
 *     near zero almost always, so `score > 80` is only meaningful when the
 *     score is a percentile of the model output over its own history.
 */

export type DailyBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export const FEATURE_KEYS = [
  "vol7",
  "volExpansion",
  "runup7",
  "ddFromHigh90",
  "distMA200",
  "volumeZ",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureVector = Record<FeatureKey, number>;

/** Pre-registered specification. Changing these invalidates the write-up. */
export const SPEC = {
  /** Forward window used to define a crash. */
  labelHorizon: 10,
  /** A crash is a fall of at least this much (close to close) inside the horizon. */
  labelThreshold: -0.15,
  /** Minimum observations before any percentile is emitted. */
  minHistory: 250,
  /** Ridge penalty used by the logistic fit (few labelled events, so shrink). */
  ridge: 1,
  volShort: 7,
  volLong: 30,
  highWindow: 90,
  trendWindow: 200,
  volumeWindow: 90,
  /** Round-trip execution cost in percent of traded notional, per switch. */
  tradeCostPct: 0.3,
  /** Recovery needs this many consecutive days below the recovery level. */
  recoveryDays: 3,
  /** Recovery level = threshold - this margin (avoids flapping at the edge). */
  recoveryMargin: 10,
} as const;

const EPS = 1e-12;

function mean(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mu = mean(values);
  let acc = 0;
  for (const value of values) acc += (value - mu) ** 2;
  return Math.sqrt(acc / (values.length - 1));
}

/** Share of the window that is <= value, as 0..100. Ties count as <=. */
export function percentileRank(window: readonly number[], value: number): number {
  if (window.length === 0) return 50;
  let count = 0;
  for (const item of window) if (item <= value) count += 1;
  return (count / window.length) * 100;
}

/**
 * Percentile of `values[i]` inside the expanding window `values[0..i]`.
 * Returns null until `minObs` observations exist. Never reads the future.
 */
export function expandingPercentile(
  values: readonly number[],
  i: number,
  minObs: number = SPEC.minHistory,
): number | null {
  if (i + 1 < minObs) return null;
  let count = 0;
  const current = values[i];
  for (let k = 0; k <= i; k += 1) if (values[k] <= current) count += 1;
  return (count / (i + 1)) * 100;
}

/** Daily log returns. `returns[i]` = log(close[i] / close[i-1]); index 0 is 0. */
export function logReturns(closes: readonly number[]): number[] {
  const out = new Array<number>(closes.length).fill(0);
  for (let i = 1; i < closes.length; i += 1) {
    out[i] = Math.log(closes[i] / closes[i - 1]);
  }
  return out;
}

/** Annualised realised volatility of the `window` returns ending at `i`. */
export function realisedVol(returns: readonly number[], i: number, window: number): number | null {
  if (i - window + 1 < 1) return null;
  const slice = returns.slice(i - window + 1, i + 1);
  return stdev(slice) * Math.sqrt(365) * 100;
}

/** Downside semi-deviation, annualised, in percent. */
export function downsideDeviation(returns: readonly number[], i: number, window: number): number | null {
  if (i - window + 1 < 1) return null;
  const slice = returns.slice(i - window + 1, i + 1);
  let acc = 0;
  for (const r of slice) acc += Math.min(r, 0) ** 2;
  return Math.sqrt(acc / slice.length) * Math.sqrt(365) * 100;
}

function windowMax(values: readonly number[], i: number, window: number): number | null {
  if (i - window + 1 < 0) return null;
  let best = Number.NEGATIVE_INFINITY;
  for (let k = i - window + 1; k <= i; k += 1) best = Math.max(best, values[k]);
  return best;
}

/**
 * Raw (un-ranked) feature matrix. Entries are null during warm-up.
 * These are the only inputs the score is allowed to see: price and volume of
 * one instrument, all observable at the close of day `i`.
 */
export function buildRawFeatures(bars: readonly DailyBar[]): Record<FeatureKey, (number | null)[]> {
  const closes = bars.map((bar) => bar.close);
  const volumes = bars.map((bar) => bar.volume);
  const returns = logReturns(closes);
  const n = bars.length;

  const out: Record<FeatureKey, (number | null)[]> = {
    vol7: new Array<number | null>(n).fill(null),
    volExpansion: new Array<number | null>(n).fill(null),
    runup7: new Array<number | null>(n).fill(null),
    ddFromHigh90: new Array<number | null>(n).fill(null),
    distMA200: new Array<number | null>(n).fill(null),
    volumeZ: new Array<number | null>(n).fill(null),
  };

  for (let i = 0; i < n; i += 1) {
    const short = realisedVol(returns, i, SPEC.volShort);
    const long = realisedVol(returns, i, SPEC.volLong);
    if (short !== null) out.vol7[i] = short;
    if (short !== null && long !== null && long > EPS) out.volExpansion[i] = short / long;

    if (i >= SPEC.volShort) out.runup7[i] = (closes[i] / closes[i - SPEC.volShort] - 1) * 100;

    const high = windowMax(closes, i, SPEC.highWindow);
    if (high !== null && high > EPS) out.ddFromHigh90[i] = (closes[i] / high - 1) * 100;

    if (i >= SPEC.trendWindow - 1) {
      const ma = mean(closes.slice(i - SPEC.trendWindow + 1, i + 1));
      if (ma > EPS) out.distMA200[i] = (closes[i] / ma - 1) * 100;
    }

    if (i >= SPEC.volumeWindow - 1) {
      const vol = volumes.slice(i - SPEC.volumeWindow + 1, i + 1);
      const sd = stdev(vol);
      if (sd > EPS) out.volumeZ[i] = (volumes[i] - mean(vol)) / sd;
    }
  }

  return out;
}

/** Feature matrix in expanding-percentile space (0..100). Null until warm. */
export function buildRankedFeatures(bars: readonly DailyBar[], minObs: number = SPEC.minHistory): (FeatureVector | null)[] {
  const raw = buildRawFeatures(bars);
  const n = bars.length;
  const out: (FeatureVector | null)[] = new Array<FeatureVector | null>(n).fill(null);

  for (let i = 0; i < n; i += 1) {
    const vector = {} as FeatureVector;
    let complete = true;
    for (const key of FEATURE_KEYS) {
      const series = raw[key];
      const value = series[i];
      if (value === null) {
        complete = false;
        break;
      }
      const history: number[] = [];
      for (let k = 0; k <= i; k += 1) {
        const past = series[k];
        if (past !== null) history.push(past);
      }
      vector[key] = expandingPercentile(history, history.length - 1, minObs) ?? 50;
    }
    if (complete) out[i] = vector;
  }

  return out;
}

export type CrashLabel = {
  isCrash: boolean;
  forwardMinClose: number;
  forwardReturnPct: number;
  troughIndex: number;
} | null;

/**
 * Forward-looking crash label. This is the ONLY function allowed to look
 * ahead, and it is used for labelling and evaluation — never as an input.
 */
export function labelCrash(
  bars: readonly DailyBar[],
  i: number,
  horizon: number = SPEC.labelHorizon,
  threshold: number = SPEC.labelThreshold,
): CrashLabel {
  if (i + horizon >= bars.length) return null;
  let minClose = Number.POSITIVE_INFINITY;
  let troughIndex = i + 1;
  for (let k = i + 1; k <= i + horizon; k += 1) {
    if (bars[k].close < minClose) {
      minClose = bars[k].close;
      troughIndex = k;
    }
  }
  const forwardReturn = minClose / bars[i].close - 1;
  return {
    isCrash: forwardReturn <= threshold,
    forwardMinClose: minClose,
    forwardReturnPct: forwardReturn * 100,
    troughIndex,
  };
}

export type CrashEvent = { startIndex: number; troughIndex: number; dropPct: number };

/**
 * Distinct crash events. Consecutive trigger days collapse into one event so
 * a single prolonged sell-off is not counted many times.
 */
export function findCrashEvents(bars: readonly DailyBar[]): CrashEvent[] {
  const events: CrashEvent[] = [];
  let lastTrough = -1;
  for (let i = 0; i < bars.length; i += 1) {
    const label = labelCrash(bars, i);
    if (!label || !label.isCrash) continue;
    if (i <= lastTrough) continue;
    events.push({ startIndex: i, troughIndex: label.troughIndex, dropPct: label.forwardReturnPct });
    lastTrough = label.troughIndex;
  }
  return events;
}

// ---------------------------------------------------------------- logistic

export type LogisticModel = {
  weights: number[];
  intercept: number;
  iterations: number;
  converged: boolean;
};

/** Gaussian elimination with partial pivoting. Returns null if singular. */
export function solveLinearSystem(matrix: number[][], rhs: readonly number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, index) => [...row, rhs[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let acc = a[row][n];
    for (let col = row + 1; col < n; col += 1) acc -= a[row][col] * solution[col];
    solution[row] = acc / a[row][row];
  }
  return solution;
}

/**
 * Ridge-regularised logistic regression by iteratively reweighted least
 * squares. The intercept is not penalised. Inputs are expected in 0..1.
 */
export function fitLogistic(
  x: readonly (readonly number[])[],
  y: readonly number[],
  ridge: number = SPEC.ridge,
): LogisticModel {
  const n = x.length;
  const k = x[0].length;
  const w = new Array<number>(k + 1).fill(0);
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < 60; iter += 1) {
    iterations = iter + 1;
    const gradient = new Array<number>(k + 1).fill(0);
    const hessian = Array.from({ length: k + 1 }, () => new Array<number>(k + 1).fill(0));

    for (let i = 0; i < n; i += 1) {
      let eta = w[0];
      for (let a = 0; a < k; a += 1) eta += w[a + 1] * x[i][a];
      const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, eta))));
      const weight = Math.max(p * (1 - p), 1e-6);
      const residual = y[i] - p;
      gradient[0] += residual;
      for (let a = 0; a < k; a += 1) gradient[a + 1] += residual * x[i][a];
      for (let a = 0; a <= k; a += 1) {
        const xa = a === 0 ? 1 : x[i][a - 1];
        for (let b = a; b <= k; b += 1) {
          const xb = b === 0 ? 1 : x[i][b - 1];
          hessian[a][b] += weight * xa * xb;
        }
      }
    }

    for (let a = 0; a <= k; a += 1) {
      if (a > 0) {
        gradient[a] -= ridge * w[a];
        hessian[a][a] += ridge;
      }
      for (let b = 0; b < a; b += 1) hessian[a][b] = hessian[b][a];
    }

    const delta = solveLinearSystem(hessian, gradient);
    if (!delta) break;
    let maxStep = 0;
    for (let a = 0; a <= k; a += 1) {
      w[a] += delta[a];
      maxStep = Math.max(maxStep, Math.abs(delta[a]));
    }
    if (maxStep < 1e-8) {
      converged = true;
      break;
    }
  }

  return { weights: w.slice(1), intercept: w[0], iterations, converged };
}

export function predictLogistic(model: LogisticModel, features: readonly number[]): number {
  let eta = model.intercept;
  for (let a = 0; a < features.length; a += 1) eta += model.weights[a] * features[a];
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, eta))));
}

/** Rank-based AUC with tie handling. Returns 0.5 when only one class exists. */
export function rocAuc(scores: readonly number[], labels: readonly number[]): number {
  const positives = labels.filter((value) => value === 1).length;
  const negatives = labels.length - positives;
  if (positives === 0 || negatives === 0) return 0.5;

  const order = scores.map((score, index) => ({ score, index })).sort((a, b) => a.score - b.score);
  const ranks = new Array<number>(scores.length).fill(0);
  let cursor = 0;
  while (cursor < order.length) {
    let end = cursor;
    while (end + 1 < order.length && order[end + 1].score === order[cursor].score) end += 1;
    const averageRank = (cursor + end) / 2 + 1;
    for (let k = cursor; k <= end; k += 1) ranks[order[k].index] = averageRank;
    cursor = end + 1;
  }

  let rankSum = 0;
  for (let i = 0; i < labels.length; i += 1) if (labels[i] === 1) rankSum += ranks[i];
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

// ---------------------------------------------------------------- backtest

export type DeRiskConfig = {
  label: string;
  /** Trigger when the risk score is strictly above this. Mirrors PolicyConfig. */
  scoreThreshold: number;
  /** Exposure reduction in percentage points of portfolio value. */
  deRiskPct: number;
  recoveryDays: number;
  recoveryMargin: number;
  /** Cost in percent of traded notional, charged on every switch. */
  tradeCostPct: number;
};

export type Trigger = {
  index: number;
  date: string;
  score: number;
  /** Realised drop from the trigger close to the lowest close in the next 20 days, in percent. */
  remainingDropPct: number;
  /** Trading days from the trigger to that low. */
  daysToTrough: number;
  /** Was a >=15% ten-day fall actually running at trigger time? */
  wasCrash: boolean;
};

export type BacktestResult = {
  label: string;
  startIndex: number;
  days: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  returnOverMaxDrawdown: number;
  averageExposurePct: number;
  triggers: number;
  hitRatePct: number;
  medianDaysToTrough: number | null;
  medianRemainingDropPct: number | null;
  costDragPct: number;
  equity: number[];
  triggerList: Trigger[];
};

export function maxDrawdown(equity: readonly number[]): number {
  let peak = equity[0];
  let worst = 0;
  for (const value of equity) {
    if (value > peak) peak = value;
    const drawdown = value / peak - 1;
    if (drawdown < worst) worst = drawdown;
  }
  return worst * 100;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Constant-weight control: does the timing add anything over a static haircut? */
export function simulateStatic(
  bars: readonly DailyBar[],
  startIndex: number,
  exposurePct: number,
): BacktestResult {
  const weight = exposurePct / 100;
  const equity: number[] = [1];
  for (let i = startIndex + 1; i < bars.length; i += 1) {
    const r = bars[i].close / bars[i - 1].close - 1;
    equity.push(equity[equity.length - 1] * (1 + weight * r));
  }
  const totalReturnPct = (equity[equity.length - 1] - 1) * 100;
  const maxDd = maxDrawdown(equity);
  return {
    label: `static ${exposurePct}% exposure`,
    startIndex,
    days: equity.length - 1,
    totalReturnPct,
    maxDrawdownPct: maxDd,
    returnOverMaxDrawdown: maxDd === 0 ? 0 : totalReturnPct / Math.abs(maxDd),
    averageExposurePct: exposurePct,
    triggers: 0,
    hitRatePct: 0,
    medianDaysToTrough: null,
    medianRemainingDropPct: null,
    costDragPct: 0,
    equity,
    triggerList: [],
  };
}

/**
 * The actual product behaviour, replayed on history.
 *
 * A trigger sells `deRiskPct` points of exposure and pays one execution cost.
 * Exposure only returns to full after `recoveryDays` consecutive closes below
 * `scoreThreshold - recoveryMargin` — mirroring the recovery gate in the
 * monitor. One position change per switch, exactly like "one event, one swap".
 */
export function simulateDeRisk(
  bars: readonly DailyBar[],
  scores: readonly (number | null)[],
  config: DeRiskConfig,
  startIndex: number,
): BacktestResult {
  const recoveryLevel = config.scoreThreshold - config.recoveryMargin;
  const targetFull = 1;
  const targetDerisked = 1 - config.deRiskPct / 100;

  let weight = targetFull;
  let derisked = false;
  let calmDays = 0;
  let costAccum = 0;
  let exposureSum = 0;
  let exposureCount = 0;

  const triggers: Trigger[] = [];
  const equity: number[] = [1];

  for (let i = startIndex + 1; i < bars.length; i += 1) {
    const r = bars[i].close / bars[i - 1].close - 1;
    equity.push(equity[equity.length - 1] * (1 + weight * r));
    exposureSum += weight;
    exposureCount += 1;

    const score = scores[i];
    if (score === null) continue;

    let target = weight;
    if (!derisked && score > config.scoreThreshold) {
      target = targetDerisked;
      derisked = true;
      calmDays = 0;

      let minClose = Number.POSITIVE_INFINITY;
      let trough = i;
      for (let k = i + 1; k <= Math.min(i + 20, bars.length - 1); k += 1) {
        if (bars[k].close < minClose) {
          minClose = bars[k].close;
          trough = k;
        }
      }
      const label = labelCrash(bars, i);
      triggers.push({
        index: i,
        date: bars[i].date,
        score,
        remainingDropPct: (minClose / bars[i].close - 1) * 100,
        daysToTrough: trough - i,
        wasCrash: label ? label.isCrash : false,
      });
    } else if (derisked) {
      calmDays = score <= recoveryLevel ? calmDays + 1 : 0;
      if (calmDays >= config.recoveryDays) {
        target = targetFull;
        derisked = false;
        calmDays = 0;
      }
    }

    if (target !== weight) {
      const turnover = Math.abs(target - weight);
      const cost = turnover * (config.tradeCostPct / 100);
      costAccum += cost;
      equity[equity.length - 1] *= 1 - cost;
      weight = target;
    }
  }

  const totalReturnPct = (equity[equity.length - 1] - 1) * 100;
  const maxDd = maxDrawdown(equity);
  const hits = triggers.filter((trigger) => trigger.wasCrash).length;

  return {
    label: config.label,
    startIndex,
    days: equity.length - 1,
    totalReturnPct,
    maxDrawdownPct: maxDd,
    returnOverMaxDrawdown: maxDd === 0 ? 0 : totalReturnPct / Math.abs(maxDd),
    averageExposurePct: exposureCount === 0 ? 100 : (exposureSum / exposureCount) * 100,
    triggers: triggers.length,
    hitRatePct: triggers.length === 0 ? 0 : (hits / triggers.length) * 100,
    medianDaysToTrough: median(triggers.map((trigger) => trigger.daysToTrough)),
    medianRemainingDropPct: median(triggers.map((trigger) => trigger.remainingDropPct)),
    costDragPct: costAccum * 100,
    equity,
    triggerList: triggers,
  };
}

// ---------------------------------------------------------------- graded exposure

/**
 * A pre-registered exposure schedule: risk score -> how much of the portfolio
 * stays in the RISK asset.
 *
 * This is deliberately DATA, not code. A schedule is serialisable, so the exact
 * shape that was tested can be written into the results file and diffed across
 * runs. `step` reproduces the shipped on/off rule exactly; every other kind is
 * a graded (continuous or multi-step) response.
 *
 * Nothing here changes WHEN an action is authorised. The schedule only answers
 * "how many points", and the caller still has to clamp the result by
 * `maxDeRiskPct` and pass it through the normal approval gate.
 */
export type ScheduleSpec =
  | { kind: "step"; label: string; threshold: number; cutPct: number }
  | { kind: "linear"; label: string; lo: number; hi: number; maxCutPct: number }
  | { kind: "power"; label: string; lo: number; hi: number; maxCutPct: number; exponent: number }
  | { kind: "bands"; label: string; bands: readonly { from: number; cutPct: number }[] };

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

/** Position of `score` inside `[lo, hi]`, as 0..1. Degenerate spans become a step. */
function spanPosition(lo: number, hi: number, score: number): number {
  if (hi - lo <= EPS) return score >= hi ? 1 : 0;
  return clampUnit((score - lo) / (hi - lo));
}

/** Exposure reduction in percentage points that the schedule asks for. */
export function scheduleCutPct(spec: ScheduleSpec, score: number): number {
  switch (spec.kind) {
    case "step":
      return score > spec.threshold ? spec.cutPct : 0;
    case "linear":
      return spanPosition(spec.lo, spec.hi, score) * spec.maxCutPct;
    case "power":
      return spanPosition(spec.lo, spec.hi, score) ** spec.exponent * spec.maxCutPct;
    case "bands": {
      let cut = 0;
      for (const band of spec.bands) if (score >= band.from) cut = band.cutPct;
      return cut;
    }
  }
}

/** Share of the portfolio (0..1) that stays in the RISK asset. */
export function scheduleExposure(spec: ScheduleSpec, score: number): number {
  return 1 - scheduleCutPct(spec, score) / 100;
}

export type GradedConfig = {
  label: string;
  /** Cost in percent of traded notional, charged on every switch. */
  tradeCostPct: number;
  /** Rebalance only when the schedule sits this many points away from live exposure. */
  rebalanceBandPct: number;
  /** Exposure may only RISE after this many consecutive scores at/below `recoveryLevel`. */
  recoveryDays: number;
  /** Calm level that unlocks re-risking. Fast down, slow up — same asymmetry as the shipped rule. */
  recoveryLevel: number;
};

export type Switch = {
  index: number;
  date: string;
  score: number;
  fromPct: number;
  toPct: number;
  direction: "down" | "up";
  wasCrash: boolean;
};

export type GradedResult = BacktestResult & {
  switches: number;
  downSwitches: number;
  upSwitches: number;
  minExposurePct: number;
  maxExposurePct: number;
  daysBelowSeventyPct: number;
  switchList: Switch[];
};

/**
 * Replay a graded exposure schedule on history.
 *
 * Ordering rules, identical to `simulateDeRisk` so the comparison is honest:
 *  - the day's return is earned at the exposure held BEFORE the decision;
 *  - reducing exposure happens at once, raising it waits for `recoveryDays`;
 *  - every switch pays `tradeCostPct` on the traded notional;
 *  - `rebalanceBandPct` suppresses trades the schedule itself would not notice.
 */
export function simulateGraded(
  bars: readonly DailyBar[],
  scores: readonly (number | null)[],
  spec: ScheduleSpec,
  config: GradedConfig,
  startIndex: number,
): GradedResult {
  const band = config.rebalanceBandPct / 100;

  let weight = 1;
  let calmDays = 0;
  let costAccum = 0;
  let exposureSum = 0;
  let exposureCount = 0;
  let minExposure = 1;
  let maxExposure = 1;
  let daysBelowSeventy = 0;

  const switches: Switch[] = [];
  const equity: number[] = [1];

  for (let i = startIndex + 1; i < bars.length; i += 1) {
    const r = bars[i].close / bars[i - 1].close - 1;
    equity.push(equity[equity.length - 1] * (1 + weight * r));
    exposureSum += weight;
    exposureCount += 1;
    if (weight < minExposure) minExposure = weight;
    if (weight > maxExposure) maxExposure = weight;
    if (weight < 0.7) daysBelowSeventy += 1;

    const score = scores[i];
    if (score === null) continue;

    calmDays = score <= config.recoveryLevel ? calmDays + 1 : 0;
    const desired = scheduleExposure(spec, score);

    let target = weight;
    if (desired < weight - band) {
      target = desired;
    } else if (desired > weight + band && calmDays >= config.recoveryDays) {
      target = desired;
    }

    if (target !== weight) {
      const turnover = Math.abs(target - weight);
      const cost = turnover * (config.tradeCostPct / 100);
      costAccum += cost;
      equity[equity.length - 1] *= 1 - cost;

      const label = labelCrash(bars, i);
      switches.push({
        index: i,
        date: bars[i].date,
        score,
        fromPct: weight * 100,
        toPct: target * 100,
        direction: target < weight ? "down" : "up",
        wasCrash: label ? label.isCrash : false,
      });
      weight = target;
    }
  }

  const downSwitches = switches.filter((entry) => entry.direction === "down");
  const triggers: Trigger[] = downSwitches.map((entry) => {
    let minClose = Number.POSITIVE_INFINITY;
    let trough = entry.index;
    for (let k = entry.index + 1; k <= Math.min(entry.index + 20, bars.length - 1); k += 1) {
      if (bars[k].close < minClose) {
        minClose = bars[k].close;
        trough = k;
      }
    }
    return {
      index: entry.index,
      date: entry.date,
      score: entry.score,
      remainingDropPct: (minClose / bars[entry.index].close - 1) * 100,
      daysToTrough: trough - entry.index,
      wasCrash: entry.wasCrash,
    };
  });

  const totalReturnPct = (equity[equity.length - 1] - 1) * 100;
  const maxDd = maxDrawdown(equity);
  const hits = triggers.filter((trigger) => trigger.wasCrash).length;

  return {
    label: config.label,
    startIndex,
    days: equity.length - 1,
    totalReturnPct,
    maxDrawdownPct: maxDd,
    returnOverMaxDrawdown: maxDd === 0 ? 0 : totalReturnPct / Math.abs(maxDd),
    averageExposurePct: exposureCount === 0 ? 100 : (exposureSum / exposureCount) * 100,
    triggers: triggers.length,
    hitRatePct: triggers.length === 0 ? 0 : (hits / triggers.length) * 100,
    medianDaysToTrough: median(triggers.map((trigger) => trigger.daysToTrough)),
    medianRemainingDropPct: median(triggers.map((trigger) => trigger.remainingDropPct)),
    costDragPct: costAccum * 100,
    equity,
    triggerList: triggers,
    switches: switches.length,
    downSwitches: downSwitches.length,
    upSwitches: switches.length - downSwitches.length,
    minExposurePct: minExposure * 100,
    maxExposurePct: maxExposure * 100,
    daysBelowSeventyPct: daysBelowSeventy,
    switchList: switches,
  };
}
