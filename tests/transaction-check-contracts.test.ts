import { describe, expect, it } from "vitest";
import { classifyTransaction, TransactionCheckReportSchema, TransactionCheckRequestSchema, TransactionObservationSchema, type TransactionObservation } from "@/domain/schemas/transaction-check";

const txHash = `0x${"ab".repeat(32)}`;
const blockHash = `0x${"cd".repeat(32)}`;
const poolAddress = `0x${"12".repeat(20)}`;
const observation: TransactionObservation = {
  transaction: { hash: txHash, from: `0x${"34".repeat(20)}`, to: null, nativeValueEth: "20059.2", input: "0x", status: "SUCCESS", blockNumber: 20449709, blockHash, timestamp: "2024-08-03T18:08:23.000Z", logCount: 0 },
  supportedSwaps: [],
  evidence: [
    { type: "TRANSACTION", txHash, blockHash, blockNumber: 20449709, description: "Test transaction reference", source: `https://etherscan.io/tx/${txHash}` },
    { type: "BLOCK", blockHash, blockNumber: 20449709, description: "Test block reference", source: "https://etherscan.io/block/20449709" },
  ],
  scope: { protocol: "UNISWAP_V3", poolAddress, poolLabel: "Uniswap V3 WETH/USDC 0.05%", asset: "WETH", quoteAsset: "USDC", fee: 500 },
};
const report = { mode: "LIVE_READ_ONLY", network: "ethereum-mainnet", checkedAt: "2026-10-07T06:00:00.000Z", observation, classification: "NO_SUPPORTED_SWAP", headline: "未证实卖出", summary: "只有外层转账证据", confirmedFacts: ["交易已确认"], uncertainties: ["未查后续路径"], nextSteps: ["补查后续路径"] };
const swap = { logIndex: 0, poolAddress, direction: "SELL_ETH" as const, wethAmount: "1.000000000000000001", usdcAmount: "2800.000001" };

describe("transaction-check contracts", () => {
  it("accepts a hash-only request and rejects wallet/free text/invalid hash", () => {
    expect(TransactionCheckRequestSchema.parse({ txHash })).toEqual({ txHash });
    expect(TransactionCheckRequestSchema.safeParse({ txHash, wallet: "anything" }).success).toBe(false);
    expect(TransactionCheckRequestSchema.safeParse({ txHash: "0x123" }).success).toBe(false);
  });
  it("preserves exact amounts and refuses floating-point amounts", () => {
    expect(TransactionObservationSchema.parse(observation).transaction.nativeValueEth).toBe("20059.2");
    expect(TransactionObservationSchema.safeParse({ ...observation, transaction: { ...observation.transaction, nativeValueEth: 20059.2 } }).success).toBe(false);
  });
  it("does not allow a transfer-only report to claim sell evidence", () => {
    expect(TransactionCheckReportSchema.parse(report).classification).toBe("NO_SUPPORTED_SWAP");
    expect(TransactionCheckReportSchema.safeParse({ ...report, classification: "SUPPORTED_POOL_SELL" }).success).toBe(false);
  });
  it("distinguishes sell, buy, mixed and reverted", () => {
    expect(classifyTransaction("SUCCESS", [swap])).toBe("SUPPORTED_POOL_SELL");
    expect(classifyTransaction("SUCCESS", [{ ...swap, direction: "BUY_ETH" }])).toBe("SUPPORTED_POOL_BUY");
    expect(classifyTransaction("SUCCESS", [swap, { ...swap, logIndex: 1, direction: "BUY_ETH" }])).toBe("SUPPORTED_POOL_MIXED");
    expect(classifyTransaction("REVERTED", [])).toBe("REVERTED");
  });
  it("rejects duplicate swap indexes, a foreign pool, zero swap quantities and swaps on reverted receipts", () => {
    const tx = { ...observation.transaction, logCount: 2 };
    for (const supportedSwaps of [[swap, swap], [{ ...swap, poolAddress: `0x${"ff".repeat(20)}` }], [{ ...swap, wethAmount: "0" }]]) {
      expect(TransactionObservationSchema.safeParse({ ...observation, transaction: tx, supportedSwaps }).success).toBe(false);
    }
    expect(TransactionObservationSchema.safeParse({ ...observation, transaction: { ...tx, status: "REVERTED" }, supportedSwaps: [swap] }).success).toBe(false);
  });
  it("rejects transaction/block references that disagree with the observation", () => {
    expect(TransactionObservationSchema.safeParse({ ...observation, evidence: observation.evidence.map(item => ({ ...item, blockNumber: 1 })) }).success).toBe(false);
    expect(TransactionObservationSchema.safeParse({ ...observation, evidence: [observation.evidence[1]] }).success).toBe(false);
  });
  it("requires one supported-pool event reference for every recorded swap", () => {
    const withSwap = { ...observation, transaction: { ...observation.transaction, logCount: 1 }, supportedSwaps: [swap] };
    const event = { type: "CONTRACT_EVENT" as const, txHash, blockHash, blockNumber: 20449709, contractAddress: poolAddress, description: "Swap log 0", source: `https://etherscan.io/tx/${txHash}#eventlog` };
    expect(TransactionObservationSchema.safeParse(withSwap).success).toBe(false);
    expect(TransactionObservationSchema.safeParse({ ...withSwap, evidence: [...observation.evidence, { ...event, contractAddress: `0x${"ff".repeat(20)}` }] }).success).toBe(false);
    expect(TransactionObservationSchema.safeParse({ ...withSwap, evidence: [...observation.evidence, event, event] }).success).toBe(false);
    expect(TransactionObservationSchema.safeParse({ ...withSwap, evidence: [...observation.evidence, event] }).success).toBe(true);
  });
  it("rejects future observations, Mock modes and empty uncertainty", () => {
    expect(TransactionCheckReportSchema.safeParse({ ...report, checkedAt: "2020-01-01T00:00:00.000Z" }).success).toBe(false);
    expect(TransactionCheckReportSchema.safeParse({ ...report, mode: "MOCK" }).success).toBe(false);
    expect(TransactionCheckReportSchema.safeParse({ ...report, uncertainties: [] }).success).toBe(false);
  });
});
