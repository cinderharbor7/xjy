import { z } from "zod";
import { OnchainSignalStateSchema } from "@/domain/schemas";

const score = z.number().finite().min(0).max(100);
const confidence = z.number().finite().min(0).max(1);

export const RiskLabMetricSchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number().finite(),
  display: z.string().min(1),
  unit: z.string(),
  percentile: z.number().finite().min(0).max(100),
  state: z.enum(["ELEVATED", "WATCH", "NORMAL"]),
  direction: z.enum(["UP", "DOWN", "FLAT"]),
  rationale: z.string().min(1),
});

export const RiskLabModelSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  method: z.string().min(1),
  score,
  confidence,
  output: z.string().min(1),
  formula: z.string().min(1),
  inputs: z.array(z.string().min(1)).min(1),
  rationale: z.string().min(1),
  citation: z.string().min(1),
});

export const RiskLabSnapshotSchema = z.strictObject({
  asset: z.literal("ETH"),
  asOf: z.iso.datetime(),
  dataMode: z.enum(["MOCK_CHAIN_FIXTURE", "LIVE_CHAIN_READ"]),
  sourceNote: z.string().min(1),
  blockRange: z.strictObject({ from: z.number().int().positive(), to: z.number().int().positive() }),
  priceUsd: z.number().finite().positive(),
  metrics: z.array(RiskLabMetricSchema).min(1),
  models: z.array(RiskLabModelSchema).min(1),
  composite: z.strictObject({
    score,
    band: z.enum(["LOW", "WATCH", "HIGH", "CRITICAL"]),
    confidence,
    horizon: z.string().min(1),
    interpretation: z.string().min(1),
  }),
  recommendation: z.strictObject({
    stance: z.enum(["DEFENSIVE", "NEUTRAL", "RISK_ON"]),
    action: z.string().min(1),
    currentExposurePct: z.number().finite().min(0).max(100),
    targetExposurePct: z.number().finite().min(0).max(100),
    confidence,
    rationale: z.string().min(1),
  }),
  evidence: z.array(z.strictObject({
    label: z.string().min(1),
    value: z.string().min(1),
    source: z.string().min(1),
    status: z.enum(["OBSERVED", "DERIVED", "LIMITATION"]),
  })).min(1),
  curve: z.array(z.strictObject({ label: z.string().min(1), score })).min(1),
});

export type RiskLabSnapshot = z.infer<typeof RiskLabSnapshotSchema>;

const round = (value: number, digits = 1) => Number(value.toFixed(digits));
const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const hash = (char: string) => `0x${char.repeat(64)}`;

const dexSignal = OnchainSignalStateSchema.parse({
  signalType: "DEX_SELL_PRESSURE",
  asset: "ETH",
  windowStart: "2026-10-06T14:00:00.000Z",
  windowEnd: "2026-10-07T14:00:00.000Z",
  currentSellVolumeUsd: 194_000_000,
  baselineSellVolumeUsd: 100_000_000,
  anomalyRatio: 1.94,
  txCount: 42_080,
  uniqueWallets: 18_420,
  evidence: [
    { type: "BLOCK", blockNumber: 23_500_120, blockHash: hash("a"), description: "Window end block for the sell-pressure aggregate", source: "Ethereum mainnet fixture" },
    { type: "CONTRACT_EVENT", blockNumber: 23_500_118, txHash: hash("b"), contractAddress: "0x1111111111111111111111111111111111111111", description: "DEX swap event sample retained as an observation reference", source: "Ethereum mainnet fixture" },
  ],
});

