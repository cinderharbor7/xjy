import { beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import type { MarketState, PortfolioState, RiskAnalysis } from "@/domain/types";
import { MarketStateSchema, PortfolioStateSchema, RiskAnalysisSchema } from "@/domain/schemas";
import { verifyRescueOutcome } from "@/domain/verification";
import { PolicyService } from "@/modules/policy/policy.service";
import { ExecutionService } from "@/modules/execution/execution.service";
import {
  ForkExecutionAdapter, UNISWAP_V2_FACTORY, UNISWAP_V2_ROUTER, createAnvilForkConfig,
} from "@/modules/execution/fork-execution.adapter";
import type { PolicyConfig } from "@/domain/types";

/**
 * End-to-end test against a local anvil fork of Ethereum mainnet.
 * Skipped unless FORK_RPC_URL is set:
 *   FORK_RPC_URL=http://127.0.0.1:8545 pnpm vitest run tests/fork-integration.test.ts
 *
 * Prep on the fork (see scripts/README or memory log):
 *   anvil --fork-url https://eth.drpc.org --port 8545
 *   fund the demo wallet and wrap 10 ETH into WETH for it.
 */

const RPC_URL = process.env.FORK_RPC_URL;
const W1: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ANVIL_KEY_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as `0x${string}`;
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

const POLICY_CONFIG: PolicyConfig = {
  minRiskScore: 80,
  minConfidence: 0.85,
  minRiskExposurePct: 70,
  maxDeRiskPct: 30,
  allowedRiskAssets: ["ETH"],
  allowedDefensiveAssets: ["USDC"],
};

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);
const FACTORY = parseAbi(["function getPair(address,address) view returns (address)"]);
const PAIR = parseAbi(["function getReserves() view returns (uint112,uint112,uint32)"]);

