import { fingerprintSVG } from "./render.js";
import { visualParameters } from "./data.js";
import {
  pendingTransaction,
  reserveTransaction,
  persistTransaction,
  completeTransaction,
  withTransactionLock,
} from "./pending.js";
export { pendingTransaction } from "./pending.js";
export const NETWORK = {
  chainId: "0x3c8",
  chainName: "Bohr Testnet / BOT Chain Testnet",
  nativeCurrency: { name: "Test BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: ["https://rpc.bohr.life"],
  blockExplorerUrls: ["https://scan.bohr.life"],
};
const safeRead = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};
export const wallet = { account: null, chainId: null };
export const contractAddress = () => safeRead("cfp.contract.968", "");
export const collections = () =>
  safeRead("cfp.collection.968", []).filter(
    (x) => x.owner?.toLowerCase() === wallet.account?.toLowerCase(),
  );
export const base64 = (text) =>
  btoa(
    Array.from(new TextEncoder().encode(text), (b) =>
      String.fromCharCode(b),
    ).join(""),
  );
export function createEdition(coin, sentiment) {
  const svg = fingerprintSVG(coin, sentiment),
    capturedAt = new Date().toISOString();
  const snapshot = {
    schema: "cfp/1",
    symbol: coin.id,
    capturedAt,
    sourceMode: coin.mode,
    sourceAsOf: coin.asOf,
    market: {
      price: coin.price,
      change24h: coin.change,
      quoteVolume24h: coin.volume,
      amplitude24h: coin.amplitude,
    },
    sentiment: {
      value: sentiment?.value ?? null,
      scope: "market-wide",
      source: sentiment?.mode === "demo" ? "illustrative" : "Alternative.me",
      status: sentiment?.mode,
      asOf: sentiment?.asOf ?? null,
    },
    parameters: visualParameters(coin, sentiment),
  };
  const metadata = {
    name: `${coin.name} / ${coin.id} Fingerprint`,
    description:
      "A self-published market-data artwork. Contour edition v1. Data is not oracle-attested. Market sentiment source: Alternative.me when live; illustrative when demo.",
    image: `data:image/svg+xml;base64,${base64(svg)}`,
    attributes: [
      { trait_type: "Currency", value: coin.id },
      { trait_type: "Data mode", value: coin.mode },
      { trait_type: "Edition", value: "Contour v1" },
      { trait_type: "Captured at", value: capturedAt },
    ],
    properties: snapshot,
  };
  return {
    svg,
    snapshot,
    metadata,
    uri: `data:application/json;base64,${base64(JSON.stringify(metadata))}`,
  };
}
export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
export async function connect() {
  if (!window.ethereum)
    throw new Error(
      "未检测到浏览器钱包。请在安装了 MetaMask 等 EVM 钱包的浏览器中打开本页。",
    );
  const accounts = await window.ethereum.request({
    method: "eth_requestAccounts",
  });
  if (!accounts?.[0]) throw new Error("没有可用的钱包账户。");
  wallet.account = accounts[0];
  wallet.chainId = await window.ethereum.request({ method: "eth_chainId" });
  return wallet;
}
// Native page navigation must retain an existing wallet grant without prompting.
export async function restoreWallet() {
  if (!window.ethereum?.request) return false;
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(accounts?.[0] ?? "")) return false;
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    wallet.account = accounts[0];
    wallet.chainId = chainId;
    return true;
  } catch {
    return false;
  }
}
export function watchWallet(callback) {
  const e = window.ethereum;
  if (!e?.on) return;
  e.on("accountsChanged", (accounts) => {
    wallet.account = accounts[0] ?? null;
    callback();
  });
  e.on("chainChanged", (chain) => {
    wallet.chainId = chain;
    callback();
  });
}
async function signer() {
  await connect();
  if (wallet.chainId !== NETWORK.chainId) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: NETWORK.chainId }],
      });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [NETWORK],
      });
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: NETWORK.chainId }],
      });
    }
  }
  const { BrowserProvider } = await import("ethers");
  const provider = new BrowserProvider(window.ethereum);
  if ((await provider.getNetwork()).chainId !== 968n)
    throw new Error("钱包尚未切换到 BOT Chain Testnet，已停止操作。");
  wallet.chainId = NETWORK.chainId;
  return { provider, signer: await provider.getSigner() };
}
let artifact;
async function loadArtifact() {
  if (!artifact) {
    const response = await fetch("/fingerprint-contract.json");
    if (!response.ok)
      throw new Error("缺少合约构建文件。请运行 pnpm fingerprint:compile。");
    artifact = await response.json();
  }
  return artifact;
}
export async function verifyContract(address) {
  const { JsonRpcProvider, isAddress } = await import("ethers");
  if (!isAddress(address)) throw new Error("请输入有效的 EVM 合约地址。");
  const provider = new JsonRpcProvider(NETWORK.rpcUrls[0]);
  try {
    if ((await provider.getNetwork()).chainId !== 968n)
      throw new Error("RPC 网络与 BOT Chain 不一致。");
    const code = await provider.getCode(address);
    const compiled = await loadArtifact();
    if (code.toLowerCase() !== compiled.deployedBytecode.toLowerCase())
      throw new Error("地址的合约字节码与本项目不一致，请确认部署版本。");
    if (!save("cfp.contract.968", address))
      throw new Error("浏览器无法保存配置，请允许本地存储。");
  } finally {
    provider.destroy();
  }
}
const sameAddress = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
function metadataFromUri(uri) {
  const prefix = "data:application/json;base64,";
  try {
    if (!uri.startsWith(prefix)) throw new Error("Invalid URI");
    const bytes = Uint8Array.from(atob(uri.slice(prefix.length)), (c) => c.charCodeAt(0));
    const metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
        typeof metadata.properties?.capturedAt !== "string" || !Number.isFinite(Date.parse(metadata.properties.capturedAt)))
      throw new Error("Invalid snapshot metadata");
    return metadata;
  } catch {
    throw new Error("NFT URI 未包含可核验的 JSON 快照与时间，已停止操作；已有交易保留占用。");
  }
}
function assertNoPending() {
  if (pendingTransaction()) throw new Error("已有待核验 NFT 交易；请只查询原交易，不要重复发送。");
}
function cancelled(error) {
  return error?.code === 4001 || error?.code === "ACTION_REJECTED";
}
async function broadcast(job, send, report) {
  job = JSON.parse(JSON.stringify(job));
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  if (!sameAddress(accounts?.[0], job.owner) || Number(await window.ethereum.request({ method: "eth_chainId" })) !== job.chainId)
    throw new Error("钱包账户或网络发生变化，已停止 NFT 操作。");
  const reserved = reserveTransaction(job);
  let submitted;
  try {
    submitted = await send();
  } catch (error) {
    if (cancelled(error)) completeTransaction(reserved);
    else report("发送结果尚不明确且未取得哈希；保留占用，请人工核查钱包记录，禁止再次发送。");
    throw error;
  }
  const pending = { ...reserved, status: "SUBMITTED", hash: submitted.hash };
  persistTransaction(pending);
  report("交易已提交，保留原交易哈希，正在等待核验。", pending.hash);
  try {
    // Receipt waiting is bounded; a replacement or timeout never triggers a new send.
    const receipt = await submitted.wait(1, 60_000);
    return await settleTransaction(pending, receipt, report);
  } catch (error) {
    error.transactionHash = pending.hash;
    report(error.message === "NFT_TRANSACTION_REVERTED"
      ? "原交易已确认回滚，未添加收藏。"
      : "尚未取得可核验的成功结果。保留原交易哈希，仅查询原交易；不会自动重发。", pending.hash);
    throw error;
  }
}
async function reader() {
  const { createPublicClient, http } = await import("viem");
  return createPublicClient({ transport: http(NETWORK.rpcUrls[0], { retryCount: 0, timeout: 15_000 }) });
}
async function settleTransaction(job, receipt, report, rpc) {
  const client = rpc || await reader();
  if (await client.getChainId() !== job.chainId) throw new Error("RPC 网络与待确认 NFT 交易不一致，保留占用。");
  const hash = receipt?.transactionHash ?? receipt?.hash;
  if (!receipt || hash?.toLowerCase() !== job.hash.toLowerCase() || !sameAddress(receipt.from, job.owner))
    throw new Error("尚未取得匹配原交易哈希与签名钱包的回执，保留占用。");
  if (receipt.status === 0 || receipt.status === "reverted") {
    completeTransaction(job);
    throw new Error("NFT_TRANSACTION_REVERTED");
  }
  if (receipt.status !== 1 && receipt.status !== "success") throw new Error("原交易状态未知，保留占用。");
  const a = await loadArtifact();
  const address = job.kind === "DEPLOY" ? receipt.contractAddress : job.contract;
  if (!address || (job.kind === "DEPLOY" ? receipt.to != null : !sameAddress(receipt.to, address)))
    throw new Error("原交易的目标合约不一致，保留占用。");
  const code = await client.getCode({ address });
  if (code?.toLowerCase() !== a.deployedBytecode.toLowerCase())
    throw new Error("回执合约代码与本项目不一致，保留占用。");
  if (job.kind === "DEPLOY") {
    if (!save("cfp.contract.968", address)) throw new Error("部署已成功但地址无法保存；保留原交易记录。");
    completeTransaction(job);
    report(`合约已部署并核验：${address}`, job.hash);
    return address;
  }
  const { Interface, keccak256, toUtf8Bytes } = await import("ethers");
  if (keccak256(toUtf8Bytes(job.edition.uri)) !== job.digest) throw new Error("待确认快照摘要不一致，保留占用。");
  const abi = new Interface(a.abi);
  const event = receipt.logs.filter((log) => sameAddress(log.address, address)).map((log) => {
    try { return abi.parseLog(log); } catch { return null; }
  }).find((log) => log?.name === "FingerprintMinted" && sameAddress(log.args.collector, job.owner) && log.args.digest === job.digest);
  if (!event) throw new Error("原交易没有匹配的 NFT 铸造事件，保留占用。");
  const tokenId = event.args.tokenId;
  const read = (functionName) => client.readContract({ address, abi: a.abi, functionName, args: [tokenId] });
  if (!sameAddress(await read("ownerOf"), job.owner) || await read("metadataHash") !== job.digest || await read("tokenURI") !== job.edition.uri)
    throw new Error("链上所有权、摘要或元数据核验失败，保留占用。");
  const metadata = metadataFromUri(job.edition.uri);
  const record = { owner: job.owner, tokenId: tokenId.toString(), contract: address, tx: job.hash,
    chainId: job.chainId, metadata, capturedAt: metadata.properties.capturedAt };
  const records = safeRead("cfp.collection.968", []);
  if (!save("cfp.collection.968", [record, ...records.filter((x) => x.tx?.toLowerCase() !== job.hash.toLowerCase())]))
    throw new Error(`Token #${record.tokenId} 已铸造但收藏记录无法保存；保留原交易记录。`);
  completeTransaction(job);
  report(`已收藏，Token #${record.tokenId}。链上所有权与快照摘要已核验。`, job.hash);
  return record;
}
export async function queryPendingTransaction(report) {
  return withTransactionLock(async () => {
    const job = pendingTransaction();
    if (!job) throw new Error("没有待核验 NFT 交易。");
    if (!job.hash) throw new Error("发送结果尚不明确且没有原交易哈希；禁止重发，请人工核查钱包记录。");
    report("只查询原 NFT 交易，不发起新的签名或广播。", job.hash);
    try {
      const client = await reader();
      if (await client.getChainId() !== job.chainId) throw new Error("RPC 网络不一致。");
      const receipt = await client.getTransactionReceipt({ hash: job.hash });
      return await settleTransaction(job, receipt, report, client);
    } catch (error) {
      error.transactionHash = job.hash;
      report(error.message === "NFT_TRANSACTION_REVERTED"
        ? "原交易已确认回滚，未添加收藏。"
        : "尚未取得可核验的成功结果。保留原交易哈希，仅查询原交易；不会自动重发。", job.hash);
      throw error;
    }
  });
}
export async function deployContract(report) {
  return withTransactionLock(async () => {
    assertNoPending();
    const { ContractFactory } = await import("ethers");
    const { signer: s } = await signer(), a = await loadArtifact();
    const owner = await s.getAddress();
    const factory = new ContractFactory(a.abi, a.bytecode, s);
    report("请在钱包中核对部署费用并确认。");
    return broadcast({ kind: "DEPLOY", chainId: 968, owner }, async () => {
      const contract = await factory.deploy();
      return contract.deploymentTransaction();
    }, report);
  });
}
export async function mintEdition(edition, report) {
  edition = JSON.parse(JSON.stringify(edition));
  edition.metadata = metadataFromUri(edition.uri);
  edition.snapshot.capturedAt = edition.metadata.properties.capturedAt;
  return withTransactionLock(async () => {
    assertNoPending();
    const address = contractAddress();
    if (!address) throw new Error("尚未配置 NFT 合约，请先部署或填写合约地址。");
    if (edition.uri.length > 18000) throw new Error("快照超过合约大小限制，请减少元数据后重试。");
    const { Contract, keccak256, toUtf8Bytes } = await import("ethers");
    const { provider, signer: s } = await signer(), a = await loadArtifact();
    if ((await provider.getCode(address)).toLowerCase() !== a.deployedBytecode.toLowerCase())
      throw new Error("合约代码与本项目不匹配，已停止铸造。");
    const owner = await s.getAddress(), contract = new Contract(address, a.abi, s);
    const digest = keccak256(toUtf8Bytes(edition.uri));
    if (await contract.minted(owner, digest)) throw new Error("这个账户已收藏过同一份快照。");
    report("请在钱包中核对 Gas 费用并确认铸造。");
    return broadcast({ kind: "MINT", chainId: 968, owner, contract: address, digest,
      edition: { uri: edition.uri, metadata: edition.metadata, snapshot: edition.snapshot } },
    () => contract.mint(edition.uri), report);
  });
}
export function errorMessage(error) {
  if (error.code === 4001 || error.code === "ACTION_REJECTED")
    return "你取消了钱包操作，未完成上链。";
  if (error.code === "INSUFFICIENT_FUNDS")
    return "测试 BOT 余额不足以支付 Gas，请补充后重试。";
  return error.shortMessage || error.message || "操作失败，请稍后重试。";
}
