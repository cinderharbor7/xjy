/**
 * Evidence-backed Policy thresholds.
 *
 * This module is deliberately INERT: nothing in the running product imports it.
 * It exists so the numbers in the write-up are machine-checkable rather than
 * prose. `tests/policy-calibration.test.ts` asserts that every value below
 * still matches `data/policy-calibration-results.json`, so a silent drift
 * between the document and the data fails the build.
 *
 * Full method, tables and limitations: docs/policy-calibration.md
 * Reproduce: pnpm exec tsx scripts/calibrate-policy.ts
 */

/** What `src/mocks/scenarios.ts` ships today. Kept here only for comparison. */
export const POLICY_THRESHOLDS_IN_USE = {
  minRiskScore: 80,
  minConfidence: 0.85,
  minRiskExposurePct: 70,
  maxDeRiskPct: 30,
} as const;

/**
 * Recommendation from the 2026-10-07 calibration.
 *
 * Only `minRiskScore` moves. It is a public configuration change and therefore
 * needs the four-way sign-off before it replaces POLICY_THRESHOLDS_IN_USE.
 * The demo path is unaffected either way: the demo risk score is 91, which
 * clears both 80 and 85.
 */
export const POLICY_THRESHOLDS_CALIBRATED = {
  minRiskScore: 85,
  minConfidence: 0.85,
  minRiskExposurePct: 70,
  maxDeRiskPct: 30,
} as const;

/**
 * Candidates the data does NOT support, and why. Recording rejected options is
 * part of the calibration, not an afterthought.
 */
export const REJECTED_CANDIDATES = [
  {
    candidate: "minRiskScore = 90",
    looksBetterBecause: "highest return/drawdown in the whole grid (+/- ret 18.14 vs 17.27 buy-and-hold)",
    rejectedBecause: "only 7 triggers in 7 years and a 0% hit rate; 7 samples cannot support a parameter choice",
  },
  {
    candidate: "maxDeRiskPct = 100",
    looksBetterBecause: "deepest drawdown reduction at every threshold",
    rejectedBecause: "cost drag scales with size (4.2% at theta=90) and Calmar falls below buy-and-hold at theta<=80",
  },
  {
    candidate: "minRiskScore = 60",
    looksBetterBecause: "most triggers, so it always looks busy",
    rejectedBecause: "95% of triggers were false and cost drag reached 24% at maxDeRiskPct=100",
  },
] as const;

/** Why `minConfidence` and `minRiskExposurePct` are untouched. */
export const NOT_CALIBRATED = [
  {
    field: "minConfidence",
    reason: "measures evidence support, not an observable market quantity; price history cannot identify it",
  },
  {
    field: "minRiskExposurePct",
    reason: "a risk-budget preference, not a market truth; the backtest only shows that a higher threshold buys thinner protection",
  },
] as const;

/**
 * The claims this calibration supports and, more importantly, the claims it
 * refutes. Anything user-facing must be consistent with `refuted`.
 */
export const CALIBRATION_CLAIMS = {
  supported: [
    "A score above 80 marks a top-20% risk reading whose 10-day conditional probability of a >=15% fall is 24.2%, 2.1x the 11.68% base rate.",
    "Raising the trigger to 85 cuts triggers from 20 to 12, lifts the hit rate from 10% to 33% and improves return/drawdown from 15.00 to 17.80.",
  ],
  refuted: [
    "The risk score does NOT predict crashes: pooled out-of-sample AUC is 0.524.",
    "The score is coincident, not leading: its dominant driver is distance below the 90-day high (normalised weight -0.379, sign stable across 8 yearly refits).",
    "It does NOT catch gap risk: the day before 2020-03-12 (-43.3%), 2021-05-19 (-27.6%) and 2024-08-05 (-10.0%) the score was 34.4 / 43.4 / 55.7, all below 80.",
    "A fast run-up does NOT raise measured crash risk: the fitted sign on the 7-day run-up is negative and stable (-0.144), the opposite of the rationale currently written in src/modules/eth-risk/risk-lab.ts.",
    "It does NOT transfer to crowded leveraged books: the same method scores AUC 0.802 on Chinese small caps yet the strategy loses 3.5% against a 4.9% buy-and-hold.",
  ],
} as const;

