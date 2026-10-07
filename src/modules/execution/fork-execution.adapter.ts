import {
  createPublicClient, createWalletClient, decodeEventLog, http, parseAbi, parseAbiItem, toEventSelector,
} from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Chain, PublicClient, WalletClient } from "viem";
import { ExecutionResultSchema, PolicyConfigSchema } from "@/domain/schemas";
import type { ExecutionResult, MarketState, PolicyConfig, PolicyDecision, PortfolioState } from "@/domain/types";
import type { ExecutionAdapter } from "./execution.adapter";
import { validateApprovedSwap } from "./approved-swap";
import { computeApprovedSourceAmount, isToken0, toRawAmount } from "./fork-amounts";

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
  /** Recipient of the defensive asset; usually the user wallet under protection. */
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

export const ETHEREUM_FORK_TOKENS: Record<string, ForkTokenConfig> = {
  // The RISK asset "ETH" settles as WETH: gas must never subtract from the
  // approved source amount, or the balance-diff receipt check would fail.
  ETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
  USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
};

export const UNISWAP_V2_ROUTER: Address = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
export const UNISWAP_V2_FACTORY: Address = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";

export const ANVIL_FORK_CHAIN: Chain = {
  ...mainnet,
  // A fork keeps the parent chain id (1) unless anvil is started with --chain-id.
  id: 1,
  name: "Anvil Fork (Ethereum Mainnet)",
  rpcUrls: { default: { http: [] } },
  testnet: true,
};

/** Demo preset for a local `anvil --fork-url <mainnet rpc> --chain-id 1337` chain. */
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
 */
export class ForkExecutionAdapter implements ExecutionAdapter {
  private readonly config: PolicyConfig;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly guardian: Address;

  constructor(
    trustedConfig: PolicyConfig,
    private readonly chainConfig: ForkChainConfig,
    private readonly deps: ForkAdapterDeps,
  ) {
    const parsed = PolicyConfigSchema.parse(trustedConfig);
    this.config = parsed;
    const account = privateKeyToAccount(chainConfig.guardianPrivateKey);
    this.guardian = account.address;
    this.publicClient = createPublicClient({ chain: chainConfig.chain, transport: http(chainConfig.rpcUrl) });
    this.walletClient = createWalletClient({ account, chain: chainConfig.chain, transport: http(chainConfig.rpcUrl) });
  }

  async execute(decision: PolicyDecision): Promise<ExecutionResult> {
    const timestamp = new Date().toISOString();
    try {
      // Gate 1: independent re-validation against the trusted user config.
      const approved = validateApprovedSwap(decision, this.config);
      const sourceSymbol = approved.sourceAsset as string;
      const targetSymbol = approved.targetAsset as string;
      const sourceToken = this.chainConfig.tokens[sourceSymbol];
      const targetToken = this.chainConfig.tokens[targetSymbol];
      if (!sourceToken || !targetToken) {
        throw new Error(`No on-chain token config for ${!sourceToken ? sourceSymbol : targetSymbol}; the whitelisted asset is not executable on this chain.`);
      }

      // Gate 2: the exact source amount under the verification pricing.
      // PolicyDecision carries no wallet; the protected wallet comes from trusted config only.
      const portfolio = await this.deps.getPortfolio(this.chainConfig.recipient);
      const market = await this.deps.getMarketState();
      const sourceAmount = computeApprovedSourceAmount(portfolio, market, sourceSymbol, approved.reduceExposurePct as number);
      if (!Number.isFinite(sourceAmount) || sourceAmount <= 0) {
        throw new Error("Approved reduction cannot be priced into a positive source amount under the market quote.");
      }
      const rawAmount = toRawAmount(sourceAmount, sourceToken.decimals);
      const balance = await this.publicClient.readContract({
        address: sourceToken.address, abi: ERC20_ABI, functionName: "balanceOf", args: [this.chainConfig.recipient],
      });
      if (balance < rawAmount) {
        throw new Error(`Guardian holds ${balance} raw units of ${sourceSymbol}; approved swap needs ${rawAmount}.`);
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
        if (approveReceipt.status !== "success") throw new Error("Token approval transaction reverted.");
      }

      const quote = await this.publicClient.readContract({
        address: this.chainConfig.router, abi: ROUTER_ABI, functionName: "getAmountsOut",
        args: [rawAmount, [sourceToken.address, targetToken.address]],
      });
      const expectedOut = quote[quote.length - 1];
      const minOut = expectedOut - (expectedOut * BigInt(this.chainConfig.slippageBps)) / 10_000n;
      if (minOut <= 0n) throw new Error("Slippage protection produced a non-positive minimum output.");

      const deadline = BigInt(Math.floor(Date.now() / 1000) + this.chainConfig.deadlineSeconds);
      const swapHash = await this.walletClient.writeContract({
        address: this.chainConfig.router, abi: ROUTER_ABI, functionName: "swapExactTokensForTokens",
        args: [rawAmount, minOut, [sourceToken.address, targetToken.address], this.chainConfig.recipient, deadline],
        account: this.guardian, chain: this.chainConfig.chain,
      });
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: swapHash });
      if (receipt.status !== "success") throw new Error(`Swap transaction reverted: ${swapHash}.`);

      // Gate 4: the receipt must come from the pair's own Swap event, not from echoes.
      const pair = await this.publicClient.readContract({
        address: this.chainConfig.factory, abi: FACTORY_ABI, functionName: "getPair",
        args: [sourceToken.address, targetToken.address],
      });
      if (!pair || pair === "0x0000000000000000000000000000000000000000") {
        throw new Error("No Uniswap V2 pair exists for the whitelisted asset pair.");
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
        if (amountIn !== rawAmount) throw new Error(`Pair Swap event amountIn ${amountIn} does not equal the approved raw amount ${rawAmount}.`);
      }
      if (transferredOut <= 0n) throw new Error("No Swap event from the pair receipt; execution outcome is unverifiable.");

      return ExecutionResultSchema.parse({
        success: true,
        action: "SWAP_TO_SAFE",
        sourceAsset: sourceSymbol,
        targetAsset: targetSymbol,
        sourceAmount: Number(rawAmount) / 10 ** sourceToken.decimals,
        targetAmount: Number(transferredOut) / 10 ** targetToken.decimals,
        txHash: swapHash,
        timestamp,
      });
    } catch (error) {
      // Failed path: keep the authorized action and assets, no amounts, no hash.
      const sourceSymbol = decision.sourceAsset;
      const targetSymbol = decision.targetAsset;
      const reason = error instanceof Error ? error.message : String(error);
      return ExecutionResultSchema.parse({
        success: false,
        action: "SWAP_TO_SAFE",
        ...(sourceSymbol !== undefined ? { sourceAsset: sourceSymbol } : {}),
        ...(targetSymbol !== undefined ? { targetAsset: targetSymbol } : {}),
        error: reason,
        timestamp,
      });
    }
  }
}
