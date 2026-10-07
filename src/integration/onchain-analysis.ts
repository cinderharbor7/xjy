import { RiskAnalysisSchema } from "@/domain/schemas";
import type { RiskAnalysis } from "@/domain/types";
import { validateWallet, type EthereumReadClient } from "@/modules/onchain/ethereum-reader";
import { readEthereumData } from "@/modules/onchain/live-data";
import { EthereumReadError } from "@/modules/onchain/read-error";
import { EthereumDataResultSchema, type EthereumDataResult } from "@/modules/onchain/read-results";
import { OnchainAnalysisService, type OnchainInvestigationFactory } from "@/modules/risk/onchain-analysis.service";

export const ONCHAIN_ANALYSIS_LIMITATIONS = [
  "Risk score uses deterministic heuristic rules, not a fitted or calibrated prediction model.",
  "Confidence measures distinct reference coverage and transaction count; it does not independently verify truth or predict a price fall.",
  "The observation covers native ETH and USDC holdings and one Uniswap V3 WETH/USDC pool; it does not cover the entire market.",
  "volatilityScore is a one-hour price-change proxy, not statistical volatility.",
  "No LLM, policy evaluation, signing, transaction broadcast or monitoring is performed.",
] as const;

export type OnchainAnalysisResult = Extract<EthereumDataResult, { section: "all" }> & {
  analysisMethod: "SELL_PRESSURE_HEURISTIC";
  riskAnalysis: RiskAnalysis;
  limitations: string[];
};

/** A's all-read owns one snapshot for portfolio, market and signal; B only analyzes it. */
export async function analyzeOnchainData(
  client: EthereumReadClient,
  wallet: string,
  read: typeof readEthereumData = readEthereumData,
  investigationFactory?: OnchainInvestigationFactory,
): Promise<OnchainAnalysisResult> {
  const requestedWallet = validateWallet(wallet);
  // Read failures propagate; A owns RPC sanitization and this composition has no fallback.
  const parsed = EthereumDataResultSchema.safeParse(await read(client, { section: "all", wallet: requestedWallet }));
  if (!parsed.success || parsed.data.section !== "all") {
    throw new EthereumReadError("INVALID_CHAIN_DATA", "The analysis requires a complete validated Ethereum observation.");
  }
  const data = parsed.data;
  if (data.portfolio.state.wallet.toLowerCase() !== requestedWallet.toLowerCase()
    || data.market.state.asset !== data.signal.asset
    || data.portfolio.state.timestamp !== data.market.state.timestamp
    || data.market.state.timestamp !== data.signal.windowEnd) {
    throw new EthereumReadError("INVALID_CHAIN_DATA", "The analysis requires one wallet and one shared Ethereum snapshot.");
  }
  const riskAnalysis = RiskAnalysisSchema.parse(await new OnchainAnalysisService(undefined, investigationFactory).analyze(
    data.portfolio.state, data.market.state, data.signal,
  ));
  const limitations = [...ONCHAIN_ANALYSIS_LIMITATIONS] as string[];
  if (investigationFactory) limitations[4] = "No policy evaluation, signing, transaction broadcast or monitoring is performed. Investigation uses the explicitly supplied adapter.";
  return { ...data, analysisMethod: "SELL_PRESSURE_HEURISTIC", riskAnalysis, limitations };
}