/**
 * Evidence on a GRADED exposure response — should the cut size ramp with the
 * score instead of switching on at one threshold?
 *
 * `ScheduleSpec` in `calibration.ts` expresses both, and the step schedule
 * reproduces `simulateDeRisk` bit for bit, so a ramp and the shipped rule are
 * measured on identical machinery (same cost, same recovery gate). The tests
 * assert that equivalence, so the comparison cannot drift.
 *
 * Answer from the 2026-10-07 calibration: a ramp does NOT help, and the
 * tail-escalating variant actively hurts.
 */
export const GRADED_EXPOSURE_EVIDENCE = {
  baselineReproducesShippedRule: true,
  bestShape: "bands 70/80/90 -> 10/25/40",
  bestShapeCalmar: 15.72,
  shippedCalmar: 15.0,
  bestShapeEdgeOverShipped: 0.72,
  bestShapeSwitchesPerYear: 15.1,
  shippedSwitchesPerYear: 5.6,
  bestShapeCostDragPct: 4.83,
  shippedCostDragPct: 3.6,
  /** Mean edge of the graded shapes over a passive hold at the SAME average exposure. */
  meanEdgeOverMatchedControlPct: -269.8,
  worstShape: "tail bands 80/92 -> 30/50",
  worstShapeCalmar: 12.88,
  worstShapeMaxDrawdownPct: -79.0,
} as const;

/**
 * Where a graded response is the right shape, and where it is not.
 * Anything user-facing must stay consistent with `refuted`.
 */
export const GRADED_EXPOSURE_CLAIMS = {
  supported: [
    "Grading is compatible with the trust model: the schedule only decides HOW MANY points, `maxDeRiskPct` still caps it and the approval gate still decides WHETHER. 'Analysis may be uncertain, authorisation must be exact' survives intact.",
    "The best graded shape — a wide-deadband three-band ladder (70/80/90 -> 10/25/40) — does beat the shipped step: return/drawdown 15.72 vs 15.00.",
  ],
  refuted: [
    "That win is marginal: +0.72 return/drawdown, bought with 15.1 switches per year instead of 5.6 and 4.83% cost drag instead of 3.60%.",
    "Fully continuous ramps are NOT an improvement. Every linear/convex form lands at 12.67-15.10 against the binary rule's 15.00, while churning up to 19.3 switches per year.",
    "Escalating the cut in the extreme tail is actively harmful: 80/92 -> 30/50 returns 1016.8% and posts the worst drawdown in the set (-79.0%).",
    "No shape earns its keep against a passive hold at its own average exposure: mean edge -269.8%. The apparent gain comes from holding less, not from timing better.",
    "Grading cannot fix a coincident score. Expressing a lagging signal more finely still leaves it lagging — the binding constraint is signal quality, not response shape.",
  ],
} as const;

export const CALIBRATION_PROVENANCE = {  calibratedAt: "2026-10-07",
  method: "walk-forward ridge logistic regression, expanding-percentile score, product-rule replay",
  dataset: {
    primary: "Coinbase Exchange ETH-USD daily, UTC day bucket",
    coverage: "2016-05-18 .. 2026-10-07",
    bars: 3793,
    crossVenueCheck:
      "OKX ETH-USDT daily commits to a different 24h bucket: same-date return correlation 0.324, largest same-date gap 39.68 points. Sources are never mixed.",
  },
  evaluation: {
    window: "2019-09-07 .. 2026-10-07",
    days: 2587,
    crashEvents: 99,
    baseRatePct: 11.68,
  },
  resultsFile: "data/policy-calibration-results.json",
  writeUp: "docs/policy-calibration.md",
} as const;