describe.skipIf(!RPC_URL)("ForkExecutionAdapter end-to-end on anvil fork", () => {
  let client: ReturnType<typeof createPublicClient>;

  beforeAll(async () => {
    client = createPublicClient({ chain: { ...mainnet, id: 1 }, transport: http(RPC_URL) });
    // Top the demo wallet back up; fork state persists across runs and prior
    // swaps accumulate USDC, so wrap enough WETH to keep exposure above 70%.
    const account = privateKeyToAccount(ANVIL_KEY_1);
    const wallet = createWalletClient({ account, chain: { ...mainnet, id: 1 }, transport: http(RPC_URL) });
    const current = await readPortfolioRaw();
    const usdcUsd = current.defensiveAssetUsd;
    const ethPrice = current.ethPrice;
    const requiredForExposure = (usdcUsd * 2.5) / ethPrice; // exposure(2.5x) ≈ 71.4%
    const target = Math.max(10, Math.ceil(requiredForExposure - current.ethAmount) + current.ethAmount);
    if (current.ethAmount < target) {
      const missing = target - current.ethAmount;
      const hash = await wallet.writeContract({
        address: WETH, abi: parseAbi(["function deposit() payable"]),
        functionName: "deposit",
        value: BigInt(Math.round(missing * 1e18)),
        account: W1, chain: { ...mainnet, id: 1 },
      });
      await client.waitForTransactionReceipt({ hash });
    }
  });

  /** Raw chain values (balances + pool price) before schema assembly. */
  async function readPortfolioRaw(): Promise<{ ethAmount: number; usdcAmount: number; ethPrice: number; defensiveAssetUsd: number }> {
    const pair = await client.readContract({ address: UNISWAP_V2_FACTORY, abi: FACTORY, functionName: "getPair", args: [WETH, USDC] });
    const [reserve0, reserve1] = await client.readContract({ address: pair as Address, abi: PAIR, functionName: "getReserves" });
    const ethPrice = Number(reserve0) / 1e6 / (Number(reserve1) / 1e18);
    const [wethRaw, usdcRaw] = await Promise.all([
      client.readContract({ address: WETH, abi: ERC20, functionName: "balanceOf", args: [W1] }),
      client.readContract({ address: USDC, abi: ERC20, functionName: "balanceOf", args: [W1] }),
    ]);
    return {
      ethAmount: Number(wethRaw) / 1e18,
      usdcAmount: Number(usdcRaw) / 1e6,
      ethPrice,
      defensiveAssetUsd: Number(usdcRaw) / 1e6,
    };
  }

  /** Real read side for the test: balances from the chain, price from the pool reserves. */
  async function readPortfolio(): Promise<PortfolioState> {
    const { ethAmount, usdcAmount, ethPrice } = await readPortfolioRaw();
    const riskUsd = ethAmount * ethPrice;
    const total = riskUsd + usdcAmount;
    return PortfolioStateSchema.parse({
      wallet: W1,
      totalUsd: total,
      riskAssetUsd: riskUsd,
      defensiveAssetUsd: usdcAmount,
      riskExposurePct: total === 0 ? 0 : (riskUsd / total) * 100,
      assets: [
        { symbol: "ETH", amount: ethAmount, usdValue: riskUsd, category: "RISK" },
        { symbol: "USDC", amount: usdcAmount, usdValue: usdcAmount, category: "DEFENSIVE" },
      ],
      timestamp: new Date().toISOString(),
    });
  }

  async function readMarket(): Promise<MarketState> {
    const before = await readPortfolio();
    return MarketStateSchema.parse({
      asset: "ETH",
      priceUsd: before.assets.find((a) => a.symbol === "ETH")!.usdValue
        / before.assets.find((a) => a.symbol === "ETH")!.amount,
      priceChange5mPct: -3,
      priceChange1hPct: -10,
      volatilityScore: 82,
      timestamp: new Date().toISOString(),
    });
  }

  it("runs policy → real swap → independent re-read → verification, all PASSED", { timeout: 120_000 }, async () => {
    const before = await readPortfolio();
    expect(before.assets.find((a) => a.symbol === "ETH")!.amount).toBeGreaterThanOrEqual(10);

    const market = await readMarket();
    const risk: RiskAnalysis = RiskAnalysisSchema.parse({
      riskScore: 95,
      confidence: 0.9,
      riskExposurePct: before.riskExposurePct,
      stressTests: [
        { priceChangePct: -10, projectedPortfolioUsd: before.totalUsd * 0.9, projectedLossUsd: before.totalUsd * 0.1 },
      ],
      investigation: {
        summary: "Concentrated ETH exposure while DEX sell pressure spikes.",
        primaryCause: "Single-asset concentration.",
        evidence: ["mock investigation for fork demo"],
        uncertainties: [],
        confidence: 0.9,
      },
      recommendedAction: "SWAP_TO_SAFE",
    });

    // C's full chain: policy decision → guarded execution → receipt.
    const policy = new PolicyService(POLICY_CONFIG);
    const decision = policy.evaluate(before, risk);
    expect(decision.triggered).toBe(true);
    expect(decision.reduceExposurePct).toBe(30);

    const adapter = new ForkExecutionAdapter(
      POLICY_CONFIG,
      createAnvilForkConfig(RPC_URL!, ANVIL_KEY_1, W1),
      { getPortfolio: readPortfolio, getMarketState: readMarket },
    );
    const executionService = new ExecutionService(adapter, POLICY_CONFIG);
    const execution = await executionService.execute(decision);
    expect(execution.success).toBe(true);
    expect(execution.txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(execution.sourceAsset).toBe("ETH");
    expect(execution.targetAsset).toBe("USDC");
    expect(execution.sourceAmount).toBeGreaterThan(0);

    // Independent re-read and D's verification, exactly as the orchestrator does.
    const after = await readPortfolio();
    const verification = verifyRescueOutcome(before, after, decision, execution, market);
    expect(verification.status).toBe("PASSED");
    for (const reason of verification.reasons) expect(reason.startsWith("Passed")).toBe(true);

    const afterEth = after.assets.find((a) => a.symbol === "ETH")!.amount;
    const beforeEth = before.assets.find((a) => a.symbol === "ETH")!.amount;
    expect(afterEth).toBeCloseTo(beforeEth - (execution.sourceAmount as number), 9);
    expect(after.riskExposurePct).toBeLessThan(before.riskExposurePct);
  });

  it("returns a structured failure when the wallet holds nothing to sell", { timeout: 60_000 }, async () => {
    const before = await readPortfolio(); // portfolio is now post-swap; build a synthetic empty one
    const usdc = before.assets.find((a) => a.symbol === "USDC")!;
    const empty = PortfolioStateSchema.parse({
      wallet: before.wallet,
      totalUsd: usdc.usdValue,
      riskAssetUsd: 0,
      defensiveAssetUsd: usdc.usdValue,
      riskExposurePct: 0,
      assets: [
        { symbol: "ETH", amount: 0, usdValue: 0, category: "RISK" },
        { symbol: "USDC", amount: usdc.amount, usdValue: usdc.usdValue, category: "DEFENSIVE" },
      ],
      timestamp: new Date().toISOString(),
    });
    const market = await readMarket();
    const risk: RiskAnalysis = RiskAnalysisSchema.parse({
      riskScore: 95, confidence: 0.9, riskExposurePct: 0,
      stressTests: [], investigation: {
        summary: "s", primaryCause: "s", evidence: [], uncertainties: [], confidence: 0.9,
      },
      recommendedAction: "SWAP_TO_SAFE",
    });
    const policy = new PolicyService(POLICY_CONFIG);
    const decision = policy.evaluate(empty, risk);
    expect(decision.triggered).toBe(false); // no held risk asset → policy itself declines
    expect(decision.action).toBe("NONE");
    void market;
  });
});
