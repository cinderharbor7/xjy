/**
 * Transparent demo rules that turn A's frozen DEX sell-pressure signal
 * (OnchainSignalState) into a bounded risk contribution for B's risk score.
 * Deliberately legible constants, not a fitted model.
 */

/** A sell-pressure anomaly is measured as a multiple of the previous equal-length window. */
export const PRESSURE_SATURATION_RATIO = 3;

/** Most points the signal may add on top of the deterministic market/portfolio score. */
export const SELL_PRESSURE_UPLIFT_MAX = 30;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Anomaly ratio -> risk uplift in [0, SELL_PRESSURE_UPLIFT_MAX].
 * 1x (no anomaly) adds nothing; >= PRESSURE_SATURATION_RATIO adds the full uplift;
 * linear in between. The frozen signal contract guarantees a positive baseline.
 */
export function sellPressureUplift(anomalyRatio: number): number {
  return clamp((anomalyRatio - 1) / (PRESSURE_SATURATION_RATIO - 1), 0, 1) * SELL_PRESSURE_UPLIFT_MAX;
}
