import { createPublicClient, http, toHex } from "viem";
import { mainnet } from "viem/chains";
import { EthereumPortfolioAdapter } from "../portfolio/ethereum-portfolio.adapter";
import { PortfolioService } from "../portfolio/portfolio.service";
import { ChainlinkMarketAdapter } from "../market/chainlink-market.adapter";
import { MarketService } from "../market/market.service";
import { EthereumSnapshot, validateWallet, type EthereumReadClient } from "./ethereum-reader";
import { OnchainSignalService } from "./onchain-signal.service";
import { UniswapSellPressureAdapter } from "./uniswap-sell-pressure.adapter";
import { EthereumReadError, withEthereumRead } from "./read-error";
import { EthereumDataResultSchema, LIVE_READ_SCOPE, type EthereumDataResult, type ReadRequest } from "./read-results";

export function validateRpcUrl(value: string | undefined): string {
  try {
    const url = new URL(value?.trim() ?? "");
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.href;
  } catch {
    throw new EthereumReadError("CONFIGURATION_ERROR", "Set ETHEREUM_RPC_URL to an HTTP(S) Ethereum mainnet RPC endpoint.");
  }
}

/** Bound in-flight reads locally; no background tasks, retries or persistent queue. */
function readLimiter() {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(read: () => Promise<T>): Promise<T> => {
    if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try { return await read(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

export function createEthereumReadClient(rpcUrl: string): EthereumReadClient {
  const client = createPublicClient({ chain: mainnet, cacheTime: 0, transport: http(validateRpcUrl(rpcUrl), { retryCount: 0, timeout: 10_000 }) });
  const limit = readLimiter();
  return {
    getChainId: () => limit(() => client.getChainId()),
    getBlock: (parameters) => limit(() => client.getBlock(parameters)),
    getBalance: (parameters) => limit(() => client.getBalance(parameters)),
    readContract: ((parameters) => limit(() => client.readContract(parameters))) as EthereumReadClient["readContract"],
    getTransaction: (parameters) => limit(() => client.getTransaction(parameters)),
    getRawLogs: ({ address, topics, fromBlock, toBlock }) => limit(() => client.request({ method: "eth_getLogs", params: [{
      address, topics: [...topics], fromBlock: toHex(fromBlock), toBlock: toHex(toBlock),
    }] })),
  };
}

/** B/D use frozen getters. Every getter captures a new snapshot, including an after-read. */
export function createEthereumDataServices(client: EthereumReadClient) {
  const source = () => EthereumSnapshot.capture(client);
  return {
    portfolio: new PortfolioService(new EthereumPortfolioAdapter(source)),
    market: new MarketService(new ChainlinkMarketAdapter(source)),
    signal: new OnchainSignalService(new UniswapSellPressureAdapter(source)),
  };
}

/** A one-shot CLI/handoff read shares an anchor, never a cross-call cache. */
export async function readEthereumData(client: EthereumReadClient, request: ReadRequest): Promise<EthereumDataResult> {
  return withEthereumRead(async () => {
    if (!["all", "portfolio", "market", "signal"].includes(request.section)) {
      throw new EthereumReadError("INVALID_ARGUMENT", "Choose all, portfolio, market or signal.");
    }
    const wallet = request.section === "all" || request.section === "portfolio" ? validateWallet(request.wallet!) : undefined;
    const snapshot = await EthereumSnapshot.capture(client);
    const source = async () => snapshot;
    const metadata = { mode: "LIVE_READ_ONLY", network: "ethereum-mainnet", scope: LIVE_READ_SCOPE, section: request.section };
    const output = { ...metadata,
      ...(wallet === undefined ? {} : { portfolio: await new EthereumPortfolioAdapter(source).readPortfolio(wallet) }),
      ...(request.section === "all" || request.section === "market" ? { market: await new ChainlinkMarketAdapter(source).readMarket() } : {}),
      ...(request.section === "all" || request.section === "signal" ? { signal: await new OnchainSignalService(new UniswapSellPressureAdapter(source)).getSignal() } : {}),
    };
    const parsed = EthereumDataResultSchema.safeParse(output);
    if (!parsed.success) throw new EthereumReadError("INVALID_CHAIN_DATA", "The Ethereum read result does not satisfy its declared contract.");
    return parsed.data;
  });
}
