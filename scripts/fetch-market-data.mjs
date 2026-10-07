/**
 * Rebuild the market history that scripts/calibrate-policy.ts consumes.
 *
 *   node scripts/fetch-market-data.mjs
 *   node scripts/fetch-market-data.mjs --proxy http://127.0.0.1:7897
 *   node scripts/fetch-market-data.mjs --out C:/tmp/price-data
 *
 * WHY THIS IS A SCRIPT AND NOT A COMMITTED FILE
 * --------------------------------------------
 * The raw series are ~1.1 MB of third-party market data with a licence we do
 * not own. They are therefore git-ignored. What IS committed is the frozen
 * output, `data/policy-calibration-results.json`, plus the doc. This script is
 * the reproduction path: it rebuilds the exact inputs those numbers came from,
 * so the evidence stays checkable instead of being a screenshot.
 *
 * Only stdlib is used, so there is nothing to install. No API key is needed.
 *
 * Sources
 *   ETH primary   Coinbase Exchange public candles, ETH-USD, 1 day, UTC bucket
 *   ETH secondary OKX public market API, ETH-USDT, 1 day  (cross-check only)
 *   CN indices    Tencent finance kline, forward-adjusted index levels
 *
 * Rule the calibration depends on: ONE venue, ONE day boundary. The two ETH
 * venues commit to different 24h buckets (see section 1 of the report), so they
 * are stored separately and never blended.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { gunzipSync } from "node:zlib";

const argv = process.argv.slice(2);
const argOf = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    "usage: node scripts/fetch-market-data.mjs [--out <dir>] [--proxy <url>]\n" +
      "  --out    directory for the JSON files (default: <repo>/data)\n" +
      "  --proxy  e.g. http://127.0.0.1:7897 ; also read from HTTPS_PROXY",
  );
  process.exit(0);
}

const repoRoot = resolve(import.meta.dirname, "..");
const outDir = resolve(argOf("--out") ?? resolve(repoRoot, "data"));
const proxyUrl = argOf("--proxy") ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null;

// ---------------------------------------------------------------- http

function openTls(host, port, proxy) {
  return new Promise((ok, fail) => {
    if (!proxy) {
      const socket = tlsConnect({ host, port, servername: host }, () => ok(socket));
      socket.on("error", fail);
      return;
    }
    const proxyPort = proxy.port || (proxy.protocol === "https:" ? 443 : 80);
    const raw = netConnect({ host: proxy.hostname, port: Number(proxyPort) }, () => {
      raw.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    raw.on("error", fail);
    let seen = "";
    const onData = (chunk) => {
      seen += chunk.toString("latin1");
      if (!seen.includes("\r\n\r\n")) return;
      raw.removeListener("data", onData);
      const status = seen.slice(0, seen.indexOf("\r\n"));
      if (!/\s200\s/.test(status)) {
        fail(new Error(`proxy refused CONNECT: ${status}`));
        return;
      }
      const socket = tlsConnect({ socket: raw, servername: host }, () => ok(socket));
      socket.on("error", fail);
    };
    raw.on("data", onData);
  });
}

function dechunk(buffer) {
  const out = [];
  let offset = 0;
  for (;;) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd < 0) break;
    const size = parseInt(buffer.toString("latin1", offset, lineEnd).split(";")[0], 16);
    if (!Number.isFinite(size) || size === 0) break;
    out.push(buffer.subarray(lineEnd + 2, lineEnd + 2 + size));
    offset = lineEnd + 2 + size + 2;
  }
  return Buffer.concat(out);
}

/** Minimal HTTPS GET. Uses a CONNECT tunnel when a proxy is configured. */
function httpsGetText(url, proxy) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parsed.port || 443;
  const target = parsed.pathname + parsed.search;
  const proxyObject = proxy ? new URL(proxy) : null;

  return openTls(host, port, proxyObject).then(
    (socket) =>
      new Promise((ok, fail) => {
        const chunks = [];
        const timer = setTimeout(() => {
          socket.destroy();
          fail(new Error(`timeout after 60s: ${url}`));
        }, 60000);
        socket.on("data", (chunk) => chunks.push(chunk));
        socket.on("error", (error) => {
          clearTimeout(timer);
          fail(error);
        });
        socket.on("end", () => {
          clearTimeout(timer);
          const raw = Buffer.concat(chunks);
          const headerEnd = raw.indexOf("\r\n\r\n");
          if (headerEnd < 0) {
            fail(new Error(`no header terminator from ${url}`));
            return;
          }
          const header = raw.toString("latin1", 0, headerEnd).toLowerCase();
          let body = raw.subarray(headerEnd + 4);
          if (header.includes("transfer-encoding: chunked")) body = dechunk(body);
          if (header.includes("content-encoding: gzip")) body = gunzipSync(body);
          ok(body.toString("utf8"));
        });
        socket.write(
          `GET ${target} HTTP/1.1\r\n` +
            `Host: ${host}\r\n` +
            "User-Agent: xjy-risk-guardian-calibration/1.0\r\n" +
            "Accept: application/json,text/plain,*/*\r\n" +
            "Accept-Encoding: gzip\r\n" +
            "Connection: close\r\n\r\n",
        );
      }),
  );
}

