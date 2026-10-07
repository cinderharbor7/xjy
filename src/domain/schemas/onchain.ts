import { z } from "zod";

const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const evidenceFields = {
  txHash: hash.optional(),
  blockHash: hash.optional(),
  blockNumber: count,
  contractAddress: address.optional(),
  description: z.string().trim().min(1),
  source: z.string().trim().min(1),
};

/** References to observations, not execution permissions or proof of authenticity. */
export const OnchainEvidenceSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...evidenceFields, type: z.literal("TRANSACTION"), txHash: hash }),
  z.strictObject({ ...evidenceFields, type: z.literal("BLOCK"), blockHash: hash }),
  z.strictObject({ ...evidenceFields, type: z.literal("CONTRACT_EVENT"), txHash: hash, contractAddress: address }),
]);

/** A produces ETH gross-sell observations; B consumes this stable data contract. */
export const OnchainSignalStateSchema = z.strictObject({
  signalType: z.literal("DEX_SELL_PRESSURE"),
  asset: z.literal("ETH"),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  currentSellVolumeUsd: z.number().finite().nonnegative(),
  baselineSellVolumeUsd: z.number().finite().positive(),
  anomalyRatio: z.number().finite().nonnegative(),
  txCount: count,
  uniqueWallets: count,
  evidence: z.array(OnchainEvidenceSchema),
}).superRefine((signal, context) => {
  if (Date.parse(signal.windowStart) >= Date.parse(signal.windowEnd)) {
    context.addIssue({ code: "custom", path: ["windowEnd"], message: "The UTC observation window must have a positive duration: [start, end)." });
  }
  const expectedRatio = signal.currentSellVolumeUsd / signal.baselineSellVolumeUsd;
  if (!Number.isFinite(expectedRatio)
    || Math.abs(signal.anomalyRatio - expectedRatio) > 1e-9 * Math.max(1, Math.abs(signal.anomalyRatio), Math.abs(expectedRatio))) {
    context.addIssue({ code: "custom", path: ["anomalyRatio"], message: "Anomaly ratio must equal current gross sell USD divided by the positive previous-window baseline." });
  }
  if (signal.uniqueWallets > signal.txCount || (signal.txCount === 0 && signal.currentSellVolumeUsd !== 0)) {
    context.addIssue({ code: "custom", path: ["txCount"], message: "Unique originating wallets cannot exceed sell transactions; no sell transactions implies zero current sell volume." });
  }
});
