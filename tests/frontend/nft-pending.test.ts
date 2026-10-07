// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const owner = "0x1111111111111111111111111111111111111111";
const address = "0x2222222222222222222222222222222222222222";
const hash = "0x" + "a".repeat(64);
const key = "cfp.pending.968.v1";
const mocks = vi.hoisted(() => ({
  mint: vi.fn(), deploy: vi.fn(), wait: vi.fn(), minted: vi.fn(),
  chain: vi.fn(), receipt: vi.fn(), code: vi.fn(), read: vi.fn(),
  address: vi.fn(), http: vi.fn(),
}));
vi.mock("../../web/fingerprint/render.js", () => ({
  fingerprintSVG: () => "<svg/>", mountFingerprints: () => () => {},
  mountSculpture: vi.fn(), sculptureFailureMessage: vi.fn(),
  setMotionPaused: vi.fn(), isMotionPaused: () => false,
}));
vi.mock("ethers", async (original) => ({
  ...(await original<object>()),
  BrowserProvider: class {
    getNetwork = async () => ({ chainId: 968n });
    getCode = async () => "0xcafe";
    getSigner = async () => ({ getAddress: mocks.address });
  },
  ContractFactory: class {
    deploy = mocks.deploy;
  },
  Contract: class {
    minted = mocks.minted;
    mint = mocks.mint;
  },
}));
vi.mock("viem", async (original) => ({
  ...(await original<object>()), http: mocks.http,
  createPublicClient: () => ({ getChainId: mocks.chain, getTransactionReceipt: mocks.receipt,
    getCode: mocks.code, readContract: mocks.read }),
}));
const artifact = {
  abi: ["event FingerprintMinted(address indexed collector,uint256 indexed tokenId,bytes32 indexed digest)"],
  bytecode: "0xcafe", deployedBytecode: "0xcafe",
};
const metadata = { name: "ETH", properties: { capturedAt: "2026-10-07T10:30:00.000Z" } };
const edition = { uri: `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}`, metadata,
  snapshot: { capturedAt: metadata.properties.capturedAt } };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear(); sessionStorage.clear();
  mocks.address.mockResolvedValue(owner);
  mocks.chain.mockResolvedValue(968);
  mocks.code.mockResolvedValue("0xcafe");
  mocks.receipt.mockResolvedValue(null);
  mocks.minted.mockResolvedValue(false);
  mocks.wait.mockRejectedValue(new Error("receipt timed out"));
  mocks.mint.mockResolvedValue({ hash, wait: mocks.wait });
  mocks.deploy.mockResolvedValue({ deploymentTransaction: () => ({ hash, wait: mocks.wait }) });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(artifact)));
  Object.defineProperty(window, "ethereum", { configurable: true, value: {
    on() {}, request: vi.fn(async ({ method }: { method: string }) => method === "eth_chainId" ? "0x3c8" : [owner]),
  } });
  let held = false;
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request:
    async (_: string, _options: unknown, action: (lock: unknown) => Promise<unknown>) => {
      if (held) return action(null);
      held = true;
      try { return await action({ name: key }); } finally { held = false; }
    } } });
  localStorage.setItem("cfp.contract.968", JSON.stringify(address));
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "ethereum");
  Reflect.deleteProperty(navigator, "locks");
});

it("persists deployment hash after timeout and blocks a second deployment after module reload", async () => {
  let nft = await import("../../web/fingerprint/nft.js");
  const report = vi.fn();
  await expect(nft.deployContract(report)).rejects.toThrow("timed out");
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ kind: "DEPLOY", owner, chainId: 968, hash, status: "SUBMITTED" });
  expect(report.mock.calls.at(-1)?.[1]).toBe(hash);
  vi.resetModules(); nft = await import("../../web/fingerprint/nft.js");
  await expect(nft.deployContract(report)).rejects.toThrow("待核验");
  expect(mocks.deploy).toHaveBeenCalledTimes(1);
});

