import { OnchainReportRequestSchema, OnchainReportSchema } from "@/integration/onchain-report.contracts";
import { esc, money, pct, time, pageHead, badge, panel, list, facts, explorer, rawDetails, request, jsonOptions, lifecycle, mountIdentity } from "../ui.js";

export function reportHTML(report) {
  const { portfolio: { state: p }, market: { state: m }, signal: s, riskAnalysis: r } = report;
  const mode = report.investigationMode === "AI" ? "AI 调查 · 推断未经独立核实" : "确定性规则解释 · 未调用 AI";
  const references = [...report.portfolio.evidence, ...report.market.evidence, ...s.evidence];
  return `<div class="status-band">${badge("LIVE_READ_ONLY · Ethereum 主网")}${badge(mode)}</div>
    ${panel("本次观察", facts([
      ["钱包", explorer("address", p.wallet)], ["锚点区块", explorer("block", String(p.blockNumber))],
      ["区块时间", esc(time(p.timestamp))], ["报告完成时间", esc(time(report.checkedAt))],
      ["ETH / USD", money(m.priceUsd)], ["持仓总值（原生 ETH + USDC）", money(p.totalUsd)],
      ["ETH 风险敞口", pct(p.riskExposurePct)], ["5 分钟价格变化", pct(m.priceChange5mPct)],
      ["1 小时价格变化", pct(m.priceChange1hPct)],
    ]) + '<p class="note">持仓只覆盖原生 ETH 与 USDC；卖压来自指定池内 WETH，不能混同资产余额。Chainlink 更新之间价格可能不变。</p>')}
    <div class="workspace-grid">${panel("01 / 量化事实", facts([
      ["当前窗口（左闭右开）", `${esc(time(s.windowStart))} → ${esc(time(s.windowEnd))}`],
      ["当前五分钟总卖出额", money(s.currentSellVolumeUsd)], ["紧邻前五分钟总卖出额", money(s.baselineSellVolumeUsd)],
      ["异常倍数（当前 ÷ 基线）", `${s.anomalyRatio.toFixed(4)}×`], ["当前卖出交易数", esc(s.txCount)],
      ["不同 tx.from 数量", esc(s.uniqueWallets)], ["单池", explorer("address", report.scope.signalPool)],
    ]) + '<p class="note">统计总卖出，不扣买入；USD 由实际 USDC 成交数量 × 事件区块 Chainlink USDC/USD 计算。没有异常也是有效观察。</p>')}
    ${panel("02 / 规则风险计算", facts([["Risk Score", `${r.riskScore} / 100`], ["Confidence", pct(r.confidence * 100)],
      ["波动代理", `${m.volatilityScore.toFixed(2)} / 100`]]) + '<p class="note">分数未校准，不是跌价概率。Confidence 受引用覆盖与交易数量限制，不证明原因真实。波动代理 = min(100, |1h 变化百分数| × 10)，不是统计波动率。</p>')}
    ${panel("03 / 解释与假设", `<p>${esc(r.investigation.summary)}</p><p>${esc(r.investigation.primaryCause)}</p><small>${esc(mode)}；不核实钱包身份或交易意图。</small>`)}
    ${panel("04 / 尚不能确认", list(r.investigation.uncertainties), "dark-panel")}
    ${panel("解释所引用的证据", list(r.investigation.evidence), "wide")}
    ${panel("链上出处", references.map((e) => `<div class="evidence-row"><p>${esc(e.description)}</p>${e.type === "BLOCK" ? explorer("block", e.blockHash) : explorer("tx", e.txHash)}<p>区块 ${esc(e.blockNumber)} · ${esc(e.source)}</p>${e.type === "CONTRACT_EVENT" ? explorer("address", e.contractAddress) : ""}</div>`).join(""), "wide")}
    ${panel("方法与范围限制", list(report.limitations) + '<p class="note">这是一次只读调查。未评估 Policy，未授权交易，未签名，不构成自主监控或保护承诺。</p>', "wide")}</div>
    ${rawDetails(report, "完整 JSON · 可复制保存，保留来源与时间")}`;
}

export async function mount(root) {
  const life = lifecycle(root);
  root.innerHTML = pageHead("Ethereum 异动调查报告", "读取同一区块的真实持仓、行情和单池卖压；把事实、解释和未知项放在一起复查。", "LIVE_READ_ONLY · 单次调查")
    + `<div class="status-band">${badge("无需连接钱包 · 无交易权限")}${badge("仅 ETH / 单池范围")}</div>
      <form id="onchain-report-form" class="workspace-panel"><label for="report-wallet">观察钱包地址</label>
      <input id="report-wallet" name="wallet" type="text" autocomplete="off" spellcheck="false" required placeholder="0x…" aria-label="观察钱包地址">
      <label for="report-mode">解释方式</label><select id="report-mode" name="investigationMode"><option value="RULES">规则解释（真实链上数据，不调用 AI）</option><option value="AI">真实 AI 调查（需服务器模型配置）</option></select>
      <p class="note">读取包括历史区块与 Swap 日志，需要等待。缺数据或缺 AI 配置会明确报错，不会回退到 Mock。其他代币暂不统计。</p>
      <button type="submit" class="button-primary">生成真实报告</button></form>
      <p id="report-status" role="status" aria-live="polite"></p><div id="onchain-report-result"></div>`;
  const identityCleanup = mountIdentity(root);
  const form = root.querySelector("form");
  const button = form.querySelector("button");
  const status = root.querySelector("#report-status");
  const result = root.querySelector("#onchain-report-result");
  let busy = false;
  for (const type of ["input", "change"]) life.on(type, (event) => {
    if (!busy && form.contains(event.target)) { result.innerHTML = ""; status.textContent = ""; }
  });
  life.on("submit", async (event) => {
    if (event.target !== form) return;
    event.preventDefault();
    if (busy) return;
    result.innerHTML = "";
    const parsed = OnchainReportRequestSchema.safeParse({ wallet: form.elements.wallet.value, investigationMode: form.elements.investigationMode.value });
    if (!parsed.success) { status.textContent = "请输入完整的 Ethereum 钱包地址。"; return; }
    busy = true;
    button.disabled = true;
    form.elements.wallet.disabled = true;
    form.elements.investigationMode.disabled = true;
    status.textContent = parsed.data.investigationMode === "AI" ? "正在读取链上观察并请求 AI 调查…" : "正在读取真实链上观察并计算规则报告…";
    try {
      const report = await request("/api/onchain-analysis", OnchainReportSchema, { ...jsonOptions("POST", parsed.data), signal: life.signal });
      if (!life.alive) return;
      if (report.portfolio.state.wallet.toLowerCase() !== parsed.data.wallet.toLowerCase() || report.investigationMode !== parsed.data.investigationMode) throw new Error("报告与本次请求不一致，未展示。");
      result.innerHTML = reportHTML(report);
      status.textContent = "调查完成。请逐项复查来源与未知项；本次没有执行交易。";
    } catch (error) {
      if (life.alive) status.textContent = error instanceof Error ? error.message : "调查未完成。";
    } finally {
      if (life.alive) {
        busy = false; button.disabled = false;
        form.elements.wallet.disabled = false;
        form.elements.investigationMode.disabled = false;
      }
    }
  });
  return () => { life.dispose(); identityCleanup(); };
}
