import { describe, expect, it } from "vitest";
import { OnchainEvidenceSchema, OnchainSignalStateSchema } from "@/domain/schemas";
import type { OnchainEvidence, OnchainSignalState } from "@/domain/types";

// Synthetic references validate the contract shape, not the existence of a transaction.
const txHash = "0x" + "ab".repeat(32);
const blockHash = "0x" + "cd".repeat(32);
const contractAddress = "0x" + "12".repeat(20);
const transaction: OnchainEvidence = {
  type: "TRANSACTION",
  txHash,
  blockNumber: 21000000,
  description: "Mock ETH sell transaction",
  source: "MOCK fixture",
};
const block: OnchainEvidence = {
  type: "BLOCK",
  blockHash,
  blockNumber: 21000000,
  description: "Mock block containing sampled sell transactions",
  source: "MOCK fixture",
};
const event: OnchainEvidence = {
  type: "CONTRACT_EVENT",
  txHash,
  blockNumber: 21000000,
  contractAddress,
  description: "Mock DEX sell event",
  source: "MOCK fixture",
};
const signal: OnchainSignalState = {
  signalType: "DEX_SELL_PRESSURE",
  asset: "ETH",
  windowStart: "2026-10-06T00:00:00.000Z",
  windowEnd: "2026-10-06T00:05:00.000Z",
  currentSellVolumeUsd: 300000,
  baselineSellVolumeUsd: 100000,
  anomalyRatio: 3,
  txCount: 12,
  uniqueWallets: 8,
  evidence: [transaction, block, event],
};

describe("OnchainEvidence frozen contract", () => {
  it.each([transaction, block, event])("accepts the %s evidence reference", (evidence) => {
    expect(OnchainEvidenceSchema.parse(evidence)).toEqual(evidence);
  });

  it("allows a block reference without a transaction and validates optional references when supplied", () => {
    expect(OnchainEvidenceSchema.parse(block).txHash).toBeUndefined();
    expect(OnchainEvidenceSchema.parse({ ...block, txHash, contractAddress })).toEqual({ ...block, txHash, contractAddress });
    expect(OnchainEvidenceSchema.parse({ ...transaction, blockHash })).toEqual({ ...transaction, blockHash });
  });

  it.each([
    { evidence: transaction, patch: { txHash: undefined } },
    { evidence: block, patch: { blockHash: undefined } },
    { evidence: event, patch: { txHash: undefined } },
    { evidence: event, patch: { contractAddress: undefined } },
    { evidence: transaction, patch: { blockNumber: undefined } },
    { evidence: transaction, patch: { source: undefined } },
    { evidence: transaction, patch: { description: undefined } },
    { evidence: transaction, patch: { type: "LOG" } },
    { evidence: transaction, patch: { txHash: "0x1234" } },
    { evidence: block, patch: { blockHash: "0x" + "gg".repeat(32) } },
    { evidence: event, patch: { contractAddress: "0x" + "ab".repeat(19) } },
    { evidence: transaction, patch: { blockNumber: -1 } },
    { evidence: transaction, patch: { blockNumber: 1.5 } },
    { evidence: transaction, patch: { blockNumber: Number.MAX_SAFE_INTEGER + 1 } },
    { evidence: transaction, patch: { description: "   " } },
    { evidence: transaction, patch: { source: " \n " } },
    { evidence: transaction, patch: { blockNumber: "21000000" } },
    { evidence: transaction, patch: { instruction: "execute a swap" } },
  ])("rejects missing or invalid typed references and undeclared fields: %j", ({ evidence, patch }) => {
    expect(OnchainEvidenceSchema.safeParse({ ...evidence, ...patch }).success).toBe(false);
  });

  it("trims human-readable references without coercing hashes or numeric fields", () => {
    const parsed = OnchainEvidenceSchema.parse({ ...transaction, description: "  Mock sell  ", source: " MOCK fixture " });
    expect(parsed.description).toBe("Mock sell");
    expect(parsed.source).toBe("MOCK fixture");
    expect(OnchainEvidenceSchema.safeParse({ ...transaction, txHash: ` ${txHash} ` }).success).toBe(false);
  });

  it("accepts block zero and the safe integer boundary", () => {
    expect(OnchainEvidenceSchema.parse({ ...block, blockNumber: 0 }).blockNumber).toBe(0);
    expect(OnchainEvidenceSchema.parse({ ...block, blockNumber: Number.MAX_SAFE_INTEGER }).blockNumber).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("OnchainSignalState frozen contract", () => {
  it("parses the complete JSON boundary example through the public schema and infer type", () => {
    const parsed: OnchainSignalState = OnchainSignalStateSchema.parse(JSON.parse(JSON.stringify(signal)));
    expect(parsed).toEqual(signal);
    expect(parsed.evidence.map((item) => item.type)).toEqual(["TRANSACTION", "BLOCK", "CONTRACT_EVENT"]);
  });

  it("accepts no sells with a positive baseline and accepts sampled or empty evidence", () => {
    const emptyWindow: OnchainSignalState = {
      ...signal, currentSellVolumeUsd: 0, anomalyRatio: 0, txCount: 0, uniqueWallets: 0, evidence: [],
    };
    expect(OnchainSignalStateSchema.parse(emptyWindow)).toEqual(emptyWindow);
    expect(OnchainSignalStateSchema.parse({ ...signal, evidence: [] }).txCount).toBe(12);
    expect(OnchainSignalStateSchema.parse({ ...signal, evidence: [transaction] }).uniqueWallets).toBe(8);
  });

  it.each([
    { signalType: "WALLET_OUTFLOW" }, { asset: "BTC" },
    { windowStart: signal.windowEnd },
    { windowEnd: "2026-10-05T23:59:59.000Z" },
    { windowStart: "2026-10-06T00:00:00+00:00" },
    { windowEnd: "2026-10-06T00:05:00" },
    { currentSellVolumeUsd: -1 }, { currentSellVolumeUsd: Infinity },
    { baselineSellVolumeUsd: 0 }, { baselineSellVolumeUsd: -1 }, { baselineSellVolumeUsd: NaN },
    { anomalyRatio: -1 }, { anomalyRatio: Infinity }, { anomalyRatio: 2 },
    { currentSellVolumeUsd: Number.MAX_VALUE, baselineSellVolumeUsd: Number.MIN_VALUE, anomalyRatio: 0 },
    { txCount: -1 }, { txCount: 1.5 }, { txCount: Number.MAX_SAFE_INTEGER + 1 },
    { uniqueWallets: -1 }, { uniqueWallets: 8.5 }, { uniqueWallets: Number.MAX_SAFE_INTEGER + 1 },
    { uniqueWallets: 13 }, { txCount: 0, uniqueWallets: 0 },
    { txCount: "12" }, { evidence: [{ ...transaction, permission: "APPROVED" }] },
    { permission: "APPROVED" },
  ])("rejects invalid windows, volumes, ratios, counts or additional authority: %j", (patch) => {
    expect(OnchainSignalStateSchema.safeParse({ ...signal, ...patch }).success).toBe(false);
  });

  it("permits ordinary floating-point tolerance but rejects a materially inconsistent ratio", () => {
    expect(OnchainSignalStateSchema.safeParse({ ...signal, anomalyRatio: 3 + 2e-9 }).success).toBe(true);
    expect(OnchainSignalStateSchema.safeParse({ ...signal, anomalyRatio: 3 + 4e-9 }).success).toBe(false);
  });
});
