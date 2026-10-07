"use client";

import { useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { z } from "zod";
import { StatusResponseSchema, type MonitorStatus } from "@/integration/guardian/contracts";
import { RiskLabSnapshotSchema } from "@/modules/eth-risk/risk-lab";
import { exportReport, guardianReport, guardianSessionReport, parseReportFile, reportHash, researchReport, type ReportEnvelope } from "@/modules/attestation/report";
import { confirmTransaction, connectMetaMask, deployRegistry, getMetaMask, publishHash, transactionUrl, verifyOnChain, walletMessage, type TransactionJob } from "@/modules/attestation/bot-chain";
import styles from "./attestations.module.css";

const pendingKey = "xjy:bot:pending:v1", reportKey = "xjy:bot:report:v1", contractKey = "xjy:bot:registry:968";
const JobSchema = z.object({ kind: z.enum(["DEPLOY", "PUBLISH"]), hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), publisher: z.string().regex(/^0x[0-9a-fA-F]{40}$/), contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(), reportHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional() });

function download(envelope: ReportEnvelope) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2) + "\n"], { type: "application/json;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = `risk-report-${envelope.reportHash.slice(2, 14)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AttestationsPage() {
  const [mode, setMode] = useState<"research" | "guardian">("research");
  const [monitor, setMonitor] = useState<MonitorStatus>();
  const [eventId, setEventId] = useState("");
  const [envelope, setEnvelope] = useState<ReportEnvelope>();
  const [contract, setContract] = useState(process.env.NEXT_PUBLIC_BOT_REPORT_REGISTRY ?? "");
  const [account, setAccount] = useState<Address>();
  const [publisher, setPublisher] = useState("");
  const [job, setJob] = useState<TransactionJob>();
  const [lastTx, setLastTx] = useState<TransactionJob>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("准备报告后，再使用测试 BOT 发布内容哈希。");
  const [error, setError] = useState("");
  const [verification, setVerification] = useState("");
  const lock = useRef(false);
  const hash = envelope ? reportHash(envelope.report) : undefined;
  const intact = !!envelope && hash === envelope.reportHash;

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("source");
    if (requested === "guardian") setMode("guardian");
    try {
      const saved = localStorage.getItem(reportKey); if (saved) { const parsed = parseReportFile(saved); setEnvelope(parsed.envelope); setPublisher(parsed.envelope.anchor?.publisher ?? ""); }
      const pending = localStorage.getItem(pendingKey); if (pending) { const parsed = JobSchema.parse(JSON.parse(pending)) as TransactionJob; setJob(parsed); setLastTx(parsed); setProgress("有已提交交易等待核验。请查询原交易，不要重新签名。"); }
      if (!process.env.NEXT_PUBLIC_BOT_REPORT_REGISTRY) setContract(localStorage.getItem(contractKey) ?? "");
    } catch { setError("浏览器保存的报告/交易记录无法读取。请导入已下载的 JSON；链上记录不受影响。"); }
    let provider;
    try { provider = getMetaMask(); } catch { return; }
    const changed = () => { setAccount(undefined); setProgress("钱包账户已变更，请重新连接。已有交易仍按原发布者核验。"); };
    const networkChanged = () => { setVerification(""); };
    provider.on?.("accountsChanged", changed); provider.on?.("chainChanged", networkChanged);
    return () => { provider.removeListener?.("accountsChanged", changed); provider.removeListener?.("chainChanged", networkChanged); };
  }, []);

  function saveEnvelope(value: ReportEnvelope) {
    setEnvelope(value); setVerification("");
    try { localStorage.setItem(reportKey, JSON.stringify(value)); } catch { setError("报告未能保存到浏览器，请立即下载 JSON 留存。"); }
  }
  async function action(fn: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setVerification("");
    try { await fn(); } catch (e) { setError(walletMessage(e)); setProgress("本次操作未完成，详见提示；已提交的交易仍可按原哈希查询。"); } finally { lock.current = false; setBusy(false); }
  }
  async function loadEvents() {
    const response = await fetch("/api/monitor", { cache: "no-store" });
    if (!response.ok) throw new Error("Guardian 状态不可用。报告页不会启动监控或执行交易。");
    const state = StatusResponseSchema.parse(await response.json()); setMonitor(state); setEventId(state.latestSession ? "latest-session" : state.events[0]?.id ?? "");
    if (!state.events.length && !state.latestSession) setProgress("暂无持久化 Guardian 事件或运行记录。可先导出 Risk Lab 研究报告；本页不会触发救援交易。");
  }
  async function prepare() {
    if (mode === "research") {
      const response = await fetch("/api/eth-risk", { cache: "no-store" });
      if (!response.ok) throw new Error("无法读取 ETH 研究报告。");
      saveEnvelope(exportReport(researchReport(RiskLabSnapshotSchema.parse(await response.json()))));
    } else if (eventId === "latest-session" && monitor?.latestSession) {
      saveEnvelope(exportReport(guardianSessionReport(monitor.latestSession, monitor.mode)));
    } else {
      const selected = monitor?.events.find(e => e.id === eventId);
      if (!selected || !monitor) throw new Error("先读取并选择一个已有 Guardian 事件。");
      saveEnvelope(exportReport(guardianReport(selected, monitor.mode)));
    }
    setProgress("报告快照已固定。后续市场变化不会自动修改这份待存证报告。");
  }
  async function settle(pending: TransactionJob, wait: boolean) {
    try {
      const result = await confirmTransaction(pending, wait);
      setContract(result.contract);
      try { localStorage.setItem(contractKey, result.contract); localStorage.removeItem(pendingKey); } catch { /* Transaction is already confirmed; show authoritative result regardless of storage. */ }
      setJob(undefined);
      if (result.anchor) {
        // The signed report hash, not whatever currently appears in a selector, determines the receipt.
        setEnvelope(current => {
          if (!current || reportHash(current.report) !== pending.reportHash) return current;
          const confirmed = { ...current, anchor: result.anchor }; try { localStorage.setItem(reportKey, JSON.stringify(confirmed)); } catch { /* Download remains available. */ } return confirmed;
        });
        setPublisher(result.anchor.publisher);
        setProgress(`存证已确认：${pending.reportHash}。链上发布者 ${result.anchor.publisher}，时间 ${new Date(Number(result.anchor.timestamp) * 1000).toISOString()}。请下载含存证回执的 JSON。`);
      } else setProgress(`合约部署已确认：${result.contract}。现在可发布报告；也可把地址写入 NEXT_PUBLIC_BOT_REPORT_REGISTRY 后重新构建。`);
    } catch (e) {
      if (e instanceof Error && e.message === "TRANSACTION_REVERTED") {
        setJob(undefined); try { localStorage.removeItem(pendingKey); } catch { /* Keep visible failed result. */ } throw e;
      }
      setProgress("尚未取得可核验的成功回执。保留原交易哈希，稍后点击“查询原交易”；不会自动重新发送。");
    }
  }
  async function send(kind: "DEPLOY" | "PUBLISH") {
    if (!account || job) throw new Error("请先连接 MetaMask；已有待确认交易时只能查询原交易。");
    if (kind === "PUBLISH" && (!envelope || !hash || !intact)) throw new Error("报告哈希不匹配或尚未准备，不能发布。");
    setProgress(kind === "DEPLOY" ? "等待 MetaMask 切换至 BOT 测试网并确认部署…" : "正在校验网络和合约，随后请在 MetaMask 确认发布…");
    const pending = kind === "DEPLOY" ? await deployRegistry(getMetaMask(), account) : await publishHash(getMetaMask(), account, contract, hash!);
    setJob(pending); setLastTx(pending);
    try { localStorage.setItem(pendingKey, JSON.stringify(pending)); } catch { setError("浏览器无法保存待确认交易，请保留下面的交易哈希，避免重复签名。"); }
    setProgress("交易已提交，正在等待 BOT Chain 回执…");
    await settle(pending, true);
  }
  async function verify() {
    if (!envelope || !hash) throw new Error("请先准备或导入报告 JSON。");
    if (!intact) { setVerification("不一致：报告内容与文件声明的原始哈希不匹配，内容或哈希已被修改。未查询链上。"); return; }
    const result = await verifyOnChain(contract, publisher, hash);
    if (!result.exists) { setVerification("未找到：当前合约中没有该发布者对这一内容哈希的存证。不能认定报告已经发布。"); return; }
    const anchor = envelope.anchor;
    if (anchor) {
      if (getAddress(anchor.contract) !== result.contract || getAddress(anchor.publisher) !== result.publisher || anchor.timestamp !== result.timestamp) throw new Error("文件中的存证元数据与查询到的链上记录不一致。");
      await confirmTransaction({ kind: "PUBLISH", hash: anchor.transactionHash as `0x${string}`, publisher: result.publisher, contract: result.contract, reportHash: hash });
    }
    setVerification(`核验通过：规范化报告哈希与链上记录一致${anchor ? "，发布回执也匹配" : "（文件未附交易回执）"}。发布者 ${result.publisher}；链上时间 ${new Date(Number(result.timestamp) * 1000).toISOString()}。`);
  }

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="/"><span className="brand-mark">V</span><span><strong>VERDANT / ATTESTATION</strong><small>Risk report provenance</small></span></a><nav className="nav-links"><a href="/">Guardian</a><a href="/risk-lab">ETH Risk Lab</a></nav><span className="status-pill">BOT TESTNET · 968</span></header>
    <section className="hero"><div><p className="eyebrow">Ethereum analysis · BOT Chain attestation</p><h1>Evidence,<br /><em>set in time.</em></h1><p className="hero-copy">风险调查报告存证。固定报告快照、下载 JSON，再用 MetaMask 将内容哈希发布到 BOT Chain。</p></div><aside className="hero-note"><strong>内容完整性，而非事实背书</strong><span>链上仅记录哈希、发布者和时间。Mock / Fork / 真实数据标签随报告保存；存证不会把演示分析变成真实结论，也不会触发 ETH 换币。</span></aside></section>
    <div className={styles.grid}>
      <section className="light-panel"><div className="panel-head"><h2>01 / 准备报告</h2><span className="status-pill">JSON · KECCAK256</span></div>
        <label className={styles.label}>报告来源<select value={mode} disabled={busy || !!job} onChange={e => setMode(e.target.value as "research" | "guardian")}><option value="research">ETH Risk Lab 研究快照</option><option value="guardian">Guardian 已有风险事件</option></select></label>
        {mode === "guardian" && <><button className="secondary-button" disabled={busy || !!job} onClick={() => void action(loadEvents)}>读取已有事件（不执行交易）</button><label className={styles.label}>事件<select value={eventId} disabled={busy || !!job} onChange={e => setEventId(e.target.value)}><option value="">选择记录</option>{monitor?.latestSession && <option value="latest-session">最近一次运行（含未触发策略的结果；未附配置版本）</option>}{monitor?.events.map(e => <option key={e.id} value={e.id}>{e.createdAt} · {e.status} · {e.id.slice(0, 8)}</option>)}</select></label></>}
        <div className="monitor-actions"><button className="primary-button" disabled={busy || !!job} onClick={() => void action(prepare)}>固定报告并计算哈希</button><label className={styles.upload}>导入报告 JSON<input type="file" accept=".json,application/json" disabled={busy || !!job} onChange={e => { const file = e.target.files?.[0]; if (file) void action(async () => { if (file.size > 2_000_000) throw new Error("报告文件超过 2 MB。"); let parsed; try { parsed = parseReportFile(await file.text()); } catch { throw new Error("JSON 不是有效的 v1 风险报告文件：可能存在重复字段、结构损坏或不合法的报告内容。"); } saveEnvelope(parsed.envelope); if (parsed.envelope.anchor) { setContract(parsed.envelope.anchor.contract); setPublisher(parsed.envelope.anchor.publisher); } setProgress(parsed.matches ? "文件内容哈希一致；继续查询链上记录才能确认存证。" : "报告内容与声明哈希不一致，请核查文件。禁止发布此文件。"); }); e.target.value = ""; }} /></label></div>
        {envelope && <div className={styles.report}><span className="status-pill">{envelope.report.dataMode}</span><p>{envelope.report.kind !== "ETH_RISK_LAB" ? "包含调查与证据、策略决定及已有执行/验证结果。事件版额外附带冻结配置和提交记录。" : "包含研究模型、证据及建议。policyDecision / execution / verification 均为 null；没有执行交易。"}</p><p>快照时间：{envelope.report.capturedAt}</p><label className={styles.label}>计算出的内容哈希<code>{hash}</code></label><p className={styles.integrity}>{intact ? "文件哈希一致" : "内容或声明哈希已变更"}</p><button className="secondary-button" onClick={() => download(envelope)}>下载{envelope.anchor ? "含存证回执的 " : ""}JSON</button><details><summary>查看报告内容</summary><pre>{JSON.stringify(envelope.report, null, 2)}</pre></details></div>}
      </section>
      <section className="dark-panel"><div className="panel-head"><h2>02 / MetaMask 存证</h2><span className="panel-index">968</span></div><p className="muted-on-dark">RPC: https://rpc.bohr.life · Gas: 测试 BOT。账户连接不授权 ETH 交易；部署/发布时由 MetaMask 单独确认。</p><button className="primary-button" disabled={busy} onClick={() => void action(async () => { const connected = await connectMetaMask(getMetaMask()); setAccount(connected); setPublisher(p => p || connected); setProgress("MetaMask 已连接。部署或发布时将请求切换到 BOT 测试网。"); })}>{account ? "重新连接 MetaMask" : "连接 MetaMask"}</button>{account && <p className={styles.address}>{account}</p>}
        <label className={styles.label}>BOT 存证合约地址<input value={contract} disabled={busy || !!job} spellCheck={false} onChange={e => { setContract(e.target.value.trim()); setVerification(""); }} placeholder="0x…（已部署地址）" /></label>
        <div className="monitor-actions"><button className="primary-button" disabled={busy || !!job || !account || !envelope || !intact || !contract} onClick={() => void action(() => send("PUBLISH"))}>发布报告哈希</button>{job && <button className="secondary-button" disabled={busy} onClick={() => void action(() => settle(job, false))}>查询原交易</button>}</div>
        <details className={styles.deploy}><summary>首次使用：部署存证合约</summary><p>仅需部署一次。此操作使用当前 MetaMask 账户支付测试 BOT gas；不保存私钥。已有合约地址时直接填入上方即可。</p><button className="secondary-button" disabled={busy || !!job || !account} onClick={() => void action(() => send("DEPLOY"))}>通过 MetaMask 部署</button></details>
        <div className={styles.progress} role="status" aria-live="polite">{busy && <span className="spinner" />}{progress}</div>{lastTx && <p className={styles.address}><a href={transactionUrl(lastTx.hash)} target="_blank" rel="noreferrer">在 BOT 浏览器查看交易</a><br /><code>{lastTx.hash}</code></p>}{error && <p className={styles.error} role="alert">{error}</p>}
      </section>
    </div>
    <section className={`light-panel ${styles.verify}`}><div className="panel-head"><div><p className="eyebrow">Independent check</p><h2>03 / 核验报告是否改变</h2></div><span className="status-pill">无需连接钱包</span></div><p>导入原始 JSON 后，重新计算内容哈希并查询链上记录。空格、缩进和对象字段顺序不影响哈希；正文、证据、数组顺序及数值变更会影响哈希。请核对发布者地址是否为你信任的来源。</p><label className={styles.label}>预期发布者（可从原始存证回执取得）<input value={publisher} disabled={busy} spellCheck={false} onChange={e => { setPublisher(e.target.value.trim()); setVerification(""); }} placeholder="0x…" /></label><button className="primary-button" disabled={busy || !envelope || !contract || !publisher} onClick={() => void action(verify)}>重新计算并核验链上记录</button>{verification && <p className={styles.verification} role="status">{verification}</p>}</section>
    <footer className="footer"><span>BOT Chain 存证是真实测试网交易；原始报告的数据模式保持不变。</span><span>JSON 保存在本机浏览器并可下载；链上不上传报告正文。</span></footer>
  </main>;
}
