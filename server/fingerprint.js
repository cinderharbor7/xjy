import { coins, marketStats, candleStats } from "../web/fingerprint/data.js";
const cache = new Map();
export async function upstream(url, ttl = 60000) {
  const old = cache.get(url),
    now = Date.now();
  if (old?.pending) return old.pending;
  if (old && now < old.expires) return old.result;
  const pending = (async () => {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "CurrencyFingerprint/0.1",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const result = { status: "live", data, asOf: new Date().toISOString() };
      cache.set(url, { result, expires: Date.now() + ttl });
      return result;
    } catch (error) {
      const result = old?.result?.data
        ? { ...old.result, status: "stale", error: error.message }
        : {
            status: "unavailable",
            data: null,
            asOf: null,
            error: error.message,
          };
      cache.set(url, { result, expires: Date.now() + 60000 });
      return result;
    }
  })();
  cache.set(url, { ...old, pending });
  return pending;
}
const binance = "https://data-api.binance.vision/api/v3";
export async function market() {
  const symbols = encodeURIComponent(
    JSON.stringify(coins.map((c) => `${c.id}USDT`)),
  );
  const [market, sentiment] = await Promise.all([
    upstream(`${binance}/ticker/24hr?symbols=${symbols}`),
    upstream("https://api.alternative.me/fng/?limit=1", 3600000),
  ]);
  const rows = Array.isArray(market.data) ? market.data : [];
  const fng = sentiment.data?.data?.[0];
  return {
    mode: "live",
    fetchedAt: market.asOf,
    source: { ...market, data: undefined, name: "Binance Spot" },
    sentiment: {
      value: fng ? Number(fng.value) : null,
      label: fng?.value_classification ?? "暂无数据",
      mode: sentiment.status,
      collectedAt: sentiment.asOf,
      asOf: fng ? new Date(Number(fng.timestamp) * 1000).toISOString() : null,
    },
    coins: coins.map((c) => {
      const t = rows.find((t) => t.symbol === `${c.id}USDT`);
      return {
        ...c,
        ...marketStats(t || {}),
        mode: t ? market.status : "unavailable",
      };
    }),
  };
}
export async function detail(id, days) {
  const coin = coins.find((c) => c.id === id);
  if (!coin) return null;
  const [candles, book, github, llama, dex, news] = await Promise.all([
    upstream(
      `${binance}/klines?symbol=${id}USDT&interval=1h&limit=${days === 7 ? 169 : 25}`,
      60000,
    ),
    upstream(`${binance}/depth?symbol=${id}USDT&limit=100`, 30000),
    upstream(`https://api.github.com/repos/${coin.repo}`, 21600000),
    coin.chain
      ? upstream("https://api.llama.fi/v2/chains", 1800000)
      : Promise.resolve({ status: "not-applicable", data: null }),
    coin.token
      ? upstream(
          `https://api.dexscreener.com/token-pairs/v1/${coin.dexChain}/${coin.token}`,
          60000,
        )
      : Promise.resolve({ status: "not-applicable", data: null }),
    upstream(
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${coin.name}" cryptocurrency`)}&mode=artlist&format=json&maxrecords=20&timespan=24h`,
      900000,
    ),
  ]);
  const history = Array.isArray(candles.data)
    ? candles.data
        .filter((k) => Number(k[6]) < Date.now())
        .map((k) => ({
          time: Number(k[0]),
          close: Number(k[4]),
          volume: Number(k[7]),
          buyVolume: Number(k[10]),
        }))
    : [];
  const bestBid = Number(book.data?.bids?.[0]?.[0]) || null,
    bestAsk = Number(book.data?.asks?.[0]?.[0]) || null;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
  const sum = (side, ratio) =>
    !mid
      ? null
      : (book.data?.[side] || [])
          .filter(([p]) => Math.abs(Number(p) - mid) / mid <= ratio)
          .reduce((n, [p, q]) => n + Number(p) * Number(q), 0);
  const bidDepth = sum("bids", 0.01),
    askDepth = sum("asks", 0.01);
  const pools = Array.isArray(dex.data)
    ? dex.data.filter(
        (p) =>
          p.baseToken?.address?.toLowerCase() === coin.token?.toLowerCase(),
      )
    : [];
  // A missing per-pool metric makes the aggregate unknown, never a fabricated zero.
  const aggregatePoolMetric = (pick, reducer = (a, b) => a + b) => {
    const values = pools.map(pick);
    return values.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)
      ? values.reduce((a, b) => reducer(a, b), 0) : null;
  };
  const volume = history.reduce((n, k) => n + k.volume, 0),
    buyVolume = history.reduce((n, k) => n + k.buyVolume, 0);
  return {
    id,
    days,
    history,
    stats: {
      ...candleStats(history),
      bestBid,
      bestAsk,
      spread: mid ? ((bestAsk - bestBid) / mid) * 100 : null,
      bidDepth,
      askDepth,
      imbalance:
        bidDepth + askDepth > 0
          ? (bidDepth - askDepth) / (bidDepth + askDepth)
          : null,
      buyRatio: volume ? buyVolume / volume : null,
    },
    github: github.data
      ? {
          stars: github.data.stargazers_count,
          forks: github.data.forks_count,
          issues: github.data.open_issues_count,
          pushedAt: github.data.pushed_at,
          url: github.data.html_url,
        }
      : null,
    tvl: Array.isArray(llama.data)
      ? (llama.data.find(
          (c) => c.name.toLowerCase() === coin.chain?.toLowerCase(),
        )?.tvl ?? null)
      : null,
    dex: pools.length
      ? {
          pools: pools.length,
          liquidity: aggregatePoolMetric((p) => p.liquidity?.usd),
          largest: aggregatePoolMetric((p) => p.liquidity?.usd, Math.max),
          buys: aggregatePoolMetric((p) => p.txns?.h24?.buys),
          sells: aggregatePoolMetric((p) => p.txns?.h24?.sells),
          wrapped: !!coin.wrapped,
        }
      : null,
    news: Array.isArray(news.data?.articles)
      ? news.data.articles.map((a) => ({
          title: a.title,
          url: a.url,
          domain: a.domain,
          time: a.seendate,
        }))
      : [],
    sources: Object.fromEntries(
      Object.entries({
        Binance: candles,
        "Binance order book": book,
        GitHub: github,
        DefiLlama: llama,
        "DEX Screener": dex,
        GDELT: news,
      }).map(([k, v]) => [
        k,
        { status: v.status, asOf: v.asOf ?? null, error: v.error ?? null },
      ]),
    ),
  };
}
