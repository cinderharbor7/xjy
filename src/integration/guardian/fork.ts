import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, formatUnits, getAddress, http, keccak256, parseAbi, type TransactionReceipt, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ExecutionResultSchema, RescueSessionSchema } from "@/domain/schemas";
import type { ExecutionResult, PortfolioState, RescueSession } from "@/domain/types";
import { verifyRescueOutcome } from "@/domain/verification";
import { createAnvilForkConfig, type ForkChainConfig } from "@/modules/execution/fork-execution.adapter";
import { ForkObservationReader } from "@/modules/onchain/fork-observation-reader";
import { GuardianError, type GuardianEvent } from "./contracts";
import { GuardianStore } from "./store";

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "event Transfer(address indexed from,address indexed to,uint256 value)"]);

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

/** D owns Fork identity and signing journal; A owns canonical balance/quote observations. */
export class ForkReadBridge {
  readonly client;
  private readonly reader: ForkObservationReader;
  constructor(readonly config: ForkChainConfig, private readonly store: GuardianStore) {
    this.client = createPublicClient({ chain: config.chain, cacheTime: 0, transport: http(config.rpcUrl, { retryCount: 0, timeout: 10_000 }) });
    this.reader = new ForkObservationReader(this.client, { chainId: config.chain.id, wallet: config.recipient,
      factory: config.factory, weth: config.tokens.ETH, usdc: config.tokens.USDC });
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
  async observation(wallet: string) {
    await this.preflight();
    return this.reader.read(wallet);
  }
  async portfolio(wallet: string): Promise<PortfolioState> {
    return (await this.observation(wallet)).portfolio;
  }
  /** A mined Fork execution is timed by its canonical receipt block, not the signing clock. */
  private async receiptTimestamp(receipt: TransactionReceipt, hash: string): Promise<string> {
    if (receipt.status !== "success" || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error("Receipt does not confirm this swap");
    const block = await this.client.getBlock({ blockNumber: receipt.blockNumber });
    if (block.number !== receipt.blockNumber || block.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()
      || block.timestamp < 0n || block.timestamp > 253_402_300_799n) throw new Error("Receipt block is not canonical or has invalid time");
    return new Date(Number(block.timestamp) * 1000).toISOString();
  }
  async confirmedExecution(execution: ExecutionResult): Promise<ExecutionResult> {
    if (!execution.success) return execution;
    if (!execution.txHash) throw new Error("Confirmed swap requires a transaction hash");
    const receipt = await this.client.getTransactionReceipt({ hash: execution.txHash as `0x${string}` });
    return ExecutionResultSchema.parse({ ...execution, timestamp: await this.receiptTimestamp(receipt, execution.txHash) });
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
      sourceAmount: Number(formatUnits(source, this.config.tokens.ETH.decimals)), targetAmount: Number(formatUnits(target, this.config.tokens.USDC.decimals)), txHash: submitted.hash, timestamp: await this.receiptTimestamp(receipt, submitted.hash) });
    const after = await this.portfolio(this.config.recipient);
    if (after.blockNumber === undefined || after.blockNumber < Number(receipt.blockNumber)) throw new Error("The after observation predates the receipt block");
    return RescueSessionSchema.parse({ ...event.analysis, execution, after, verification: verifyRescueOutcome(event.analysis.before, after, event.analysis.policyDecision, execution, event.analysis.market) });
  }
}
