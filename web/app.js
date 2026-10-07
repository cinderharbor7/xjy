import { identityAssets } from "./ui.js";
import "./style.css";
import {
  sampleMarket,
  sampleHistory,
  visualParameters,
  candleStats,
} from "./fingerprint/data.js";
import {
  mountFingerprints,
  mountSculpture,
  sculptureFailureMessage,
  setMotionPaused,
  isMotionPaused,
} from "./fingerprint/render.js";
import {
  wallet,
  NETWORK,
  connect,
  restoreWallet,
  watchWallet,
  collections,
  contractAddress,
  createEdition,
  downloadFile,
  deployContract,
  verifyContract,
  mintEdition,
  errorMessage,
} from "./fingerprint/nft.js";

const $ = (s, root = document) => root.querySelector(s);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  n == null
    ? "—"
    : Number(n).toLocaleString("en-US", {
        minimumFractionDigits: n < 1 ? 4 : 2,
        maximumFractionDigits: n < 1 ? 4 : 2,
      });
const compact = (n) =>
  n == null
    ? "—"
    : n >= 1e8
      ? `${(n / 1e8).toFixed(2)} 亿`
      : n >= 1e4
        ? `${(n / 1e4).toFixed(1)} 万`
        : Math.round(n).toLocaleString();
const pct = (n) => (n == null ? "—" : `${n.toFixed(2)}%`);
const timestamp = (s) =>
  s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—";
const statusName = {
  demo: "演示数据",
  live: "公开快照",
  stale: "缓存已过期",
  unavailable: "暂不可用",
  "not-applicable": "不适用",
};
const safeURL = (url) => {
  try {
    const u = new URL(url);
    return ["https:", "http:"].includes(u.protocol) ? esc(u.href) : "#";
  } catch {
    return "#";
  }
};
const change = (c) =>
  `<span class="change ${c.change >= 0 ? "positive" : "negative"}">${c.change == null ? "—" : `${c.change >= 0 ? "+" : ""}${pct(c.change)}`} <span class="text-[9px] opacity-70">24h</span></span>`;
const coinCanvas = (c, small = false) =>
  `<canvas data-coin="${c.id}" ${small ? 'data-size="small"' : ""} class="${small ? "" : "fingerprint-main"}" role="img" aria-label="${c.name} 数据指纹：振幅 ${pct(c.amplitude)}，24 小时成交额 ${compact(c.volume)}"></canvas>`;
let state = {
  market: sampleMarket(),
  filter: "全部",
  query: "",
  sort: "featured",
  days: 1,
  busy: false,
  view: "contour",
};
let cleanup = () => {},
  sculptureCleanup = () => {},
  routeVersion = 0,
  detailCache = null,
  currentEdition = null,
  transactionBusy = false;
