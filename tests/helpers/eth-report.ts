import { buildSnapshot } from "../../server/eth-report";
import type { ReportSubmission } from "../../src/modules/eth-report/contracts";
export function providerData() {
  const asOf = "2026-10-08T01:00:00.000Z", meta = { status: "live", asOf };
  return {
    m: { mode: "live", source: meta, coins: [{ id: "ETH", mode: "live", asOf, price: 2800, change: -3, volume: 100000, high: 2900, low: 2700, trades: 300, amplitude: 7 }], sentiment: { mode: "live", collectedAt: asOf, asOf, value: 40 } },
    d: { id: "ETH", days: 1, history: [{ time: Date.parse("2026-10-07T23:00:00Z"), close: 2800, volume: 100, buyVolume: 40 }, { time: Date.parse("2026-10-08T00:00:00Z"), close: 2700, volume: 120, buyVolume: 50 }], stats: { volatility: 0, drawdown: 3.57, buyRatio: 90 / 220, bestBid: 2700, bestAsk: 2701, spread: 0.037, bidDepth: 5000, askDepth: 6000, imbalance: -1 / 11 }, dex: { pools: 2, liquidity: 100000, largest: 60000, buys: 50, sells: 80 }, tvl: 1000000, github: { stars: 5000, forks: 900, issues: 30, pushedAt: asOf }, news: [{ title: "ETH 市场观察", url: "https://example.com/news", domain: "example.com", time: "20261008T003000Z" }], sources: Object.fromEntries(["Binance", "Binance order book", "DEX Screener", "DefiLlama", "GitHub", "GDELT"].map((name) => [name, { ...meta }])) },
  };
}
export function sampleSnapshot() { const { m, d } = providerData(); return buildSnapshot(m, d, 1, "2026-10-08T01:00:10Z"); }
export function submission(snapshotId: string): ReportSubmission {
  return { snapshotId, conclusion: "ANOMALY_SIGNALS", summary: "ETH价格变化值得核查，原因尚不确定。", observations: [{ statement: "单交易所ETH出现价格变化。", basis: "CURRENT", evidenceIds: ["market-1"] }], hypotheses: [{ explanation: "可能存在卖出压力，不能确认原因。", supportingEvidenceIds: ["orderbook-1"], counterEvidenceIds: [], uncertainty: "缺少跨交易所证据。" }], uncertainties: ["无法核实参与者意图。"], nextChecks: ["核查具体链上交易。"] };
}
