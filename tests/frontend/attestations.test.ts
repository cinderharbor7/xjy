// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { getRiskLabSnapshot } from "@/modules/eth-risk/risk-lab";
import { exportReport, researchReport } from "@/modules/attestation/report";
import * as chain from "@/modules/attestation/bot-chain";
import { mount } from "../../web/pages/attestations.js";
const account = "0x1111111111111111111111111111111111111111";
vi.mock("../../web/fingerprint/render.js", async (original) => ({
  ...(await original<object>()),
  mountFingerprints: () => () => {},
}));
vi.mock("@/modules/attestation/bot-chain", async (original) => ({
  ...(await original<object>()),
  getMetaMask: () => ({ on() {}, removeListener() {} }),
  connectMetaMask: vi.fn(
    async () => "0x1111111111111111111111111111111111111111",
  ),
  confirmTransaction: vi.fn(),
  publishHash: vi.fn(),
  deployRegistry: vi.fn(),
}));
let dispose: () => void;
const tick = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "<main></main>";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(getRiskLabSnapshot())),
  );
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, action: () => unknown) => action() } });
});
afterEach(() => {
  dispose?.();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
it("keeps an unresolved broadcast and prevents a second publish or deployment", async () => {
  localStorage.setItem(
    "xjy:bot:pending:v1",
    JSON.stringify({
      kind: "DEPLOY",
      publisher: account,
      hash: "0x" + "a".repeat(64),
    }),
  );
  vi.mocked(chain.confirmTransaction).mockRejectedValue(new Error("not yet"));
  dispose = await mount(document.querySelector("main")!);
  expect(
    document.querySelector<HTMLButtonElement>('[data-report="deploy"]')!
      .disabled,
  ).toBe(true);
  document.querySelector<HTMLButtonElement>('[data-report="settle"]')!.click();
  await tick();
  await tick();
  expect(localStorage.getItem("xjy:bot:pending:v1")).not.toBeNull();
  expect(chain.publishHash).not.toHaveBeenCalled();
  expect(chain.deployRegistry).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("保留原交易哈希");
});
it("loads a tampered saved report but refuses publication and retains its original declared hash", async () => {
  const envelope = exportReport(researchReport(getRiskLabSnapshot()));
  envelope.report.capturedAt = "2026-10-07T00:00:00.000Z";
  localStorage.setItem("xjy:bot:report:v1", JSON.stringify(envelope));
  localStorage.setItem("xjy:bot:registry:968", account);
  dispose = await mount(document.querySelector("main")!);
  document.querySelector<HTMLButtonElement>('[data-report="connect"]')!.click();
  await tick();
  await tick();
  expect(
    document.querySelector<HTMLButtonElement>('[data-report="publish"]')!
      .disabled,
  ).toBe(true);
  expect(document.body.textContent).toContain("禁止发布");
  expect(chain.publishHash).not.toHaveBeenCalled();
});
it("prepares a validated research report without connecting a wallet or triggering Guardian", async () => {
  dispose = await mount(document.querySelector("main")!);
  document.querySelector<HTMLButtonElement>('[data-report="prepare"]')!.click();
  await tick();
  await tick();
  expect(document.body.textContent).toContain("MOCK_CHAIN_FIXTURE");
  expect(document.body.textContent).toContain("内容哈希一致");
  expect(chain.connectMetaMask).not.toHaveBeenCalled();
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
    "/api/eth-risk",
  ]);
});

async function connect() {
  document.querySelector<HTMLButtonElement>('[data-report="connect"]')!.click();
  await tick();
  await tick();
}
const hash = `0x${"b".repeat(64)}` as const;

it("refuses to request a deployment when a durable sending intent cannot be saved", async () => {
  dispose = await mount(document.querySelector("main")!);
  await connect();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage full"); });
  document.querySelector<HTMLButtonElement>('[data-report="deploy"]')!.click();
  await tick(); await tick();
  expect(chain.deployRegistry).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLButtonElement>('[data-report="deploy"]')!.disabled).toBe(true);
  expect(document.body.textContent).toContain("禁止新签名");
});

