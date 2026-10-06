import { describe, expect, it } from "vitest";
import { AavePositionStateSchema, PositionSnapshotSchema, PositionQuerySchema } from "@/extensions/aave/schemas";

const wallet = `0x${"11".repeat(20)}`;
const evidence = {
  chainId: 1, network: "ethereum-mainnet", protocol: "aave-v3",
  providerAddress: wallet, poolAddress: wallet, oracleAddress: wallet, ethAssetAddress: wallet,
  blockNumber: 20000, blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "2026-10-06T12:00:00.000Z",
};
const snapshot = {
  mode: "LIVE", status: "ACTIVE", wallet, evidence,
  position: { wallet, collateralUsd: 200000, debtUsd: 100000, healthFactor: 1.08, ethPrice: 2800, timestamp: evidence.blockTimestamp, blockNumber: 20000 },
  marketChanges: {
    ethChangePct: -5, previousEthPrice: 2900, referenceBlockNumber: 12800,
    referenceBlockHash: `0x${"cd".repeat(32)}`, referenceTimestamp: "2026-10-05T12:00:00.000Z",
    referenceOracleAddress: wallet, lookbackBlocks: 7200, lookbackSeconds: 86400,
  },
};

describe("independent live position contracts", () => {
  it("keeps borrowed-position fields in the extension without accepting portfolio fields", () => {
    expect(AavePositionStateSchema.parse(snapshot.position)).toEqual(snapshot.position);
    expect(AavePositionStateSchema.safeParse({ ...snapshot.position, riskExposurePct: 70 }).success).toBe(false);
    expect(AavePositionStateSchema.safeParse({
      wallet, totalUsd: 27000, riskAssetUsd: 18900, defensiveAssetUsd: 8100,
      riskExposurePct: 70, assets: [], timestamp: evidence.blockTimestamp,
    }).success).toBe(false);
  });
  it("accepts an active snapshot with the unchanged Aave position fields", () => {
    expect(PositionSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });
  it("returns an explicit no-debt result without a fabricated HF", () => {
    const result = { mode: "LIVE", status: "NO_DEBT", wallet, position: null, message: "No borrowed debt; HF is not applicable.", evidence };
    expect(PositionSnapshotSchema.parse(result)).toEqual(result);
    expect(PositionSnapshotSchema.safeParse({ ...result, position: snapshot.position }).success).toBe(false);
  });
  it.each(["", "test-wallet", "0x123", `0x${"gg".repeat(20)}`])("rejects invalid real-chain wallet %s", (value) => {
    expect(PositionQuerySchema.safeParse({ wallet: value }).success).toBe(false);
  });
  it("rejects input overrides and extra internal data", () => {
    expect(PositionQuerySchema.safeParse({ wallet, rpcUrl: "https://example.com" }).success).toBe(false);
    expect(PositionSnapshotSchema.safeParse({ ...snapshot, internal: true }).success).toBe(false);
  });
  it("rejects different wallets, blocks and invalid evidence hashes", () => {
    expect(PositionSnapshotSchema.safeParse({ ...snapshot, wallet: `0x${"22".repeat(20)}` }).success).toBe(false);
    expect(PositionSnapshotSchema.safeParse({ ...snapshot, position: { ...snapshot.position, blockNumber: 1 } }).success).toBe(false);
    expect(PositionSnapshotSchema.safeParse({ ...snapshot, evidence: { ...evidence, blockHash: "fake" } }).success).toBe(false);
  });
  it("rejects debt-free active snapshots and inconsistent market windows", () => {
    expect(PositionSnapshotSchema.safeParse({ ...snapshot, position: { ...snapshot.position, debtUsd: 0 } }).success).toBe(false);
    expect(PositionSnapshotSchema.safeParse({ ...snapshot, marketChanges: { ...snapshot.marketChanges, lookbackSeconds: 1 } }).success).toBe(false);
  });
});