it("freezes a mint snapshot and keeps the original hash and occupation on receipt/RPC uncertainty", async () => {
  const nft = await import("../../web/fingerprint/nft.js");
  await expect(nft.mintEdition(edition, vi.fn())).rejects.toThrow("timed out");
  const job = JSON.parse(localStorage.getItem(key)!);
  expect(job).toMatchObject({ kind: "MINT", owner, contract: address, hash, edition });
  mocks.receipt.mockRejectedValueOnce(new Error("RPC unavailable"));
  const report = vi.fn();
  await expect(nft.queryPendingTransaction(report)).rejects.toThrow("RPC unavailable");
  expect(mocks.receipt).toHaveBeenCalledWith({ hash });
  expect(report.mock.calls.at(-1)?.[1]).toBe(hash);
  await expect(nft.mintEdition(edition, report)).rejects.toThrow("待核验");
  expect(mocks.mint).toHaveBeenCalledTimes(1);
  expect(mocks.http).toHaveBeenCalledWith("https://rpc.bohr.life", { retryCount: 0, timeout: 15_000 });
});

it("refuses to broadcast if persistent storage is unavailable", async () => {
  const nft = await import("../../web/fingerprint/nft.js");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  await expect(nft.deployContract(vi.fn())).rejects.toThrow("无法保存");
  expect(mocks.deploy).not.toHaveBeenCalled();
});

it("retains the known hash in this tab and the durable reservation if storage fails after broadcasting", async () => {
  const nft = await import("../../web/fingerprint/nft.js");
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name: string, value: string) {
    if (name === key && JSON.parse(value).status === "SUBMITTED") throw new Error("quota changed");
    return setItem.call(this, name, value);
  });
  await expect(nft.deployContract(vi.fn())).rejects.toMatchObject({ transactionHash: hash });
  expect(nft.pendingTransaction()).toMatchObject({ hash, status: "SUBMITTED" });
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ hash: null, status: "SENDING" });
  await expect(nft.deployContract(vi.fn())).rejects.toThrow("待核验");
  expect(mocks.deploy).toHaveBeenCalledTimes(1);
  expect(mocks.wait).not.toHaveBeenCalled();
});

it("releases a definitively rejected wallet signature before any hash was returned", async () => {
  const nft = await import("../../web/fingerprint/nft.js");
  mocks.deploy.mockRejectedValueOnce(Object.assign(new Error("user rejected"), { code: "ACTION_REJECTED" }));
  await expect(nft.deployContract(vi.fn())).rejects.toThrow("user rejected");
  expect(localStorage.getItem(key)).toBeNull();
});

it("never lets an old tab's known hash replace or release a different window's newer reservation", async () => {
  const nft = await import("../../web/fingerprint/nft.js");
  await expect(nft.deployContract(vi.fn())).rejects.toThrow("timed out");
  const oldJob = nft.pendingTransaction()!;
  const newer = { ...oldJob, id: crypto.randomUUID(), status: "SENDING", hash: null };
  localStorage.setItem(key, JSON.stringify(newer));
  expect(nft.pendingTransaction()).toMatchObject({ id: newer.id, hash: null });
  const { completeTransaction } = await import("../../web/fingerprint/pending.js");
  expect(() => completeTransaction(oldJob)).toThrow("发生变化");
  expect(JSON.parse(localStorage.getItem(key)!).id).toBe(newer.id);
});

it("keeps an ambiguous send without a hash occupied and does not offer a new broadcast", async () => {
  mocks.mint.mockRejectedValueOnce(new Error("wallet disconnected while sending"));
  const nft = await import("../../web/fingerprint/nft.js");
  await expect(nft.mintEdition(edition, vi.fn())).rejects.toThrow("disconnected");
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ status: "SENDING", hash: null });
  await expect(nft.queryPendingTransaction(vi.fn())).rejects.toThrow("没有原交易哈希");
  await expect(nft.deployContract(vi.fn())).rejects.toThrow("待核验");
  expect(mocks.mint).toHaveBeenCalledTimes(1);
  expect(mocks.deploy).not.toHaveBeenCalled();
});

