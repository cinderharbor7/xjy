import { expect, it } from "vitest";
import { buildSnapshot } from "../server/eth-report";
import { SnapshotSchema, validateSubmission } from "../src/modules/eth-report/contracts";
import { providerData, sampleSnapshot, submission } from "./helpers/eth-report";

it("pins real source semantics, units and independent times", () => {
  const s = sampleSnapshot();
  expect(SnapshotSchema.parse(s)).toEqual(s);
  expect(s.evidence).toHaveLength(8);
  expect(s.evidence.find((e) => e.group === "dex")!.data).toMatchObject({ asset: "WETH", unit: "USD / count" });
  expect(s.evidence.find((e) => e.group === "sentiment")!.scope).toContain("非ETH专属");
});
it("does not convert missing/stale sources to current or zero", () => {
  const { m, d } = providerData(); d.sources.DefiLlama.status = "unavailable"; d.tvl = null as any;
  d.sources.Binance.status = "stale";
  const s = buildSnapshot(m, d, 1);
  expect(s.evidence.find((e) => e.group === "tvl")).toMatchObject({ status: "unavailable", data: null });
  expect(s.evidence.find((e) => e.group === "history")!.status).toBe("stale");
});
it.each(["demo", "wrong-asset", "infinity", "empty-time", "bad-url", "unclosed", "gap"])("rejects %s source anomalies", (fault) => {
  const { m, d } = providerData();
  if (fault === "demo") m.mode = "demo";
  if (fault === "wrong-asset") d.id = "BTC";
  if (fault === "infinity") m.coins[0].price = Infinity;
  if (fault === "empty-time") m.source.asOf = "invalid";
  if (fault === "bad-url") d.news[0].url = "javascript:alert(1)";
  if (fault === "unclosed") d.history[1].time = Date.parse("2026-10-08T01:00:00Z");
  if (fault === "gap") d.history[0].time -= 3600000;
  expect(() => buildSnapshot(m, d, 1, "2026-10-08T01:00:10Z")).toThrow();
});
it("empty candles and zero-volume samples retain unavailable/null semantics", () => {
  const { m, d } = providerData(); d.history = [];
  expect(buildSnapshot(m, d, 1).evidence.find((e) => e.group === "history")).toMatchObject({ data: null, status: "unavailable" });
});
it("checks snapshot identity, no added fields and evidence ownership", () => {
  const s = sampleSnapshot(), r = submission(s.snapshotId);
  expect(validateSubmission(r, s)).toEqual(r);
  expect(() => validateSubmission({ ...r, riskScore: 95 }, s)).toThrow();
  expect(() => validateSubmission({ ...r, snapshotId: crypto.randomUUID() }, s)).toThrow("SNAPSHOT_MISMATCH");
  r.observations[0].evidenceIds = ["fake"];
  expect(() => validateSubmission(r, s)).toThrow("INVALID_EVIDENCE_REFERENCE");
});
it("stale evidence cannot support current facts; unavailable cannot support hypotheses", () => {
  const s = sampleSnapshot(), r = submission(s.snapshotId);
  s.evidence[0].status = "stale";
  expect(() => validateSubmission(r, s)).toThrow("INVALID_EVIDENCE_REFERENCE");
  r.observations[0].basis = "HISTORICAL"; r.conclusion = "INSUFFICIENT_DATA";
  expect(validateSubmission(r, s)).toEqual(r);
  s.evidence.find((e) => e.group === "orderbook")!.status = "unavailable";
  expect(() => validateSubmission(r, s)).toThrow("INVALID_EVIDENCE_REFERENCE");
});

it.each(["negative-volume", "inverted-book", "invalid-ratio", "negative-price", "sentiment-range"])("rejects impossible numeric data %s", (fault) => {
  const { m, d } = providerData();
  if (fault === "negative-volume") m.coins[0].volume = -1;
  if (fault === "inverted-book") d.stats.bestAsk = 2600;
  if (fault === "invalid-ratio") d.stats.buyRatio = 2;
  if (fault === "negative-price") m.coins[0].price = -1;
  if (fault === "sentiment-range") m.sentiment.value = 101;
  expect(() => buildSnapshot(m, d, 1)).toThrow();
});
it("computes actual sampled indicators and preserves null on one sample/zero denominator", () => {
  const { m, d } = providerData(); d.history = [d.history[0]];
  d.history[0].volume = 0; d.history[0].buyVolume = 0;
  const e = buildSnapshot(m, d, 1).evidence.find((e) => e.group === "history")!;
  expect(e.data).toMatchObject({ sampleCount: 1, volatility: null, drawdown: null, buyRatio: null });
});
