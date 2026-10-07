"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  TransactionCheckProblemSchema,
  TransactionCheckReportSchema,
  TransactionCheckRequestSchema,
  type TransactionCheckReport,
} from "@/domain/schemas/transaction-check";
import styles from "./investigate.module.css";

const TRANSFER_EXAMPLE = "0x19b45706e3877b8cb19133dbdc6f8013a5a4a033495e7b070c84977620348e8a";
const explorer = "https://etherscan.io";

function ExplorerLink({ path, children }: { path: string; children: ReactNode }) {
  return <a href={`${explorer}/${path}`} target="_blank" rel="noopener noreferrer">{children}<span className={styles.external} aria-hidden="true"> ↗</span><span className={styles.srOnly}>（在新窗口打开 Etherscan）</span></a>;
}

function Findings({ items }: { items: string[] }) {
  return <ul className={styles.findings}>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
}

function Report({ report }: { report: TransactionCheckReport }) {
  const { transaction, supportedSwaps, evidence, scope } = report.observation;
  return <section className={styles.report} aria-label="交易核验报告">
    <article className={styles.conclusion}>
      <p className={styles.eyebrow}>核验结论 · 仅依据已读取的链上记录</p>
      <h2>{report.headline}</h2>
      <p>{report.summary}</p>
      <p className={styles.checked}>查询时间：<time dateTime={report.checkedAt}>{report.checkedAt}</time> · 实时只读查询</p>
    </article>

    <div className={styles.columns}>
      <article className={styles.panel}>
        <h2>已确认的事实</h2>
        <Findings items={report.confirmedFacts} />
      </article>
      <article className={`${styles.panel} ${styles.caution}`}>
        <h2>现在还不能确认什么</h2>
        <Findings items={report.uncertainties} />
      </article>
    </div>

    <article className={styles.panel}>
      <h2>这笔交易的外层记录</h2>
      <p className={styles.note}>外层 ETH 金额指这笔交易携带的原生 ETH，不等于钱包最终净流出，也不等于卖出的金额。</p>
      <dl className={styles.facts}>
        <div><dt>交易状态</dt><dd>{transaction.status === "SUCCESS" ? "执行成功" : "执行回滚（失败）"}</dd></div>
        <div><dt>外层 ETH 金额</dt><dd className={styles.amount}>{transaction.nativeValueEth} ETH</dd></div>
        <div><dt>交易哈希</dt><dd><ExplorerLink path={`tx/${transaction.hash}`}><code>{transaction.hash}</code></ExplorerLink></dd></div>
        <div><dt>发起地址（from）</dt><dd><ExplorerLink path={`address/${transaction.from}`}><code>{transaction.from}</code></ExplorerLink></dd></div>
        <div><dt>接收地址（to）</dt><dd>{transaction.to ? <ExplorerLink path={`address/${transaction.to}`}><code>{transaction.to}</code></ExplorerLink> : "无接收地址（合约创建交易）"}</dd></div>
        <div><dt>所在区块</dt><dd><ExplorerLink path={`block/${transaction.blockNumber}`}>{transaction.blockNumber}</ExplorerLink></dd></div>
        <div><dt>区块哈希</dt><dd><code>{transaction.blockHash}</code></dd></div>
        <div><dt>区块时间（UTC）</dt><dd><time dateTime={transaction.timestamp}>{transaction.timestamp}</time></dd></div>
        <div><dt>回执中的日志数量</dt><dd>{transaction.logCount}</dd></div>
        <div className={styles.fullWidth}><dt>输入数据（input）</dt><dd><details><summary>{transaction.input === "0x" ? "0x（无输入数据）" : `${(transaction.input.length - 2) / 2} 字节 · 展开查看`}</summary><code className={styles.inputData}>{transaction.input}</code></details></dd></div>
      </dl>
    </article>

    <article className={styles.panel}>
      <h2>指定池里的兑换证据</h2>
      <p className={styles.note}>本次只检查 {scope.poolLabel}。WETH 是包装后的 ETH；下方 USDC 是代币数量，没有换算成美元价值。</p>
      <p className={styles.pool}>池地址：<ExplorerLink path={`address/${scope.poolAddress}`}><code>{scope.poolAddress}</code></ExplorerLink></p>
      {supportedSwaps.length > 0 ? <div className={styles.tableWrap}><table>
        <caption>同一笔交易内的已识别兑换事件；不合并为钱包净买卖方向</caption>
        <thead><tr><th scope="col">日志序号</th><th scope="col">池内兑换方向</th><th scope="col">WETH 数量</th><th scope="col">USDC 数量</th></tr></thead>
        <tbody>{supportedSwaps.map((swap) => <tr key={swap.logIndex}>
          <td>{swap.logIndex}</td><td>{swap.direction === "SELL_ETH" ? "卖出 WETH → 收到 USDC" : "买入 WETH ← 支出 USDC"}</td><td><code>{swap.wethAmount}</code></td><td><code>{swap.usdcAmount}</code></td>
        </tr>)}</tbody>
      </table></div> : <p className={styles.emptyEvidence}>{transaction.status === "REVERTED" ? "这笔交易已回滚，没有成功执行的兑换事件。" : "本次没有找到指定池内可支持兑换判断的事件。这不代表没有在其他池、协议或场所卖出。"}</p>}
    </article>

    <div className={styles.columns}>
      <article className={styles.panel}>
        <h2>可以自己核查的出处</h2>
        <ul className={styles.sources}>{evidence.map((item, index) => <li key={index}>
          <ExplorerLink path={item.type === "BLOCK" ? `block/${item.blockHash}` : `tx/${item.txHash}`}>
            {item.type === "BLOCK" ? "区块记录" : item.type === "TRANSACTION" ? "交易与回执" : "交易中的合约事件"}
          </ExplorerLink>
          <p>{item.description}</p><small>核查链接：{item.source}</small>
          {item.type === "CONTRACT_EVENT" && <p><ExplorerLink path={`address/${item.contractAddress}`}>查看事件所属合约</ExplorerLink></p>}
        </li>)}</ul>
      </article>
      <article className={styles.panel}>
        <h2>下一步怎么判断</h2>
        <Findings items={report.nextSteps} />
      </article>
    </div>
  </section>;
}

