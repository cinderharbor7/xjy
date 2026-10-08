// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, reportHTML } from "../../web/pages/report.js";
import { sampleSnapshot, submission } from "../helpers/eth-report";
vi.mock("../../web/fingerprint/render.js", () => ({ mountFingerprints: () => () => {} }));
let dispose: (() => void) | undefined;
const tools = new Map<string, any>();
const root = () => document.querySelector("main")!;
const output = () => root().querySelector<HTMLElement>("#report-output")!;
const snapshot = sampleSnapshot();
beforeEach(() => {
  document.body.innerHTML = "<main></main>";
  Object.defineProperty(document, "modelContext", { configurable: true, value: {
    registerTool: vi.fn(async (tool: any, options: { signal: AbortSignal }) => {
      if (options.signal.aborted) throw new Error("aborted");
      tools.set(tool.name, tool);
      options.signal.addEventListener("abort", () => tools.delete(tool.name), { once: true });
    }),
  } });
});
afterEach(() => { dispose?.(); dispose = undefined; tools.clear(); vi.unstubAllGlobals(); });
async function start() {
  const fetcher = vi.fn(async (_url: string) => Response.json(snapshot)); vi.stubGlobal("fetch", fetcher);
  dispose = await mount(root()); await vi.waitFor(() => expect(tools.size).toBe(6)); return fetcher;
}
async function complete() {
  const fetcher = await start();
  await tools.get("create_eth_snapshot").execute({ windowDays: 1 });
  const report = await tools.get("submit_eth_report").execute(submission(snapshot.snapshotId));
  return { fetcher, report };
}
it("registered tools prepare data, receive a report and render identical JSON/A4 without model calls", async () => {
  const { fetcher, report } = await complete();
  expect(output().hidden).toBe(false);
  expect(root().textContent).toContain("发现异常线索");
  expect(root().textContent).toContain("未经独立核实");
  expect(JSON.parse(root().querySelector("#report-json")!.textContent!)).toEqual(report);
  root().querySelector<HTMLButtonElement>('[data-report-view="json"]')!.click();
  expect(root().querySelector<HTMLElement>("#report-a4")!.hidden).toBe(true);
  root().querySelector<HTMLButtonElement>('[data-report-view="a4"]')!.click();
  expect(root().querySelector<HTMLElement>("#report-json")!.hidden).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("/api/eth-report-snapshot?days=1");
});
it("prepares data manually without claiming an Agent has run", async () => {
  await start(); root().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(root().querySelector("#report-status")!.textContent).toContain("等待外部 Agent"));
  expect(root().querySelector("#report-calls")!.children).toHaveLength(0);
  expect(output().hidden).toBe(true);
});
it("invalid submission does not render a report and records the actual failure", async () => {
  await start(); await tools.get("create_eth_snapshot").execute({ windowDays: 1 });
  const r = submission(snapshot.snapshotId); r.observations[0].evidenceIds = ["fake"];
  await expect(tools.get("submit_eth_report").execute(r)).rejects.toThrow();
  expect(output().hidden).toBe(true); expect(root().querySelector("#report-calls")!.textContent).toContain("失败");
});
it("clears an earlier result before a failed new read", async () => {
  const { fetcher } = await complete(); fetcher.mockRejectedValueOnce(new Error("offline"));
  await expect(tools.get("create_eth_snapshot").execute({ windowDays: 1 })).rejects.toThrow();
  expect(output().hidden).toBe(true); expect(root().querySelector("#report-json")!.textContent).toBe("");
});
it("unregisters tools on navigation and rejects retained callbacks", async () => {
  await start(); const tool = tools.get("create_eth_snapshot"); dispose!(); dispose = undefined;
  expect(tools.size).toBe(0);
  await expect(tool.execute({ windowDays: 1 })).rejects.toThrow("SESSION_CLOSED");
});
it("escapes external prose and exports source data with the report", async () => {
  const { report } = await complete(); report.analysis.summary = '<img src=x onerror="alert(1)">';
  const container = document.createElement("div"); container.innerHTML = reportHTML(report);
  expect(container.querySelector("img")).toBeNull(); expect(container.textContent).toContain("<img");
  const writeText = vi.fn(async (_text: string) => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  root().querySelector<HTMLButtonElement>('[data-export="copy"]')!.click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(JSON.parse(writeText.mock.calls[0][0]).snapshot).toEqual(snapshot);
});
it("reports unsupported WebMCP without adding a model fallback", async () => {
  Object.defineProperty(document, "modelContext", { configurable: true, value: undefined });
  dispose = await mount(root());
  await vi.waitFor(() => expect(root().querySelector("#webmcp-status")!.textContent).toContain("不支持"));
  expect(tools.size).toBe(0); expect(root().querySelector('input[name="wallet"]')).toBeNull();
});
