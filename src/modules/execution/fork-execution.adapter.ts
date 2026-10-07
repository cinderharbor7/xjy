import {
  createPublicClient, createWalletClient, decodeEventLog, http, parseAbi, parseAbiItem, toEventSelector,
} from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Chain, PublicClient, WalletClient } from "viem";
import { ExecutionResultSchema } from "@/domain/schemas";
import type { ExecutionResult, MarketState, PolicyConfig, PolicyDecision, PortfolioState } from "@/domain/types";
import type { ExecutionAdapter } from "./execution.adapter";
import { validateApprovedSwap } from "./approved-swap";
import { computeApprovedSourceAmount, isToken0, toRawAmount } from "./fork-amounts";
import { validatePolicyConfig } from "@/modules/policy/policy-config.service";

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])",
]);
const FACTORY_ABI = parseAbi(["function getPair(address tokenA, address tokenB) view returns (address pair)"]);
const SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
);

export interface ForkTokenConfig {
  address: Address;
  decimals: number;
}

export interface ForkChainConfig {
  chain: Chain;
  rpcUrl: string;
  /** Guardian hot wallet key; injected at runtime, never committed. */
  guardianPrivateKey: `0x${string}`;
  /** Wallet under protection: holds the RISK asset and receives the defensive asset. */
  recipient: Address;
  tokens: Record<string, ForkTokenConfig>;
  router: Address;
  factory: Address;
  slippageBps: number;
  deadlineSeconds: number;
}

/** Portfolio and market quotes come from the read side; the Executor never owns balance state. */
export interface ForkAdapterDeps {
  getPortfolio(wallet: string): Promise<PortfolioState>;
  getMarketState(): Promise<MarketState>;
}

/** Test seam only: the fork demo builds its own clients from `chainConfig`. */
export interface ForkAdapterClients {
  publicClient?: PublicClient;
  walletClient?: WalletClient;
}

/**
 * Failure codes the caller can map to its own state machine. Kept as plain strings
 * inside the error message so no frozen schema has to change.
 */
export type ForkExecutionFailureCode =
  /** Guardian/recipient/chain/whitelist does not describe an executable setup. */
  | "CONFIG_INVALID"
  /** Approve, quote or pre-flight failed: no swap transaction was broadcast. */
  | "PRE_SUBMIT_FAILED"
  /** The swap was broadcast but its receipt is unknown. The hash is kept and the swap must never be resent automatically. */
  | "SUBMITTED_UNKNOWN"
  /** The swap transaction was mined and reverted. */
  | "SWAP_REVERTED"
  /** The receipt exists but does not prove the approved amount was swapped. */
  | "RECEIPT_UNVERIFIABLE";

export class ForkExecutionFailure extends Error {
  constructor(
    readonly code: ForkExecutionFailureCode,
    message: string,
    /** Present only once a transaction was broadcast. */
    readonly txHash?: `0x${string}`,
  ) {
    super(`${code}: ${message}`);
    this.name = "ForkExecutionFailure";
  }
}

export type ForkSubmissionStatus = "SUBMITTED_UNKNOWN" | "CONFIRMED" | "REVERTED";

/** In-memory record of what was broadcast. D owns durable persistence and event de-duplication. */
export interface ForkSubmission {
  txHash: `0x${string}`;
  status: ForkSubmissionStatus;
  submittedAt: string;
  decision: PolicyDecision;
  note: string;
}

/** Addresses are compared case-insensitively; raw string equality would reject the same wallet. */
export function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
}

export const ETHEREUM_FORK_TOKENS: Record<string, ForkTokenConfig> = {
  // The RISK asset "ETH" settles as WETH: gas must never subtract from the
  // approved source amount, or the balance-diff receipt check would fail.
  ETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
  USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
};

export const UNISWAP_V2_ROUTER: Address = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
export const UNISWAP_V2_FACTORY: Address = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";

/**
 * A fork keeps the parent chain id unless anvil is started with `--chain-id`.
 * `anvil --fork-url <mainnet rpc>` therefore reports chain id 1, and the client
 * config must say 1 as well: viem refuses to sign when the RPC disagrees.
 * Every execution re-checks this against the live RPC before touching funds.
 */
export const ANVIL_FORK_CHAIN_ID = 1;

export const ANVIL_FORK_CHAIN: Chain = {
  ...mainnet,
  id: ANVIL_FORK_CHAIN_ID,
  name: "Anvil Fork (Ethereum Mainnet)",
  rpcUrls: { default: { http: [] } },
  testnet: true,
};

