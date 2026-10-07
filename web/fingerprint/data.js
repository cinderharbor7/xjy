export const coins = [
  {
    id: "ETH",
    name: "Ethereum",
    cn: "以太坊",
    category: "公链",
    chain: "Ethereum",
    repo: "ethereum/go-ethereum",
    token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    dexChain: "ethereum",
    wrapped: true,
    color: 215,
    description:
      "可编程的区块链网络。价格、交易活动与市场情绪，在这里汇成一枚不断变化的数字指纹。",
    website: "https://ethereum.org",
  },
  {
    id: "BTC",
    name: "Bitcoin",
    cn: "比特币",
    category: "价值存储",
    chain: "Bitcoin",
    repo: "bitcoin/bitcoin",
    color: 32,
    description:
      "开放、去中心化的价值网络。从交易节奏到价格振幅，观察比特币此刻的市场轮廓。",
    website: "https://bitcoin.org",
  },
  {
    id: "SOL",
    name: "Solana",
    cn: "索拉纳",
    category: "公链",
    chain: "Solana",
    repo: "anza-xyz/agave",
    token: "So11111111111111111111111111111111111111112",
    dexChain: "solana",
    wrapped: true,
    color: 155,
    description:
      "面向高频交互的区块链网络。将价格起伏与市场活跃度转换成流动的数字形态。",
    website: "https://solana.com",
  },
  {
    id: "BNB",
    name: "BNB",
    cn: "币安币",
    category: "公链",
    chain: "BSC",
    repo: "bnb-chain/bsc",
    color: 45,
    description:
      "BNB Chain 生态的原生资产。用一枚指纹记录市场活动，而非判断未来价格。",
    website: "https://www.bnbchain.org",
  },
  {
    id: "LINK",
    name: "Chainlink",
    cn: "预言机网络",
    category: "DeFi",
    repo: "smartcontractkit/chainlink",
    token: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    dexChain: "ethereum",
    color: 238,
    description:
      "连接智能合约与外部数据的预言机网络。市场数据和开源开发状态共同构成观察视角。",
    website: "https://chain.link",
  },
  {
    id: "UNI",
    name: "Uniswap",
    cn: "去中心化交易",
    category: "DeFi",
    repo: "Uniswap/v3-core",
    token: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    dexChain: "ethereum",
    color: 325,
    description:
      "去中心化交易协议的治理代币。读取市场与交易池数据，保留每个来源的语义边界。",
    website: "https://uniswap.org",
  },
  {
    id: "AVAX",
    name: "Avalanche",
    cn: "雪崩协议",
    category: "公链",
    chain: "Avalanche",
    repo: "ava-labs/avalanchego",
    color: 7,
    description:
      "支持多链应用的区块链网络。以数据塑造形态，记录一个可被收藏的市场切片。",
    website: "https://www.avax.network",
  },
  {
    id: "DOGE",
    name: "Dogecoin",
    cn: "狗狗币",
    category: "社区",
    chain: "Dogecoin",
    repo: "dogecoin/dogecoin",
    color: 55,
    description:
      "从社区文化生长而来的加密资产。观察价格、成交与新闻，理解指纹背后的数据。",
    website: "https://dogecoin.com",
  },
];
const values = [
  [3248.62, 3.42, 18720000000, 6.4],
  [96284.15, 1.86, 32100000000, 3.8],
  [184.73, 6.18, 4860000000, 10.2],
  [612.8, 0.92, 1430000000, 2.9],
  [22.46, -2.34, 628000000, 7.6],
  [12.82, 4.26, 386000000, 8.8],
  [36.54, -1.68, 492000000, 6.2],
  [0.3184, 5.72, 2160000000, 11.6],
];
export function sampleMarket() {
  return {
    mode: "demo",
    fetchedAt: null,
    sentiment: { value: 68, label: "贪婪", mode: "demo" },
    coins: coins.map((c, i) => ({
      ...c,
      price: values[i][0],
      change: values[i][1],
      volume: values[i][2],
      amplitude: values[i][3],
      high: values[i][0] * 1.035,
      low: values[i][0] * 0.973,
      trades: Math.round(values[i][2] / 1600),
      mode: "demo",
      asOf: null,
    })),
    source: { status: "demo", name: "设计演示数据" },
  };
}
export const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
export function visualParameters(coin, sentiment) {
  return {
    hue: coin.color,
    mood: sentiment?.value == null ? 0.5 : clamp(sentiment.value / 100),
    roughness:
      coin.amplitude == null ? 0.25 : clamp(coin.amplitude / 15, 0.08, 0.85),
    activity:
      coin.volume == null
        ? 0.25
        : clamp(Math.log10(Math.max(coin.volume, 1)) / 12, 0.1, 1),
    seed: [...coin.id].reduce((n, c) => n + c.charCodeAt(0), 0) / 100,
  };
}
export function sampleHistory(coin, days = 1) {
  // Explicitly synthetic; only used while mode === demo.
  return Array.from({ length: days === 1 ? 25 : 169 }, (_, i) => ({
    time: Date.UTC(2026, 0, 1) + i * 3600000,
    close:
      coin.price *
      (0.96 +
        (0.034 * i) / (days === 1 ? 24 : 168) +
        Math.sin(i * 1.31 + coin.color) * 0.007 +
        Math.sin(i * 0.42) * 0.012),
  }));
}
export function marketStats(ticker) {
  const number = (value) =>
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(Number(value))
      ? null
      : Number(value);
  const price = number(ticker.lastPrice),
    high = number(ticker.highPrice),
    low = number(ticker.lowPrice),
    open = number(ticker.openPrice);
  return {
    price,
    high,
    low,
    change: number(ticker.priceChangePercent),
    volume: number(ticker.quoteVolume),
    trades: number(ticker.count),
    amplitude:
      open > 0 && high !== null && low !== null
        ? ((high - low) / open) * 100
        : null,
    asOf: Number.isFinite(Number(ticker.closeTime))
      ? new Date(Number(ticker.closeTime)).toISOString()
      : null,
  };
}
export function candleStats(history) {
  const prices = history
    .map((c) => c.close)
    .filter((n) => Number.isFinite(n) && n > 0);
  if (prices.length < 2) return { volatility: null, drawdown: null };
  const returns = prices.slice(1).map((n, i) => Math.log(n / prices[i]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const volatility =
    Math.sqrt(
      returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length,
    ) *
    Math.sqrt(24) *
    100;
  let peak = prices[0],
    drawdown = 0;
  for (const p of prices) {
    peak = Math.max(peak, p);
    drawdown = Math.max(drawdown, ((peak - p) / peak) * 100);
  }
  return { volatility, drawdown };
}
