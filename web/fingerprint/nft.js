import { fingerprintSVG } from "./render.js";
import { visualParameters } from "./data.js";
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
      throw new Error("缺少合约构建文件。请运行 npm run contract:build。");
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
export async function deployContract(report) {
  const { ContractFactory } = await import("ethers");
  const { signer: s } = await signer(),
    a = await loadArtifact();
  report("请在钱包中核对部署费用并确认。");
  const factory = new ContractFactory(a.abi, a.bytecode, s),
    contract = await factory.deploy();
  const tx = contract.deploymentTransaction();
  report("部署交易已提交，等待链上确认。", tx.hash);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  save("cfp.contract.968", address);
  report(`合约已部署：${address}`, tx.hash);
  return address;
}
export async function mintEdition(edition, report) {
  const address = contractAddress();
  if (!address) throw new Error("尚未配置 NFT 合约，请先部署或填写合约地址。");
  if (edition.uri.length > 18000)
    throw new Error("快照超过合约大小限制，请减少元数据后重试。");
  const { Contract, keccak256, toUtf8Bytes } = await import("ethers");
  const { provider, signer: s } = await signer(),
    a = await loadArtifact();
  if (
    (await provider.getCode(address)).toLowerCase() !==
    a.deployedBytecode.toLowerCase()
  )
    throw new Error("合约代码与本项目不匹配，已停止铸造。");
  const owner = await s.getAddress(),
    contract = new Contract(address, a.abi, s),
    digest = keccak256(toUtf8Bytes(edition.uri));
  if (await contract.minted(owner, digest))
    throw new Error("这个账户已收藏过同一份快照。");
  report("请在钱包中核对 Gas 费用并确认铸造。");
  const tx = await contract.mint(edition.uri);
  report("铸造交易已提交，等待链上确认。", tx.hash);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1)
    throw new Error("交易未成功，未添加收藏。");
  const event = receipt.logs
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((log) => log?.name === "FingerprintMinted");
  if (!event) throw new Error("交易已确认，但未找到铸造事件，请在浏览器核对。");
  const tokenId = event.args.tokenId.toString();
  if (
    (await contract.ownerOf(tokenId)).toLowerCase() !== owner.toLowerCase() ||
    (await contract.metadataHash(tokenId)) !== digest
  )
    throw new Error("链上所有权或摘要核验失败，请查看交易。");
  const record = {
    owner,
    tokenId,
    contract: address,
    tx: receipt.hash,
    chainId: 968,
    metadata: edition.metadata,
    capturedAt: edition.snapshot.capturedAt,
  };
  const saved = save("cfp.collection.968", [
    record,
    ...safeRead("cfp.collection.968", []),
  ]);
  report(
    saved
      ? `已收藏，Token #${tokenId}。链上所有权与快照摘要已核验。`
      : `Token #${tokenId} 已铸造，但本地记录保存失败，请保留交易链接。`,
    receipt.hash,
  );
  return record;
}
export function errorMessage(error) {
  if (error.code === 4001 || error.code === "ACTION_REJECTED")
    return "你取消了钱包操作，未完成上链。";
  if (error.code === "INSUFFICIENT_FUNDS")
    return "测试 BOT 余额不足以支付 Gas，请补充后重试。";
  return error.shortMessage || error.message || "操作失败，请稍后重试。";
}
