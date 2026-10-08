import { SnapshotSchema } from "@/modules/eth-report/contracts";
import { ReportSession } from "@/modules/eth-report/session";
import { registerReportTools } from "../report/tools.js";
import { esc, pct, time, pageHead, badge, panel, list, facts, request, lifecycle, mountIdentity } from "../ui.js";

const conclusions = { ANOMALY_SIGNALS: "发现异常线索", NO_CLEAR_ANOMALY: "未发现明确异常", INSUFFICIENT_DATA: "数据不足" };
const sourceLabels = { live: "采集时有效", stale: "过期 · 仅历史背景", unavailable: "不可用" };
const refs = (ids) => ids.map((id) => `<a class="report-citation" href="#evidence-${esc(id)}">[${esc(id)}]</a>`).join(" ");
function evidenceHTML(snapshot) {
  return snapshot.evidence.map((e) => `<section class="report-evidence" id="evidence-${esc(e.id)}"><h3>${esc(e.id)} / ${esc(e.source)}</h3><p>${esc(sourceLabels[e.status])} · 采集 ${esc(time(e.collectedAt))} · 观测 ${esc(time(e.observedAt))}</p><p>${esc(e.scope)}</p><a class="external-link" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">查看来源 ↗</a><details><summary>原始数据</summary><pre>${esc(JSON.stringify(e.data, null, 2))}</pre></details></section>`).join("");
}
function keyDataHTML(snapshot) {
  const value = (group) => snapshot.evidence.find((e) => e.group === group)?.data;
  const m = value("market"), h = value("history"), b = value("orderbook"), d = value("dex"), t = value("tvl");
  const number = (v) => v == null ? "—" : Number(v).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  return facts([["ETH / USDT（Binance）", number(m?.eth?.price)], ["滚动24h价格变化", pct(m?.eth?.change)],
    ["滚动24h成交额 / USDT", number(m?.eth?.volume)], ["小时收益率日化波动率", pct(h?.volatility)],
    ["样本区间最大回撤", pct(h?.drawdown)], ["100档盘口价差", pct(b?.spread)],
    ["WETH返回池流动性 / USD", number(d?.liquidity)], ["Ethereum链TVL / USD", number(t?.tvlUsd)]])
    + '<p class="note">每项指标的有效、过期或缺失状态见来源。上述值来自网站快照，外部Agent不能覆盖。</p>';
}
export function reportHTML(report) {
  const { analysis: r, snapshot: s } = report;
  return `<article class="report-paper" aria-label="A4 调查报告"><header class="report-masthead"><p class="scope-label">VERDANT / ETHEREUM RESEARCH</p><span>外部 Agent 调查 · ${s.windowDays === 1 ? "24h" : "7d"}</span><h2>以太坊<br>异动调查报告</h2><p>${esc(time(report.acceptedAt))} · ETH</p></header>
    <section class="report-lead"><span class="scope-label">01 / 调查结论</span><h3>${esc(conclusions[r.conclusion])}</h3><p>${esc(r.summary)}</p><p class="note">外部 Agent 的解释未经独立核实。已校验格式与引用，不等于已证实因果。</p></section>
    ${panel("02 / 关键数据", keyDataHTML(s))}
    ${panel("03 / 观察事实", r.observations.length ? r.observations.map((o) => `<div class="report-finding"><p>${esc(o.statement)}</p><small>${o.basis === "CURRENT" ? "基于快照采集时数据" : "历史背景"}</small> ${refs(o.evidenceIds)}</div>`).join("") : '<p>没有可提交的观察事实。</p>')}
    ${panel("04 / 解释与反证", r.hypotheses.length ? r.hypotheses.map((h) => `<div class="report-finding"><p>${esc(h.explanation)}</p><p>支持 ${refs(h.supportingEvidenceIds)}</p><p>反证 ${h.counterEvidenceIds.length ? refs(h.counterEvidenceIds) : "尚无引用；不代表不存在反证"}</p><p class="note">${esc(h.uncertainty)}</p></div>`).join("") : '<p>现有证据不足以提出原因解释。</p>')}
    ${panel("05 / 尚不能确认", list(r.uncertainties))}${panel("06 / 下一步核查", list(r.nextChecks))}
    ${panel("07 / 来源与数据", evidenceHTML(s))}${panel("08 / 范围与方法", list(s.limitations) + report.indicatorDefinitions.map((d) => `<h3>${esc(d.id)}</h3><p><code>${esc(d.formula)}</code></p><p>${esc(d.unit)} · ${esc(d.limitation)}</p>`).join(""))}
    <footer class="report-footnote">报告 ${esc(report.reportId)}<br>快照 ${esc(s.snapshotId)} · ${esc(time(s.createdAt))}<br>仅当前页面保存 · 未签名 / 未执行交易 / 未上链</footer></article>`;
}