/**
 * Demo preset for a local `anvil --fork-url <mainnet rpc>` chain (chain id 1).
 * Pass `--chain-id N` to anvil only if you also change the chain id here, so the
 * startup command, this config and the live RPC all agree.
 */
export function createAnvilForkConfig(rpcUrl: string, guardianPrivateKey: `0x${string}`, recipient: Address): ForkChainConfig {
  return {
    chain: ANVIL_FORK_CHAIN,
    rpcUrl,
    guardianPrivateKey,
    recipient,
    tokens: ETHEREUM_FORK_TOKENS,
    router: UNISWAP_V2_ROUTER,
    factory: UNISWAP_V2_FACTORY,
    slippageBps: 300, // 3%
    deadlineSeconds: 600,
  };
}

/**
 * Real on-chain executor for fork networks: turns an approved percentage-point
 * decision into an exact Uniswap V2 swap and returns only a receipt. It never
 * reports balances or "the situation is now safe" — the orchestrator re-reads
 * the portfolio independently and D's verification judges the outcome.
 *
 * Demo wallet model (confirmed 2026-10-07): guardian and protected wallet are the
 * SAME address, so the balance that is read is the balance that is spent. This
 * adapter refuses any other arrangement instead of pretending to support it; a
 * guardian-managed user wallet needs an authorization scheme first.
 */
export class ForkExecutionAdapter implements ExecutionAdapter {
  private readonly config: PolicyConfig;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly guardian: Address;
  private readonly submissionLog: ForkSubmission[] = [];

  constructor(
    trustedConfig: PolicyConfig,
    private readonly chainConfig: ForkChainConfig,
    private readonly deps: ForkAdapterDeps,
    clients: ForkAdapterClients = {},
  ) {
    // The allowlist must be executable on this chain; a symbol that only passes
    // string validation could never be sold, so fail at construction, not mid-execution.
    this.config = validatePolicyConfig(trustedConfig, { executableAssets: Object.keys(chainConfig.tokens) });

    const account = privateKeyToAccount(chainConfig.guardianPrivateKey);
    this.guardian = account.address;
    if (!sameAddress(account.address, chainConfig.recipient)) {
      throw new ForkExecutionFailure(
        "CONFIG_INVALID",
        `the signing wallet ${account.address} is not the protected wallet ${chainConfig.recipient}. `
        + "This adapter reads balances from the protected wallet and spends from the signing wallet, so the fork demo requires one and the same address.",
      );
    }

    this.publicClient = clients.publicClient
      ?? createPublicClient({ chain: chainConfig.chain, transport: http(chainConfig.rpcUrl) });
    this.walletClient = clients.walletClient
      ?? createWalletClient({ account, chain: chainConfig.chain, transport: http(chainConfig.rpcUrl) });
  }

  /** Swap transactions this adapter broadcast, newest last. D decides durability. */
  submissions(): readonly ForkSubmission[] {
    return this.submissionLog;
  }

  /** Broadcast but not yet resolved; these must block a new automatic swap for the same event. */
  pendingSubmissions(): readonly ForkSubmission[] {
    return this.submissionLog.filter((entry) => entry.status === "SUBMITTED_UNKNOWN");
  }

