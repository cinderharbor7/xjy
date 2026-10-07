import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { MarketStateSchema } from "@/domain/schemas";
import type { MarketState, PortfolioState } from "@/domain/types";
import { DEMO_POLICY_CONFIG, DEMO_WALLET, MockScenarioState } from "@/mocks/scenarios";
import { RescueOrchestrator } from "@/modules/rescue/rescue.orchestrator";
import { PortfolioService } from "@/modules/portfolio/portfolio.service";
import { MarketService } from "@/modules/market/market.service";
import { RiskService } from "@/modules/risk/risk.service";
import { InvestigationService } from "@/modules/investigation/investigation.service";
import { MockInvestigationAdapter } from "@/modules/investigation/mock-investigation.adapter";
import { PolicyService } from "@/modules/policy/policy.service";
import { ExecutionService } from "@/modules/execution/execution.service";
import { MockExecutionAdapter } from "@/modules/execution/mock-execution.adapter";
import { ForkExecutionAdapter } from "@/modules/execution/fork-execution.adapter";
import { GuardianError, ModeSchema } from "./contracts";
import { GuardianStore } from "./store";
import { GuardianMonitor, type MonitorRuntime } from "./monitor";
import { ForkReadBridge, localForkConfig } from "./fork";
import type { ForkObservation } from "@/modules/onchain/fork-observation-reader";

const DemoSignalSchema = z.strictObject({ timestamp: z.iso.datetime(), priceChange5mPct: z.number().min(-100), priceChange1hPct: z.number().min(-100), volatilityScore: z.number().min(0).max(100) });
async function demoMarket(priceUsd: number): Promise<MarketState> {
  // Explicit demo input. File observations retain their timestamps: reading again cannot refresh stale evidence.
  const signals = process.env.GUARDIAN_SIGNAL_FILE
    ? DemoSignalSchema.parse(JSON.parse(await readFile(process.env.GUARDIAN_SIGNAL_FILE, "utf8")))
    : { timestamp: new Date().toISOString(), priceChange5mPct: -3, priceChange1hPct: -10, volatilityScore: 82 };
  return MarketStateSchema.parse({ asset: "ETH", priceUsd, ...signals });
}

export function createGuardian(): GuardianMonitor {
  const mode = ModeSchema.parse(process.env.GUARDIAN_MODE ?? "MOCK");
  if (mode === "MOCK" && ![undefined, "true"].includes(process.env.MOCK_MODE)) throw new GuardianError(503, "MODE_INVALID", "Choose GUARDIAN_MODE=FORK explicitly; MOCK_MODE must be true for Mock mode.");
  const fork = mode === "FORK" ? localForkConfig() : undefined;
  const wallet = fork?.recipient ?? (process.env.GUARDIAN_WALLET?.trim() || DEMO_WALLET);
  const store = new GuardianStore(resolve(process.env.GUARDIAN_DB_PATH ?? ".guardian/state.sqlite"), {
    wallet, mode, config: DEMO_POLICY_CONFIG, version: 1, enabled: false, halted: false, recoveryCount: 0,
  });
  const bridge = fork ? new ForkReadBridge(fork, store) : undefined;
  const runtime: MonitorRuntime = {
    async create(config, state, journal) {
      let frozenPortfolio: PortfolioState | undefined, frozenMarket: MarketState | undefined;
      let beforeObservation: ForkObservation | undefined;
      if (bridge) await bridge.preflight();
      // Keep simulated balances across observations/events; never reset the wallet each tick.
      // A NONE session has no after; the last independent observation still owns
      // the simulated balances and must not recreate the funded starting wallet.
      const previous = state.latestSession?.after ?? state.latestAnalysis?.before;
      const initial = previous ? (() => {
        const eth = previous.assets.find(a => a.symbol === "ETH")!.amount;
        const usdc = previous.assets.find(a => a.symbol === "USDC")!.amount;
        const total = eth * 3000 + usdc;
        return { ...previous, totalUsd: total, riskAssetUsd: eth * 3000, defensiveAssetUsd: usdc, riskExposurePct: total ? eth * 3000 / total * 100 : 0,
          assets: [{ symbol: "ETH", amount: eth, usdValue: eth * 3000, category: "RISK" as const }, { symbol: "USDC", amount: usdc, usdValue: usdc, category: "DEFENSIVE" as const }] };
      })() : undefined;
      const mock = bridge ? undefined : new MockScenarioState(wallet, config, initial);
      const portfolioService = new PortfolioService({ async getPortfolio(w) {
        const observation = bridge ? await bridge.observation(w) : undefined;
        beforeObservation ??= observation;
        const result = observation ? observation.portfolio : mock!.getPortfolio(w);
        frozenPortfolio ??= structuredClone(result);
        return result; // after always calls the independent read side again
      } });
      const marketService = new MarketService({ async getMarketState() {
        if (bridge && !beforeObservation) throw new Error("Portfolio observation must precede its market quote");
        const price = bridge ? beforeObservation!.priceUsd : mock!.getMarketState().priceUsd;
        const result = await demoMarket(price); frozenMarket = structuredClone(result); return result;
      } });
      const adapter = bridge && fork ? new ForkExecutionAdapter(config, fork, {
        async getPortfolio() { if (!frozenPortfolio) throw new Error("Missing execution snapshot"); return structuredClone(frozenPortfolio); },
        async getMarketState() { if (!frozenMarket) throw new Error("Missing market snapshot"); return structuredClone(frozenMarket); },
      }, { walletClient: bridge.journaledWallet(journal), publicClient: bridge.client }) : new MockExecutionAdapter(mock!, config);
      return new RescueOrchestrator({ portfolioService, marketService, riskService: new RiskService(),
        investigationService: new InvestigationService(new MockInvestigationAdapter()), policyService: new PolicyService(config),
        executionService: new ExecutionService({ async execute(decision) {
          const receipt = await adapter.execute(decision);
          const result = bridge ? await bridge.confirmedExecution(receipt) : receipt;
          // C's error strings can contain RPC diagnostics. Persist/display only bounded phase codes.
          if (result.error) {
            const code = result.error.split(":")[0];
            result.error = ["CONFIG_INVALID", "PRE_SUBMIT_FAILED", "SUBMITTED_UNKNOWN", "SWAP_REVERTED", "RECEIPT_UNVERIFIABLE"].includes(code) ? `${code}: Execution needs review. No automatic retry.` : "EXECUTION_FAILED: Execution needs review.";
          }
          return result;
        } }, config),
      });
    },
    async resolve(event) { return bridge ? bridge.resolve(event) : "UNVERIFIABLE"; },
  };
  return new GuardianMonitor(store, runtime);
}

const globalGuardian = globalThis as typeof globalThis & { __xjyGuardian?: GuardianMonitor };
export function getGuardian() { return globalGuardian.__xjyGuardian ??= createGuardian(); }
