import { approximatelyEqual } from "@/domain/schemas";
import type { MarketState, PortfolioState } from "@/domain/types";

/**
 * Amount math for the real swap adapter.
 *
 * Every function here mirrors the pricing used by verifyRescueOutcome:
 * the market asset is priced at the market quote, everything else at the
 * snapshot's own usdValue/amount ratio. If these two ever disagree, an honest
 * execution would still fail independent verification, so the adapter must
 * derive its quantities from exactly this file.
 */

/** Total portfolio value at the same quotes verification will use. */
export function quotedPortfolioUsd(portfolio: PortfolioState, market: MarketState): number {
  return portfolio.assets.reduce(
    (total, asset) => total + (asset.symbol === market.asset ? asset.amount * market.priceUsd : asset.usdValue),
    0,
  );
}

/** Price of one unit of the source asset under the verification quote. Returns 0 when unpriceable. */
export function quotedSourcePrice(portfolio: PortfolioState, market: MarketState, sourceAsset: string): number {
  const source = portfolio.assets.find((asset) => asset.symbol === sourceAsset);
  if (!source || source.amount <= 0) return 0;
  return source.symbol === market.asset ? market.priceUsd : source.usdValue / source.amount;
}

/**
 * Source token amount that realises exactly `reduceExposurePct` percentage
 * points of the portfolio under the verification quote.
 *
 * Selling the entire balance is exact only when the approved points already
 * equal the full exposure; any leftover dust would break the exposure-points
 * check, so the full-balance shortcut is taken whenever it matches within the
 * same tolerance verification uses.
 */
export function computeApprovedSourceAmount(
  portfolio: PortfolioState, market: MarketState, sourceAsset: string, reduceExposurePct: number,
): number {
  const source = portfolio.assets.find((asset) => asset.symbol === sourceAsset);
  if (!source || source.amount <= 0) return Number.NaN;
  const totalUsd = quotedPortfolioUsd(portfolio, market);
  const sourcePrice = quotedSourcePrice(portfolio, market, sourceAsset);
  if (!Number.isFinite(totalUsd) || totalUsd <= 0 || !Number.isFinite(sourcePrice) || sourcePrice <= 0) {
    return Number.NaN;
  }
  const fullExposurePoints = source.amount * sourcePrice / totalUsd * 100;
  if (approximatelyEqual(fullExposurePoints, reduceExposurePct)) return source.amount;
  return totalUsd * (reduceExposurePct / 100) / sourcePrice;
}

/** Convert a human-readable amount into raw on-chain units at the token's decimals. */
export function toRawAmount(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(`Cannot convert amount ${amount} to raw units at ${decimals} decimals.`);
  }
  // toFixed rounds at the token's own precision; parsing that exact string back
  // avoids the >2^53 precision loss a naive amount * 10**decimals would incur.
  return BigInt(amount.toFixed(decimals).replace(".", ""));
}

/** Lower address becomes token0 in a Uniswap V2 pair; comparison is case-insensitive. */
export function isToken0(sourceAddress: string, targetAddress: string): boolean {
  return sourceAddress.toLowerCase() < targetAddress.toLowerCase();
}
