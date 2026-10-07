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
});
afterEach(() => {
  dispose?.();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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