export default function TransactionCheck() {
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<TransactionCheckReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function changeInput(value: string) {
    setTxHash(value);
    setReport(null);
    setError(null);
  }

  async function checkTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setReport(null);
    setError(null);
    const request = TransactionCheckRequestSchema.safeParse({ txHash: txHash.trim() });
    if (!request.success) {
      setError("请输入完整的 Ethereum 交易哈希：以 0x 开头，后面有 64 位十六进制字符。这里需要交易哈希，不是钱包地址。");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/transaction-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.data),
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const problem = TransactionCheckProblemSchema.safeParse(body);
        setError(problem.success ? problem.data.detail : "查询失败，服务未返回有效的错误说明。请确认本机服务与 RPC 配置。");
        return;
      }
      const result = TransactionCheckReportSchema.safeParse(body);
      if (!result.success || result.data.observation.transaction.hash.toLowerCase() !== request.data.txHash.toLowerCase()) {
        setError("服务返回的报告与本次查询不一致，无法展示为已核验结果。");
        return;
      }
      setReport(result.data);
    } catch {
      setError("无法完成本次查询。请检查本机服务和网络连接；本次没有核验结果。");
    } finally {
      setLoading(false);
    }
  }

  return <main className={styles.shell} lang="zh-CN">
    <header className={styles.header}>
      <Link href="/" className={styles.home}>← 返回 Guardian Demo</Link>
      <span className={styles.mode}>LIVE READ ONLY · Ethereum 主网</span>
    </header>
    <section className={styles.hero}>
      <p className={styles.eyebrow}>ETH 交易核验 · MVP</p>
      <h1>大额转账，<br />就等于有人在卖吗？</h1>
      <p className={styles.intro}>把消息中的交易哈希贴进来，查看链上实际记录了什么、哪些结论有证据、哪些还不能确定。</p>
      <p className={styles.scope}>当前覆盖：Ethereum 主网外层交易 + Uniswap V3 WETH/USDC 0.05% 单池。输入不会触发签名、转账或交易。</p>
    </section>

    <section className={styles.query} aria-labelledby="query-title">
      <h2 id="query-title">先核查一笔交易</h2>
      <form onSubmit={checkTransaction} aria-busy={loading}>
        <label htmlFor="transaction-hash">Ethereum 交易哈希（Tx Hash）</label>
        <div className={styles.inputRow}>
          <input id="transaction-hash" name="txHash" value={txHash} onChange={(event) => changeInput(event.target.value)} disabled={loading} autoComplete="off" spellCheck={false} placeholder="0x…（64 位十六进制字符）" aria-describedby="hash-help" aria-invalid={Boolean(error)} />
          <button className={styles.primary} type="submit" disabled={loading || !txHash.trim()}>{loading ? "正在核验…" : "核验交易"}</button>
        </div>
        <p id="hash-help" className={styles.note}>在区块浏览器的交易详情或链上异动消息中复制完整 Tx Hash。</p>
        <button className={styles.example} type="button" disabled={loading} onClick={() => changeInput(TRANSFER_EXAMPLE)}>填入真实大额转账示例（20,059.2 ETH）</button>
        <p className={styles.note}>示例只填入历史交易哈希；点击「核验交易」仍会从真实 RPC 读取，不使用 Mock 结果。</p>
      </form>
    </section>

    <div className={styles.liveRegion} role="status" aria-live="polite">{loading && "正在读取主网交易、回执与区块，并检查指定池的兑换事件…"}{!loading && report && "核验完成。下方是本次交易报告。"}</div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {report ? <Report report={report} /> : !loading && !error && <section className={styles.empty}>
      <h2>先看证据，再决定这条消息意味着什么。</h2>
      <p>我们会区分「交易确实发生了」和「已经证实卖出」。地址的真实身份、后续资金去向与价格下跌原因，需要额外证据。</p>
    </section>}
    <footer className={styles.footer}>只读核验 · 不提供买卖指令 · 报告只覆盖本次查询的交易与指定池</footer>
  </main>;
}
