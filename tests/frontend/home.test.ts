// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
vi.mock("../../web/fingerprint/render.js", async (original) => ({
  ...(await original<object>()),
  mountFingerprints: () => () => {},
}));
it("integrates workbench links and per-coin fingerprints with working search and category filters", async () => {
  const shell = readFileSync(resolve("web/index.html"), "utf8");
  document.body.innerHTML = shell.match(/<body>([\s\S]*)<\/body>/)![1];
  history.replaceState(null, "", "/");
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
  await import("../../web/app.js");
  expect(document.querySelectorAll(".coin-card")).toHaveLength(8);
  expect(
    document.querySelectorAll(".coin-card canvas[data-coin]"),
  ).toHaveLength(8);
  expect(document.querySelector(".hero-actions a")?.getAttribute("href")).toBe(
    "/coins/ETH",
  );
  for (const route of [
    "/guardian",
    "/investigate",
    "/risk-lab",
    "/position",
    "/attestations",
    "/collection",
  ])
    expect(document.querySelector(`header a[href="${route}"]`)).not.toBeNull();
  const search = document.querySelector<HTMLInputElement>("#search")!;
  search.value = "SOL";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(document.querySelectorAll(".coin-card")).toHaveLength(1);
  expect(document.querySelector(".coin-card")?.getAttribute("href")).toBe(
    "/coins/SOL",
  );
  search.value = "";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector<HTMLButtonElement>('[data-filter="DeFi"]')!.click();
  expect(document.querySelectorAll(".coin-card")).toHaveLength(2);
  search.value = "nothing";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(document.querySelector("#coin-grid")!.textContent).toContain(
    "没有匹配",
  );
  document.querySelector<HTMLButtonElement>('[data-action="reset"]')!.click();
  expect(document.querySelectorAll(".coin-card")).toHaveLength(8);
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