let pageCleanup = () => {};
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4200);
}
function updateWallet() {
  $("#wallet-label").textContent = wallet.account
    ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}`
    : "连接钱包";
  if (location.pathname === "/collection") render();
}
watchWallet(updateWallet);
void restoreWallet().then((connected) => {
  if (connected) updateWallet();
});
function statusControl() {
  const m = state.market;
  return `<div class="data-control"><span><i class="status-dot ${m.mode === "live" && m.source.status === "live" ? "live" : ""}"></i>${m.mode === "demo" ? "演示数据" : statusName[m.source.status]}${m.fetchedAt ? " · " + new Date(m.fetchedAt).toLocaleTimeString("zh-CN", { hour12: false }) : ""}</span><button data-action="source" ${state.busy ? "disabled" : ""}>${state.busy ? "读取中…" : m.mode === "demo" ? "接入公开数据" : "切换演示"}</button>${m.mode === "live" ? '<button data-action="refresh" ' + (state.busy ? "disabled" : "") + ">刷新</button>" : ""}</div>`;
}
function art(c) {
  return `<div class="hero-art">${coinCanvas(c)}<span class="art-label label-top">色彩 / 市场情绪</span><span class="art-label label-left">起伏 / 日内振幅<br><span class="leading-6">${pct(c.amplitude)}</span></span><span class="art-label label-right">节奏 / 交易活跃</span><div class="art-toolbar"><span>移动鼠标，探索不同视角</span><button data-action="motion" aria-label="${isMotionPaused() ? "播放" : "暂停"}动态图形">${isMotionPaused() ? "▶" : "Ⅱ"}</button></div></div>`;
}
function home() {
  const c = state.market.coins[0];
  return `<div class="intro-line"><p>观察市场的另一种方式</p>${statusControl()}</div>
  <section class="hero" aria-label="焦点币种"><div class="hero-copy"><div class="feature-tag">本期观察 · 编辑精选</div><h1>${c.name}</h1><div class="hero-subtitle">${c.cn} / 数据、指纹与证据</div><p class="hero-description">从形态观察市场，从数据追溯变化。<br>每一个币种，都有可以理解的指纹。</p><div class="hero-price">${c.price == null ? "—" : "$" + money(c.price)}${change(c)}</div><div class="hero-actions"><a href="/coins/${c.id}" class="button-primary">查看币种详情 <span aria-hidden="true">↗</span></a><button class="button-secondary" data-action="mint" data-coin="${c.id}">收藏此刻</button></div><div class="hero-bottom"><span>24h 成交额 ${compact(c.volume)} USDT</span><span>${statusName[c.mode]}</span></div></div>${art(c)}</section>
  <div class="legend-strip"><span>一枚指纹，多个数据维度</span><div class="legend-items"><span><i></i>色彩映射情绪</span><span><i></i>形态映射振幅</span><span><i></i>节奏映射活跃</span></div><button data-action="guide" class="text-button">指纹如何生成 ↗</button></div>
  ${homeTools()}<section class="catalogue" aria-labelledby="catalogue-title"><div class="section-head"><div><h2 id="catalogue-title">资产图鉴<small>${state.market.coins.length} 个币种</small></h2><p>每一种货币，都有自己的市场性格。</p></div><label class="search-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg><input id="search" type="search" placeholder="搜索名称或币种" aria-label="搜索名称或币种" value="${esc(state.query)}"></label></div><div class="filter-bar"><div class="filters" aria-label="币种类别">${["全部", "公链", "DeFi", "价值存储", "社区"].map((f) => `<button data-filter="${f}" class="filter ${state.filter === f ? "active" : ""}" aria-pressed="${state.filter === f}">${f}</button>`).join("")}</div><select id="sort" class="sort-select" aria-label="币种排序"><option value="featured">精选排序</option><option value="change">24h 涨幅优先</option><option value="volume">成交额优先</option></select></div><div class="coin-grid" id="coin-grid"></div><p class="catalogue-foot" id="catalogue-foot"></p></section>`;
}
function renderCards() {
  const q = state.query.toLowerCase();
  const rows = state.market.coins.filter(
    (c) =>
      (state.filter === "全部" || c.category === state.filter) &&
      `${c.id} ${c.name} ${c.cn}`.toLowerCase().includes(q),
  );
  if (state.sort !== "featured")
    rows.sort(
      (a, b) => (b[state.sort] ?? -Infinity) - (a[state.sort] ?? -Infinity),
    );
  $("#coin-grid").innerHTML = rows.length
    ? rows
        .map(
          (c) =>
            `<a class="coin-card" href="/coins/${c.id}" aria-label="查看 ${c.name} 指纹详情"><div class="coin-art">${coinCanvas(c, true)}</div><div><div class="coin-name">${c.name}<small>${c.id}</small></div><div class="coin-meta"><span>${c.cn}</span><span class="category">${c.category}</span></div><div class="coin-stats"><span>成交额 ${compact(c.volume)}</span><span>振幅 ${pct(c.amplitude)}</span></div></div><div class="coin-price">${c.price == null ? "—" : "$" + money(c.price)}${change(c)}<div class="source-mini">${statusName[c.mode]} ↗</div></div></a>`,
        )
        .join("")
    : `<div class="empty-state"><h2>没有匹配的指纹</h2><p>试试币种缩写，或清除当前筛选。</p><button class="button-secondary" data-action="reset">清除筛选</button></div>`;
  $("#catalogue-foot").textContent =
    `已展示 ${rows.length} / 8 枚指纹　${state.market.mode === "demo" ? "当前为设计演示，不代表真实行情。" : "价格与成交额：Binance USDT 交易对。缺失数据以 — 标记。"}`;
  $("#sort").value = state.sort;
  mount();
}
function detailPage(c) {
  return `<div class="intro-line"><div class="breadcrumb"><a href="/">探索图鉴</a><span>/</span><span>${c.name}</span></div>${statusControl()}</div><section class="detail-hero"><div class="detail-overview"><div class="feature-tag">货币指纹 / ${c.id}</div><h1>${c.name}</h1><div class="coin-identity"><span>${c.cn}</span><span>${c.id}</span><span class="category">${c.category}</span></div><p class="detail-description">${c.description}</p><div class="detail-price">${c.price == null ? "—" : "$" + money(c.price)}${change(c)}</div><dl class="detail-metrics"><div><dt>24h 成交额 / USDT</dt><dd>${compact(c.volume)}</dd></div><div><dt>24h 日内振幅</dt><dd>${pct(c.amplitude)}</dd></div><div><dt>24h 最高 / USDT</dt><dd>${money(c.high)}</dd></div><div><dt>24h 最低 / USDT</dt><dd>${money(c.low)}</dd></div></dl><div class="flex gap-3 flex-wrap"><button class="button-primary" data-action="mint" data-coin="${c.id}" ${c.price == null ? "disabled" : ""}>收藏这枚指纹 <span>↗</span></button><a class="button-secondary" href="${c.website}" target="_blank" rel="noopener noreferrer">官方网站 ↗</a></div></div><div class="detail-art"><div class="view-toggle" aria-label="指纹视图"><button data-view="contour" class="active">纹理指纹</button><button data-view="sculpture">流体形态</button></div><div id="detail-art-content" class="h-full">${art(c)}</div></div></section>${coinTools(c)}<div id="detail-data" class="detail-sections"><div class="panel span-all loading">正在读取币种数据…</div></div>`;
}
function priceChart(history) {
  if (history.length < 2) return '<div class="loading">暂无可用价格序列</div>';
  const values = history.map((p) => p.close),
    min = Math.min(...values),
    max = Math.max(...values),
    range = max - min || max * 0.01 || 1;
  const points = values.map((p, i) => [
    (i / (values.length - 1)) * 560,
    170 - ((p - min) / range) * 145,
  ]);
  const path = points
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  return `<div class="chart" id="price-chart"><svg viewBox="0 0 560 200" preserveAspectRatio="none" role="img" aria-label="${state.days === 1 ? "24 小时" : "7 天"}收盘价图，最低 ${money(min)}，最高 ${money(max)} USDT"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#c66b3d" stop-opacity=".18"/><stop offset="100%" stop-color="#c66b3d" stop-opacity="0"/></linearGradient></defs>${[35, 90, 145, 195].map((y) => `<path d="M0 ${y}H560" stroke="#c9c6b5" stroke-dasharray="3 5"/>`).join("")}<path d="${path} L560 200 L0 200 Z" fill="url(#chart-fill)"/><path d="${path}" stroke="#9d4d29" stroke-width="2.2" vector-effect="non-scaling-stroke" fill="none"/></svg><div class="chart-tooltip" id="chart-tooltip" hidden></div></div><div class="chart-labels"><span>${new Date(history[0].time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><span>${money(min)} – ${money(max)} USDT</span><span>${new Date(history.at(-1).time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></div>`;
}
function sentimentNetwork(articles) {
  const domains = [
    ...new Set(articles.map((a) => a.domain).filter(Boolean)),
  ].slice(0, 8);
  if (!domains.length)
    return '<p class="sub">没有可用新闻来源；不推断币种情绪。</p>';
  return `<svg class="network-map" viewBox="0 0 340 170" role="img" aria-label="币种新闻来源关联图，连线仅表示搜索命中，不表示观点一致或冲突">${domains
    .map((d, i) => {
      const a = (i / domains.length) * Math.PI * 2,
        x = 170 + Math.cos(a) * 115,
        y = 85 + Math.sin(a) * 60;
      return `<line x1="170" y1="85" x2="${x}" y2="${y}"/><circle cx="${x}" cy="${y}" r="5"/><text x="${x}" y="${y + 17}" text-anchor="middle">${esc(d.slice(0, 22))}</text>`;
    })
    .join("")}<circle cx="170" cy="85" r="13" fill="#476bb2"/></svg>`;
}
function detailPanels(c, data) {
  const demo = state.market.mode === "demo",
    s = state.market.sentiment,
    p = visualParameters(c, s);
  const history = demo ? sampleHistory(c, state.days) : (data?.history ?? []);
  const stats = demo ? { ...candleStats(history) } : (data?.stats ?? {});
  const metrics = [
    ["现价", c.price == null ? "—" : money(c.price) + " USDT", "Binance Spot"],
    ["24h 成交笔数", compact(c.trades), "Binance Spot"],
    [
      "小时收益率日化波动率",
      pct(stats.volatility),
      `${state.days === 1 ? "24h" : "7d"} 已收盘 K 线计算`,
    ],
    ["区间最大回撤", pct(stats.drawdown), "小时收盘价计算"],
    ["盘口买卖价差", pct(stats.spread), "Binance / 100 档"],
    ["±1% 买盘深度", compact(stats.bidDepth) + " USDT", "仅返回的 100 档内"],
    ["±1% 卖盘深度", compact(stats.askDepth) + " USDT", "仅返回的 100 档内"],
    [
      "主动买入成交占比",
      stats.buyRatio == null ? "—" : pct(stats.buyRatio * 100),
      "K 线报价资产成交额",
    ],
    ["DEX 返回池数量", data?.dex?.pools ?? "—", "DEX Screener 返回集"],
    [
      "DEX 返回池流动性",
      data?.dex ? "$" + compact(data.dex.liquidity) : "—",
      c.wrapped ? "包装币交易池" : "DEX Screener",
    ],
    [
      "所属链 TVL",
      data?.tvl == null ? "—" : "$" + compact(data.tvl),
      "DefiLlama / 链级指标",
    ],
    ["公开仓库 Stars", data?.github?.stars ?? "—", c.repo],
    ["公开仓库 Forks", data?.github?.forks ?? "—", "GitHub"],
    [
      "仓库最后推送",
      timestamp(data?.github?.pushedAt),
      "GitHub / 非最后提交时间",
    ],
  ];
  const sources = demo
    ? Object.fromEntries(
        ["Binance", "GitHub", "DefiLlama", "DEX Screener", "GDELT"].map((n) => [
          n,
          { status: "demo" },
        ]),
      )
    : (data?.sources ?? {});
  $("#detail-data").innerHTML =
    `<section class="panel"><div class="panel-head"><div><h2>市场轨迹</h2><p class="sub">${demo ? "演示曲线 / 非历史行情" : (statusName[data?.sources?.Binance?.status] ?? "暂不可用") + " / Binance 已收盘小时 K 线"}</p></div><div class="periods"><button data-days="1" class="${state.days === 1 ? "active" : ""}">24h</button><button data-days="7" class="${state.days === 7 ? "active" : ""}">7d</button></div></div>${priceChart(history)}</section>
  <section class="panel"><div class="panel-head"><div><h2>指纹的构成</h2><p class="sub">三个可解释的视觉维度</p></div><button class="text-button" data-action="guide">查看映射 ↗</button></div><div class="dimension-row"><span>市场情绪</span><div class="dimension-track"><i style="width:${p.mood * 100}%"></i></div><strong>${s.value ?? "—"}</strong></div><div class="dimension-row"><span>日内振幅</span><div class="dimension-track"><i style="width:${p.roughness * 100}%"></i></div><strong>${pct(c.amplitude)}</strong></div><div class="dimension-row"><span>交易活跃</span><div class="dimension-track"><i style="width:${p.activity * 100}%"></i></div><strong>${compact(c.volume)}</strong></div><p class="sub">缺失维度使用中性形态；数值仍显示为 —。图形不是信用评分。</p></section>
  <section class="panel"><div class="panel-head"><div><h2>数据切片</h2><p class="sub">${demo ? "仅基础行情与曲线为演示值，其余维度保留为空。" : "行情时间 " + timestamp(c.asOf) + "；各来源采集时间见下方。"}</p></div></div><table class="metrics-table"><thead><tr><th scope="col">指标</th><th scope="col">数值</th><th scope="col">口径 / 来源</th></tr></thead><tbody>${metrics.map(([name, value, source]) => `<tr><td>${esc(name)}</td><td>${esc(value)}</td><td>${esc(source)}</td></tr>`).join("")}</tbody></table></section>
  <div class="flex flex-col gap-6"><section class="panel"><h2>市场情绪温度</h2><p class="sub">${demo ? "演示情绪指数" : "Alternative.me Fear & Greed Index"}</p><div class="sentiment-title">${s.value ?? "—"}<small>${s.value == null ? "暂无指数" : s.value >= 75 ? "极度贪婪" : s.value >= 55 ? "贪婪" : s.value >= 45 ? "中性" : s.value >= 25 ? "恐惧" : "极度恐惧"}</small></div><div class="sentiment-scale">${s.value == null ? "" : `<i class="sentiment-marker" style="left:${s.value}%"></i>`}</div><div class="flex justify-between text-[10px] text-muted"><span>极度恐惧</span><span>中性</span><span>极度贪婪</span></div><p class="sub">全市场背景指标，不是 ${c.id} 的独立情绪评分。<br>来源：<a class="underline" target="_blank" rel="noopener" href="https://alternative.me/crypto/fear-and-greed-index/">Alternative.me</a> / ${demo ? "演示值" : statusName[s.mode] + " / " + timestamp(s.asOf)}</p></section><section class="panel"><h2>新闻观察</h2><p class="sub">最近 24 小时，最多 20 篇。按来源关联，尚未进行观点与情绪分类。</p>${sentimentNetwork(data?.news ?? [])}${
    data?.news?.length
      ? data.news
          .slice(0, 5)
          .map(
            (n) =>
              `<a class="news-item" target="_blank" rel="noopener noreferrer" href="${safeURL(n.url)}">${esc(n.title)}<small>${esc(n.domain)} ↗</small></a>`,
          )
          .join("")
      : '<p class="sub">' +
        (demo
          ? "切换公开数据后读取 GDELT 新闻。"
          : "新闻源暂不可用或无匹配结果。") +
        "</p>"
  }</section></div>
  <section class="panel span-all"><div class="panel-head"><div><h2>来源与可用性</h2><p class="sub">保留每个来源的采集时间；缓存过期的数据不能视作实时。</p></div></div><div class="source-grid">${Object.entries(
    { ...sources, "Alternative.me": { status: s.mode, asOf: s.asOf } },
  )
    .map(
      ([name, source]) =>
        `<div class="source-item">${esc(name)}<span class="source-state">${statusName[source.status] ?? "暂无数据"}</span><p>${source.asOf ? timestamp(source.asOf) : demo ? "演示模式，未调用接口" : "暂无采集时间"}${source.error ? "<br>" + esc(source.error) : ""}</p></div>`,
    )
    .join("")}</div></section>`;
  const chart = $("#price-chart");
  if (chart) {
    chart.addEventListener("pointermove", (e) => {
      const r = chart.getBoundingClientRect(),
        i = Math.max(
          0,
          Math.min(
            history.length - 1,
            Math.round(((e.clientX - r.left) / r.width) * (history.length - 1)),
          ),
        ),
        point = history[i];
      $("#chart-tooltip").hidden = false;
      $("#chart-tooltip").textContent =
        `${timestamp(point.time)} / ${money(point.close)} USDT`;
    });
    chart.addEventListener(
      "pointerleave",
      () => ($("#chart-tooltip").hidden = true),
    );
  }
}
async function loadDetail(c, version) {
  if (state.market.mode === "demo") {
    detailCache = null;
    detailPanels(c, null);
    return;
  }
  try {
    const response = await fetch(`/api/detail?coin=${c.id}&days=${state.days}`);
    if (!response.ok) throw new Error("读取详情失败");
    const data = await response.json();
    if (version !== routeVersion) return;
    detailCache = data;
    detailPanels(c, data);
  } catch (error) {
    if (version !== routeVersion) return;
    detailPanels(c, null);
    toast(error.message);
  }
}
function collectionPage() {
  const items = collections();
  return `<div class="section-head mt-5"><div><h2>我的收藏<small>${items.length} 枚</small></h2><p>将一个市场瞬间，留成链上的数字标本。</p></div><button class="button-secondary" data-action="network">BOT 测试网设置</button></div><div class="notice">这里展示当前钱包在本浏览器成功铸造的记录。转让后的最新所有权请以区块浏览器为准。</div>${items.length ? `<div class="collection-grid">${items.map((item) => `<article class="collection-card"><img src="${esc(item.metadata.image)}" alt="${esc(item.metadata.name)}"/><div><h3>${esc(item.metadata.name)}</h3><p>Token #${esc(item.tokenId)} / BOT Chain</p><p>${timestamp(item.capturedAt)}</p><a href="${NETWORK.blockExplorerUrls[0]}/tx/${esc(item.tx)}" target="_blank" rel="noopener">查看链上记录 ↗</a></div></article>`).join("")}</div>` : `<div class="empty-state mt-8"><div class="text-5xl text-slate-400">◌</div><h2>${wallet.account ? "你的第一枚指纹，留给此刻。" : "连接钱包，查看你的收藏。"}</h2><p>在币种详情页保存一份数据快照，<br>将它铸造为 BOT Chain 测试网上的 NFT。</p><div class="flex gap-3 justify-center"><a href="/" class="button-primary">探索指纹图鉴</a>${wallet.account ? "" : '<button class="button-secondary" data-action="wallet">连接钱包</button>'}</div></div>`}`;
}
function mount() {
  cleanup();
  cleanup = mountFingerprints(
    $("#main"),
    [...state.market.coins, ...identityAssets],
    state.market.sentiment,
  );
}
function currentCoin() {
  const id = decodeURIComponent(
    location.pathname.split("/")[2] || "",
  ).toUpperCase();
  return [...state.market.coins, ...identityAssets].find((c) => c.id === id);
}
function render() {
  const version = ++routeVersion;
  cleanup();
  sculptureCleanup();
  pageCleanup();
  pageCleanup = () => {};
  sculptureCleanup = () => {};
  state.view = "contour";
  const path = location.pathname.replace(/\/$/, "") || "/",
    c = currentCoin();
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const active =
      a.dataset.nav === path ||
      (a.dataset.nav === "/" && path.startsWith("/coins/"));
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  const featurePages = [
    "/guardian",
    "/investigate",
    "/risk-lab",
    "/position",
    "/attestations",
  ];
  if (featurePages.includes(path)) {
    $("#main").innerHTML = '<p class="loading">正在加载工作台…</p>';
    const module =
      path === "/guardian"
        ? import("./pages/guardian.js")
        : path === "/attestations"
          ? import("./pages/attestations.js")
          : import("./pages/research.js");
    module
      .then(async (m) => {
        if (version !== routeVersion) return;
        const dispose = await m.mount($("#main"), path.slice(1));
        if (version !== routeVersion) dispose();
        else pageCleanup = dispose;
      })
      .catch(() => {
        if (version === routeVersion)
          $("#main").innerHTML =
            '<p class="error-band">工作台未能加载，请刷新重试。</p>';
      });
    document.title =
      {
        "/guardian": "保护实验",
        "/investigate": "交易核验",
        "/risk-lab": "ETH 风险研究",
        "/position": "Aave 仓位",
        "/attestations": "报告存证",
      }[path] + " · VERDANT";
  } else if (path === "/collection") {
    $("#main").innerHTML = collectionPage();
    document.title = "指纹收藏 · VERDANT";
  } else if (path.startsWith("/coins/") && c) {
    $("#main").innerHTML = detailPage(c);
    document.title = c.name + " · VERDANT";
    mount();
    if (identityAssets.some((a) => a.id === c.id))
      $("#detail-data").innerHTML =
        '<section class="panel span-all"><h2>身份指纹</h2><p class="sub">该资产目前未接入独立行情，图形使用中性参数。查看 ETH 页面可进入对应研究；包装资产与原生资产的余额不可互换。</p><a class="button-secondary" href="/coins/ETH">查看 ETH</a></section>';
    else loadDetail(c, version);
  } else if (path === "/") {
    $("#main").innerHTML = home();
    renderCards();
    document.title = "资产观察 · VERDANT";
  } else {
    $("#main").innerHTML =
      '<div class="empty-state"><h2>未找到这个页面或币种</h2><a class="button-primary" href="/">返回资产观察</a></div>';
    document.title = "未找到 · VERDANT";
  }
}
async function loadMarket() {
  try {
    sessionStorage.setItem("verdant.market-mode", "live");
  } catch {}
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    const response = await fetch("/api/market");
    if (!response.ok) throw new Error("公开数据服务暂不可用");
    state.market = await response.json();
    if (state.market.source.status !== "live")
      toast("行情源暂不可用，缺失值以 — 显示；可切回演示模式。");
  } catch (error) {
    toast(error.message);
  } finally {
    state.busy = false;
    render();
  }
}
function modal(title, content) {
  $("#modal-body").innerHTML =
    `<div class="modal-content"><div class="modal-head"><h2>${title}</h2><button class="close-modal" data-action="close" aria-label="关闭对话框">×</button></div>${content}</div>`;
  if (!$("#modal").open) $("#modal").showModal();
}
function guide() {
  modal(
    "读懂一枚货币指纹",
    `<p>它是一份市场数据的视觉切片。同样的数据与参数会生成相同的静态收藏版本，动态视图则让结构更容易被观察。</p><div class="guide-row"><strong>色彩</strong><span>币种拥有固定基础色相；Alternative.me 全市场恐惧贪婪指数影响色彩分布。它不代表某个币的独立新闻情绪。</span></div><div class="guide-row"><strong>形态</strong><span>日内振幅 =（24h 最高价 − 最低价）÷ 开盘价。振幅越大，纹理起伏越明显；15% 为视觉映射上限。</span></div><div class="guide-row"><strong>节奏</strong><span>24h USDT 成交额经 log10 归一化，影响动态速度。不同币种之间可以在同一尺度下观察。</span></div><div class="guide-row"><strong>收藏</strong><span>将此刻参数生成固定的矢量纹理版 NFT。SVG 图像、数值、来源状态和时间一并写入链上；流体视图是同组参数的另一种呈现。</span></div><p>首页焦点是编辑精选，不是收益排行。缺失数据使用中性形态并显示 —；演示数据会显式标记。漂亮的指纹不等于安全的资产。</p><button class="button-primary mt-3" data-action="close">明白了</button>`,
  );
}
function mintDialog(c) {
  currentEdition = createEdition(c, state.market.sentiment);
  modal(
    "收藏此刻的指纹",
    `<div class="mint-preview"><img src="${currentEdition.metadata.image}" alt="待铸造的 ${c.name} 矢量指纹"><div><h3>${c.name}</h3><dl><div><dt>网络</dt><dd>BOT Chain Testnet</dd></div><div><dt>数据</dt><dd>${statusName[c.mode]}</dd></div><div><dt>版本</dt><dd>纹理版 v1 / SVG</dd></div><div><dt>存储</dt><dd>图像与快照完整上链</dd></div></dl></div></div><p>收藏的是这一刻的固定纹理，不随后续行情改变。铸造费用为钱包显示的测试 BOT Gas，合约不收取额外铸造费。</p>${c.mode === "demo" ? '<label class="notice block"><input type="checkbox" id="demo-consent"> 我知道这是演示数据 NFT，不是真实市场快照。</label>' : ""}${!contractAddress() ? '<div class="notice">尚未配置 NFT 合约。可先下载快照，或打开测试网设置部署合约。</div>' : `<p class="break-all text-[11px]">合约：${esc(contractAddress())}</p>`}<div class="mint-actions"><button class="button-primary" data-action="confirm-mint" ${c.price == null || !contractAddress() ? "disabled" : ""}>确认并在钱包铸造</button><button class="button-secondary" data-action="download">下载快照</button><button class="text-button" data-action="network">测试网设置</button></div><div id="mint-progress" class="mint-progress" role="status"></div>`,
  );
}
function networkDialog() {
  modal(
    "BOT 测试网设置",
    `<dl class="text-xs leading-8 text-muted"><div>网络：Bohr Testnet / Chain ID 968</div><div>RPC：${NETWORK.rpcUrls[0]}</div><div>Gas：测试 BOT</div><div>浏览器：<a class="underline" href="${NETWORK.blockExplorerUrls[0]}" target="_blank" rel="noopener">scan.bohr.life</a></div></dl><p>如果已有本项目合约，填写地址并核验。也可以通过钱包部署新合约；钱包会显示费用并请求你确认。</p><label class="form-label" for="contract-address">NFT 合约地址</label><input class="config-input" id="contract-address" placeholder="0x…" value="${esc(contractAddress())}"><div class="mint-actions"><button class="button-primary" data-action="save-contract">核验并保存</button><button class="button-secondary" data-action="deploy">部署新合约</button></div><div id="mint-progress" class="mint-progress" role="status"></div><p>元数据由收藏者提交，合约保存其不可变版本，不证明数据源的真实性。</p>`,
  );
}
function report(message, hash) {
  const el = $("#mint-progress");
  if (el)
    el.innerHTML = `${esc(message)}${hash ? `<br><a href="${NETWORK.blockExplorerUrls[0]}/tx/${esc(hash)}" target="_blank" rel="noopener">查看交易 ${esc(hash.slice(0, 12))}… ↗</a>` : ""}`;
}
async function transaction(action) {
  if (transactionBusy) return;
  transactionBusy = true;
  $("#modal")
    .querySelectorAll("button,input")
    .forEach((b) => (b.disabled = true));
  try {
    await action();
    updateWallet();
  } catch (error) {
    report(errorMessage(error));
  } finally {
    transactionBusy = false;
    $("#modal")
      .querySelectorAll("button,input")
      .forEach((b) => (b.disabled = false));
  }
}
document.addEventListener("click", async (event) => {
  const button = event.target.closest(
    "[data-action],[data-filter],[data-days],[data-view]",
  );
  if (!button || button.disabled) return;
  if (button.dataset.filter) {
    state.filter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((b) => {
      b.classList.toggle("active", b === button);
      b.setAttribute("aria-pressed", b === button);
    });
    renderCards();
    return;
  }
  if (button.dataset.days) {
    state.days = Number(button.dataset.days);
    const c = currentCoin();
    if (c) {
      const version = ++routeVersion;
      $("#detail-data").innerHTML =
        '<div class="panel span-all loading">正在读取价格区间…</div>';
      loadDetail(c, version);
    }
    return;
  }
  if (button.dataset.view) {
    const c = currentCoin();
    state.view = button.dataset.view;
    sculptureCleanup();
    sculptureCleanup = () => {};
    document
      .querySelectorAll("[data-view]")
      .forEach((b) => b.classList.toggle("active", b === button));
    if (state.view === "contour") {
      $("#detail-art-content").innerHTML = art(c);
      mount();
      return;
    }
    cleanup();
    $("#detail-art-content").innerHTML =
      '<div class="sculpture-host" id="sculpture-host"></div><div class="art-toolbar"><span>流体形态 / Shader Park</span><button data-action="motion" aria-label="暂停动态图形">Ⅱ</button></div>';
    const host = $("#sculpture-host"),
      version = routeVersion;
    const revert = (error) => {
      if (
        version !== routeVersion ||
        state.view !== "sculpture" ||
        !host.isConnected
      )
        return;
      sculptureCleanup();
      sculptureCleanup = () => {};
      $("#detail-art-content").innerHTML = art(c);
      state.view = "contour";
      document
        .querySelectorAll("[data-view]")
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.view === "contour"),
        );
      mount();
      toast(sculptureFailureMessage(error));
    };
    try {
      const dispose = await mountSculpture(
        host,
        c,
        state.market.sentiment,
        revert,
      );
      if (version !== routeVersion || state.view !== "sculpture") dispose();
      else sculptureCleanup = dispose;
    } catch (error) {
      revert(error);
    }
    return;
  }
  try {
    switch (button.dataset.action) {
      case "guide":
        guide();
        break;
      case "close":
        if (!transactionBusy) $("#modal").close();
        break;
      case "source":
        if (state.market.mode === "demo") await loadMarket();
        else {
          state.market = sampleMarket();
          try {
            sessionStorage.setItem("verdant.market-mode", "demo");
          } catch {}
          render();
        }
        break;
      case "refresh":
        await loadMarket();
        break;
      case "wallet":
        await connect();
        updateWallet();
        toast(
          wallet.chainId === NETWORK.chainId
            ? "钱包已连接 BOT Chain"
            : "钱包已连接；铸造时将请求切换至 BOT Chain。",
        );
        break;
      case "motion":
        setMotionPaused(!isMotionPaused());
        document.querySelectorAll('[data-action="motion"]').forEach((b) => {
          b.textContent = isMotionPaused() ? "▶" : "Ⅱ";
          b.setAttribute(
            "aria-label",
            isMotionPaused() ? "播放动态图形" : "暂停动态图形",
          );
        });
        break;
      case "reset":
        state.filter = "全部";
        state.query = "";
        render();
        break;
      case "mint":
        mintDialog(
          [...state.market.coins, ...identityAssets].find(
            (c) => c.id === button.dataset.coin,
          ),
        );
        break;
      case "network":
        networkDialog();
        break;
      case "download":
        downloadFile(
          `${currentEdition.snapshot.symbol}-fingerprint.json`,
          JSON.stringify(currentEdition.metadata, null, 2),
          "application/json",
        );
        toast("快照已导出，包含 SVG 图像与数据来源。");
        break;
      case "confirm-mint":
        if (
          currentEdition.snapshot.sourceMode === "demo" &&
          !$("#demo-consent")?.checked
        ) {
          report("请先确认你理解这份 NFT 使用演示数据。");
          break;
        }
        await transaction(async () => {
          await mintEdition(currentEdition, report);
          button.dataset.action = "close";
          button.textContent = "完成";
        });
        break;
      case "deploy":
        await transaction(async () => {
          const address = await deployContract(report);
          $("#contract-address").value = address;
        });
        break;
      case "save-contract":
        await transaction(async () => {
          await verifyContract($("#contract-address").value.trim());
          report(
            "合约代码已核验，地址已保存。现在可关闭设置并重新打开收藏窗口。",
          );
        });
        break;
    }
  } catch (error) {
    toast(errorMessage(error));
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    state.query = e.target.value;
    renderCards();
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "sort") {
    state.sort = e.target.value;
    renderCards();
  }
});
$("#modal").addEventListener("cancel", (e) => {
  if (transactionBusy) e.preventDefault();
});
// Native URLs keep all existing workbench deep links usable without a client framework.
if (location.hash.startsWith("#/coin/"))
  location.replace("/coins/" + encodeURIComponent(location.hash.split("/")[2]));
