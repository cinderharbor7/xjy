import { RiskLabSnapshotSchema } from "@/modules/eth-risk/risk-lab";
import {
  PositionQuerySchema,
  PositionSnapshotSchema,
} from "@/extensions/aave/schemas";
import {
  TransactionCheckRequestSchema,
  TransactionCheckReportSchema,
} from "@/domain/schemas/transaction-check";
import {
  esc,
  money,
  pct,
  time,
  pageHead,
  badge,
  panel,
  list,
  table,
  facts,
  explorer,
  rawDetails,
  request,
  jsonOptions,
  errorText,
  lifecycle,
  mountIdentity,
  assetTag,
} from "../ui.js";

export function transactionReportHTML(report) {
  const {
    transaction: t,
    supportedSwaps: swaps,
    evidence,
    scope,
  } = report.observation;
  return `<section class="report-conclusion">${badge(report.mode)}<h2>${esc(report.headline)}</h2><p>${esc(report.summary)}</p><small>核查时间 ${time(report.checkedAt)}</small></section><div class="workspace-grid">${panel("已确认的事实", list(report.confirmedFacts))}${panel("仍无法确认", list(report.uncertainties), "dark-panel")}${panel(
    "外层交易记录",
    `<p class="note">外层 ETH 金额不等于钱包净流出，也不等于卖出数量。</p>${facts(
      [
        ["状态", esc(t.status)],
        ["原生 ETH 金额", esc(t.nativeValueEth) + " ETH"],
        ["交易", explorer("tx", t.hash)],
        ["From", explorer("address", t.from)],
        ["To", t.to ? explorer("address", t.to) : "创建合约"],
        ["区块", explorer("block", String(t.blockNumber))],
        ["区块哈希", `<code>${esc(t.blockHash)}</code>`],
        ["区块时间", time(t.timestamp)],
        ["日志数", esc(t.logCount)],
      ],
    )}${rawDetails(t.input, "交易输入数据")}`,
    "wide",
  )}${panel(
    "指定池兑换证据",
    `<p>${esc(scope.poolLabel)}</p><p>${explorer("address", scope.poolAddress)}</p><div class="asset-pair">${assetTag("WETH")}${assetTag("USDC")}</div><p class="note">WETH 是包装 ETH；USDC 列为代币数量，不换算成美元。事件不合并为钱包净买卖方向。</p>${
      swaps.length
        ? table(
            ["日志", "方向", "WETH 数量", "USDC 数量"],
            swaps.map((s) => [
              esc(s.logIndex),
              s.direction === "SELL_ETH" ? "卖出 WETH" : "买入 WETH",
              esc(s.wethAmount),
              esc(s.usdcAmount),
            ]),
          )
        : `<p>${t.status === "REVERTED" ? "交易已回滚，无成功兑换事件。" : "未找到该池的兑换证据，不代表在其他池或场所没有卖出。"}</p>`
    }`,
    "wide",
  )}${panel("证据出处", list(evidence.map((e) => e.description)) + evidence.map((e) => `<div class="evidence-row">${e.type === "BLOCK" ? explorer("block", e.blockHash) : explorer("tx", e.txHash)}<p>${esc(e.source)}</p>${e.type === "CONTRACT_EVENT" ? explorer("address", e.contractAddress) : ""}</div>`).join(""))}${panel("下一步", list(report.nextSteps))}</div>`;
}
export function positionReportHTML(s) {
  const ev = s.evidence;
  return `<div class="status-band">${badge("LIVE · Ethereum / Aave V3")}${badge(s.status)}</div>${
    s.status === "NO_DEBT"
      ? panel(
          "无债务仓位",
          `<p>${esc(s.message)}</p><p>不计算健康因子，也不生成减仓建议。</p>`,
        )
      : panel(
          "同一区块的仓位与市场",
          facts([
            ["抵押品", money(s.position.collateralUsd)],
            ["债务", money(s.position.debtUsd)],
            ["Health Factor", esc(s.position.healthFactor.toFixed(4))],
            ["ETH 价格", money(s.position.ethPrice)],
            ["ETH 区间变化", pct(s.marketChanges.ethChangePct)],
            [
              "对比区块",
              explorer("block", String(s.marketChanges.referenceBlockNumber)),
            ],
            ["参考价格", money(s.marketChanges.previousEthPrice)],
            [
              "对比间隔",
              esc(s.marketChanges.lookbackBlocks) +
                " 区块 / " +
                esc(s.marketChanges.lookbackSeconds) +
                " 秒",
            ],
          ]) +
            `<p class="note">价格来自 Aave 预言机；查询只读，不进入 Guardian 执行。</p>`,
        )
  }${panel(
    "可核验的链上位置",
    facts([
      ["钱包", explorer("address", s.wallet)],
      ["区块", explorer("block", String(ev.blockNumber))],
      ["区块哈希", `<code>${esc(ev.blockHash)}</code>`],
      ["区块时间", time(ev.blockTimestamp)],
      ["Pool", explorer("address", ev.poolAddress)],
      ["Oracle", explorer("address", ev.oracleAddress)],
      ["Provider", explorer("address", ev.providerAddress)],
      ["ETH 资产", explorer("address", ev.ethAssetAddress)],
    ]) + rawDetails(s),
  )}`;
}
export function riskReportHTML(s) {
  return `<div class="status-band">${badge(s.dataMode, "warn")}<span>${esc(s.sourceNote)}</span><span>${time(s.asOf)}</span></div><div class="workspace-grid">${panel(
    "ETH 风险研究",
    facts([
      ["参考价", money(s.priceUsd)],
      ["综合分", esc(s.composite.score) + " / 100"],
      ["置信度", pct(s.composite.confidence * 100)],
      ["观察范围", esc(s.composite.horizon)],
    ]) +
      `<p>${esc(s.composite.interpretation)}</p><svg class="research-chart" viewBox="0 0 680 190" role="img" aria-label="研究样本的风险分数曲线"><line x1="42" y1="160" x2="638" y2="160"/><polyline points="${s.curve.map((p, i) => `${50 + i * 200},${160 - p.score * 1.18}`).join(" ")}"/>${s.curve.map((p, i) => `<text x="${40 + i * 200}" y="183">${esc(p.label)}</text><text x="${40 + i * 200}" y="${148 - p.score * 1.18}">${esc(p.score)}</text>`).join("")}</svg>`,
  )}${panel(
    "研究建议",
    badge(s.recommendation.stance) +
      `<h3>${esc(s.recommendation.action)}</h3><p>${esc(s.recommendation.rationale)}</p>${facts(
        [
          ["当前 ETH 敞口", pct(s.recommendation.currentExposurePct)],
          ["目标 ETH 敞口", pct(s.recommendation.targetExposurePct)],
          ["建议置信度", pct(s.recommendation.confidence * 100)],
        ],
      )}<p class="note">研究输出不批准或执行交易；分数与置信度不是经校准的下跌概率。</p>`,
    "dark-panel",
  )}</div><section class="workspace-panel"><h2>观察输入</h2><div class="research-metrics">${s.metrics.map((m) => `<article><div>${badge(m.state)}</div><h3>${esc(m.label)}</h3><strong>${esc(m.display)}</strong><small>${esc(m.unit)} / ${esc(m.direction)}</small><div class="meter"><i style="width:${m.percentile}%"></i></div><p>${esc(m.rationale)}</p></article>`).join("")}</div></section><section class="workspace-panel"><h2>模型与依据</h2><div class="model-grid">${s.models.map((m) => `<article><div class="model-heading"><h3>${esc(m.title)}</h3><strong>${m.score}</strong></div><p>${esc(m.method)} / Confidence ${pct(m.confidence * 100)}</p><p>${esc(m.output)}</p><code class="formula-block">${esc(m.formula)}</code><p>${esc(m.rationale)}</p>${list(m.inputs)}<small>${esc(m.citation)}</small></article>`).join("")}</div></section>${panel("数据出处与限制", s.evidence.map((e) => `<div class="evidence-row">${badge(e.status)}<h3>${esc(e.label)}</h3><p>${esc(e.value)}</p><small>${esc(e.source)}</small></div>`).join("") + `<p class="note">区块范围 ${s.blockRange.from} – ${s.blockRange.to}。当前 fixture 的“OBSERVED”仅指样本中的观测项，不能当作本次真实 RPC 读取。</p>` + rawDetails(s))}<a class="button-primary" href="/attestations?source=research">固定研究报告并存证</a>`;
}

