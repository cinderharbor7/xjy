import { createPublicClient, createWalletClient, custom, decodeEventLog, defineChain, getAddress, http, keccak256, parseAbi, type Address, type EIP1193Provider, type Hash } from "viem";
import artifact from "./registry-artifact.json";
import type { ReportAnchor } from "./report";

export const botChain = defineChain({ id: 968, name: "BOT Chain Testnet", nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_BOT_RPC_URL || "https://rpc.bohr.life"] } }, blockExplorers: { default: { name: "BOT Scan", url: "https://scan.bohr.life" } }, testnet: true });
export const registryAbi = parseAbi([
  "function REGISTRY_ID() view returns (bytes32)", "function attestations(address publisher, bytes32 reportHash) view returns (uint256)", "function publish(bytes32 reportHash)",
  "event ReportPublished(bytes32 indexed reportHash, address indexed publisher, uint256 timestamp)",
]);
export const registryBytecode = artifact.bytecode as Hash;
export type InjectedWallet = EIP1193Provider & { isMetaMask?: boolean; providers?: InjectedWallet[]; on?: (event: string, listener: (...args: unknown[]) => void) => void; removeListener?: (event: string, listener: (...args: unknown[]) => void) => void };
export type TransactionJob = { kind: "DEPLOY" | "PUBLISH"; hash: Hash; publisher: Address; contract?: Address; reportHash?: Hash };
export function getMetaMask(): InjectedWallet {
  const injected = (window as Window & { ethereum?: InjectedWallet }).ethereum;
  const provider = injected?.providers?.find(p => p.isMetaMask) ?? (injected?.isMetaMask ? injected : undefined);
  if (!provider) throw new Error("请在安装 MetaMask 的浏览器中打开页面；不需要填写私钥。");
  return provider;
}
export const botReader = () => createPublicClient({ chain: botChain, transport: http(botChain.rpcUrls.default.http[0], { retryCount: 0, timeout: 15_000 }) });
type Reader = ReturnType<typeof botReader>;
export function transactionUrl(hash: Hash) { return `${botChain.blockExplorers.default.url}/tx/${hash}`; }
export async function assertRegistry(address: string, reader: Reader = botReader()): Promise<Address> {
  const contract = getAddress(address);
  if (await reader.getChainId() !== botChain.id) throw new Error("RPC 链 ID 不等于 968，已停止操作。");
  const code = await reader.getCode({ address: contract });
  if (!code || code === "0x" || keccak256(code) !== artifact.runtimeCodeHash) throw new Error("该地址不是当前版本的 RiskReportRegistry 存证合约。");
  return contract;
}
export async function connectMetaMask(provider: InjectedWallet): Promise<Address> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts[0]) throw new Error("MetaMask 没有授权账户。");
  return getAddress(accounts[0]);
}
export async function ensureBotChain(provider: InjectedWallet, account: Address) {
  if (Number(await provider.request({ method: "eth_chainId" })) !== 968) {
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x3c8" }] }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x3c8", chainName: botChain.name, nativeCurrency: botChain.nativeCurrency, rpcUrls: [...botChain.rpcUrls.default.http], blockExplorerUrls: [botChain.blockExplorers.default.url] }] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x3c8" }] });
    }
  }
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!accounts[0] || getAddress(accounts[0]) !== account || Number(await provider.request({ method: "eth_chainId" })) !== 968) throw new Error("账户或网络已变更，请重新连接后操作。");
}
export async function deployRegistry(provider: InjectedWallet, publisher: Address): Promise<TransactionJob> {
  await ensureBotChain(provider, publisher);
  if (await botReader().getChainId() !== 968) throw new Error("RPC 网络不匹配。");
  const wallet = createWalletClient({ account: publisher, chain: botChain, transport: custom(provider, { retryCount: 0 }) });
  const hash = await wallet.deployContract({ abi: registryAbi, bytecode: registryBytecode });
  return { kind: "DEPLOY", hash, publisher };
}
export async function publishHash(provider: InjectedWallet, publisher: Address, address: string, reportHash: Hash): Promise<TransactionJob> {
  await ensureBotChain(provider, publisher);
  const reader = botReader(), contract = await assertRegistry(address, reader);
  const timestamp = await reader.readContract({ address: contract, abi: registryAbi, functionName: "attestations", args: [publisher, reportHash] });
  if (timestamp !== 0n) throw new Error("此账户已经发布过这个报告哈希，请直接核验；不需要重复支付 gas。");
  const { request } = await reader.simulateContract({ address: contract, abi: registryAbi, functionName: "publish", args: [reportHash], account: publisher });
  // Recheck after asynchronous RPC preflight; MetaMask may have changed account/network.
  await ensureBotChain(provider, publisher);
  const wallet = createWalletClient({ account: publisher, chain: botChain, transport: custom(provider, { retryCount: 0 }) });
  const hash = await wallet.writeContract(request);
  return { kind: "PUBLISH", hash, publisher, contract, reportHash };
}
export async function confirmTransaction(job: TransactionJob, wait = false): Promise<{ contract: Address; anchor?: ReportAnchor }> {
  const reader = botReader();
  if (await reader.getChainId() !== 968) throw new Error("RPC 网络不匹配。");
  const receipt = wait ? await reader.waitForTransactionReceipt({ hash: job.hash, timeout: 60_000, retryCount: 0 }) : await reader.getTransactionReceipt({ hash: job.hash });
  if (receipt.status !== "success") throw new Error("TRANSACTION_REVERTED");
  if (receipt.from.toLowerCase() !== job.publisher.toLowerCase()) throw new Error("回执发布者与签名请求不一致。");
  if (job.kind === "DEPLOY") {
    if (!receipt.contractAddress) throw new Error("回执中没有部署合约地址。");
    return { contract: await assertRegistry(receipt.contractAddress, reader) };
  }
  if (!job.contract || !job.reportHash || receipt.to?.toLowerCase() !== job.contract.toLowerCase()) throw new Error("回执目标合约不一致。");
  const contract = await assertRegistry(job.contract, reader);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics });
      if (event.eventName === "ReportPublished" && event.args.reportHash === job.reportHash && event.args.publisher.toLowerCase() === job.publisher.toLowerCase()) {
        const stored = await reader.readContract({ address: contract, abi: registryAbi, functionName: "attestations", args: [job.publisher, job.reportHash] });
        if (stored !== event.args.timestamp) throw new Error("存储与发布事件不一致。");
        return { contract, anchor: { chainId: 968, contract, publisher: job.publisher, transactionHash: receipt.transactionHash, timestamp: stored.toString() } };
      }
    } catch { /* Ignore unrelated event logs; a matching registry event is still required. */ }
  }
  throw new Error("回执中没有匹配的报告发布事件。");
}
export async function verifyOnChain(address: string, publisher: string, reportHash: Hash) {
  const reader = botReader(), contract = await assertRegistry(address, reader);
  const account = getAddress(publisher);
  const timestamp = await reader.readContract({ address: contract, abi: registryAbi, functionName: "attestations", args: [account, reportHash] });
  return { contract, publisher: account, timestamp: timestamp.toString(), exists: timestamp > 0n };
}
export function walletMessage(error: unknown) {
  let current: unknown = error;
  for (let i = 0; i < 8 && current && typeof current === "object"; i++) {
    if ((current as { code?: number }).code === 4001) return "已取消 MetaMask 签名；没有提交新的存证交易。";
    current = (current as { cause?: unknown }).cause;
  }
  if (error instanceof Error && error.message === "TRANSACTION_REVERTED") return "交易已上链但执行回退，未写入新存证。";
  return error instanceof Error && /[\u4e00-\u9fff]/.test(error.message) ? error.message : "操作未完成。检查钱包网络、BOT 余额和 RPC；已有交易哈希时请查询结果，不要重复发送。";
}
