// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, reportHTML } from "../../web/pages/report.js";
import { historicalReport } from "../helpers/onchain-report";
vi.mock("../../web/fingerprint/render.js", () => ({ mountFingerprints: () => () => {} }));
const report = historicalReport();
let dispose: (() => void) | undefined;
const root = () => document.querySelector("main")!;
const input = () => root().querySelector<HTMLInputElement>("input")!;
const status = () => root().querySelector("#report-status")!;
const result = () => root().querySelector("#onchain-report-result")!;
const submit = () => root().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
beforeEach(() => { document.body.innerHTML = "<main></main>"; });
afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllGlobals(); });
async function start(fetcher = vi.fn(async () => Response.json(report))) {
  vi.stubGlobal("fetch", fetcher); dispose = await mount(root()); input().value = report.portfolio.state.wallet; return fetcher;
}
it("renders true data with separate facts, explanation, unknowns and links", async () => {
  const fetcher = await start(); submit();
  await vi.waitFor(() => expect(result().textContent).toContain("01 / 量化事实"));
  expect(result().textContent).toContain("未调用 AI");
  expect(result().textContent).toContain("尚不能确认");
  expect(result().querySelector('a[href^="https://etherscan.io/tx/"]')).not.toBeNull();
  expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ wallet: report.portfolio.state.wallet, investigationMode: "RULES" });
});
it("clears an earlier result when the wallet or mode changes", async () => {
  await start(); submit(); await vi.waitFor(() => expect(result().innerHTML).not.toBe(""));
  input().value = "invalid"; input().dispatchEvent(new Event("input", { bubbles: true }));
  expect(result().innerHTML).toBe(""); submit(); expect(status().textContent).toContain("请输入完整");
});
it("shows missing AI configuration or RPC failure without retaining an earlier report", async () => {
  const fetcher = await start(); submit(); await vi.waitFor(() => expect(result().innerHTML).not.toBe(""));
  fetcher.mockResolvedValue(Response.json({ detail: "真实 AI 尚未配置" }, { status: 503 }));
  root().querySelector<HTMLSelectElement>("select")!.value = "AI";
  submit(); await vi.waitFor(() => expect(status().textContent).toContain("真实 AI 尚未配置"));
  expect(result().innerHTML).toBe("");
});
it("rejects a response for another wallet or selected mode", async () => {
  await start(vi.fn(async () => Response.json({ ...report, investigationMode: "AI" })));
  submit(); await vi.waitFor(() => expect(status().textContent).toContain("不一致"));
  expect(result().innerHTML).toBe("");
});
it("locks inputs and prevents duplicate requests until the first finishes", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
  await start(fetcher); submit(); submit();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(input().disabled).toBe(true);
  finish(Response.json(report)); await vi.waitFor(() => expect(input().disabled).toBe(false));
});
it("does not render a late response after navigation disposes the page", async () => {
  let finish!: (response: Response) => void;
  await start(vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  submit(); dispose!(); finish(Response.json(report));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(result().innerHTML).toBe("");
});
it("escapes provider/model text rather than executing HTML", () => {
  const data = historicalReport(); data.riskAnalysis.investigation.summary = '<img src=x onerror="alert(1)">';
  const container = document.createElement("div"); container.innerHTML = reportHTML(data);
  expect(container.querySelector("img")).toBeNull(); expect(container.textContent).toContain("<img");
});
