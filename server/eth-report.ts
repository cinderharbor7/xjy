import { randomUUID } from "node:crypto";
import { candleStats } from "../web/fingerprint/data.js";
import { market, detail } from "./fingerprint.js";
import { SnapshotSchema, type Snapshot } from "../src/modules/eth-report/contracts";

const numeric = (v: unknown) => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("INVALID_SOURCE_NUMBER");
  return v;
};
const fields = (v: any, names: string[]) => Object.fromEntries(names.map((key) => [key, numeric(v?.[key])]));
/** Fixed provider surface; no model-controlled URLs or credentials. */
export function buildSnapshot(m: any, d: any, windowDays: 1 | 7, now = new Date().toISOString()): Snapshot {
  if (m?.mode !== "live" || d?.id !== "ETH" || d.days !== windowDays || !Array.isArray(m.coins)) throw new Error("INVALID_SOURCE_DATA");
  const eth = m.coins.find((c: any) => c.id === "ETH");
  if (!eth) throw new Error("ETH_MISSING");
  const bounded = (value: unknown, min: number, max = Infinity, integer = false) => {
    const n = numeric(value);
    if (n !== null && (n < min || n > max || (integer && !Number.isInteger(n)))) throw new Error("INVALID_SOURCE_RANGE");
  };
  for (const c of m.coins) {
    if (!["live", "stale", "unavailable"].includes(c.mode) || !/^[A-Z]{2,10}$/.test(c.id)) throw new Error("INVALID_ASSET_CONTEXT");
    if (c.price !== null && c.price !== undefined && c.price <= 0) throw new Error("INVALID_PRICE");
    bounded(c.volume, 0); bounded(c.trades, 0, Infinity, true); bounded(c.amplitude, 0);
    if (c.asOf !== null && c.asOf !== undefined && !Number.isFinite(Date.parse(c.asOf))) throw new Error("INVALID_SOURCE_TIME");
  }
  for (const key of ["high", "low"]) if (eth[key] != null && eth[key] <= 0) throw new Error("INVALID_PRICE");
  if (eth.high != null && eth.low != null && eth.high < eth.low) throw new Error("INVALID_PRICE_RANGE");
  bounded(d.stats?.volatility, 0); bounded(d.stats?.drawdown, 0, 100); bounded(d.stats?.buyRatio, 0, 1);
  for (const key of ["bidDepth", "askDepth", "spread"]) bounded(d.stats?.[key], 0);
  bounded(d.stats?.imbalance, -1, 1);
  if (d.stats?.bestBid != null && (d.stats.bestBid <= 0 || d.stats.bestAsk < d.stats.bestBid)) throw new Error("INVALID_ORDERBOOK");
  for (const key of ["liquidity", "largest"]) bounded(d.dex?.[key], 0);
  for (const key of ["pools", "buys", "sells"]) bounded(d.dex?.[key], 0, Infinity, true);
  bounded(d.tvl, 0); bounded(m.sentiment?.value, 0, 100);
  for (const key of ["stars", "forks", "issues"]) bounded(d.github?.[key], 0, Infinity, true);
  const evidence: any[] = [];
  const add = (group: string, source: string, url: string, meta: any, data: any, scope: string, observedAt: string | null = null) => {
    if (!["live", "stale", "unavailable"].includes(meta?.status)) throw new Error("INVALID_SOURCE_STATUS");
    const unavailable = meta.status === "unavailable" || data === null;
    evidence.push({ id: `${group}-${evidence.filter((e) => e.group === group).length + 1}`, group, source, url,
      status: unavailable ? "unavailable" : meta.status, collectedAt: meta.asOf ?? null, observedAt,
      scope, data: unavailable ? null : data });
  };
  add("market", "Binance Spot", "https://data-api.binance.vision/api/v3/ticker/24hr?symbol=ETHUSDT", m.source,
    eth.price == null ? null : { unit: "USDT", eth: fields(eth, ["price", "change", "volume", "high", "low", "trades", "amplitude"]),
      context: m.coins.map((c: any) => ({ asset: c.id, status: c.mode, observedAt: c.asOf, ...fields(c, ["price", "change", "volume"]) })) },
    "Binance现货ETH/USDT滚动24h；其他资产仅作市场比较。", eth.asOf ?? null);
  if (!Array.isArray(d.history) || d.history.length > (windowDays === 7 ? 169 : 25)) throw new Error("INVALID_CANDLES");
  const history = (d.history ?? []).map((h: any) => ({ ...fields(h, ["time", "close", "volume", "buyVolume"]) }));
  if (history.some((h: any) => h.time === null || h.time < 0 || h.close === null || h.close <= 0
    || h.time + 3600000 > Date.parse(now) || h.volume === null || h.volume < 0 || h.buyVolume === null || h.buyVolume < 0 || h.buyVolume > h.volume)) throw new Error("INVALID_CANDLES");
  if (history.some((h: any, i: number) => i > 0 && h.time - history[i - 1].time !== 3600000)) throw new Error("NON_CONTIGUOUS_CANDLES");
  const stats = candleStats(history);
  const totalVolume = history.reduce((n: number, h: any) => n + h.volume, 0);
  const buyVolume = history.reduce((n: number, h: any) => n + h.buyVolume, 0);
  add("history", "Binance Klines", `https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1h&limit=${windowDays === 7 ? 169 : 25}`, d.sources.Binance,
    history.length ? { unit: "USDT", sampleCount: history.length, history, ...stats, buyRatio: totalVolume > 0 ? buyVolume / totalVolume : null } : null,
    "实际返回的已收盘小时样本；窗口以首末时间为准。波动率为小时收益率日化。", history.length ? new Date(history.at(-1).time + 3600000).toISOString() : null);
  add("orderbook", "Binance order book", "https://data-api.binance.vision/api/v3/depth?symbol=ETHUSDT&limit=100", d.sources["Binance order book"],
    d.stats.bestBid == null || d.stats.bestAsk == null ? null : { unit: "USDT; spread %, imbalance ratio", ...fields(d.stats, ["bestBid", "bestAsk", "spread", "bidDepth", "askDepth", "imbalance"]) }, "返回100档内±1%深度；非完整盘口。");
  add("dex", "DEX Screener", "https://api.dexscreener.com/token-pairs/v1/ethereum/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", d.sources["DEX Screener"],
    d.dex ? { asset: "WETH", unit: "USD / count", ...fields(d.dex, ["pools", "liquidity", "largest", "buys", "sells"]) } : null,
    "WETH为baseToken的返回池集合；非全链，无历史流动性序列。");
  add("tvl", "DefiLlama", "https://api.llama.fi/v2/chains", d.sources.DefiLlama, d.tvl == null ? null : { chain: "Ethereum", tvlUsd: numeric(d.tvl) }, "链级TVL静态值，非协议TVL或资金流。");
  add("sentiment", "Alternative.me", "https://api.alternative.me/fng/?limit=1", { status: m.sentiment.mode, asOf: m.sentiment.collectedAt ?? m.sentiment.asOf },
    m.sentiment.value == null ? null : { value: numeric(m.sentiment.value) }, "全市场恐惧贪婪指数，非ETH专属。", m.sentiment.asOf ?? null);
  add("github", "GitHub", "https://api.github.com/repos/ethereum/go-ethereum", d.sources.GitHub,
    d.github ? { repository: "ethereum/go-ethereum", ...fields(d.github, ["stars", "forks", "issues"]), pushedAt: d.github.pushedAt } : null, "仓库背景；最后推送不等于最后提交，Stars非安全评分。");
  const news = d.news ?? [];
  if (!Array.isArray(news) || news.length > 20) throw new Error("INVALID_NEWS");
  if (!news.length) add("news", "GDELT", "https://api.gdeltproject.org/api/v2/doc/doc", d.sources.GDELT, { articles: [] }, "最近24h无返回新闻或来源不可用；不证明没有相关事件。");
  for (const n of news) add("news", "GDELT", n.url, d.sources.GDELT, { title: n.title, domain: n.domain, indexedAt: n.time }, "新闻标题元数据；GDELT收录时间非核实发布时间，无正文，不能证明因果。");
  return SnapshotSchema.parse({ version: 1, snapshotId: randomUUID(), asset: "ETH", windowDays, createdAt: now, evidence,
    limitations: ["多源采集批次，非同一时刻或同一区块快照。", "网站未调用模型；外部Agent解释未经独立核实。", "stale只作历史背景；unavailable不作证据；不填充Mock。", "没有论文来源，不以论文方法背书；无综合预测分数。", "此快照为市场与生态数据，不含直接核验的链上交易，不确认异动原因。"] });
}
export async function collectSnapshot(windowDays: 1 | 7) {
  const [m, d] = await Promise.all([market(), detail("ETH", windowDays)]);
  return buildSnapshot(m, d, windowDays);
}
