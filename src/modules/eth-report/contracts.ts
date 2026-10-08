import { z } from "zod";

const text = z.string().trim().min(1).max(2000);
const id = z.string().min(1).max(100);
export const WindowSchema = z.strictObject({ windowDays: z.union([z.literal(1), z.literal(7)]) });
export const GroupSchema = z.enum(["market", "history", "orderbook", "dex", "tvl", "sentiment", "news", "github"]);
export const HttpUrlSchema = z.url().max(2048).refine((s) => ["https:", "http:"].includes(new URL(s).protocol), "HTTP(S) source required");
export const EvidenceSchema = z.strictObject({
  id, group: GroupSchema, source: z.string().min(1).max(100), url: HttpUrlSchema,
  status: z.enum(["live", "stale", "unavailable"]),
  collectedAt: z.iso.datetime().nullable(), observedAt: z.iso.datetime().nullable(),
  scope: text, data: z.json(),
});
export const SnapshotSchema = z.strictObject({
  version: z.literal(1), snapshotId: z.uuid(), asset: z.literal("ETH"),
  windowDays: z.union([z.literal(1), z.literal(7)]), createdAt: z.iso.datetime(),
  evidence: z.array(EvidenceSchema).min(8).max(28),
  limitations: z.array(text).min(1).max(20),
}).superRefine((value, ctx) => {
  if (new Set(value.evidence.map((e) => e.id)).size !== value.evidence.length)
    ctx.addIssue({ code: "custom", message: "Duplicate evidence IDs" });
  for (const e of value.evidence) {
    if (e.status === "unavailable" ? e.data !== null : e.data === null || e.collectedAt === null)
      ctx.addIssue({ code: "custom", message: "Evidence availability mismatch" });
  }
});
const refs = z.array(id).min(1).max(12);
export const ReportSubmissionSchema = z.strictObject({
  snapshotId: z.uuid(),
  conclusion: z.enum(["ANOMALY_SIGNALS", "NO_CLEAR_ANOMALY", "INSUFFICIENT_DATA"]),
  summary: text,
  observations: z.array(z.strictObject({ statement: text, basis: z.enum(["CURRENT", "HISTORICAL"]), evidenceIds: refs })).max(12),
  hypotheses: z.array(z.strictObject({ explanation: text, supportingEvidenceIds: refs, counterEvidenceIds: z.array(id).max(12), uncertainty: text })).max(6),
  uncertainties: z.array(text).min(1).max(12),
  nextChecks: z.array(text).max(8),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
export type ReportSubmission = z.infer<typeof ReportSubmissionSchema>;

/** Structural/reference verification only; it cannot establish the truth of model prose. */
export function validateSubmission(input: unknown, snapshot: Snapshot): ReportSubmission {
  const report = ReportSubmissionSchema.parse(input);
  if (report.snapshotId !== snapshot.snapshotId) throw new Error("SNAPSHOT_MISMATCH");
  const byId = new Map(snapshot.evidence.map((e) => [e.id, e]));
  const check = (ids: string[], current = false) => {
    for (const id of ids) {
      const e = byId.get(id);
      if (!e || e.status === "unavailable" || (current && e.status !== "live")) throw new Error("INVALID_EVIDENCE_REFERENCE");
    }
  };
  for (const o of report.observations) check(o.evidenceIds, o.basis === "CURRENT");
  for (const h of report.hypotheses) { check(h.supportingEvidenceIds); check(h.counterEvidenceIds); }
  if (report.conclusion !== "INSUFFICIENT_DATA" && !report.observations.some((o) => o.basis === "CURRENT"))
    throw new Error("CURRENT_EVIDENCE_REQUIRED");
  return report;
}
export const INDICATOR_DEFINITIONS = [
  { id: "market", formula: "24h change = Binance priceChangePercent; amplitude = (high-low)/open*100", unit: "% / USDT", limitation: "单交易所滚动24h，不是全网；USDT不是USD。" },
  { id: "volatility", formula: "std_population(log(close[t]/close[t-1])) * sqrt(24) * 100", unit: "%", limitation: "已收盘小时K线的日化波动率；不足2个收盘价返回null。" },
  { id: "drawdown", formula: "max((runningPeak-close)/runningPeak)*100", unit: "%", limitation: "仅小时收盘价，不包含小时内最大回撤。" },
  { id: "buyRatio", formula: "sum(takerBuyQuoteVolume)/sum(quoteVolume)", unit: "ratio [0,1]", limitation: "当前窗口报价资产成交额；成交额为0返回null。" },
  { id: "orderbook", formula: "spread=(ask-bid)/mid*100; depth=sum(price*quantity) within ±1%; imbalance=(bidDepth-askDepth)/(bidDepth+askDepth)", unit: "% / USDT / ratio [-1,1]", limitation: "仅返回100档；分母为0返回null。" },
  { id: "dex", formula: "Returned WETH base-token pools: count and sum(liquidity.usd)", unit: "USD / count", limitation: "返回池集合，非全网。买卖笔数不是净卖出额；无历史不能称流动性下降。" },
  { id: "context", formula: "Provider observations; no composite risk score", unit: "各来源标注", limitation: "链TVL非协议TVL；情绪是市场背景；新闻只有标题与收录时间；仓库推送非提交。未采用论文指标。" },
] as const;
