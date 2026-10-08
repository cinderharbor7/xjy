// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { sampleMarket } from "../../web/fingerprint/data.js";
import { identityAssets } from "../../web/ui.js";
import { createEdition } from "../../web/fingerprint/nft.js";
import { mockCollections, saveMockCollection, MOCK_COLLECTION_KEY } from "../../web/fingerprint/mock-collection.js";

vi.mock("../../web/fingerprint/render.js", async (original) => ({
  ...(await original<object>()), mountFingerprints: () => () => {},
  mountSculpture: vi.fn(), sculptureFailureMessage: vi.fn(),
  setMotionPaused: vi.fn(), isMotionPaused: () => false,
}));
const market = sampleMarket();
const assets = [...market.coins, ...identityAssets];
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(window, "ethereum"); });

it("collects all ten registered assets without a wallet, including missing-price neutral identities", () => {
  for (const coin of assets) {
    const record = saveMockCollection(createEdition(coin, market.sentiment));
    expect(record).toMatchObject({ mode: "MOCK", onchain: false });
    expect(record).not.toHaveProperty("tx");
    expect(record).not.toHaveProperty("tokenId");
  }
  expect(mockCollections()).toHaveLength(10);
  const weth = mockCollections().find((record) => record.metadata.properties.symbol === "WETH")!;
  expect(weth.metadata.properties.market).toMatchObject({ price: null });
  expect(weth.metadata.properties.sourceMode).toBe("unavailable");
});

it("keeps immutable image, source and capture time across module reload", async () => {
  const edition = createEdition(market.coins[0], market.sentiment);
  const expected = structuredClone(edition.metadata);
  saveMockCollection(edition);
  edition.metadata.properties.market.price = 999;
  edition.metadata.image = "changed";
  vi.resetModules();
  const reloaded = await import("../../web/fingerprint/mock-collection.js");
  expect(reloaded.mockCollections()[0].metadata).toEqual(expected);
});

it("does not read or alter real NFT collections, contracts or pending transactions", () => {
  const keys = ["cfp.collection.968", "cfp.contract.968", "cfp.pending.968.v1", "cfp.collection.677", "cfp.contract.677", "cfp.pending.677.v1"];
  for (const key of keys) localStorage.setItem(key, "retained original bytes");
  saveMockCollection(createEdition(market.coins[0], market.sentiment));
  expect(mockCollections()).toHaveLength(1);
  for (const key of keys) expect(localStorage.getItem(key)).toBe("retained original bytes");
});

it("rejects corrupted records without deleting them or overwriting them with a new collection", () => {
  localStorage.setItem(MOCK_COLLECTION_KEY, "corrupt");
  expect(mockCollections).toThrow("未清空原记录");
  expect(() => saveMockCollection(createEdition(market.coins[0], market.sentiment))).toThrow("未清空原记录");
  expect(localStorage.getItem(MOCK_COLLECTION_KEY)).toBe("corrupt");
});

it("reports write failure without returning a successful collection", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(() => saveMockCollection(createEdition(market.coins[0], market.sentiment))).toThrow("未能确认保存");
  expect(mockCollections()).toEqual([]);
});

it("runs the shared UI flow for every asset and keeps Mock cards free of blockchain proof links", async () => {
  document.body.innerHTML = readFileSync("web/index.html", "utf8").match(/<body>([\s\S]*)<\/body>/)![1];
  history.replaceState(null, "", "/");
  sessionStorage.setItem("verdant.market-mode", "demo");
  const dialog = document.querySelector<HTMLDialogElement>("#modal")!;
  Object.defineProperty(dialog, "showModal", { value() { this.open = true; } });
  Object.defineProperty(dialog, "close", { value() { this.open = false; } });
  const request = vi.fn(async () => []);
  Object.defineProperty(window, "ethereum", { configurable: true, value: { request, on() {} } });
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  await import("../../web/app.js");
  await new Promise((resolve) => setTimeout(resolve, 0));
  request.mockClear();
  for (const coin of assets) {
    history.replaceState(null, "", `/coins/${coin.id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    const collect = document.querySelector<HTMLButtonElement>('[data-action="mint"]')!;
    expect(collect.disabled).toBe(false);
    collect.click();
    expect(dialog.textContent).toContain("MOCK MODE · 未上链");
    document.querySelector<HTMLButtonElement>('[data-action="confirm-mock-collection"]')!.click();
    expect(document.querySelector("#mock-progress")!.textContent).toContain("已保存");
    document.querySelector<HTMLButtonElement>('[data-action="view-mock-collection"]')!.click();
  }
  expect(mockCollections()).toHaveLength(10);
  // A page re-render reads persisted records instead of losing the collected snapshots.
  window.dispatchEvent(new PopStateEvent("popstate"));
  const section = document.querySelector('[data-collection-section="MOCK"]')!;
  expect(section.querySelectorAll(".collection-card")).toHaveLength(10);
  expect(section.textContent).toContain("未上链");
  expect(section.querySelector('a[href*="/tx/"]')).toBeNull();
  expect(section.textContent).not.toContain("Token #");
  expect(document.querySelector('[data-collection-section="BOT_MAINNET"]')).not.toBeNull();
  expect(request).not.toHaveBeenCalled();
  const { fingerprintSVG } = await import("../../web/fingerprint/render.js");
  for (const coin of identityAssets) {
    const record = mockCollections().find((item) => item.metadata.properties.symbol === coin.id)!;
    expect(record.metadata.properties.parameters).toMatchObject({ mood: 0.5 });
    expect(record.metadata.properties.sentiment).toMatchObject({ value: null, status: "unavailable" });
    expect(record.metadata.image).toBe(`data:image/svg+xml;base64,${Buffer.from(fingerprintSVG(coin, { value: null })).toString("base64")}`);
  }
});
