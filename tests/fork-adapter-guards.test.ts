import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { PortfolioStateSchema } from "@/domain/schemas";
import type { MarketState, PolicyConfig, PolicyDecision, PortfolioState } from "@/domain/types";
import {
  ForkExecutionAdapter, ForkExecutionFailure, describeFailure, sameAddress,
  type ForkAdapterDeps,
} from "@/modules/execution/fork-execution.adapter";
import { ANVIL_FORK_CHAIN } from "@/modules/execution/fork-execution.adapter";

/**
 * Unit guards for the fork adapter. These need no chain: the point is that a
 * misconfigured setup is refused BEFORE anything is signed or broadcast.
 * The real swap path is covered by tests/fork-integration.test.ts (FORK_RPC_URL).
 */

const GUARDIAN_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as `0x${string}`;
const GUARDIAN_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER_WALLET = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const RPC_URL = "http://127.0.0.1:8545";

const CONFIG: PolicyConfig = {
  minRiskScore: 80,
  minConfidence: 0.85,
  minRiskExposurePct: 70,
  maxDeRiskPct: 30,
  allowedRiskAssets: ["ETH"],
  allowedDefensiveAssets: ["USDC"],
};

const DECISION: PolicyDecision = {
  triggered: true,
  action: "SWAP_TO_SAFE",
  sourceAsset: "ETH",
  targetAsset: "USDC",
  reduceExposurePct: 30,
  reasons: ["test fixture"],
};

const market: MarketState = {
  asset: "ETH",
  priceUsd: 2700,
  priceChange5mPct: -3,
  priceChange1hPct: -10,
  volatilityScore: 82,
  timestamp: new Date().toISOString(),
};

function portfolioFor(wallet: string, ethAmount = 10): PortfolioState {
  const riskUsd = ethAmount * 2700;
  return PortfolioStateSchema.parse({
    wallet,
    totalUsd: riskUsd,
    riskAssetUsd: riskUsd,
    defensiveAssetUsd: 0,
    riskExposurePct: 100,
    assets: [{ symbol: "ETH", amount: ethAmount, usdValue: riskUsd, category: "RISK" }],
    timestamp: new Date().toISOString(),
  });
}

/** Only the client methods the guard needs; nothing is ever signed in these tests. */
function fakeClients(chainId: number) {
  return { publicClient: { getChainId: async () => chainId } as unknown as PublicClient };
}

function deps(portfolio: PortfolioState): ForkAdapterDeps {
  return { getPortfolio: async () => portfolio, getMarketState: async () => market };
}

function build(overrides: {
  recipient?: string;
  config?: PolicyConfig;
  portfolio?: PortfolioState;
  chainId?: number;
} = {}) {
  const recipient = (overrides.recipient ?? GUARDIAN_ADDRESS) as `0x${string}`;
  return new ForkExecutionAdapter(
    overrides.config ?? CONFIG,
    {
      chain: { ...ANVIL_FORK_CHAIN, id: 1 },
      rpcUrl: RPC_URL,
      guardianPrivateKey: GUARDIAN_KEY,
      recipient,
      tokens: {
        ETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
        USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
      },
      router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
      factory: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
      slippageBps: 300,
      deadlineSeconds: 600,
    },
    deps(overrides.portfolio ?? portfolioFor(recipient)),
    fakeClients(overrides.chainId ?? 1),
  );
}

describe("ForkExecutionAdapter wallet relationship (D→C 3.2)", () => {
  it("rejects a signing wallet that is not the protected wallet", () => {
    expect(() => build({ recipient: OTHER_WALLET })).toThrow(ForkExecutionFailure);
    expect(() => build({ recipient: OTHER_WALLET })).toThrow(/CONFIG_INVALID/);
  });

  it("accepts the same address written in a different case", () => {
    expect(() => build({ recipient: GUARDIAN_ADDRESS.toLowerCase() })).not.toThrow();
    expect(sameAddress(GUARDIAN_ADDRESS, GUARDIAN_ADDRESS.toLowerCase())).toBe(true);
  });

  it("refuses to price a swap against another wallet's balances", async () => {
    const adapter = build({ portfolio: portfolioFor(OTHER_WALLET) });
    const result = await adapter.execute(DECISION);
    expect(result.success).toBe(false);
    expect(result.error).toContain("CONFIG_INVALID");
    expect(result.txHash).toBeUndefined();
    // Nothing was broadcast, so nothing may be reported as pending.
    expect(adapter.submissions()).toHaveLength(0);
  });
});

describe("ForkExecutionAdapter chain and whitelist guards (D→C 3.1 / 3.3)", () => {
  it("rejects a whitelisted asset the chain config cannot execute", () => {
    expect(() => build({ config: { ...CONFIG, allowedDefensiveAssets: ["DAI"] } }))
      .toThrow(/no on-chain token config/);
  });

  it("refuses to trade when the RPC chain id differs from the configured chain id", async () => {
    const adapter = build({ chainId: 1337 });
    const result = await adapter.execute(DECISION);
    expect(result.success).toBe(false);
    expect(result.error).toContain("CONFIG_INVALID");
    expect(adapter.submissions()).toHaveLength(0);
  });
});

describe("ForkExecutionAdapter failure semantics (D→C 3.4)", () => {
  it("labels a pre-submit failure and never invents a receipt", async () => {
    const adapter = build({ chainId: 1337 });
    const result = await adapter.execute(DECISION);
    expect(result.sourceAmount).toBeUndefined();
    expect(result.targetAmount).toBeUndefined();
    expect(result.txHash).toBeUndefined();
    expect(result.error).toBeDefined();
    expect(adapter.pendingSubmissions()).toHaveLength(0);
  });

  it("describes a broadcast-but-unresolved hash as unknown, not failed", () => {
    const message = describeFailure(new Error("timeout"), "0xabc");
    expect(message).toContain("SUBMITTED_UNKNOWN");
    expect(message).toContain("0xabc");
    expect(message).toContain("Do not send a new swap");
  });

  it("keeps a typed failure message intact for the caller", () => {
    const failure = new ForkExecutionFailure("SWAP_REVERTED", "the swap reverted on chain.", `0x${"a".repeat(64)}`);
    expect(failure.code).toBe("SWAP_REVERTED");
    expect(failure.txHash).toBe(`0x${"a".repeat(64)}`);
    expect(describeFailure(failure, undefined)).toContain("SWAP_REVERTED");
  });
});