export async function mount(root, kind) {
  const life = lifecycle(root);
  let clean = () => {},
    busy = false,
    queryRevision = 0;
  const config = {
    investigate: [
      "交易核验",
      "核对一笔 Ethereum 交易的外层事实与指定池兑换，保留能够确认和不能确认的边界。",
    ],
    position: [
      "Aave 仓位",
      "独立读取 Ethereum / Aave V3 仓位与预言机价格，不执行交易。",
    ],
    "risk-lab": [
      "ETH 风险研究",
      "用同一份研究样本观察卖压、波动、杠杆、泡沫与左尾风险。",
    ],
  }[kind];
  root.innerHTML =
    pageHead(...config) +
    `<nav class="context-links"><a href="/coins/ETH">ETH 数据与指纹</a><a href="/investigate">交易核验</a><a href="/risk-lab">风险研究</a><a href="/position">Aave 仓位</a><a href="/attestations">报告存证</a></nav>${kind === "risk-lab" ? '<div class="notice">当前接口为明确标记的研究样本，不是实时预测，也没有真实 AI 调查。</div><button class="button-secondary" data-research="reload">重读研究样本</button>' : `<form class="query-form" id="research-query"><label for="query-value">${kind === "position" ? "Ethereum 钱包地址" : "Ethereum 交易哈希"}</label><div class="query-row"><input id="query-value" name="value" required spellcheck="false" autocomplete="off" placeholder="${kind === "position" ? "0x + 40 位十六进制字符" : "0x + 64 位十六进制字符"}"><button class="button-primary" type="submit">${kind === "position" ? "读取只读仓位" : "核验这笔交易"}</button><button type="button" class="button-secondary" data-research="example">填入示例</button></div><p class="note">仅从配置的主网 RPC 读取；未配置或读取失败时不回退 Mock。${kind === "investigate" ? "目前仅解析 Uniswap V3 WETH/USDC 0.05% 池，不推断身份或后续去向。" : ""}</p></form>`}<p id="research-error" class="error-band" role="alert" hidden></p><div id="research-result"></div>`;
  const err = root.querySelector("#research-error"),
    result = root.querySelector("#research-result");
  function clearQueryResult() {
    queryRevision++;
    err.hidden = true;
    err.textContent = "";
    result.innerHTML = "";
    clean();
    clean = mountIdentity(root);
  }
  async function load() {
    if (busy || !life.alive) return;
    clearQueryResult();
    const revision = queryRevision;
    let query;
    if (kind !== "risk-lab") {
      const value = root.querySelector("#query-value").value.trim();
      const check =
        kind === "position"
          ? PositionQuerySchema.safeParse({ wallet: value })
          : TransactionCheckRequestSchema.safeParse({ txHash: value });
      if (!check.success) {
        err.textContent =
          kind === "position"
            ? "请输入有效的 Ethereum 钱包地址。"
            : "请输入完整的 Ethereum 交易哈希。";
        err.hidden = false;
        return;
      }
      query = check.data;
    }
    busy = true;
    root
      .querySelectorAll('.query-form button,.query-form input,[data-research="reload"]')
      .forEach((b) => (b.disabled = true));
    result.innerHTML = '<p class="loading">正在读取并校验数据…</p>';
    try {
      const data = await request(
        kind === "position"
          ? "/api/position"
          : kind === "investigate"
            ? "/api/transaction-checks"
            : "/api/eth-risk",
        kind === "position"
          ? PositionSnapshotSchema
          : kind === "investigate"
            ? TransactionCheckReportSchema
            : RiskLabSnapshotSchema,
        { ...(query ? jsonOptions("POST", query) : {}), signal: life.signal },
      );
      if (!life.alive || revision !== queryRevision) return;
      const requestedValue = query?.txHash ?? query?.wallet;
      if (requestedValue && root.querySelector("#query-value").value.trim().toLowerCase() !== requestedValue.toLowerCase()) {
        clearQueryResult();
        return;
      }
      if (kind === "investigate" && data.observation.transaction.hash.toLowerCase() !== query.txHash.toLowerCase())
        throw new Error("服务返回的报告与本次查询不一致，无法展示为已核验结果。");
      if (kind === "position" && data.wallet.toLowerCase() !== query.wallet.toLowerCase())
        throw new Error("服务返回的仓位与本次查询钱包不一致，无法展示为已核验结果。");
      result.innerHTML =
        kind === "position"
          ? positionReportHTML(data)
          : kind === "investigate"
            ? transactionReportHTML(data)
            : riskReportHTML(data);
      clean();
      clean = mountIdentity(root);
    } catch (e) {
      if (life.alive && revision === queryRevision) {
        result.innerHTML = "";
        err.textContent = errorText(e);
        err.hidden = false;
      }
    } finally {
      busy = false;
      if (life.alive)
        root
          .querySelectorAll('.query-form button,.query-form input,[data-research="reload"]')
          .forEach((b) => (b.disabled = false));
    }
  }
  life.on("input", (e) => {
    if (e.target.id === "query-value") clearQueryResult();
  });
  life.on("submit", (e) => {
    if (e.target.id === "research-query") {
      e.preventDefault();
      void load();
    }
  });
  life.on("click", (e) => {
    const b = e.target.closest("[data-research]");
    if (!b || b.disabled) return;
    if (b.dataset.research === "example") {
      root.querySelector("#query-value").value =
        kind === "position"
          ? "0x485c028c475dba482297656229d11b4eaf22357b"
          : "0x19b45706e3877b8cb19133dbdc6f8013a5a4a033495e7b070c84977620348e8a";
      clearQueryResult();
    } else void load();
  });
  clean = mountIdentity(root);
  if (kind === "risk-lab") void load();
  return () => {
    life.dispose();
    clean();
  };
}
