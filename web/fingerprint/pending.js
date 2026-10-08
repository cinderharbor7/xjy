import { z } from "zod";

const key = "cfp.pending.677.v1";
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const fields = {
  id: z.string().uuid(),
  chainId: z.literal(677),
  owner: address,
  status: z.enum(["SENDING", "SUBMITTED"]),
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).nullable(),
};
const schema = z.discriminatedUnion("kind", [
  z.object({ ...fields, kind: z.literal("DEPLOY") }).strict(),
  z.object({
    ...fields,
    kind: z.literal("MINT"),
    contract: address,
    digest: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    edition: z.object({
      uri: z.string().min(1),
      metadata: z.record(z.string(), z.unknown()),
      snapshot: z.object({ capturedAt: z.string().min(1) }).passthrough(),
    }).strict(),
  }).strict(),
]).refine((job) => job.status === "SENDING" ? job.hash === null : job.hash !== null);
let lastKnownJob = null;

export function pendingTransaction() {
  let legacyPending = false;
  try {
    legacyPending = localStorage.getItem("cfp.pending.968.v1") !== null;
    if (legacyPending) throw new Error("Legacy pending occupation");
    const raw = localStorage.getItem(key);
    const stored = raw ? schema.parse(JSON.parse(raw)) : null;
    // If storage failed after broadcast, keep the already known hash visible in this tab.
    if (stored?.status === "SENDING" && lastKnownJob?.hash && stored.id === lastKnownJob.id)
      return lastKnownJob;
    return lastKnownJob = stored;
  } catch {
    const error = new Error(legacyPending ? "旧测试网存在待确认 NFT 记录；保留原记录人工核查，禁止新的主网签名，不按主网查询旧哈希。" : "浏览器待确认记录无法读取；禁止新的 NFT 交易，请保留记录人工核查。");
    error.transactionHash = lastKnownJob?.hash;
    throw error;
  }
}

export function reserveTransaction(job) {
  if (pendingTransaction()) throw new Error("已有待核验 NFT 交易；请只查询原交易，不要重复发送。");
  return persistTransaction({ ...job, id: crypto.randomUUID(), status: "SENDING", hash: null });
}

export function persistTransaction(job) {
  const validated = schema.parse(job);
  lastKnownJob = validated;
  try {
    const raw = JSON.stringify(validated);
    localStorage.setItem(key, raw);
    if (localStorage.getItem(key) !== raw) throw new Error("Storage mismatch");
  } catch {
    const error = new Error("无法保存 NFT 待确认记录；已停止操作。若已取得交易哈希，请保存它，禁止重新发送。");
    error.transactionHash = validated.hash;
    throw error;
  }
  return validated;
}

export function completeTransaction(job) {
  const current = pendingTransaction();
  if (!current || current.id !== job.id || current.kind !== job.kind || current.hash !== job.hash || current.owner.toLowerCase() !== job.owner.toLowerCase())
    throw new Error("待确认记录发生变化；保留占用并人工核查。");
  localStorage.removeItem(key);
  if (localStorage.getItem(key) !== null) throw new Error("待确认记录无法解除；请保留记录人工核查。");
  lastKnownJob = null;
}

export async function withTransactionLock(action) {
  if (!navigator.locks?.request)
    throw new Error("当前浏览器不支持安全的跨窗口交易锁；请使用支持 Web Locks 的 Chrome/Edge。");
  return navigator.locks.request(key, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("另一个窗口正在处理 NFT 交易，请等待并查询原交易。");
    return action();
  });
}
