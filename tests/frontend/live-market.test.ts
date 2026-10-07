// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { sampleMarket } from "../../web/fingerprint/data.js";
vi.mock("../../web/fingerprint/render.js", async (original) => ({
  ...(await original<object>()), mountFingerprints: () => () => {},
}));
it("opens ETH with public data by default, keeps failed reads missing, and uses demo only after an explicit choice", async () => {
  document.body.innerHTML = readFileSync("web/index.html", "utf8").match(/<body>([\s\S]*)<\/body>/)![1];
  history.replaceState(null, "", "/coins/ETH");
  sessionStorage.clear();
  let finish: (value: Response) => void;
  const deferred = new Promise<Response>((resolve) => { finish = resolve; });
  let marketCalls = 0;
  const data = { ...sampleMarket(), mode: "live", source: { name: "Binance Spot", status: "live" },
    sentiment: { value: 65, mode: "live", asOf: "2026-10-07T11:00:00.000Z" },
    fetchedAt: "2026-10-07T11:00:00.000Z", coins: sampleMarket().coins.map((c) => ({ ...c, mode: "live", price: 2222 })) };
  const fetcher = vi.fn(async (url: string) => {
    if (url !== "/api/market") return Response.json(null);
    marketCalls++;
    if (marketCalls === 1) return deferred;
    if (marketCalls === 2 || marketCalls === 3) throw new Error("行情连接失败");
    if (marketCalls === 4) return Response.json({ ...data, coins: [] });
    return Response.json({ mode: "demo", coins: data.coins, source: { status: "demo" } });
  });
  vi.stubGlobal("fetch", fetcher);
  await import("../../web/app.js");
  expect(document.querySelector(".detail-price")!.textContent).toContain("—");
  expect(document.querySelector(".detail-price")!.textContent).not.toContain("3,248.62");
  finish!(Response.json(data));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  await settle(); await settle();
  expect(document.querySelector(".detail-price")!.textContent).toContain("2,222");
  expect(sessionStorage.getItem("verdant.market-mode")).toBe("live");
  expect(document.querySelector(".detail-price")!.textContent).toContain("USDT");
  document.querySelector<HTMLButtonElement>('[data-action="refresh"]')!.click();
  await settle();
  expect(document.querySelector(".detail-price")!.textContent).toContain("—");
  expect(document.querySelector("#toast")!.textContent).toContain("行情连接失败");
  document.querySelector<HTMLButtonElement>('[data-action="source"]')!.click();
  expect(document.querySelector(".detail-price")!.textContent).toContain("3,248.62");
  expect(sessionStorage.getItem("verdant.market-mode")).toBe("demo");
  document.querySelector<HTMLButtonElement>('[data-action="source"]')!.click();
  await settle();
  expect(document.querySelector(".detail-price")!.textContent).toContain("—");
  expect(sessionStorage.getItem("verdant.market-mode")).toBe("live");
  document.querySelector<HTMLButtonElement>('[data-action="refresh"]')!.click();
  await settle();
  expect(document.querySelector("#toast")!.textContent).toContain("响应无效");
  expect(document.querySelector(".detail-price")!.textContent).toContain("—");
  document.querySelector<HTMLButtonElement>('[data-action="refresh"]')!.click();
  await settle();
  expect(document.querySelector("#toast")!.textContent).toContain("响应无效");
  expect(document.querySelector(".detail-price")!.textContent).toContain("—");
  vi.unstubAllGlobals();
});