  async execute(decision: PolicyDecision): Promise<ExecutionResult> {
    const timestamp = new Date().toISOString();
    let submittedHash: `0x${string}` | undefined;
    try {
      // The chain the client signs for must be the chain the RPC actually serves.
      const rpcChainId = await this.publicClient.getChainId();
      if (rpcChainId !== this.chainConfig.chain.id) {
        throw new ForkExecutionFailure(
          "CONFIG_INVALID",
          `the RPC reports chain id ${rpcChainId} but the configured chain id is ${this.chainConfig.chain.id}; fix the fork startup command and the chain config together.`,
        );
      }

      // Gate 1: independent re-validation against the trusted user config.
      const approved = validateApprovedSwap(decision, this.config);
      const sourceSymbol = approved.sourceAsset as string;
      const targetSymbol = approved.targetAsset as string;
      const sourceToken = this.chainConfig.tokens[sourceSymbol];
      const targetToken = this.chainConfig.tokens[targetSymbol];
      if (!sourceToken || !targetToken) {
        throw new ForkExecutionFailure(
          "CONFIG_INVALID",
          `no on-chain token config for ${!sourceToken ? sourceSymbol : targetSymbol}; the whitelisted asset is not executable on this chain.`,
        );
      }

      // Gate 2: the exact source amount under the verification pricing.
      // PolicyDecision carries no wallet; the protected wallet comes from trusted config only.
      const portfolio = await this.deps.getPortfolio(this.chainConfig.recipient);
      if (!sameAddress(portfolio.wallet, this.chainConfig.recipient)) {
        throw new ForkExecutionFailure(
          "CONFIG_INVALID",
          `the read side returned portfolio wallet ${portfolio.wallet} while the protected wallet is ${this.chainConfig.recipient}; refusing to price a swap against another wallet's balances.`,
        );
      }
      const market = await this.deps.getMarketState();
      const sourceAmount = computeApprovedSourceAmount(portfolio, market, sourceSymbol, approved.reduceExposurePct as number);
      if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) {
        throw new ForkExecutionFailure("PRE_SUBMIT_FAILED", "the approved reduction cannot be priced into a positive source amount under the market quote.");
      }
      const rawAmount = toRawAmount(sourceAmount, sourceToken.decimals);
      const balance = await this.publicClient.readContract({
        address: sourceToken.address, abi: ERC20_ABI, functionName: "balanceOf", args: [this.chainConfig.recipient],
      });
      if (balance < rawAmount) {
        throw new ForkExecutionFailure(
          "PRE_SUBMIT_FAILED",
          `the protected wallet holds ${balance} raw units of ${sourceSymbol} but the approved swap needs ${rawAmount}.`,
        );
      }

      // Gate 3: approve only the exact amount, then swap with slippage protection.
      const allowance = await this.publicClient.readContract({
        address: sourceToken.address, abi: ERC20_ABI, functionName: "allowance",
        args: [this.chainConfig.recipient, this.chainConfig.router],
      });
      if (allowance < rawAmount) {
        const approveHash = await this.walletClient.writeContract({
          address: sourceToken.address, abi: ERC20_ABI, functionName: "approve",
          args: [this.chainConfig.router, rawAmount], account: this.guardian, chain: this.chainConfig.chain,
        });
        const approveReceipt = await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
        if (approveReceipt.status !== "success") {
          throw new ForkExecutionFailure("PRE_SUBMIT_FAILED", "the token approval transaction reverted; no swap was broadcast.", approveHash);
        }
      }

      const quote = await this.publicClient.readContract({
        address: this.chainConfig.router, abi: ROUTER_ABI, functionName: "getAmountsOut",
        args: [rawAmount, [sourceToken.address, targetToken.address]],
      });
      const expectedOut = quote[quote.length - 1];
      const minOut = expectedOut - (expectedOut * BigInt(this.chainConfig.slippageBps)) / 10_000n;
      if (minOut <= 0n) {
        throw new ForkExecutionFailure("PRE_SUBMIT_FAILED", "slippage protection produced a non-positive minimum output; refusing to broadcast a swap.");
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + this.chainConfig.deadlineSeconds);
      // From here on a hash exists: the swap may already be on chain, so nothing below
      // may be retried automatically — the caller resolves the hash instead.
      submittedHash = await this.walletClient.writeContract({
        address: this.chainConfig.router, abi: ROUTER_ABI, functionName: "swapExactTokensForTokens",
        args: [rawAmount, minOut, [sourceToken.address, targetToken.address], this.chainConfig.recipient, deadline],
        account: this.guardian, chain: this.chainConfig.chain,
      });
      const entry = this.recordSubmission(submittedHash, approved, timestamp);

      const receipt = await this.awaitReceipt(submittedHash);
      if (receipt.status !== "success") {
        entry.status = "REVERTED";
        entry.note = "Swap transaction reverted; the event stays consumed and must not be retried automatically.";
        throw new ForkExecutionFailure("SWAP_REVERTED", `the swap transaction reverted on chain: ${submittedHash}.`, submittedHash);
      }

      // Gate 4: the receipt must come from the pair's own Swap event, not from echoes.
      const pair = await this.publicClient.readContract({
        address: this.chainConfig.factory, abi: FACTORY_ABI, functionName: "getPair",
        args: [sourceToken.address, targetToken.address],
      });
      if (!pair || pair === "0x0000000000000000000000000000000000000000") {
        throw new ForkExecutionFailure("RECEIPT_UNVERIFIABLE", "no Uniswap V2 pair exists for the whitelisted asset pair.", submittedHash);
      }
      const sourceIsToken0 = isToken0(sourceToken.address, targetToken.address);
      // Only decode the pair's Swap logs; pairs also emit Sync/Transfer events.
      const SWAP_TOPIC = toEventSelector(SWAP_EVENT);
      let transferredOut = 0n;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== pair.toLowerCase()) continue;
        if (log.topics[0]?.toLowerCase() !== SWAP_TOPIC) continue;
        const decoded = decodeEventLog({ abi: [SWAP_EVENT], data: log.data, topics: log.topics });
        if (decoded.eventName !== "Swap") continue;
        const amountIn = sourceIsToken0 ? decoded.args.amount0In : decoded.args.amount1In;
        const amountOut = sourceIsToken0 ? decoded.args.amount1Out : decoded.args.amount0Out;
        transferredOut += amountOut;
        if (amountIn !== rawAmount) {
          throw new ForkExecutionFailure(
            "RECEIPT_UNVERIFIABLE",
            `the pair's Swap event reports amountIn ${amountIn}, which does not equal the approved raw amount ${rawAmount}.`,
            submittedHash,
          );
        }
      }
      if (transferredOut <= 0n) {
        throw new ForkExecutionFailure("RECEIPT_UNVERIFIABLE", "the receipt carries no Swap event from the pair, so the executed amount cannot be proven.", submittedHash);
      }

      entry.status = "CONFIRMED";
      entry.note = "Swap receipt confirmed and matched to the approved amount.";
      return ExecutionResultSchema.parse({
        success: true,
        action: "SWAP_TO_SAFE",
        sourceAsset: sourceSymbol,
        targetAsset: targetSymbol,
        sourceAmount: Number(rawAmount) / 10 ** sourceToken.decimals,
        targetAmount: Number(transferredOut) / 10 ** targetToken.decimals,
        txHash: submittedHash,
        timestamp,
      });
    } catch (error) {
      // Failure path: keep the authorized action and assets, no amounts. The frozen
      // ExecutionResult has no "pending" status, so a broadcast-but-unresolved hash is
      // reported inside `error` and through submissions() until C and D agree on a
      // shared status field (public contracts are not modified from a C branch).
      const sourceSymbol = decision.sourceAsset;
      const targetSymbol = decision.targetAsset;
      return ExecutionResultSchema.parse({
        success: false,
        action: "SWAP_TO_SAFE",
        ...(sourceSymbol !== undefined ? { sourceAsset: sourceSymbol } : {}),
        ...(targetSymbol !== undefined ? { targetAsset: targetSymbol } : {}),
        error: describeFailure(error, submittedHash),
        timestamp,
      });
    }
  }

  /**
   * A broadcast swap is never re-sent. A receipt timeout means "unknown", not "failed":
   * the caller keeps the event consumed and queries the known hash.
   */
  private async awaitReceipt(hash: `0x${string}`) {
    try {
      return await this.publicClient.waitForTransactionReceipt({ hash });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ForkExecutionFailure(
        "SUBMITTED_UNKNOWN",
        `the swap ${hash} was broadcast but its receipt could not be confirmed (${reason}). Do not send a new swap for this event; query the receipt of the known hash instead.`,
        hash,
      );
    }
  }

  private recordSubmission(hash: `0x${string}`, decision: PolicyDecision, submittedAt: string): ForkSubmission {
    const entry: ForkSubmission = {
      txHash: hash,
      status: "SUBMITTED_UNKNOWN",
      submittedAt,
      decision,
      note: "Broadcast; awaiting receipt confirmation.",
    };
    this.submissionLog.push(entry);
    return entry;
  }
}

/** Every failure message names its phase, so the caller can distinguish retryable from not. */
export function describeFailure(error: unknown, submittedHash?: `0x${string}`): string {
  if (error instanceof ForkExecutionFailure) return error.message;
  const reason = error instanceof Error ? error.message : String(error);
  if (submittedHash) {
    return `SUBMITTED_UNKNOWN: the swap ${submittedHash} was broadcast but the outcome is unknown (${reason}). `
      + "Do not send a new swap for this event; query the receipt of the known hash instead.";
  }
  return `PRE_SUBMIT_FAILED: no swap was broadcast (${reason}). If the signing client threw after sending, verify the account nonce before retrying.`;
}