function buildSnapshot(): RiskLabSnapshot {
  const priceUsd = 3_482;
  const priceChange24h = -4.8;
  const realizedVol = 72.4;
  const runup7d = 18.9;
  const leverageGrowth30d = 17.6;
  const stablecoinLiquidityGap = -8.2;
  const bubbleScore = 81;
  const exchangeInflowZ = 2.4;
  const currentExposurePct = 72;

  const metrics: z.infer<typeof RiskLabMetricSchema>[] = [
    { key: "sell-pressure", label: "DEX sell pressure", value: dexSignal.anomalyRatio, display: `${dexSignal.anomalyRatio.toFixed(2)}×`, unit: "vs previous 24h window", percentile: 91, state: "ELEVATED" as const, direction: "UP" as const, rationale: "Gross ETH sell volume is almost twice the previous-window baseline; this is the main short-horizon warning." },
    { key: "realized-vol", label: "Realized volatility", value: realizedVol, display: `${realizedVol.toFixed(1)}%`, unit: "7d annualized", percentile: 84, state: "ELEVATED" as const, direction: "UP" as const, rationale: "Higher volatility widens the left tail and makes the same liquidity shock more damaging." },
    { key: "runup", label: "Price run-up", value: runup7d, display: `+${runup7d.toFixed(1)}%`, unit: "7d", percentile: 79, state: "WATCH" as const, direction: "UP" as const, rationale: "A fast run-up raises crash probability without implying that the unconditional mean return must be negative." },
    { key: "leverage", label: "Leverage growth", value: leverageGrowth30d, display: `+${leverageGrowth30d.toFixed(1)}%`, unit: "30d open interest", percentile: 76, state: "WATCH" as const, direction: "UP" as const, rationale: "Accumulated leverage is a slower moving vulnerability that can turn a market shock into forced selling." },
    { key: "liquidity-gap", label: "Stablecoin liquidity gap", value: stablecoinLiquidityGap, display: `${stablecoinLiquidityGap.toFixed(1)}%`, unit: "vs 30d depth", percentile: 71, state: "WATCH" as const, direction: "DOWN" as const, rationale: "A negative depth gap means less exit capacity is available when sell pressure arrives." },
    { key: "bubble", label: "Explosive-dynamics proxy", value: bubbleScore, display: `${bubbleScore}/100`, unit: "GSADF proxy", percentile: 82, state: "ELEVATED" as const, direction: "UP" as const, rationale: "The proxy is above its illustrative critical region; it is a bubble-state input, not a crash timestamp." },
  ];

  const thresholdScore = round(clamp(0.35 * 91 + 0.2 * 84 + 0.2 * 76 + 0.15 * 71 + 0.1 * 82));
  const logitScore = round(clamp(50 + 1.7 * runup7d + 0.35 * (realizedVol - 50) + 8 * (dexSignal.anomalyRatio - 1) + 0.25 * leverageGrowth30d));
  const bubbleModelScore = round(clamp(bubbleScore * 0.72 + realizedVol * 0.18 + runup7d * 0.1));
  const regimeScore = round(clamp(45 + 18 * (dexSignal.anomalyRatio - 1) + 0.4 * realizedVol + 0.45 * Math.abs(stablecoinLiquidityGap)));
  const tailScore = round(clamp(50 + 0.9 * leverageGrowth30d + 0.55 * realizedVol + 5 * Math.abs(priceChange24h)));

  const models = [
    { id: "threshold", title: "Threshold early-warning", method: "KLR noise-to-signal screen", score: thresholdScore, confidence: 0.78, output: `${metrics.filter(metric => metric.state !== "NORMAL").length} / ${metrics.length} indicators at watch or elevated`, formula: "Warning = Σ wⱼ · I(xⱼ > cⱼ)", inputs: ["DEX sell-pressure ratio", "realized volatility", "leverage growth", "liquidity gap"], rationale: "The threshold layer is intentionally legible: it shows exactly which observable conditions are active and avoids hiding the trigger inside a black box.", citation: "Kaminsky (1998); Drehmann & Juselius (2014)" },
    { id: "logit", title: "Crash probability", method: "Rolling logistic model", score: logitScore, confidence: 0.68, output: "Illustrative probability: 31% for ≥12% drawdown in 10d (not fitted)", formula: "P(Crashₜ₊₁₀) = Λ(α + β′Xₜ)", inputs: ["7d run-up", "volatility", "sell pressure", "leverage growth"], rationale: "The score is a deterministic demo proxy. The displayed probability is an illustrative placeholder, not a fitted or out-of-sample estimate.", citation: "Chen, Hong & Stein (2001); Beutel et al. (2019)" },
    { id: "bubble", title: "Explosive price state", method: "GSADF-style proxy", score: bubbleModelScore, confidence: 0.61, output: "Bubble-state proxy: active", formula: "GSADF = supᵣ₁,ᵣ₂ ADFᵣ₁ᵣ₂", inputs: ["price run-up", "recursive right-tail statistic", "realized volatility"], rationale: "This model detects explosive dynamics; it is evidence of fragility and does not claim that a crash must happen immediately.", citation: "Phillips, Shi & Yu (2015)" },
    { id: "regime", title: "Liquidity regime", method: "State-dependent shock model", score: regimeScore, confidence: 0.72, output: "Illustrative fragile-regime probability: 74% (not fitted)", formula: "Return = αₛ + βₛ · LiquidityShock + ε", inputs: ["sell-pressure shock", "depth gap", "realized volatility"], rationale: "A sell shock has a larger expected loss in a fragile regime, so the same flow is not interpreted in isolation.", citation: "Acharya, Amihud & Bharath (2013); Jiang et al. (2022)" },
    { id: "tail", title: "Left-tail quantile", method: "Conditional 5% return estimate", score: tailScore, confidence: 0.65, output: "Illustrative q₀.₀₅(10d return): −14.8% (not fitted)", formula: "Q₀.₀₅(rₜ₊₁₀ | Xₜ) = α₀.₀₅ + β′₀.₀₅Xₜ", inputs: ["leverage expansion", "volatility", "price shock"], rationale: "The tail estimate focuses on the loss distribution rather than the average return, which is the decision variable for a defensive position.", citation: "Baron & Xiong (2017); Kalyvas (2020)" },
  ];

  const compositeScore = round(models.reduce((sum, model, index) => sum + model.score * [0.24, 0.25, 0.17, 0.19, 0.15][index], 0));
  const compositeConfidence = round(models.reduce((sum, model, index) => sum + model.confidence * [0.24, 0.25, 0.17, 0.19, 0.15][index], 0), 2);
  const band = compositeScore >= 80 ? "CRITICAL" : compositeScore >= 65 ? "HIGH" : compositeScore >= 45 ? "WATCH" : "LOW";

  return RiskLabSnapshotSchema.parse({
    asset: "ETH",
    asOf: "2026-10-07T14:00:00.000Z",
    dataMode: "MOCK_CHAIN_FIXTURE",
    sourceNote: "All values are deterministic demo observations shaped like Ethereum mainnet aggregates. No RPC, indexer, wallet, or transaction is called by this page.",
    blockRange: { from: 23_413_920, to: 23_500_120 },
    priceUsd,
    metrics,
    models,
    composite: {
      score: compositeScore,
      band,
      confidence: compositeConfidence,
      horizon: "next 7–14 days",
      interpretation: "Several independent layers agree that ETH is fragile: sell pressure and volatility are immediate, while leverage and explosive dynamics are slower structural warnings.",
    },
    recommendation: {
      stance: "DEFENSIVE",
      action: "Reduce ETH exposure by 20–30 percentage points; pause new leverage and keep a stablecoin liquidity buffer.",
      currentExposurePct,
      targetExposurePct: 45,
      confidence: compositeConfidence,
      rationale: "The recommendation is sized to the overlap of model signals, not to a single forecast. It is a risk budget suggestion and does not execute trades.",
    },
    evidence: [
      { label: "Sell-pressure window", value: `${dexSignal.currentSellVolumeUsd / 1_000_000}M USD · ${dexSignal.txCount.toLocaleString()} swaps · ${dexSignal.uniqueWallets.toLocaleString()} wallets`, source: "OnchainSignalState / DEX aggregate", status: "OBSERVED" },
      { label: "Block range", value: `${(23_413_920).toLocaleString()} → ${dexSignal.evidence[0].blockNumber.toLocaleString()}`, source: "Ethereum mainnet fixture", status: "OBSERVED" },
      { label: "Regression horizon", value: "10d crash event and 7–14d risk budget", source: "Model design derived from cited papers", status: "DERIVED" },
      { label: "Known limitation", value: "Synthetic fixture; no live chain refresh or fitted standard errors", source: "Demo disclosure", status: "LIMITATION" },
    ],
    curve: [
      { label: "Normal", score: 28 },
      { label: "Watch", score: 48 },
      { label: "Current", score: compositeScore },
      { label: "Stress", score: clamp(compositeScore + 15) },
    ],
  });
}

export function getRiskLabSnapshot() {
  return buildSnapshot();
}
