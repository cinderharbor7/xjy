// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TransactionCheckReportSchema } from "@/domain/schemas/transaction-check";
import { PositionSnapshotSchema } from "@/extensions/aave/schemas";
import { mount } from "../../web/pages/research.js";

vi.mock("../../web/fingerprint/render.js", async (original) => ({
  ...(await original<object>()),
  mountFingerprints: () => () => {},
}));

const txHash = `0x${"ab".repeat(32)}`;
const otherHash = `0x${"ef".repeat(32)}`;
const blockHash = `0x${"cd".repeat(32)}`;
const positionWallet = `0x${"ab".repeat(20)}`;
function positionSnapshot(wallet: string, status: "ACTIVE" | "NO_DEBT") {
  const evidence = {
    chainId: 1, network: "ethereum-mainnet", protocol: "aave-v3",
    providerAddress: wallet, poolAddress: wallet, oracleAddress: wallet, ethAssetAddress: wallet,
    blockNumber: 20000, blockHash, blockTimestamp: "2026-10-06T12:00:00.000Z",
  };
  const common = { mode: "LIVE", wallet, evidence };
  return PositionSnapshotSchema.parse(status === "ACTIVE" ? {
    ...common, status,
    position: { wallet, collateralUsd: 200000, debtUsd: 100000, healthFactor: 1.08, ethPrice: 2800, timestamp: evidence.blockTimestamp, blockNumber: evidence.blockNumber },
    marketChanges: {
      ethChangePct: -5, previousEthPrice: 2900, referenceBlockNumber: 12800,
      referenceBlockHash: `0x${"ef".repeat(32)}`, referenceTimestamp: "2026-10-05T12:00:00.000Z",
      referenceOracleAddress: wallet, lookbackBlocks: 7200, lookbackSeconds: 86400,
    },
  } : { ...common, status, position: null, message: "无借款债务。" });
}
const report = (hash = txHash) => TransactionCheckReportSchema.parse({
  mode: "LIVE_READ_ONLY",
  network: "ethereum-mainnet",
  checkedAt: "2026-10-07T06:00:00.000Z",
  classification: "NO_SUPPORTED_SWAP",
  headline: "未证实卖出",
  summary: "仅验证外层交易事实。",
  confirmedFacts: ["交易已确认"],
  uncertainties: ["未核验其他交易池"],
  nextSteps: ["核对原始消息引用"],
  observation: {
    transaction: {
      hash, from: `0x${"12".repeat(20)}`, to: null,
      nativeValueEth: "20059.2", input: "0x", status: "SUCCESS",
      blockNumber: 20449709, blockHash,
      timestamp: "2024-08-03T18:08:23.000Z", logCount: 0,
    },
    supportedSwaps: [],
    evidence: [
      { type: "TRANSACTION", txHash: hash, blockHash, blockNumber: 20449709, description: "外层交易", source: `https://etherscan.io/tx/${hash}` },
      { type: "BLOCK", blockHash, blockNumber: 20449709, description: "交易所在区块", source: "https://etherscan.io/block/20449709" },
    ],
    scope: {
      protocol: "UNISWAP_V3", poolAddress: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640",
      poolLabel: "Uniswap V3 WETH/USDC 0.05%", asset: "WETH", quoteAsset: "USDC", fee: 500,
    },
  },
});
const root = () => document.querySelector("main")!;
const input = () => root().querySelector<HTMLInputElement>("#query-value")!;
const result = () => root().querySelector("#research-result")!;
const error = () => root().querySelector<HTMLElement>("#research-error")!;
const submit = () => root().querySelector("form")!.dispatchEvent(
  new Event("submit", { bubbles: true, cancelable: true }),
);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle() { await tick(); await tick(); }
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
let dispose: (() => void) | undefined;
beforeEach(() => { document.body.innerHTML = "<main></main>"; });
afterEach(() => { dispose?.(); dispose = undefined; vi.unstubAllGlobals(); });

async function successfulQuery() {
  const fetcher = vi.fn(async () => Response.json(report()));
  vi.stubGlobal("fetch", fetcher);
  dispose = await mount(root(), "investigate");
  input().value = txHash;
  submit();
  await settle();
  expect(result().textContent).toContain("已确认的事实");
  return fetcher;
}

it("clears an earlier report and validation error as soon as the query input changes", async () => {
  await successfulQuery();
  input().value = "invalid";
  input().dispatchEvent(new Event("input", { bubbles: true }));
  expect(result().innerHTML).toBe("");
  submit();
  expect(error().hidden).toBe(false);
  input().value = otherHash;
  input().dispatchEvent(new Event("input", { bubbles: true }));
  expect(error().hidden).toBe(true);
  expect(error().textContent).toBe("");
  expect(result().innerHTML).toBe("");
});