export async function mount(root) {
  const life = lifecycle(root);
  root.innerHTML = pageHead("Ethereum 异动调查报告", "网站准备数据，外部 Agent 调查；把观察、解释与尚不能确认的部分放在同一份报告里。", "WEBMCP · 外部 Agent")
    + `<div class="status-band">${badge("ETH 市场与生态观察")}${badge("无需钱包 · 无交易权限")}</div>
    <section class="workspace-panel"><form id="eth-report-form" class="report-controls"><label for="report-window">观察窗口</label><select id="report-window"><option value="1">24 小时</option><option value="7">7 天</option></select><button class="button-primary" type="submit">准备真实数据</button></form>
    <p id="webmcp-status" role="status">正在检查 WebMCP 支持…</p><p class="note">在支持 WebMCP 的应用内浏览器打开本页，让外部 Agent 使用网站工具调查 ETH 并提交报告。工具注册不代表已连接 Agent。网站不请求内置模型。</p>
    <details><summary>给外部 Agent 的任务说明</summary><p>请读取此页的 ETH 快照与指标定义，按需查看证据。综合判断是否存在异动线索，区分事实、假设与未知项，使用本次证据 ID 提交报告。不要把新闻标题当作已核实原因，也不要生成交易指令。</p></details>
    <p class="note">只保留当前页面会话；刷新或离开即清空。报告完成后可下载 JSON。没有异常也是有效结果。</p></section>
    <p id="report-status" role="status" aria-live="polite">尚未准备数据。</p><div id="report-coverage"></div>
    <details class="raw-details"><summary>实际工具调用记录</summary><ol id="report-calls"></ol></details>
    <div id="report-output" hidden><div class="report-toolbar" aria-label="报告视图"><div><button type="button" data-report-view="a4" aria-pressed="true">A4 阅读版</button><button type="button" data-report-view="json" aria-pressed="false">JSON 数据版</button></div><div><button type="button" data-export="copy">复制 JSON</button><button type="button" data-export="download">下载 JSON</button></div></div><p id="report-export-status" role="status"></p><div id="report-a4"></div><pre id="report-json" class="report-json" tabindex="0" hidden></pre></div>`;
  const identityCleanup = mountIdentity(root);
  const form = root.querySelector("form");
  const status = root.querySelector("#report-status");
  const output = root.querySelector("#report-output");
  const coverage = root.querySelector("#report-coverage");
  let view = "a4", registration;
  function render() {
    if (!life.alive) return;
    const { busy, snapshot, report } = session.state;
    form.querySelector("button").disabled = busy;
    form.querySelector("select").disabled = busy;
    if (snapshot) form.querySelector("select").value = String(snapshot.windowDays);
    coverage.innerHTML = snapshot ? panel("本次数据覆盖", facts([["快照", esc(snapshot.snapshotId)], ["采集批次", esc(time(snapshot.createdAt))], ["有效 / 过期 / 不可用", ["live", "stale", "unavailable"].map((s) => snapshot.evidence.filter((e) => e.status === s).length).join(" / ")]]) + '<p class="note">各来源有独立时间。这里的有效指采集时可用，不保证此刻仍然新鲜；数据不是同一区块的链上证据。</p>' + snapshot.evidence.map((e) => `<p>${esc(e.source)} · ${esc(sourceLabels[e.status])} · ${esc(time(e.collectedAt))}</p>`).join("")) : "";
    output.hidden = !report;
    root.querySelector("#report-a4").innerHTML = report ? reportHTML(report) : "";
    root.querySelector("#report-json").textContent = report ? JSON.stringify(report, null, 2) : "";
    root.querySelector("#report-export-status").textContent = "";
    status.textContent = busy ? "正在准备公开数据…" : report ? "已接收外部 Agent 报告；格式和引用通过校验，解释未经独立核实。" : snapshot ? "数据已准备。等待外部 Agent 调查并提交报告。" : "尚未准备数据。";
    showView();
  }
  function showView() {
    root.querySelector("#report-a4").hidden = view !== "a4";
    root.querySelector("#report-json").hidden = view !== "json";
    root.querySelectorAll("[data-report-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.reportView === view)));
  }
  const session = new ReportSession((days) => request(`/api/eth-report-snapshot?days=${days}`, SnapshotSchema, { signal: life.signal }), render);
  life.on("submit", async (event) => {
    if (event.target !== form) return;
    event.preventDefault();
    try { await session.call("create_eth_snapshot", { windowDays: Number(form.querySelector("select").value) }); }
    catch { if (life.alive) status.textContent = "数据未准备完成。旧报告已清空，请检查来源后重新准备。"; }
  });
  life.on("click", async (event) => {
    const button = event.target.closest("button");
    if (button?.dataset.reportView) { view = button.dataset.reportView; showView(); }
    if (!button?.dataset.export) return;
    const report = session.state.report;
    if (!report) return;
    const text = JSON.stringify(report, null, 2);
    try {
      if (button.dataset.export === "copy") await navigator.clipboard.writeText(text);
      else {
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const a = document.createElement("a"); a.href = url; a.download = `eth-report-${report.reportId}.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      if (life.alive) root.querySelector("#report-export-status").textContent = button.dataset.export === "copy" ? "JSON 已复制。" : "已发起 JSON 下载。";
    } catch { if (life.alive) root.querySelector("#report-export-status").textContent = "导出未完成，可切换 JSON 视图手动复制。"; }
  });
  const connectTools = async () => { try {
    registration = await registerReportTools(session, { signal: life.signal, isAlive: () => life.alive, onCall: (name, stage) => {
      if (!life.alive) return;
      const li = document.createElement("li"); li.textContent = `${new Date().toLocaleTimeString("zh-CN")} · ${name} · ${{ started: "开始", completed: "完成", failed: "失败" }[stage]}`;
      const calls = root.querySelector("#report-calls"); calls.append(li); if (calls.children.length > 60) calls.firstElementChild.remove();
      if (stage === "failed") status.textContent = "工具调用失败，未接受新结果。请检查参数、快照和证据引用。";
    } });
    if (life.alive) root.querySelector("#webmcp-status").textContent = registration.available ? "6 个 WebMCP 工具已注册 · 等待外部 Agent 调用" : "当前浏览器不支持 WebMCP 工具；可准备数据，但无法在此接收 Agent 调查。";
  } catch { if (life.alive) root.querySelector("#webmcp-status").textContent = "WebMCP 注册失败；未启用内置模型。请重新打开页面。"; }
  };
  void connectTools();
  return () => { life.dispose(); session.dispose(); registration?.dispose(); identityCleanup(); };
}
