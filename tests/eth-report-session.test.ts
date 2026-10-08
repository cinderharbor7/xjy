import { expect, it, vi } from "vitest";
import { ReportSession, type AcceptedReport } from "../src/modules/eth-report/session";
import { sampleSnapshot, submission } from "./helpers/eth-report";
it("holds one snapshot and returns copies without refreshing data", async () => {
  const s = sampleSnapshot(), collect = vi.fn(async () => s), session = new ReportSession(collect);
  await session.call("create_eth_snapshot", { windowDays: 1 });
  const copy: any = await session.call("get_eth_snapshot", { snapshotId: s.snapshotId }); copy.asset = "BTC";
  expect((await session.call("get_eth_snapshot", { snapshotId: s.snapshotId }) as any).asset).toBe("ETH");
  expect(collect).toHaveBeenCalledTimes(1);
});
it("accepts report once, identical repeat is idempotent and conflicting repeat fails", async () => {
  const s = sampleSnapshot(), session = new ReportSession(async () => s);
  await session.call("create_eth_snapshot", { windowDays: 1 });
  const r = submission(s.snapshotId);
  const accepted = await session.call("submit_eth_report", r) as AcceptedReport;
  expect(await session.call("submit_eth_report", r)).toEqual(accepted);
  await expect(session.call("submit_eth_report", { ...r, summary: "different" })).rejects.toThrow("REPORT_ALREADY_SUBMITTED");
  expect(await session.call("get_eth_report", { reportId: accepted.reportId })).toEqual(accepted);
});
it("does not let another session read or submit a report", async () => {
  const s = sampleSnapshot(), session = new ReportSession(async () => s);
  await expect(session.call("get_eth_snapshot", { snapshotId: s.snapshotId })).rejects.toThrow("SNAPSHOT_MISMATCH");
  await expect(session.call("submit_eth_report", submission(s.snapshotId))).rejects.toThrow("SNAPSHOT_MISMATCH");
});
it("rejects unknown arguments and a mismatched returned window", async () => {
  const session = new ReportSession(async () => sampleSnapshot());
  await expect(session.call("create_eth_snapshot", { windowDays: 1, wallet: "x" })).rejects.toThrow();
  await expect(session.call("create_eth_snapshot", { windowDays: 7 })).rejects.toThrow("WINDOW_MISMATCH");
});
it("clears an old report before fresh collection, including failure", async () => {
  const s = sampleSnapshot(), collect = vi.fn(async () => s), session = new ReportSession(collect);
  await session.call("create_eth_snapshot", { windowDays: 1 }); await session.call("submit_eth_report", submission(s.snapshotId));
  collect.mockRejectedValueOnce(new Error("offline"));
  await expect(session.call("create_eth_snapshot", { windowDays: 1 })).rejects.toThrow("offline");
  expect(session.state).toEqual({ busy: false, snapshot: null, report: null });
});
it("rejects concurrent creation and results after disposal", async () => {
  let finish!: (v: unknown) => void;
  const session = new ReportSession(() => new Promise((resolve) => { finish = resolve; }));
  const pending = session.call("create_eth_snapshot", { windowDays: 1 });
  await expect(session.call("create_eth_snapshot", { windowDays: 1 })).rejects.toThrow("SNAPSHOT_BUSY");
  session.dispose(); finish(sampleSnapshot());
  await expect(pending).rejects.toThrow("SESSION_CLOSED");
  await expect(session.call("get_eth_indicator_definitions", {})).rejects.toThrow("SESSION_CLOSED");
  expect(session.state.snapshot).toBeNull();
});
