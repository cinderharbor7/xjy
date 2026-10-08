import { describe, expect, it, vi } from "vitest";
import { ensureBotChain, walletMessage, transactionUrl, type InjectedWallet } from "@/modules/attestation/bot-chain";
const account = `0x${"11".repeat(20)}` as const;
describe("MetaMask BOT network boundary", () => {
  it("adds unknown chain 677 with BOT currency, then verifies account and chain", async () => {
    let network = "0x1", added = false;
    const request = vi.fn(async ({ method, params }) => {
      if (method === "eth_chainId") return network;
      if (method === "eth_accounts") return [account];
      if (method === "wallet_switchEthereumChain") { if (!added) throw { code: 4902 }; network = params[0].chainId; return null; }
      if (method === "wallet_addEthereumChain") { expect(params[0]).toMatchObject({ chainId: "0x2a5", nativeCurrency: { symbol: "BOT", decimals: 18 } }); added = true; return null; }
      throw new Error(method);
    });
    await ensureBotChain({ request } as unknown as InjectedWallet, account);
    expect(network).toBe("0x2a5"); expect(request.mock.calls.filter(([r]) => r.method === "wallet_switchEthereumChain")).toHaveLength(2);
  });
  it("does not treat rejected network switch as a reason to add a chain or send a transaction", async () => {
    const request = vi.fn(async ({ method }) => { if (method === "eth_chainId") return "0x1"; throw { code: 4001 }; });
    await expect(ensureBotChain({ request } as unknown as InjectedWallet, account)).rejects.toMatchObject({ code: 4001 });
    expect(request).toHaveBeenCalledTimes(2); expect(walletMessage({ cause: { code: 4001 } })).toContain("取消");
  });
  it("rejects changed account and keeps transaction links on BOT explorer", async () => {
    const request = vi.fn(async ({ method }) => method === "eth_chainId" ? "0x2a5" : [`0x${"22".repeat(20)}`]);
    await expect(ensureBotChain({ request } as unknown as InjectedWallet, account)).rejects.toThrow(/账户/);
    expect(transactionUrl(`0x${"ab".repeat(32)}`)).toBe(`https://scan.botchain.ai/tx/0x${"ab".repeat(32)}`);
  });
});