else if (location.hash === "#/collection") location.replace("/collection");
render();
try {
  if (
    sessionStorage.getItem("verdant.market-mode") === "live" &&
    (location.pathname === "/" || location.pathname.startsWith("/coins/"))
  ) {
    state.market = {
      mode: "live",
      source: { status: "unavailable" },
      sentiment: { value: null, mode: "unavailable" },
      fetchedAt: null,
      coins: sampleMarket().coins.map((c) => ({
        ...c,
        price: null,
        high: null,
        low: null,
        change: null,
        volume: null,
        amplitude: null,
        trades: null,
        mode: "unavailable",
      })),
    };
    void loadMarket();
  }
} catch {}

function homeTools() {
  return '<section class="workspace-paths" aria-label="研究工作台"><div><h2>从观察到核验</h2><p>沿着资产数据，找到有出处的结论。</p></div><a href="/investigate"><strong>交易核验</strong><span>Ethereum 外层事实与指定池兑换</span></a><a href="/risk-lab"><strong>风险研究</strong><span>ETH 研究模型与证据样本</span></a><a href="/guardian"><strong>保护实验</strong><span>单钱包策略与结果核验</span></a><a href="/attestations"><strong>报告存证</strong><span>BOT 测试网上的内容完整性</span></a></section>';
}
function coinTools(c) {
  return c.id === "ETH"
    ? '<section class="coin-workbench"><div><h2>围绕 ETH 继续研究</h2><p>市场指纹、主网只读核验、研究样本和保护实验分别保留其数据口径。</p></div><nav aria-label="ETH 工作台"><a href="/investigate">核验交易</a><a href="/risk-lab">风险研究</a><a href="/position">Aave 仓位</a><a href="/guardian">保护实验</a><a href="/attestations">报告存证</a></nav></section>'
    : '<div class="notice">该币种提供数据指纹与收藏；交易核验、风险研究和保护实验目前为 ETH 专属，尚未扩展到 ' +
        esc(c.id) +
        "。</div>";
}
