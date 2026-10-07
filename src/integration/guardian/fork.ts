import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, formatUnits, getAddress, http, keccak256, parseAbi, type Address, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ExecutionResultSchema, PortfolioStateSchema, RescueSessionSchema } from "@/domain/schemas";
import type { PortfolioState, RescueSession } from "@/domain/types";
import { verifyRescueOutcome } from "@/domain/verification";
import { createAnvilForkConfig, type ForkChainConfig } from "@/modules/execution/fork-execution.adapter";
import { GuardianError, type GuardianEvent } from "./contracts";
import { GuardianStore } from "./store";

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "event Transfer(address indexed from,address indexed to,uint256 value)"]);
const FACTORY = parseAbi(["function getPair(address,address) view returns (address)"]);
const PAIR = parseAbi(["function getReserves() view returns (uint112,uint112,uint32)", "function token0() view returns (address)"]);

export function localForkConfig(): ForkChainConfig {
  const url = new URL(process.env.FORK_RPC_URL ?? "http://127.0.0.1:8545");
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password) throw new GuardianError(503, "FORK_CONFIG_INVALID", "Fork RPC must be a local HTTP loopback endpoint.");
  const key = process.env.FORK_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new GuardianError(503, "FORK_CONFIG_INVALID", "Set a disposable local Fork private key on the server.");
  const account = privateKeyToAccount(key as `0x${string}`);
  const wallet = process.env.GUARDIAN_WALLET;
  if (!wallet || getAddress(wallet.toLowerCase()) !== account.address) throw new GuardianError(503, "FORK_CONFIG_INVALID", "The configured wallet must be the Fork signing wallet.");
  return createAnvilForkConfig(url.toString(), key as `0x${string}`, account.address);
}

