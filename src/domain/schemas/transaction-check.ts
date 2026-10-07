import { z } from "zod";
import { OnchainEvidenceSchema } from "./onchain";

const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1);
// Decimal strings preserve on-chain amounts; never use a floating-point USD proxy.
const amount = z.string().regex(/^(0|[1-9]\d{0,77})(\.\d{1,18})?$/);
const positiveAmount = amount.refine((value) => !/^0(?:\.0+)?$/.test(value), "Swap amounts must be positive.");

export const TransactionCheckRequestSchema = z.strictObject({ txHash: hash });
export type TransactionCheckRequest = z.infer<typeof TransactionCheckRequestSchema>;

export const TransactionFactsSchema = z.strictObject({
  hash,
  from: address,
  to: address.nullable(),
  nativeValueEth: amount,
  input: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/),
  status: z.enum(["SUCCESS", "REVERTED"]),
  blockNumber: count,
  blockHash: hash,
  timestamp: z.iso.datetime(),
  logCount: count,
});
export type TransactionFacts = z.infer<typeof TransactionFactsSchema>;

export const SupportedSwapSchema = z.strictObject({
  logIndex: count,
  poolAddress: address,
  direction: z.enum(["SELL_ETH", "BUY_ETH"]),
  wethAmount: positiveAmount,
  usdcAmount: positiveAmount,
});
export type SupportedSwap = z.infer<typeof SupportedSwapSchema>;

export const TransactionClassificationSchema = z.enum([
  "SUPPORTED_POOL_SELL", "SUPPORTED_POOL_BUY", "SUPPORTED_POOL_MIXED", "NO_SUPPORTED_SWAP", "REVERTED",
]);
export type TransactionClassification = z.infer<typeof TransactionClassificationSchema>;

export function classifyTransaction(status: TransactionFacts["status"], swaps: SupportedSwap[]): TransactionClassification {
  if (status === "REVERTED") return "REVERTED";
  const sell = swaps.some((swap) => swap.direction === "SELL_ETH");
  const buy = swaps.some((swap) => swap.direction === "BUY_ETH");
  return sell && buy ? "SUPPORTED_POOL_MIXED" : sell ? "SUPPORTED_POOL_SELL" : buy ? "SUPPORTED_POOL_BUY" : "NO_SUPPORTED_SWAP";
}

export const TransactionObservationSchema = z.strictObject({
  transaction: TransactionFactsSchema,
  supportedSwaps: z.array(SupportedSwapSchema),
  evidence: z.array(OnchainEvidenceSchema).min(2),
  scope: z.strictObject({
    protocol: z.literal("UNISWAP_V3"),
    poolAddress: address,
    poolLabel: text,
    asset: z.literal("WETH"),
    quoteAsset: z.literal("USDC"),
    fee: z.literal(500),
  }),
}).superRefine((observation, context) => {
  const { transaction, supportedSwaps, evidence, scope } = observation;
  const matchesTx = (value: string) => value.toLowerCase() === transaction.hash.toLowerCase();
  const events = evidence.filter((item) => item.type === "CONTRACT_EVENT");
  const consistent = new Set(supportedSwaps.map((swap) => swap.logIndex)).size === supportedSwaps.length
    && supportedSwaps.length <= transaction.logCount
    && (transaction.status !== "REVERTED" || (supportedSwaps.length === 0 && transaction.logCount === 0))
    && supportedSwaps.every((swap) => swap.poolAddress.toLowerCase() === scope.poolAddress.toLowerCase())
    && events.length === supportedSwaps.length
    && events.every((item) => item.contractAddress.toLowerCase() === scope.poolAddress.toLowerCase())
    && evidence.some((item) => item.type === "TRANSACTION" && matchesTx(item.txHash))
    && evidence.some((item) => item.type === "BLOCK" && item.blockHash.toLowerCase() === transaction.blockHash.toLowerCase())
    && evidence.every((item) => item.blockNumber === transaction.blockNumber
      && (item.blockHash === undefined || item.blockHash.toLowerCase() === transaction.blockHash.toLowerCase())
      && (item.txHash === undefined || matchesTx(item.txHash)));
  if (!consistent) context.addIssue({ code: "custom", message: "Observation status, pool, transaction and block references must agree." });
});
export type TransactionObservation = z.infer<typeof TransactionObservationSchema>;

export const TransactionCheckReportSchema = z.strictObject({
  mode: z.literal("LIVE_READ_ONLY"),
  network: z.literal("ethereum-mainnet"),
  checkedAt: z.iso.datetime(),
  observation: TransactionObservationSchema,
  classification: TransactionClassificationSchema,
  headline: text,
  summary: text,
  confirmedFacts: z.array(text).min(1),
  uncertainties: z.array(text).min(1),
  nextSteps: z.array(text).min(1),
}).superRefine((report, context) => {
  if (report.classification !== classifyTransaction(report.observation.transaction.status, report.observation.supportedSwaps)
    || Date.parse(report.checkedAt) < Date.parse(report.observation.transaction.timestamp)) {
    context.addIssue({ code: "custom", message: "Report classification and observation time must agree with the verified facts." });
  }
});
export type TransactionCheckReport = z.infer<typeof TransactionCheckReportSchema>;

export const TransactionCheckProblemSchema = z.strictObject({
  type: z.string().startsWith("urn:xjy:transaction-check:"),
  title: text,
  status: z.union([z.literal(400), z.literal(403), z.literal(404), z.literal(409), z.literal(415), z.literal(503)]),
  detail: text,
  instance: z.literal("/api/transaction-checks"),
  code: z.enum(["INVALID_REQUEST", "LOCAL_ONLY", "ORIGIN_REJECTED", "JSON_REQUIRED", "TRANSACTION_NOT_FOUND", "TRANSACTION_PENDING", "CONFIGURATION_ERROR", "UNSUPPORTED_NETWORK", "INVALID_CHAIN_DATA", "REORG_DETECTED", "RPC_READ_FAILED"]),
});
export type TransactionCheckProblem = z.infer<typeof TransactionCheckProblemSchema>;
