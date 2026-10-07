import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionCheckReportSchema, type SupportedSwap, type TransactionObservation } from "@/domain/schemas/transaction-check";
import { UNISWAP_POOL_ADDRESS } from "@/modules/onchain/ethereum-contracts";
import type { TransactionCheckClient } from "@/modules/transaction-check/transaction-check.client";
import { TransactionCheckService } from "@/modules/transaction-check/transaction-check.service";
import { TransactionCheckError } from "@/modules/transaction-check/transaction-check.error";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/modules/transaction-check/transaction-check.reader", () => ({ readTransactionObservation: read }));
const txHash = `0x${"1".repeat(64)}`;
const blockHash = `0x${"2".repeat(64)}`;
function observation(swaps: SupportedSwap[] = [], reverted = false): TransactionObservation {
  return {
    transaction: { hash: txHash, from: `0x${"a".repeat(40)}`, to: `0x${"b".repeat(40)}`, nativeValueEth: "20059.2", input: "0x",
      status: reverted ? "REVERTED" : "SUCCESS", blockNumber: 100, blockHash, timestamp: "2024-08-03T18:08:23.000Z", logCount: swaps.length },
    supportedSwaps: swaps,
    evidence: [{ type: "TRANSACTION", txHash, blockHash, blockNumber: 100, description: "交易", source: `https://etherscan.io/tx/${txHash}` },
      { type: "BLOCK", blockHash, blockNumber: 100, description: "区块", source: "https://etherscan.io/block/100" },
      ...swaps.map((swap) => ({ type: "CONTRACT_EVENT" as const, txHash, blockHash, blockNumber: 100,
        contractAddress: swap.poolAddress, description: `Swap log ${swap.logIndex}`, source: `https://etherscan.io/tx/${txHash}#eventlog` }))],
    scope: { protocol: "UNISWAP_V3", poolAddress: UNISWAP_POOL_ADDRESS, poolLabel: "Uniswap V3 WETH/USDC 0.05%", asset: "WETH", quoteAsset: "USDC", fee: 500 },
  };
}
const event = (direction: SupportedSwap["direction"], logIndex = 5): SupportedSwap => ({ direction, logIndex, poolAddress: UNISWAP_POOL_ADDRESS, wethAmount: "1.000000000000000001", usdcAmount: "123.456789" });
const client = {} as TransactionCheckClient;

describe("bounded plain-language transaction explanation", () => {
  beforeEach(() => { read.mockReset(); });

  it("describes outer transfer facts and explicitly avoids inferring a sale or identity", async () => {
    read.mockResolvedValue(observation());
    const report = await new TransactionCheckService(client).check(txHash);
    expect(TransactionCheckReportSchema.parse(report)).toEqual(report);
    expect(report.classification).toBe("NO_SUPPORTED_SWAP");
    expect(report.summary).toContain("不能据此断言其他地方没有卖出");
    expect(report.confirmedFacts.some((fact) => fact.includes("20059.2 ETH"))).toBe(true);
    expect(report.uncertainties.join(" ")).toContain("未核验所属机构");
    expect(report.uncertainties.join(" ")).toContain("单个配置 RPC");
    expect(report.uncertainties.join(" ")).toContain("未读取内部调用 trace");
    expect(report).not.toHaveProperty("riskScore");
    expect(report).not.toHaveProperty("confidence");
    expect(report.mode).toBe("LIVE_READ_ONLY");
    expect(read).toHaveBeenCalledWith(client, txHash);
  });

  it.each([
    [[event("SELL_ETH")], "SUPPORTED_POOL_SELL", "WETH 换 USDC"],
    [[event("BUY_ETH")], "SUPPORTED_POOL_BUY", "USDC 换 WETH"],
    [[event("SELL_ETH"), event("BUY_ETH", 6)], "SUPPORTED_POOL_MIXED", "同时出现"],
  ] as const)("explains supported directions without rounding amount strings (%#)", async (swaps, classification, headline) => {
    read.mockResolvedValue(observation([...swaps]));
    const report = await new TransactionCheckService(client).check(txHash);
    expect(report.classification).toBe(classification);
    expect(report.headline).toContain(headline);
    expect(report.confirmedFacts.join(" ")).toContain("1.000000000000000001 WETH");
    expect(report.uncertainties.join(" ")).toContain("不能确定整笔交易的净买卖方向");
    expect(report.uncertainties.join(" ")).toContain("不能当作等额美元价值");
  });

  it("does not describe reverted outer value as a successful transfer", async () => {
    read.mockResolvedValue(observation([], true));
    const report = await new TransactionCheckService(client).check(txHash);
    expect(report.classification).toBe("REVERTED");
    expect(report.summary).toContain("尝试发送的金额");
    expect(report.confirmedFacts.join(" ")).toContain("尝试附带");
    expect(report.confirmedFacts.join(" ")).toContain("失败并回滚");
  });

  it("propagates safe read failures and never substitutes an example observation", async () => {
    read.mockRejectedValue(new TransactionCheckError("RPC_READ_FAILED"));
    await expect(new TransactionCheckService(client).check(txHash)).rejects.toMatchObject({ code: "RPC_READ_FAILED" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("rejects internally contradictory reader output instead of returning a report", async () => {
    const malformed = observation([event("SELL_ETH")]);
    malformed.transaction.status = "REVERTED";
    read.mockResolvedValue(malformed);
    await expect(new TransactionCheckService(client).check(txHash)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });
  it("rejects a swap that has no matching pool event evidence", async () => {
    const malformed = observation([event("SELL_ETH")]);
    malformed.evidence = malformed.evidence.filter((item) => item.type !== "CONTRACT_EVENT");
    read.mockResolvedValue(malformed);
    await expect(new TransactionCheckService(client).check(txHash)).rejects.toMatchObject({ code: "INVALID_CHAIN_DATA" });
  });
});
