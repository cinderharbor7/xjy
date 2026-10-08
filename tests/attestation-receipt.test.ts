import { describe, expect, it, vi } from "vitest";
import { encodeEventTopics, encodeAbiParameters, keccak256, toHex } from "viem";
import artifact from "@/modules/attestation/registry-artifact.json";
import { assertRegistry, confirmTransaction, registryAbi, verifyOnChain, type TransactionJob } from "@/modules/attestation/bot-chain";

const fake = vi.hoisted(() => ({ getChainId: vi.fn(), getCode: vi.fn(), getTransactionReceipt: vi.fn(), waitForTransactionReceipt: vi.fn(), readContract: vi.fn() }));
vi.mock("viem", async original => ({ ...await original<typeof import("viem")>(), createPublicClient: () => fake }));
const address = `0x${"11".repeat(20)}` as const, publisher = `0x${"22".repeat(20)}` as const;
const hash = keccak256(toHex("report")), tx = `0x${"aa".repeat(32)}` as const;
function fixture() {
  fake.getChainId.mockResolvedValue(677); fake.getCode.mockResolvedValue(artifact.deployedBytecode); fake.readContract.mockResolvedValue(123n);
  const receipt = { from: publisher, to: address, status: "success", transactionHash: tx, logs: [{ address, data: encodeAbiParameters([{ type: "uint256" }], [123n]), topics: encodeEventTopics({ abi: registryAbi, eventName: "ReportPublished", args: { reportHash: hash, publisher } }) }] };
  fake.getTransactionReceipt.mockResolvedValue(receipt);
  return { receipt, job: { kind: "PUBLISH", chainId: 677, hash: tx, publisher, contract: address, reportHash: hash } as TransactionJob };
}
describe("BOT attestation receipt verification", () => {
  it("accepts only matching registry code, publisher, content hash and emitted/stored time", async () => {
    const { job } = fixture();
    expect(await confirmTransaction(job)).toMatchObject({ contract: address, anchor: { chainId: 677, publisher, transactionHash: tx, timestamp: "123" } });
    expect(await verifyOnChain(address, publisher, hash)).toMatchObject({ exists: true, timestamp: "123" });
  });
  it("rejects a wrong network or a different contract implementation", async () => {
    fixture(); fake.getChainId.mockResolvedValue(1); await expect(assertRegistry(address)).rejects.toThrow(/677/);
    fake.getChainId.mockResolvedValue(677); fake.getCode.mockResolvedValue("0x6000"); await expect(assertRegistry(address)).rejects.toThrow(/合约/);
  });
  it("does not confirm unrelated logs, another publisher, or a reverted transaction", async () => {
    const { receipt, job } = fixture();
    fake.getTransactionReceipt.mockResolvedValue({ ...receipt, logs: [] }); await expect(confirmTransaction(job)).rejects.toThrow(/事件/);
    fake.getTransactionReceipt.mockResolvedValue({ ...receipt, from: address }); await expect(confirmTransaction(job)).rejects.toThrow(/发布者/);
    fake.getTransactionReceipt.mockResolvedValue({ ...receipt, status: "reverted" }); await expect(confirmTransaction(job)).rejects.toThrow("TRANSACTION_REVERTED");
  });
  it("rejects a transaction job from the old testnet before querying its hash", async () => {
    const { job } = fixture();
    fake.getTransactionReceipt.mockClear();
    await expect(confirmTransaction({ ...job, chainId: 968 } as unknown as TransactionJob)).rejects.toThrow(/网络/);
    expect(fake.getTransactionReceipt).not.toHaveBeenCalled();
  });
  it("never interprets an unavailable receipt or missing attestation as confirmed", async () => {
    const { job } = fixture(); fake.getTransactionReceipt.mockRejectedValue(new Error("receipt unavailable"));
    await expect(confirmTransaction(job)).rejects.toThrow("receipt unavailable");
    fake.readContract.mockResolvedValue(0n); expect(await verifyOnChain(address, publisher, hash)).toMatchObject({ exists: false });
  });
});