it("retains an ambiguous sending intent across remount without broadcasting a second deployment", async () => {
  vi.mocked(chain.deployRegistry).mockRejectedValue(new Error("transport failed after send"));
  dispose = await mount(document.querySelector("main")!);
  await connect();
  document.querySelector<HTMLButtonElement>('[data-report="deploy"]')!.click();
  await tick(); await tick();
  expect(localStorage.getItem("xjy:bot:intent:v1")).not.toBeNull();
  dispose();
  dispose = await mount(document.querySelector("main")!);
  await connect();
  document.querySelector<HTMLButtonElement>('[data-report="deploy"]')!.click();
  await tick();
  expect(chain.deployRegistry).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("尚无可恢复的交易哈希");
});

it("keeps a known hash and durable intent when saving the submitted job fails", async () => {
  vi.mocked(chain.deployRegistry).mockResolvedValue({ kind: "DEPLOY", publisher: account, hash });
  dispose = await mount(document.querySelector("main")!);
  await connect();
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
    if (key === "xjy:bot:pending:v1") throw new Error("quota");
    return original.call(this, key, value);
  });
  document.querySelector<HTMLButtonElement>('[data-report="deploy"]')!.click();
  await tick(); await tick();
  expect(document.querySelector("#report-tx")!.textContent).toContain(hash);
  expect(localStorage.getItem("xjy:bot:intent:v1")).not.toBeNull();
  expect(document.querySelector<HTMLButtonElement>('[data-report="deploy"]')!.disabled).toBe(true);
  dispose();
  dispose = await mount(document.querySelector("main")!);
  await connect();
  expect(document.querySelector<HTMLButtonElement>('[data-report="deploy"]')!.disabled).toBe(true);
  expect(chain.deployRegistry).toHaveBeenCalledTimes(1);
});

it("does not release a confirmed job when local pending cleanup fails", async () => {
  localStorage.setItem("xjy:bot:pending:v1", JSON.stringify({ kind: "DEPLOY", publisher: account, hash }));
  vi.mocked(chain.confirmTransaction).mockResolvedValue({ contract: account });
  dispose = await mount(document.querySelector("main")!);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("storage denied"); });
  document.querySelector<HTMLButtonElement>('[data-report="settle"]')!.click();
  await tick(); await tick();
  expect(localStorage.getItem("xjy:bot:pending:v1")).not.toBeNull();
  expect(document.querySelector("#report-tx")!.textContent).toContain(hash);
  expect(document.querySelector<HTMLButtonElement>('[data-report="deploy"]')!.disabled).toBe(true);
  expect(document.body.textContent).toContain("本地交易记录无法清理");
});

it("clears a sending intent only after an explicit wallet rejection", async () => {
  vi.mocked(chain.deployRegistry).mockRejectedValue({ code: 4001 });
  dispose = await mount(document.querySelector("main")!);
  await connect();
  document.querySelector<HTMLButtonElement>('[data-report="deploy"]')!.click();
  await tick(); await tick();
  expect(localStorage.getItem("xjy:bot:intent:v1")).toBeNull();
  expect(document.querySelector<HTMLButtonElement>('[data-report="deploy"]')!.disabled).toBe(false);
});

it("retains the known hash across remount if removing just the sending intent fails", async () => {
  localStorage.setItem("xjy:bot:pending:v1", JSON.stringify({ kind: "DEPLOY", publisher: account, hash }));
  localStorage.setItem("xjy:bot:intent:v1", JSON.stringify({ kind: "DEPLOY", publisher: account }));
  vi.mocked(chain.confirmTransaction).mockResolvedValue({ contract: account });
  dispose = await mount(document.querySelector("main")!);
  const original = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
    if (key === "xjy:bot:intent:v1") throw new Error("intent cleanup denied");
    return original.call(this, key);
  });
  document.querySelector<HTMLButtonElement>('[data-report="settle"]')!.click();
  await tick(); await tick();
  expect(JSON.parse(localStorage.getItem("xjy:bot:pending:v1")!).hash).toBe(hash);
  dispose();
  dispose = await mount(document.querySelector("main")!);
  expect(document.querySelector("#report-tx")!.textContent).toContain(hash);
  expect(document.querySelector<HTMLButtonElement>('[data-report="settle"]')!.disabled).toBe(false);
  expect(chain.deployRegistry).not.toHaveBeenCalled();
});
