// No browser, no wallet, no external chain. Starts only an isolated MOCK database.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
const probe = net.createServer();
await new Promise((r, j) => {
  probe.once("error", j);
  probe.listen(0, "127.0.0.1", r);
});
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`,
  out = resolve("output", `http-check-${Date.now()}`);
mkdirSync(out, { recursive: true });
const child = spawn(
  process.execPath,
  ["--import", "tsx", "server/index.ts", "--production"],
  {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      XJY_ISOLATED_PREVIEW: "1",
      GUARDIAN_ORIGIN: origin,
      GUARDIAN_DB_PATH: resolve(out, "state.sqlite"),
      GUARDIAN_WALLET: "0x1111111111111111111111111111111111111111",
      GUARDIAN_SIGNAL_FILE: "",
    },
  },
);
let log = "";
child.stdout.on("data", (x) => (log += x));
child.stderr.on("data", (x) => (log += x));
const api = async (path, method = "GET", body, headers = {}) => {
  const response = await fetch(origin + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, body: await response.json() };
};
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error("Server startup failed");
    try {
      ready = (await fetch(origin)).ok;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "server ready");
  const paths = [
    "/",
    "/coins/ETH",
    "/coins/BTC",
    "/coins/USDC",
    "/coins/WETH",
    "/guardian",
    "/investigate",
    "/report",
    "/risk-lab",
    "/position",
    "/attestations",
    "/collection",
  ];
  for (const path of paths) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.ok(html.includes("VERDANT") && !html.includes("/_next/"));
    for (const url of [
      ...html.matchAll(/(?:src|href)="(\/assets\/[^"#]+)"/g),
    ].map((m) => m[1]))
      assert.equal((await fetch(origin + url)).status, 200, url);
  }
  assert.equal((await fetch(origin + "/missing.js")).status, 404);
  assert.equal(
    (await fetch(origin + "/fingerprint-contract.json")).status,
    200,
  );
  const monitor = await api("/api/monitor");
  assert.equal(monitor.body.mode, "MOCK");
  assert.equal(monitor.body.enabled, false);
  const wallet = monitor.body.wallet;
  let policy = (await api(`/api/policy?wallet=${wallet}`)).body;
  assert.equal(
    (
      await api("/api/monitor", "GET", undefined, {
        origin: "https://external.invalid",
      })
    ).response.status,
    403,
  );
  assert.equal(
    (await api("/api/transaction-checks", "POST", { txHash: "bad" })).response
      .status,
    400,
  );
  assert.equal(
    (await api("/api/eth-risk")).body.dataMode,
    "MOCK_CHAIN_FIXTURE",
  );
  const removedAI = await api("/api/onchain-analysis", "POST", { wallet, investigationMode: "AI" });
  assert.equal(removedAI.response.status, 410);
  assert.equal(removedAI.body.code, "AI_MODE_REMOVED");
  const invalidSnapshot = await api("/api/eth-report-snapshot?days=2");
  assert.equal(invalidSnapshot.response.status, 400);
  assert.equal(invalidSnapshot.body.code, "INVALID_WINDOW");
  assert.equal((await api("/api/eth-report-snapshot?days=1", "GET", undefined, { origin: "https://external.invalid" })).response.status, 403);
  const updated = await api("/api/policy", "PUT", {
    wallet,
    config: { ...policy.config, minRiskScore: 100 },
    version: policy.version,
  });
  assert.equal(updated.response.status, 200);
  const skipped = await api("/api/rescue", "POST", { wallet });
  assert.equal(skipped.response.status, 200);
  assert.equal(skipped.body.execution.action, "NONE");
  policy = updated.body;
  const restored = await api("/api/policy", "PUT", {
    wallet,
    config: { ...policy.config, minRiskScore: 80 },
    version: policy.version,
  });
  assert.equal(restored.response.status, 200);
  const run = await api("/api/rescue", "POST", { wallet });
  assert.equal(run.response.status, 200);
  assert.equal(run.body.verification.status, "PASSED");
  assert.equal(run.body.after.riskExposurePct, 70);
  assert.equal(run.response.headers.get("X-Rescue-Mode"), "MOCK");
  const again = await api("/api/rescue", "POST", { wallet });
  assert.equal(again.response.status, 409);
  assert.equal((await api("/api/monitor")).body.events.length, 1);
  const result = {
    mode: "isolated MOCK only",
    routes: paths.length,
    staticAssets: "passed",
    originGuard: "passed",
    policyVersioning: "passed",
    manualRescue: "PASSED",
    duplicateEvent: "blocked",
    reportMigration: "AI 410; invalid window 400; cross-origin 403",
    visualInspection: "NOT PERFORMED",
  };
  writeFileSync(resolve(out, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  child.kill("SIGTERM");
  await new Promise((r) => {
    if (child.exitCode !== null) r();
    else child.once("exit", r);
  });
  writeFileSync(resolve(out, "server.log"), log);
}
