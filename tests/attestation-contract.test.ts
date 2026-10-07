import { beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, http, keccak256, parseEther, toHex, zeroHash, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { registryAbi, registryBytecode } from "@/modules/attestation/bot-chain";
import artifact from "@/modules/attestation/registry-artifact.json";

const rpc = process.env.ATTESTATION_TEST_RPC;
const chain = defineChain({ id: 968, name: "Local attestation EVM", nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 }, rpcUrls: { default: { http: [rpc ?? "http://127.0.0.1:19545"] } } });
describe.skipIf(!rpc)("registry contract on isolated local EVM (never BOT RPC)", () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const second = privateKeyToAccount(generatePrivateKey());
  const publicClient = createPublicClient({ chain, transport: http(rpc, { retryCount: 0 }) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc, { retryCount: 0 }) });
  const other = createWalletClient({ account: second, chain, transport: http(rpc, { retryCount: 0 }) });
  let contract: Address;
  const hash = keccak256(toHex("report fixture"));
  beforeAll(async () => {
    if (!rpc || !["127.0.0.1", "localhost"].includes(new URL(rpc).hostname)) throw new Error("Local EVM only");
    expect(await publicClient.getChainId()).toBe(968);
    for (const address of [account.address, second.address]) await publicClient.request({ method: "anvil_setBalance" as never, params: [address, toHex(parseEther("10"))] as never });
    const tx = await wallet.deployContract({ abi: registryAbi, bytecode: registryBytecode });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx }); expect(receipt.status).toBe("success"); contract = receipt.contractAddress!;
  });
  it("deploys the exact compiled runtime code", async () => {
    expect(keccak256((await publicClient.getCode({ address: contract }))!)).toBe(artifact.runtimeCodeHash);
    expect(await publicClient.readContract({ address: contract, abi: registryAbi, functionName: "REGISTRY_ID" })).toBe(keccak256(toHex("xjy-risk-report-registry:v1")));
  });
  it("records the hash, actual sender and block timestamp, and rejects replacement", async () => {
    const tx = await wallet.writeContract({ address: contract, abi: registryAbi, functionName: "publish", args: [hash] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    const block = await publicClient.getBlock({ blockHash: receipt.blockHash });
    expect(await publicClient.readContract({ address: contract, abi: registryAbi, functionName: "attestations", args: [account.address, hash] })).toBe(block.timestamp);
    const event = decodeEventLog({ abi: registryAbi, data: receipt.logs[0].data, topics: receipt.logs[0].topics });
    expect(event).toMatchObject({ eventName: "ReportPublished", args: { reportHash: hash, publisher: account.address, timestamp: block.timestamp } });
    await expect(publicClient.simulateContract({ account, address: contract, abi: registryAbi, functionName: "publish", args: [hash] })).rejects.toThrow();
  });
  it("allows a different publisher to attest the same content without taking over the original", async () => {
    const tx = await other.writeContract({ address: contract, abi: registryAbi, functionName: "publish", args: [hash] });
    expect((await publicClient.waitForTransactionReceipt({ hash: tx })).status).toBe("success");
    expect(await publicClient.readContract({ address: contract, abi: registryAbi, functionName: "attestations", args: [second.address, hash] })).toBeGreaterThan(0n);
    expect(await publicClient.readContract({ address: contract, abi: registryAbi, functionName: "attestations", args: [account.address, keccak256(toHex("changed report"))] })).toBe(0n);
  });
  it("rejects the zero hash", async () => {
    await expect(publicClient.simulateContract({ account, address: contract, abi: registryAbi, functionName: "publish", args: [zeroHash] })).rejects.toThrow();
  });
});