it("prevents a concurrent call while the first window holds the transaction lock", async () => {
  let release!: () => void;
  mocks.wait.mockImplementationOnce(() => new Promise((_, reject) => { release = () => reject(new Error("still pending")); }));
  const nft = await import("../../web/fingerprint/nft.js");
  const first = nft.deployContract(vi.fn());
  const rejected = expect(first).rejects.toThrow("still pending");
  for (let i = 0; i < 10 && !release; i++) await tick();
  expect(release).toBeTypeOf("function");
  await expect(nft.mintEdition(edition, vi.fn())).rejects.toThrow("另一个窗口");
  release(); await rejected;
  expect(mocks.deploy).toHaveBeenCalledTimes(1); expect(mocks.mint).not.toHaveBeenCalled();
});

it("only releases after a matching reverted receipt and never queries a different hash", async () => {
  const nft = await import("../../web/fingerprint/nft.js");
  await expect(nft.deployContract(vi.fn())).rejects.toThrow("timed out");
  mocks.receipt.mockResolvedValueOnce({ transactionHash: "0x" + "b".repeat(64), from: owner, status: "reverted" });
  await expect(nft.queryPendingTransaction(vi.fn())).rejects.toThrow("匹配");
  expect(localStorage.getItem(key)).not.toBeNull();
  mocks.receipt.mockResolvedValueOnce({ transactionHash: hash, from: owner, status: "reverted" });
  await expect(nft.queryPendingTransaction(vi.fn())).rejects.toThrow("NFT_TRANSACTION_REVERTED");
  expect(localStorage.getItem(key)).toBeNull();
  expect(mocks.deploy).toHaveBeenCalledTimes(1);
});

it("recovers a successful deployment through only the original receipt and code check", async () => {
  const nft = await import("../../web/fingerprint/nft.js");
  await expect(nft.deployContract(vi.fn())).rejects.toThrow("timed out");
  mocks.receipt.mockResolvedValueOnce({ transactionHash: hash, from: owner, to: null, status: "success", contractAddress: address });
  expect(await nft.queryPendingTransaction(vi.fn())).toBe(address);
  expect(localStorage.getItem(key)).toBeNull();
  expect(nft.contractAddress()).toBe(address);
  expect(mocks.deploy).toHaveBeenCalledTimes(1);
});

it("retains occupation when the recovery RPC is on another chain or deployment bytecode mismatches", async () => {
  const nft = await import("../../web/fingerprint/nft.js");
  await expect(nft.deployContract(vi.fn())).rejects.toThrow("timed out");
  mocks.chain.mockResolvedValueOnce(677);
  await expect(nft.queryPendingTransaction(vi.fn())).rejects.toThrow("网络不一致");
  expect(mocks.receipt).not.toHaveBeenCalled();
  mocks.receipt.mockResolvedValueOnce({ transactionHash: hash, from: owner, to: null, status: "success", contractAddress: address });
  mocks.code.mockResolvedValueOnce("0xdead");
  await expect(nft.queryPendingTransaction(vi.fn())).rejects.toThrow("合约代码");
  expect(localStorage.getItem(key)).not.toBeNull();
  expect(mocks.deploy).toHaveBeenCalledTimes(1);
});

it("reconstructs a successful collection from the stored edition and checks exact event and token data", async () => {
  const nft = await import("../../web/fingerprint/nft.js");
  await expect(nft.mintEdition(edition, vi.fn())).rejects.toThrow("timed out");
  const job = JSON.parse(localStorage.getItem(key)!);
  const { Interface } = await import("ethers");
  const abi = new Interface(artifact.abi);
  const log = abi.encodeEventLog(abi.getEvent("FingerprintMinted")!, [owner, 1n, job.digest]);
  mocks.receipt.mockResolvedValueOnce({ transactionHash: hash, from: owner, to: address, status: "success", logs: [{ address, ...log }] });
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) => functionName === "ownerOf" ? owner : functionName === "metadataHash" ? job.digest : edition.uri);
  const result = await nft.queryPendingTransaction(vi.fn());
  expect(result).toMatchObject({ tokenId: "1", tx: hash, metadata: edition.metadata });
  expect(localStorage.getItem(key)).toBeNull();
  expect(JSON.parse(localStorage.getItem("cfp.collection.968")!)).toHaveLength(1);
  expect(mocks.mint).toHaveBeenCalledTimes(1);
});