/** D integration bridge pending A's production read adapter; no A module internals changed. */
export class ForkReadBridge {
  readonly client;
  constructor(readonly config: ForkChainConfig, private readonly store: GuardianStore) {
    this.client = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl, { retryCount: 0, timeout: 10_000 }) });
  }
  async preflight() {
    const [chainId, metadata] = await Promise.all([
      this.client.getChainId(),
      // Anvil metadata binds persistent event records to one fork instance, not just chain id 1.
      this.client.request({ method: "anvil_metadata" as never }) as Promise<unknown>,
    ]);
    const meta = metadata as { instanceId?: string; forkedNetwork?: { forkBlockNumber?: number; forkBlockHash?: string } };
    if (chainId !== this.config.chain.id || typeof meta.instanceId !== "string" || !meta.forkedNetwork?.forkBlockHash) throw new GuardianError(503, "NOT_LOCAL_FORK", "Expected an Anvil Ethereum fork with identifiable fork metadata.");
    const identity = `${chainId}:${meta.instanceId}:${meta.forkedNetwork.forkBlockHash}`;
    this.store.change(state => {
      if (state.networkIdentity && state.networkIdentity !== identity) throw new GuardianError(503, "FORK_CHANGED", "The Fork instance changed; existing event state cannot be reused on another chain instance.");
      state.networkIdentity = identity;
    });
  }
  async portfolio(wallet: string): Promise<PortfolioState> {
    if (getAddress(wallet.toLowerCase()) !== this.config.recipient) throw new Error("Wallet mismatch");
    const { ETH, USDC } = this.config.tokens;
    const blockNumber = await this.client.getBlockNumber({ cacheTime: 0 });
    const pair = await this.client.readContract({ address: this.config.factory, abi: FACTORY, functionName: "getPair", args: [ETH.address, USDC.address], blockNumber });
    const [reserves, token0, eth, usdc] = await Promise.all([
      this.client.readContract({ address: pair, abi: PAIR, functionName: "getReserves", blockNumber }),
      this.client.readContract({ address: pair, abi: PAIR, functionName: "token0", blockNumber }),
      this.client.readContract({ address: ETH.address, abi: ERC20, functionName: "balanceOf", args: [this.config.recipient], blockNumber }),
      this.client.readContract({ address: USDC.address, abi: ERC20, functionName: "balanceOf", args: [this.config.recipient], blockNumber }),
    ]);
    const ethFirst = token0.toLowerCase() === ETH.address.toLowerCase();
    const ethReserve = Number(formatUnits(reserves[ethFirst ? 0 : 1], ETH.decimals));
    const usdcReserve = Number(formatUnits(reserves[ethFirst ? 1 : 0], USDC.decimals));
    const price = usdcReserve / ethReserve;
    if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid pool quote");
    const amount = Number(formatUnits(eth, ETH.decimals)), safeAmount = Number(formatUnits(usdc, USDC.decimals));
    const riskAssetUsd = amount * price, totalUsd = riskAssetUsd + safeAmount;
    return PortfolioStateSchema.parse({ wallet: this.config.recipient, totalUsd, riskAssetUsd, defensiveAssetUsd: safeAmount,
      riskExposurePct: totalUsd ? riskAssetUsd / totalUsd * 100 : 0, blockNumber: Number(blockNumber), timestamp: new Date().toISOString(),
      assets: [{ symbol: "ETH", tokenAddress: ETH.address, amount, usdValue: riskAssetUsd, category: "RISK" }, { symbol: "USDC", tokenAddress: USDC.address, amount: safeAmount, usdValue: safeAmount, category: "DEFENSIVE" }],
    });
  }
  async price(): Promise<number> {
    // A zero WETH balance must not make market price unavailable.
    const { ETH, USDC } = this.config.tokens;
    const pair = await this.client.readContract({ address: this.config.factory, abi: FACTORY, functionName: "getPair", args: [ETH.address, USDC.address] });
    const [r, first] = await Promise.all([this.client.readContract({ address: pair, abi: PAIR, functionName: "getReserves" }), this.client.readContract({ address: pair, abi: PAIR, functionName: "token0" })]);
    const ethFirst = first.toLowerCase() === ETH.address.toLowerCase();
    return Number(formatUnits(r[ethFirst ? 1 : 0], USDC.decimals)) / Number(formatUnits(r[ethFirst ? 0 : 1], ETH.decimals));
  }
  journaledWallet(journal: (kind: "APPROVE" | "SWAP", hash: string) => void): WalletClient {
    const account = privateKeyToAccount(this.config.guardianPrivateKey);
    const wallet = createWalletClient({ account, chain: this.config.chain, transport: http(this.config.rpcUrl, { retryCount: 0, timeout: 10_000 }) });
    // Locally sign first. Persist its deterministic hash BEFORE attempting RPC broadcast.
    // No private key or serialized signed transaction is persisted or sent to the UI.
    const write: WalletClient["writeContract"] = async args => {
      await this.preflight();
      const kind = args.functionName === "approve" ? "APPROVE" : args.functionName === "swapExactTokensForTokens" ? "SWAP" : undefined;
      if (!kind || args.address.toLowerCase() !== (kind === "APPROVE" ? this.config.tokens.ETH.address : this.config.router).toLowerCase()) throw new Error("Unexpected contract write");
      const data = encodeFunctionData({ abi: args.abi, functionName: args.functionName, args: args.args } as Parameters<typeof encodeFunctionData>[0]);
      const prepared = await wallet.prepareTransactionRequest({ account, to: args.address, data, value: 0n });
      const serialized = await account.signTransaction(prepared as Parameters<typeof account.signTransaction>[0]);
      const hash = keccak256(serialized);
      journal(kind, hash);
      const broadcastHash = await this.client.sendRawTransaction({ serializedTransaction: serialized });
      if (broadcastHash !== hash) throw new Error("Unexpected broadcast hash");
      return hash;
    };
    return { ...wallet, writeContract: write } as WalletClient;
  }
  async resolve(event: GuardianEvent): Promise<RescueSession | "PENDING" | "REVERTED" | "UNVERIFIABLE"> {
    await this.preflight();
    const submitted = event.submissions.find(s => s.kind === "SWAP");
    if (!submitted) return "UNVERIFIABLE";
    let receipt;
    try { receipt = await this.client.getTransactionReceipt({ hash: submitted.hash as `0x${string}` }); }
    catch { return "PENDING"; }
    if (receipt.status !== "success") return "REVERTED";
    let source = 0n, target = 0n;
    for (const log of receipt.logs) {
      const asset = Object.entries(this.config.tokens).find(([, token]) => token.address.toLowerCase() === log.address.toLowerCase())?.[0];
      if (!asset) continue;
      try {
        const decoded = decodeEventLog({ abi: ERC20, data: log.data, topics: log.topics });
        if (decoded.eventName !== "Transfer") continue;
        const from = decoded.args.from.toLowerCase(), to = decoded.args.to.toLowerCase(), owner = this.config.recipient.toLowerCase();
        if (asset === "ETH") source += (from === owner ? decoded.args.value : 0n) - (to === owner ? decoded.args.value : 0n);
        if (asset === "USDC") target += (to === owner ? decoded.args.value : 0n) - (from === owner ? decoded.args.value : 0n);
      } catch { /* Non-Transfer logs from token contracts carry no balance evidence. */ }
    }
    if (source <= 0n || target <= 0n) return "UNVERIFIABLE";
    const execution = ExecutionResultSchema.parse({ success: true, action: "SWAP_TO_SAFE", sourceAsset: "ETH", targetAsset: "USDC",
      sourceAmount: Number(formatUnits(source, this.config.tokens.ETH.decimals)), targetAmount: Number(formatUnits(target, this.config.tokens.USDC.decimals)), txHash: submitted.hash, timestamp: submitted.timestamp });
    const after = await this.portfolio(this.config.recipient);
    return RescueSessionSchema.parse({ ...event.analysis, execution, after, verification: verifyRescueOutcome(event.analysis.before, after, event.analysis.policyDecision, execution, event.analysis.market) });
  }
}
