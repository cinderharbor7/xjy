// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRiskLabSnapshot } from "@/modules/eth-risk/risk-lab";
import { DEMO_POLICY_CONFIG, DEMO_WALLET } from "@/mocks/scenarios";
import { Recovery } from "@/integration/guardian/contracts";
import {
  mount as research,
  positionReportHTML,
  transactionReportHTML,
} from "../../web/pages/research.js";
import { mount as guardian } from "../../web/pages/guardian.js";
import { identityAssets, assetTag } from "../../web/ui.js";
vi.mock("../../web/fingerprint/render.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  mountFingerprints: () => () => {},
}));
let dispose: (() => void) | undefined;
beforeEach(() => {
  document.body.innerHTML = "<main></main>";
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const root = () => document.querySelector("main")!;
const click = (selector: string) =>
  root().querySelector<HTMLButtonElement>(selector)!.click();
const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("native frontend behavior without a browser", () => {
  it("shows labelled Risk Lab data and models without invoking execution APIs", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json(getRiskLabSnapshot()));
    vi.stubGlobal("fetch", fetcher);
    dispose = await research(root(), "risk-lab");
    await wait();
    await wait();
    expect(root().textContent).toContain("MOCK_CHAIN_FIXTURE");
    expect(root().querySelectorAll(".model-grid article").length).toBe(
      getRiskLabSnapshot().models.length,
    );
    expect(fetcher.mock.calls.every(([url]) => url === "/api/eth-risk")).toBe(
      true,
    );
    expect(root().querySelector('a[href="/coins/ETH"]')).not.toBeNull();
  });
  it("rejects malformed transaction hashes before issuing an HTTP request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    dispose = await research(root(), "investigate");
    root().querySelector<HTMLInputElement>("input")!.value = "0x123";
    root()
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await wait();
    expect(fetcher).not.toHaveBeenCalled();
    expect(root().textContent).toContain("请输入完整");
  });
  it("uses validated responses and surfaces API errors without creating a fake result", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ detail: "RPC 未配置" }, { status: 503 }),
        ),
    );
    dispose = await research(root(), "position");
    click('[data-research="example"]');
    root()
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await wait();
    await wait();
    expect(root().textContent).toContain("RPC 未配置");
    expect(root().querySelector("#research-result")!.innerHTML).toBe("");
  });
  it("does not claim a health factor or recommendation for a no-debt response", () => {
    const html = positionReportHTML({
      status: "NO_DEBT",
      message: "无债务",
      wallet: DEMO_WALLET,
      evidence: {
        blockNumber: 42,
        blockHash: "0x123",
        blockTimestamp: "2026-10-07T00:00:00Z",
        poolAddress: DEMO_WALLET,
        oracleAddress: DEMO_WALLET,
        providerAddress: DEMO_WALLET,
        ethAssetAddress: DEMO_WALLET,
      },
    });
    expect(html).toContain("不计算健康因子");
    expect(html).not.toContain("Health Factor");
  });
  it("preserves decimal strings and escapes external text in transaction evidence", () => {
    const html = transactionReportHTML({
      headline: "<script>bad</script>",
      summary: "test",
      mode: "LIVE_READ_ONLY",
      checkedAt: "2026-10-07T00:00:00Z",
      confirmedFacts: ["<img src=x onerror=bad>"],
      uncertainties: ["unknown"],
      nextSteps: ["read"],
      observation: {
        transaction: {
          hash: "0x123",
          from: DEMO_WALLET,
          to: null,
          nativeValueEth: "0.123456789012345678",
          status: "SUCCESS",
          blockNumber: 42,
          blockHash: "0x123",
          timestamp: "2026-10-07T00:00:00Z",
          logCount: 1,
          input: "0x",
        },
        supportedSwaps: [
          {
            logIndex: 0,
            direction: "SELL_ETH",
            wethAmount: "0.123456789012345678",
            usdcAmount: "234.123456",
          },
        ],
        evidence: [],
        scope: { poolLabel: "pool", poolAddress: DEMO_WALLET },
      },
    });
    expect(html).toContain("0.123456789012345678");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("/coins/WETH");
    expect(html).toContain("/coins/USDC");
  });
  it("opens Guardian read-only, submits the original policy version, and retains draft during polling", async () => {
    const status = {
      wallet: DEMO_WALLET,
      mode: "MOCK",
      enabled: false,
      halted: false,
      busy: false,
      recoveryCount: 0,
      recovery: Recovery,
      events: [],
      sources: "Mock fixture",
    };
    const policy = {
      wallet: DEMO_WALLET,
      mode: "MOCK",
      config: structuredClone(DEMO_POLICY_CONFIG),
      version: 4,
      supportedRiskAssets: ["ETH"],
      supportedDefensiveAssets: ["USDC"],
    };
    const fetcher = vi.fn(async (url: string, options: any = {}) =>
      url === "/api/monitor"
        ? Response.json(status)
        : Response.json(
            options.method === "PUT"
              ? {
                  ...policy,
                  version: 5,
                  config: JSON.parse(options.body).config,
                }
              : policy,
          ),
    );
    vi.stubGlobal("fetch", fetcher);
    dispose = await guardian(root());
    await wait();
    await wait();
    expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
    const input = root().querySelector<HTMLInputElement>(
      '[name="minRiskScore"]',
    )!;
    input.value = "92";
    root()
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await wait();
    await wait();
    const put = fetcher.mock.calls.find(([, init]) => init.method === "PUT")!;
    const body = JSON.parse(put[1].body);
    expect(body.version).toBe(4);
    expect(body.config.minRiskScore).toBe(92);
    expect(body.config.minConfidence).toBe(0.85);
    expect(root().textContent).toContain("v5");
  });
  it("provides asset identity fingerprints without inventing USDC or WETH prices", () => {
    for (const asset of identityAssets) {
      expect(asset.price).toBeNull();
      expect(asset.amplitude).toBeNull();
      expect(assetTag(asset.id)).toContain(`data-coin="${asset.id}"`);
    }
  });
});
