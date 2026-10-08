// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { sampleSnapshot, submission } from "../helpers/eth-report";
vi.mock("../../web/fingerprint/render.js", async (original) => ({ ...(await original<object>()), mountFingerprints: () => () => {} }));
it("report controls coexist with global handlers and citation navigation preserves its session", async () => {
  document.body.innerHTML = readFileSync("web/index.html", "utf8").match(/<body>([\s\S]*)<\/body>/)![1];
  history.replaceState(null, "", "/report");
  const tools = new Map<string, any>();
  Object.defineProperty(document, "modelContext", { configurable: true, value: { registerTool: async (tool: any, options: { signal: AbortSignal }) => {
    tools.set(tool.name, tool); options.signal.addEventListener("abort", () => tools.delete(tool.name));
  } } });
  const snapshot = sampleSnapshot();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(snapshot)));
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => { errors.push(event.error); };
  window.addEventListener("error", onError);
  await import("../../web/app.js");
  await vi.waitFor(() => expect(tools.size).toBe(6));
  await tools.get("create_eth_snapshot").execute({ windowDays: 1 });
  await tools.get("submit_eth_report").execute(submission(snapshot.snapshotId));
  document.querySelector<HTMLButtonElement>('[data-report-view="json"]')!.click();
  expect(document.querySelector<HTMLElement>("#report-json")!.hidden).toBe(false);
  document.querySelector<HTMLButtonElement>('[data-report-view="a4"]')!.click();
  expect(document.querySelector<HTMLElement>("#report-a4")!.hidden).toBe(false);
  const report = JSON.parse(document.querySelector("#report-json")!.textContent!);
  const originalTool = tools.get("get_eth_report");
  // Browsers fire popstate for same-document fragment navigation as well as back/forward.
  history.pushState(null, "", "/report#evidence-market-1");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector<HTMLElement>("#report-output")!.hidden).toBe(false);
  expect(JSON.parse(document.querySelector("#report-json")!.textContent!).reportId).toBe(report.reportId);
  expect(tools.get("get_eth_report")).toBe(originalTool);
  expect((await originalTool.execute({ reportId: report.reportId })).reportId).toBe(report.reportId);
  expect(errors).toEqual([]);
  expect(document.querySelector("#detail-art-content")).toBeNull();
  window.removeEventListener("error", onError); vi.unstubAllGlobals();
});