it("fails closed for damaged pending records and unavailable cross-window locks", async () => {
  const nft = await import("../../web/fingerprint/nft.js");
  localStorage.setItem(key, "{broken");
  await expect(nft.deployContract(vi.fn())).rejects.toThrow("无法读取");
  localStorage.removeItem(key);
  Reflect.deleteProperty(navigator, "locks");
  await expect(nft.deployContract(vi.fn())).rejects.toThrow("Web Locks");
  expect(mocks.deploy).not.toHaveBeenCalled();
});

it("displays only metadata and capture time from the verified URI when pending display fields are corrupted", async () => {
  const nft = await import("../../web/fingerprint/nft.js");
  await expect(nft.mintEdition(edition, vi.fn())).rejects.toThrow("timed out");
  const job = JSON.parse(localStorage.getItem(key)!);
  job.edition.metadata = { name: "Different artwork" };
  job.edition.snapshot.capturedAt = "2020-01-01T00:00:00.000Z";
  localStorage.setItem(key, JSON.stringify(job));
  const { Interface } = await import("ethers");
  const abi = new Interface(artifact.abi);
  const log = abi.encodeEventLog(abi.getEvent("FingerprintMinted")!, [owner, 1n, job.digest]);
  mocks.receipt.mockResolvedValueOnce({ transactionHash: hash, from: owner, to: address, status: "success", logs: [{ address, ...log }] });
  mocks.read.mockImplementation(async ({ functionName }: { functionName: string }) => functionName === "ownerOf" ? owner : functionName === "metadataHash" ? job.digest : edition.uri);
  const record = await nft.queryPendingTransaction(vi.fn());
  expect(record.metadata).toEqual(metadata);
  expect(record.capturedAt).toBe(metadata.properties.capturedAt);
  expect(localStorage.getItem(key)).toBeNull();
});

it("rejects malformed URI metadata before any mint request", async () => {
  const nft = await import("../../web/fingerprint/nft.js");
  await expect(nft.mintEdition({ ...edition, uri: "data:application/json;base64,ZXhhbXBsZQ==" }, vi.fn())).rejects.toThrow("JSON 快照");
  expect(mocks.mint).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toBeNull();
});

it("restores the pending hash in the UI and keeps deploy/mint disabled while exposing original-hash recovery", async () => {
  localStorage.setItem(key, JSON.stringify({ id: crypto.randomUUID(), kind: "DEPLOY", owner, chainId: 968, status: "SUBMITTED", hash }));
  document.body.innerHTML = readFileSync("web/index.html", "utf8").match(/<body>([\s\S]*)<\/body>/)![1];
  history.replaceState(null, "", "/");
  sessionStorage.setItem("verdant.market-mode", "demo");
  Object.defineProperty(document.querySelector("#modal"), "showModal", { value() { this.open = true; } });
  await import("../../web/app.js");
  document.querySelector<HTMLButtonElement>('[data-action="mint"]')!.click();
  document.querySelector<HTMLButtonElement>('[data-action="real-mint"]')!.click();
  expect(document.querySelector<HTMLButtonElement>('[data-action="confirm-mint"]')!.disabled).toBe(true);
  expect(document.querySelector("#mint-progress")!.textContent).toContain(hash);
  expect(document.querySelector<HTMLButtonElement>('[data-action="query-nft"]')!.disabled).toBe(false);
  document.querySelector<HTMLButtonElement>('[data-action="network"]')!.click();
  expect(document.querySelector<HTMLButtonElement>('[data-action="deploy"]')!.disabled).toBe(true);
  document.querySelector<HTMLButtonElement>('[data-action="query-nft"]')!.click();
  await tick(); await tick();
  expect(document.querySelector("#mint-progress")!.textContent).toContain(hash);
  expect(localStorage.getItem(key)).not.toBeNull();
  expect(mocks.mint).not.toHaveBeenCalled(); expect(mocks.deploy).not.toHaveBeenCalled();
});