async function getJson(url, { attempts = 4, label = url } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const text = await httpsGetText(url, proxyUrl);
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      process.stdout.write(`  retry ${attempt}/${attempts} ${label}: ${error.message}\n`);
      await new Promise((ok) => setTimeout(ok, 1500 * attempt));
    }
  }
  throw lastError;
}

const day = (ms) => new Date(ms * 1000).toISOString().slice(0, 10);
const round2 = (value) => Math.round(Number(value) * 100) / 100;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const fetchedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");

// ---------------------------------------------------------------- coinbase

async function fetchCoinbase() {
  const rows = [];
  const start = Date.UTC(2016, 4, 1) / 1000; // 2016-05-01, ETH-USD inception window
  const now = Math.floor(Date.now() / 1000);
  const step = 295 * 86400; // the endpoint caps a window at 300 candles
  for (let cursor = start; cursor < now; cursor += step) {
    const end = Math.min(cursor + step, now);
    const url =
      "https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=86400" +
      `&start=${new Date(cursor * 1000).toISOString().slice(0, 19)}Z` +
      `&end=${new Date(end * 1000).toISOString().slice(0, 19)}Z`;
    const batch = await getJson(url, { label: `${day(cursor)}..${day(end)}` });
    if (!Array.isArray(batch)) throw new Error(`Coinbase returned ${JSON.stringify(batch)}`);
    rows.push(...batch);
    process.stdout.write(`  coinbase ${day(cursor)} .. ${day(end)}  +${batch.length}\n`);
    await sleep(350);
  }
  const unique = new Map();
  for (const [ts, low, high, open, close, volume] of rows) unique.set(ts, [ts, low, high, open, close, volume]);
  const bars = [...unique.values()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, low, high, open, close, volume]) => [
      day(ts),
      round2(open),
      round2(high),
      round2(low),
      round2(close),
      round2(volume),
    ]);
  return {
    id: "eth-usd-daily",
    source: "Coinbase Exchange public candles API",
    endpoint:
      "https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=86400&start=<ISO>&end=<ISO> (max 300 candles per request)",
    instrument: "ETH-USD",
    interval: "1d",
    fetchedAt,
    fieldOrder: ["date", "open", "high", "low", "close", "baseVolume"],
    coverage: { from: bars[0][0], to: bars[bars.length - 1][0], bars: bars.length },
    notes: "Primary dataset. Spot venue, no synthetic fills; every calendar day trades.",
    bars,
  };
}

// ---------------------------------------------------------------- okx

async function fetchOkx() {
  const rows = [];
  let after = "";
  for (let page = 0; page < 80; page += 1) {
    const url =
      "https://www.okx.com/api/v5/market/history-candles?instId=ETH-USDT&bar=1D&limit=100" +
      (after ? `&after=${after}` : "");
    const payload = await getJson(url, { label: `page ${page + 1}` });
    const batch = payload.data ?? [];
    if (batch.length === 0) break;
    rows.push(...batch);
    if (page % 8 === 0) process.stdout.write(`  okx page ${page + 1}  total ${rows.length}\n`);
    if (batch.length < 100) break;
    const oldest = batch[batch.length - 1][0];
    if (oldest === after) break;
    after = oldest;
    await sleep(400);
  }
  const unique = new Map();
  for (const row of rows) unique.set(Number(row[0]), row);
  const bars = [...unique.keys()]
    .sort((a, b) => a - b)
    .map((ts) => {
      const row = unique.get(ts);
      return [
        day(Math.floor(ts / 1000)),
        round2(row[1]),
        round2(row[2]),
        round2(row[3]),
        round2(row[4]),
        round2(row[5]),
      ];
    });
  return {
    id: "eth-usdt-daily-secondary",
    source: "OKX public market API",
    endpoint:
      "https://www.okx.com/api/v5/market/history-candles?instId=ETH-USDT&bar=1D&limit=100 (&after=<ms> paging)",
    instrument: "ETH-USDT",
    interval: "1d",
    fetchedAt,
    fieldOrder: ["date", "open", "high", "low", "close", "baseVolume"],
    coverage: { from: bars[0][0], to: bars[bars.length - 1][0], bars: bars.length },
    notes: "Secondary source, used only for an independent cross-venue sanity check.",
    bars,
  };
}