it("leaves no earlier report when a subsequent query is invalid", async () => {
  const fetcher = await successfulQuery();
  input().value = "0x123";
  submit();
  expect(result().innerHTML).toBe("");
  expect(error().textContent).toContain("请输入完整");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects a schema-valid response for another transaction", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(report(otherHash))));
  dispose = await mount(root(), "investigate");
  input().value = txHash;
  submit();
  await settle();
  expect(result().innerHTML).toBe("");
  expect(error().hidden).toBe(false);
  expect(error().textContent).toContain("本次查询不一致");
});

it.each(["ACTIVE", "NO_DEBT"] as const)("rejects a schema-valid %s position for another wallet", async (status) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(positionSnapshot(`0x${"ef".repeat(20)}`, status))));
  dispose = await mount(root(), "position");
  input().value = positionWallet;
  submit();
  await settle();
  expect(result().innerHTML).toBe("");
  expect(error().hidden).toBe(false);
  expect(error().textContent).toContain("本次查询钱包不一致");
});

it.each(["ACTIVE", "NO_DEBT"] as const)("accepts a %s position for the same wallet regardless of address case", async (status) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(positionSnapshot(positionWallet, status))));
  dispose = await mount(root(), "position");
  input().value = `  0x${"AB".repeat(20)}  `;
  submit();
  await settle();
  expect(error().hidden).toBe(true);
  expect(result().textContent).toContain(status === "ACTIVE" ? "Health Factor" : "无债务仓位");
});

it("locks the query during reading and accepts the same hash in a different case", async () => {
  const pending = deferred();
  const fetcher = vi.fn(() => pending.promise);
  vi.stubGlobal("fetch", fetcher);
  dispose = await mount(root(), "investigate");
  input().value = `  0x${"AB".repeat(32)}  `;
  submit();
  expect(input().disabled).toBe(true);
  expect(root().querySelector<HTMLButtonElement>('[data-research="example"]')!.disabled).toBe(true);
  expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).txHash).toBe(`0x${"AB".repeat(32)}`);
  pending.resolve(Response.json(report()));
  await settle();
  expect(result().textContent).toContain("已确认的事实");
  expect(error().hidden).toBe(true);
  expect(input().disabled).toBe(false);
});

it("ignores a late report after a programmatic input change", async () => {
  const pending = deferred();
  vi.stubGlobal("fetch", vi.fn(() => pending.promise));
  dispose = await mount(root(), "investigate");
  input().value = txHash;
  submit();
  input().value = otherHash;
  input().dispatchEvent(new Event("input", { bubbles: true }));
  pending.resolve(Response.json(report()));
  await settle();
  expect(result().innerHTML).toBe("");
  expect(error().hidden).toBe(true);
  expect(input().disabled).toBe(false);
});

it("keeps the frozen request binding even when a programmatic value change emits no input event", async () => {
  const pending = deferred();
  vi.stubGlobal("fetch", vi.fn(() => pending.promise));
  dispose = await mount(root(), "investigate");
  input().value = txHash;
  submit();
  input().value = otherHash;
  pending.resolve(Response.json(report()));
  await settle();
  expect(result().innerHTML).toBe("");
  expect(error().hidden).toBe(true);
  expect(input().disabled).toBe(false);
});

it("does not update a disposed page even if fetch ignores abort", async () => {
  const pending = deferred();
  vi.stubGlobal("fetch", vi.fn(() => pending.promise));
  dispose = await mount(root(), "investigate");
  input().value = txHash;
  submit();
  dispose();
  dispose = undefined;
  root().innerHTML = "replacement page";
  pending.resolve(Response.json(report()));
  await settle();
  expect(root().innerHTML).toBe("replacement page");
});

it("removes an earlier result when the next HTTP query fails", async () => {
  const fetcher = await successfulQuery();
  fetcher.mockResolvedValueOnce(Response.json({ detail: "RPC 读取失败" }, { status: 503 }));
  submit();
  await settle();
  expect(result().innerHTML).toBe("");
  expect(error().hidden).toBe(false);
  expect(error().textContent).toBe("RPC 读取失败");
  expect(input().disabled).toBe(false);
});

it("clears an earlier report when the example button replaces the query", async () => {
  const fetcher = await successfulQuery();
  root().querySelector<HTMLButtonElement>('[data-research="example"]')!.click();
  expect(input().value).not.toBe(txHash);
  expect(result().innerHTML).toBe("");
  expect(error().hidden).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
});


it("hides Aave from research navigation while retaining the other research links", async () => {
  dispose = await mount(root(), "investigate");
  expect(root().querySelector('a[href="/position"]')).toBeNull();
  expect(root().querySelector('a[href="/coins/ETH"]')).not.toBeNull();
  expect(root().querySelector('a[href="/risk-lab"]')).not.toBeNull();
});
