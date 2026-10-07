import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createEthereumReadClient, readEthereumData, validateRpcUrl } from "./live-data";
import { validateWallet } from "./ethereum-reader";
import { EthereumReadError } from "./read-error";
import type { EthereumDataResult, ReadRequest, ReadSection } from "./read-results";

const help = `Read Ethereum mainnet data (LIVE_READ_ONLY; never signs or sends transactions).
Usage: pnpm data:read --wallet ADDRESS [--only all|portfolio|market|signal] [--json]
       pnpm data:read --only market|signal [--json]

--wallet ADDRESS   Native ETH + USDC portfolio only; other assets excluded.
--only SECTION     Default all. Signal is one Uniswap V3 WETH/USDC 0.05% pool,
                   comparing adjacent five-minute windows (gross sells).
--json             JSON on stdout; safe errors on stderr, nonzero exit on failure.
--help             Show help without RPC configuration or network access.

Requires ETHEREUM_RPC_URL; reads .env.local if present, existing environment wins.
Chainlink historical quotes can be unchanged between updates; volatilityScore is
min(100, abs(priceChange1hPct) * 10), a price-change proxy.
The main Guardian page/API remain MOCK MODE. This command does not start monitoring.
`;

type CliArguments = { help: boolean; json: boolean; request: ReadRequest };
export function parseReadArguments(argv: string[]): CliArguments {
  let section: ReadSection = "all";
  let wallet: string | undefined;
  let json = false;
  let showHelp = false;
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (!["--help", "--json", "--only", "--wallet"].includes(option) || seen.has(option)) {
      throw new EthereumReadError("INVALID_ARGUMENT", "Use the documented options once each; run --help for usage.");
    }
    seen.add(option);
    if (option === "--help") showHelp = true;
    else if (option === "--json") json = true;
    else {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new EthereumReadError("INVALID_ARGUMENT", "The --wallet and --only options require a value.");
      if (option === "--wallet") wallet = validateWallet(value);
      else {
        if (!["all", "portfolio", "market", "signal"].includes(value)) throw new EthereumReadError("INVALID_ARGUMENT", "Choose all, portfolio, market or signal.");
        section = value as ReadSection;
      }
    }
  }
  if (!showHelp && (section === "portfolio" || section === "all") && wallet === undefined) {
    throw new EthereumReadError("INVALID_WALLET", "Supply --wallet ADDRESS for a portfolio or all-data read.");
  }
  return { help: showHelp, json, request: { section, ...(wallet === undefined ? {} : { wallet }) } };
}

function loadRpcConfiguration(): string {
  try { if (existsSync(".env.local")) process.loadEnvFile(".env.local"); }
  catch { throw new EthereumReadError("CONFIGURATION_ERROR", "Unable to load the local environment configuration."); }
  return validateRpcUrl(process.env.ETHEREUM_RPC_URL);
}

function humanOutput(result: EthereumDataResult): string {
  const lines = ["LIVE_READ_ONLY — Ethereum mainnet", "Wallet scope: native ETH + USDC only; other tokens excluded."];
  if ("portfolio" in result) {
    const p = result.portfolio.state;
    lines.push(`Wallet: ${p.wallet}`, `Block: ${p.blockNumber} at ${p.timestamp}`,
      ...p.assets.map((asset) => `${asset.symbol}: ${asset.amount} ($${asset.usdValue.toFixed(2)})`),
      `Total: $${p.totalUsd.toFixed(2)}; ETH exposure: ${p.riskExposurePct.toFixed(2)}%`, `Portfolio evidence: ${result.portfolio.evidence.length}`);
  }
  if ("market" in result) {
    const m = result.market.state;
    lines.push(`Chainlink ETH/USD: $${m.priceUsd}; 5m: ${m.priceChange5mPct.toFixed(4)}%; 1h: ${m.priceChange1hPct.toFixed(4)}%`,
      `Price-change proxy: ${m.volatilityScore.toFixed(4)} / 100 (not statistical volatility)`, `Market evidence: ${result.market.evidence.length}`);
  }
  if ("signal" in result) {
    const s = result.signal;
    lines.push(`Uniswap V3 single WETH/USDC 0.05% pool; current [${s.windowStart}, ${s.windowEnd})`,
      `Gross ETH sell USD: current $${s.currentSellVolumeUsd.toFixed(2)}; preceding 5m $${s.baselineSellVolumeUsd.toFixed(2)}`,
      `Anomaly ratio: ${s.anomalyRatio.toFixed(4)}x; sell transactions: ${s.txCount}; unique tx.from: ${s.uniqueWallets}`,
      `Signal evidence: ${s.evidence.length}; use --json to inspect public block/transaction references.`);
  }
  return lines.join("\n") + "\n";
}

type CliDependencies = {
  configuration: () => string;
  read: (rpcUrl: string, request: ReadRequest) => Promise<EthereumDataResult>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};
export async function runReadCli(argv: string[], dependencies: CliDependencies = {
  configuration: loadRpcConfiguration,
  read: (rpcUrl, request) => readEthereumData(createEthereumReadClient(rpcUrl), request),
  stdout: (text) => { process.stdout.write(text); }, stderr: (text) => { process.stderr.write(text); },
}): Promise<number> {
  try {
    const args = parseReadArguments(argv);
    if (args.help) { dependencies.stdout(help); return 0; }
    const result = await dependencies.read(dependencies.configuration(), args.request);
    dependencies.stdout(args.json ? JSON.stringify(result, null, 2) + "\n" : humanOutput(result));
    return 0;
  } catch (caught) {
    const error = caught instanceof EthereumReadError ? caught : new EthereumReadError("RPC_READ_FAILED", "Unable to complete the required Ethereum read.");
    dependencies.stderr(argv.includes("--json") ? JSON.stringify({ error: { code: error.code, message: error.message } }) + "\n" : `${error.code}: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runReadCli(process.argv.slice(2));
}
