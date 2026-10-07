import { describe, expect, it } from "vitest";
import { createWalletClient, custom, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ForkExecutionAdapter, createAnvilForkConfig } from "@/modules/execution/fork-execution.adapter";
import { DEMO_POLICY_CONFIG, MockScenarioState } from "@/mocks/scenarios";

describe("Fork signing authority", () => {
  it("signs approve locally for a disposable key instead of relying on an unlocked RPC wallet", async () => {
    const key = `0x${"12".repeat(32)}` as const;
    const account = privateKeyToAccount(key);
    const config = createAnvilForkConfig("http://127.0.0.1:8545", key, account.address);
    const methods: string[] = [];
    const wallet = createWalletClient({ account, chain: config.chain, transport: custom({
      async request({ method }) {
        methods.push(method);
        if (method === "eth_chainId") return "0x1";
        if (method === "eth_getTransactionCount") return "0x0";
        if (method === "eth_estimateGas") return "0x186a0";
        if (method === "eth_maxPriorityFeePerGas" || method === "eth_gasPrice") return "0x1";
        if (method === "eth_getBlockByNumber") return { number: "0x1", hash: `0x${"ab".repeat(32)}`,
          timestamp: "0x1", baseFeePerGas: "0x1", gasLimit: "0x1c9c380", gasUsed: "0x0", transactions: [] };
        if (method === "eth_sendRawTransaction") return `0x${"cd".repeat(32)}`;
        throw new Error(`Unexpected RPC: ${method}`);
      },
    }, { retryCount: 0 }) });
    const scenario = new MockScenarioState(account.address);
    const publicClient = {
      getChainId: async () => 1,
      readContract: async ({ functionName }: { functionName: string }) => functionName === "balanceOf" ? 10n ** 20n : 0n,
      waitForTransactionReceipt: async () => { throw new Error("End offline test after locally signed approval"); },
    } as unknown as PublicClient;
    const adapter = new ForkExecutionAdapter(DEMO_POLICY_CONFIG, config, {
      getPortfolio: async wallet => scenario.getPortfolio(wallet),
      getMarketState: async () => scenario.getMarketState(),
    }, { publicClient, walletClient: wallet });
    const result = await adapter.execute({ triggered: true, action: "SWAP_TO_SAFE", sourceAsset: "ETH",
      targetAsset: "USDC", reduceExposurePct: 30, reasons: ["Approved offline fixture"] });
    expect(result.success).toBe(false);
    expect(methods).toContain("eth_sendRawTransaction");
    expect(methods).not.toContain("eth_sendTransaction");
  });
});
