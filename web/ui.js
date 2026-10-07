import { coins } from "./fingerprint/data.js";
import { mountFingerprints } from "./fingerprint/render.js";
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const money = (value) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(value);
export const pct = (value) =>
  value == null ? "—" : `${Number(value).toFixed(2)}%`;
export const time = (value) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
export const identityAssets = [
  {
    id: "USDC",
    name: "USD Coin",
    cn: "美元稳定币",
    category: "稳定币",
    chain: "Ethereum",
    color: 206,
    description:
      "用户可批准的防御资产。稳定币仍有发行方、脱锚与流动性风险。此页未接入其市场行情。",
    website: "https://www.circle.com/usdc",
  },
  {
    id: "WETH",
    name: "Wrapped Ether",
    cn: "包装以太币",
    category: "包装资产",
    chain: "Ethereum",
    color: 215,
    description:
      "Ethereum 上的包装 ETH。Fork 执行与指定池交易使用 WETH；不可直接混同原生 ETH 余额。此页未接入其独立市场行情。",
    website: "https://ethereum.org",
  },
].map((c) => ({
  ...c,
  price: null,
  amplitude: null,
  volume: null,
  change: null,
  mode: "unavailable",
  asOf: null,
  visualIdentity: true,
}));
export const registry = [...coins, ...identityAssets];
export const assetFor = (symbol) =>
  registry.find((c) => c.id === symbol) || {
    id: symbol,
    name: symbol,
    color: 190,
    price: null,
    amplitude: null,
    volume: null,
    mode: "unavailable",
  };
export function assetTag(symbol) {
  const c = assetFor(symbol);
  return `<a class="asset-tag" href="/coins/${encodeURIComponent(symbol)}"><canvas data-coin="${esc(symbol)}" data-size="small" role="img" aria-label="${esc(symbol)} 身份指纹，未绑定此处行情"></canvas><span>${esc(symbol)}<small>${esc(c.cn || c.name)}</small></span></a>`;
}
export function mountIdentity(root) {
  return mountFingerprints(
    root,
    registry.map((c) => ({ ...c, amplitude: null, volume: null })),
    { value: null },
  );
}
export function pageHead(title, description, scope = "Ethereum 专属") {
  return `<div class="workspace-heading"><div><p class="scope-label">${esc(scope)}</p><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="workspace-asset">${assetTag("ETH")}<small>身份指纹 · 各模块数据来源独立</small></div></div>`;
}
export function badge(text, tone = "") {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}
export function panel(title, body, extra = "") {
  return `<section class="workspace-panel ${extra}"><h2>${esc(title)}</h2>${body}</section>`;
}
export function list(items) {
  return `<ul class="findings-list">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
}
export function table(headers, rows) {
  return `<div class="table-scroll"><table><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
export function facts(items) {
  return `<dl class="facts-grid">${items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}
export function explorer(kind, value) {
  return `<a class="external-link" href="https://etherscan.io/${kind}/${encodeURIComponent(value)}" target="_blank" rel="noopener noreferrer"><code>${esc(value)}</code> ↗</a>`;
}
export function rawDetails(value, label = "完整数据与出处") {
  return `<details class="raw-details"><summary>${esc(label)}</summary><pre>${esc(JSON.stringify(value, null, 2))}</pre></details>`;
}
export async function request(url, schema, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("服务返回了不可解析的数据。");
  }
  if (!response.ok)
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : `请求未完成（HTTP ${response.status}）。`,
    );
  return schema ? schema.parse(body) : body;
}
export const jsonOptions = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export function errorText(error) {
  return error instanceof Error ? error.message : "操作未完成。";
}
export function lifecycle(root) {
  const controller = new AbortController();
  let alive = true;
  return {
    get alive() {
      return alive;
    },
    signal: controller.signal,
    on(type, fn) {
      root.addEventListener(type, fn, { signal: controller.signal });
    },
    dispose() {
      alive = false;
      controller.abort();
    },
  };
}