// ---------------------------------------------------------------- cn indices

const CN_TARGETS = [
  ["sh000300", "CSI300_沪深300"],
  ["sh000905", "CSI500_中证500"],
  ["sh000852", "CSI1000_中证1000"],
  ["sz399303", "CNI2000_国证2000"],
  ["sh932000", "CSI2000_中证2000"],
];
const CN_WINDOWS = [
  ["2014-01-01", "2018-01-01"],
  ["2018-01-01", "2022-01-01"],
  ["2022-01-01", "2027-01-01"],
];

async function fetchCnIndices() {
  const series = {};
  for (const [code, name] of CN_TARGETS) {
    const rows = [];
    for (const [from, to] of CN_WINDOWS) {
      const url =
        "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get" +
        `?param=${code},day,${from},${to},2000,qfq`;
      const payload = await getJson(url, { label: `${code} ${from}` });
      const node = payload.data?.[code] ?? {};
      rows.push(...(node.day ?? node.qfqday ?? []));
      await sleep(400);
    }
    const unique = new Map();
    for (const row of rows) unique.set(row[0], row);
    const bars = [...unique.keys()].sort().map((date) => {
      const row = unique.get(date);
      const volume = row.length > 5 ? row[5] : 0;
      return [date, round2(row[1]), round2(row[3]), round2(row[4]), round2(row[2]), round2(volume)];
    });
    if (bars.length === 0) {
      process.stdout.write(`  ${name} (${code})  NO DATA\n`);
      continue;
    }
    process.stdout.write(`  ${name.padEnd(16)} ${String(bars.length).padStart(5)} bars  ${bars[0][0]} .. ${bars[bars.length - 1][0]}\n`);
    series[name] = {
      code,
      coverage: { from: bars[0][0], to: bars[bars.length - 1][0], bars: bars.length },
      bars,
    };
  }
  return {
    id: "cn-index-daily",
    source: "Tencent finance kline API",
    endpoint:
      "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=<code>,day,<start>,<end>,2000,qfq",
    interval: "1d",
    fetchedAt,
    fieldOrder: ["date", "open", "high", "low", "close", "volume"],
    notes:
      "Forward-adjusted index levels, trading days only. Volume in lots. Used for the cross-market failure analysis.",
    series,
  };
}

// ---------------------------------------------------------------- main

function save(name, payload) {
  const path = resolve(outDir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload)}\n`);
  const size = JSON.stringify(payload).length;
  process.stdout.write(`  wrote ${name}  ${(size / 1024).toFixed(0)} KB\n`);
}

process.stdout.write(
  `Fetching market history -> ${outDir}\n` +
    `proxy: ${proxyUrl ?? "(direct)"}\n\n` +
    "1. ETH primary — Coinbase ETH-USD daily\n",
);
const eth = await fetchCoinbase();
process.stdout.write(`   ${eth.coverage.bars} bars  ${eth.coverage.from} .. ${eth.coverage.to}\n\n`);
process.stdout.write("2. ETH secondary — OKX ETH-USDT daily (cross-check only)\n");
const ethSecondary = await fetchOkx();
process.stdout.write(
  `   ${ethSecondary.coverage.bars} bars  ${ethSecondary.coverage.from} .. ${ethSecondary.coverage.to}\n\n`,
);
process.stdout.write("3. Chinese index daily (cross-market failure case)\n");
const cn = await fetchCnIndices();
process.stdout.write("\n");
save("eth-usd-daily.json", eth);
save("eth-usdt-daily-secondary.json", ethSecondary);
save("cn-index-daily.json", cn);
process.stdout.write(
  "\nDone. Next: pnpm exec tsx scripts/calibrate-policy.ts\n" +
    "It rewrites data/policy-calibration-results.json — commit that, not the raw series.\n",
);
