import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeOnchainData, type OnchainAnalysisResult } from "../src/integration/onchain-analysis";
import { createEthereumReadClient, validateRpcUrl } from "../src/modules/onchain/live-data";
import { parseReadArguments } from "../src/modules/onchain/read-cli";
import { EthereumReadError } from "../src/modules/onchain/read-error";

const help = `Analyze one Ethereum snapshot (LIVE_READ_ONLY; no trading or monitoring).
Usage: pnpm data:analyze --wallet ADDRESS [--json]

--wallet ADDRESS   Native ETH + USDC portfolio, with one Uniswap V3 WETH/USDC
                   gross sell-pressure signal over adjacent five-minute windows.
--json             Full validated data, public references, analysis and limitations
                   on stdout; safe errors on stderr, nonzero exit on failure.
--help             Show help without configuration or network access.

Requires ETHEREUM_RPC_URL; reads .env.local if present, existing environment wins.
Risk score and Confidence use uncalibrated deterministic heuristics. Confidence
is evidence coverage, not truth verification or the probability of a price fall.
This command calls no LLM, signs no transaction and does not start monitoring.
`;

function loadRpcConfiguration(): string {
  try { if (existsSync(".env.local")) process.loadEnvFile(".env.local"); }
  catch { throw new EthereumReadError("CONFIGURATION_ERROR", "Unable to load the local environment configuration."); }
  return validateRpcUrl(process.env.ETHEREUM_RPC_URL);
}

function humanOutput(result: OnchainAnalysisResult): string {
  return [
    "LIVE_READ_ONLY — Ethereum mainnet; SELL_PRESSURE_HEURISTIC analysis",
    `Wallet: ${result.portfolio.state.wallet}; block ${result.portfolio.state.blockNumber} at ${result.portfolio.state.timestamp}`,
    "Portfolio scope: native ETH + USDC. Signal scope: one Uniswap V3 WETH/USDC pool.",
    `Sell pressure: ${result.signal.anomalyRatio.toFixed(4)}x; window [${result.signal.windowStart}, ${result.signal.windowEnd})`,
    `Risk score: ${result.riskAnalysis.riskScore}/100; heuristic Confidence: ${result.riskAnalysis.confidence}`,
    `Investigation: ${result.riskAnalysis.investigation.summary}`,
    ...result.limitations,
    "Use --json to inspect validated portfolio, market, signal and public evidence references.",
  ].join("\n") + "\n";
}

type AnalyzeCliDependencies = {
  configuration: () => string;
  analyze: (rpcUrl: string, wallet: string) => Promise<OnchainAnalysisResult>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

export async function runAnalyzeCli(argv: string[], dependencies: AnalyzeCliDependencies = {
  configuration: loadRpcConfiguration,
  analyze: (rpcUrl, wallet) => analyzeOnchainData(createEthereumReadClient(rpcUrl), wallet),
  stdout: (text) => { process.stdout.write(text); }, stderr: (text) => { process.stderr.write(text); },
}): Promise<number> {
  try {
    if (argv.includes("--only")) throw new EthereumReadError("INVALID_ARGUMENT", "Analysis reads all sections; use --wallet ADDRESS [--json], or --help.");
    const args = parseReadArguments(argv);
    if (args.help) { dependencies.stdout(help); return 0; }
    const result = await dependencies.analyze(dependencies.configuration(), args.request.wallet!);
    dependencies.stdout(args.json ? JSON.stringify(result, null, 2) + "\n" : humanOutput(result));
    return 0;
  } catch (caught) {
    const error = caught instanceof EthereumReadError ? caught : new EthereumReadError("RPC_READ_FAILED", "Unable to complete the required Ethereum analysis.");
    dependencies.stderr(argv.includes("--json") ? JSON.stringify({ error: { code: error.code, message: error.message } }) + "\n" : `${error.code}: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runAnalyzeCli(process.argv.slice(2));
}
