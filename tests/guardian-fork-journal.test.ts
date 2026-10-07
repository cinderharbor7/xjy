import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, parseAbi, type Hex } from "viem";
import { createAnvilForkConfig } from "@/modules/execution/fork-execution.adapter";
import { DEMO_POLICY_CONFIG } from "@/mocks/scenarios";
import { GuardianStore } from "@/integration/guardian/store";
import { ForkReadBridge, localForkConfig } from "@/integration/guardian/fork";

const rpc = vi.hoisted(() => ({ send: vi.fn(), prepare: vi.fn(), metadata: vi.fn(), chainId: vi.fn() }));
vi.mock("viem", async importOriginal => {
  const actual = await importOriginal<typeof import("viem")>();
  return { ...actual,
    createPublicClient: () => ({ sendRawTransaction: rpc.send, getChainId: rpc.chainId, request: rpc.metadata }),
    createWalletClient: () => ({ prepareTransactionRequest: rpc.prepare }),
  };
});
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function fixture() {
  const key = generatePrivateKey(); const address = privateKeyToAccount(key).address;
  const dir = mkdtempSync(join(tmpdir(), "fork-journal-")); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = new GuardianStore(join(dir, "state.sqlite"), { wallet: address, mode: "FORK", config: DEMO_POLICY_CONFIG, version: 1, enabled: false, halted: false, recoveryCount: 0 }); cleanup.push(() => store.close());
  const bridge = new ForkReadBridge(createAnvilForkConfig("http://127.0.0.1:8545", key, address), store);
  rpc.chainId.mockResolvedValue(1); rpc.metadata.mockResolvedValue({ instanceId: "test-instance", forkedNetwork: { forkBlockHash: `0x${"12".repeat(32)}` } });
  rpc.prepare.mockImplementation(async args => ({ chainId: 1, type: "eip1559", nonce: 0, gas: 100000n, maxFeePerGas: 100n, maxPriorityFeePerGas: 1n, to: args.to, data: args.data, value: 0n }));
  return { bridge, store, key, address };
}
describe("Fork pre-broadcast persistence boundary", () => {
  it("persists a deterministic signed hash before broadcast, even if broadcast times out", async () => {
    const f = fixture(); let recorded: string | undefined;
    const journal = vi.fn((_kind, hash: string) => { recorded = hash; });
    rpc.send.mockImplementation(async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      expect(journal).toHaveBeenCalledOnce(); expect(recorded).toBe(keccak256(serializedTransaction)); throw new Error("broadcast timeout");
    });
    const wallet = f.bridge.journaledWallet(journal);
    await expect(wallet.writeContract({ address: f.bridge.config.router, abi: parseAbi(["function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns(uint256[])"]), functionName: "swapExactTokensForTokens", args: [1n, 1n, [f.bridge.config.tokens.ETH.address, f.bridge.config.tokens.USDC.address], f.address, 100n], account: f.address, chain: f.bridge.config.chain })).rejects.toThrow("broadcast timeout");
    expect(recorded).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("does not broadcast when durable journaling fails", async () => {
    const f = fixture(); rpc.send.mockClear();
    const wallet = f.bridge.journaledWallet(() => { throw new Error("disk failure"); });
    await expect(wallet.writeContract({ address: f.bridge.config.tokens.ETH.address, abi: parseAbi(["function approve(address,uint256) returns(bool)"]), functionName: "approve", args: [f.bridge.config.router, 1n], account: f.address, chain: f.bridge.config.chain })).rejects.toThrow("disk failure");
    expect(rpc.send).not.toHaveBeenCalled();
  });
  it("rejects chain mismatch, non-fork nodes and reset fork identity", async () => {
    const f = fixture(); await f.bridge.preflight();
    rpc.metadata.mockResolvedValue({ instanceId: "another-instance", forkedNetwork: { forkBlockHash: `0x${"12".repeat(32)}` } });
    await expect(f.bridge.preflight()).rejects.toMatchObject({ code: "FORK_CHANGED" });
    rpc.chainId.mockResolvedValue(1337); await expect(f.bridge.preflight()).rejects.toMatchObject({ code: "NOT_LOCAL_FORK" });
    rpc.chainId.mockResolvedValue(1); rpc.metadata.mockResolvedValue({ instanceId: "test-instance" }); await expect(f.bridge.preflight()).rejects.toMatchObject({ code: "NOT_LOCAL_FORK" });
  });
  it("requires loopback RPC and one signing/recipient wallet, normalizing case", () => {
    const f = fixture(); vi.stubEnv("FORK_PRIVATE_KEY", f.key); vi.stubEnv("GUARDIAN_WALLET", f.address.toLowerCase()); vi.stubEnv("FORK_RPC_URL", "http://127.0.0.1:8545");
    expect(localForkConfig().recipient).toBe(f.address);
    vi.stubEnv("FORK_RPC_URL", "https://eth.drpc.org"); expect(localForkConfig).toThrow(/loopback/);
    vi.stubEnv("FORK_RPC_URL", "http://127.0.0.1:8545"); vi.stubEnv("GUARDIAN_WALLET", `0x${"11".repeat(20)}`); expect(localForkConfig).toThrow(/signing wallet/);
  });
});
