// Explicit opt-in local acceptance run. No mainnet writes; creates a disposable Anvil wallet.
// node scripts/verify-guardian-fork.mjs <absolute-anvil-executable> <read-only-mainnet-rpc>
import { spawn } from "node:child_process";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { createPublicClient, createWalletClient, http, parseAbi, parseEther } from "viem";
import { mainnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const [anvilPath, upstream] = process.argv.slice(2);
if (!anvilPath || !upstream) throw new Error("Provide an Anvil executable and read-only mainnet RPC URL.");
const output = resolve(`.guardian/acceptance-${Date.now()}`);
await mkdir(output, { recursive: true });
const rpcUrl = "http://127.0.0.1:18545", origin = "http://127.0.0.1:3107";
const signalFile = resolve(output, "demo-signal.json");
const children = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
async function assertFreePort(port) {
  const probe = createServer();
  await new Promise((ready, reject) => {
    probe.once("error", () => reject(new Error(`Acceptance port ${port} is already in use; existing services will not be touched.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(ready));
  });
}
function assertRunning(child) {
  if (child.startupFailed || child.exitCode !== null || child.signalCode !== null) {
    const error = new Error("An acceptance child exited before its service was ready.");
    error.fatal = true; throw error;
  }
}
function launch(command, args, env, file, onStdout) {
  const child = spawn(command, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const stream = createWriteStream(resolve(output, file));
  if (onStdout) child.stdout.on("data", chunk => onStdout(chunk.toString()));
  else child.stdout.pipe(stream);
  child.stderr.pipe(stream); children.push(child);
  child.on("error", () => { child.startupFailed = true; });
  return child;
}
async function until(fn, timeout = 60_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) { try { const value = await fn(); if (value) return value; } catch (e) { if (e.fatal) throw e; last = e; } await delay(500); }
  throw new Error(`Acceptance wait timed out: ${last?.message ?? "condition was not reached"}`);
}
function assert(value, message) { if (!value) throw new Error(message); }
async function api(path, body, method = "POST") {
  const response = await fetch(`${origin}/api/${path}`, { method: body === undefined ? "GET" : method,
    headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
let signalTimer, app;
const env = { ...process.env, GUARDIAN_MODE: "FORK" };
// Store only in child environment; never print or write the private key.
const signingKey = generatePrivateKey();
const signer = privateKeyToAccount(signingKey);
Object.assign(env, { GUARDIAN_WALLET: signer.address, FORK_PRIVATE_KEY: signingKey, FORK_RPC_URL: rpcUrl,
  GUARDIAN_DB_PATH: resolve(output, "state.sqlite"), GUARDIAN_ORIGIN: origin, GUARDIAN_SIGNAL_FILE: signalFile });
const startApp = async () => {
  await assertFreePort(3107);
  const child = launch(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3107"], env, `next-${Date.now()}.log`);
  await until(async () => {
    assertRunning(child); const r = await api("monitor"); assertRunning(child);
    return r.status === 200 && r.body.wallet === signer.address && r.body.mode === "FORK";
  });
  return child;
};
let calm = false;
async function signal() { await writeFile(`${signalFile}.tmp`, JSON.stringify({ timestamp: new Date().toISOString(), priceChange5mPct: calm ? 0 : -3, priceChange1hPct: calm ? 0 : -10, volatilityScore: calm ? 20 : 82 })); await rename(`${signalFile}.tmp`, signalFile); }
try {
  await assertFreePort(18545); await assertFreePort(3107);
  let listening = false, startup = "";
  const anvil = launch(anvilPath, ["--fork-url", upstream, "--host", "127.0.0.1", "--port", "18545", "--block-time", "2", "--accounts", "0"], process.env, "anvil.log", chunk => {
    // Confirm THIS child bound its socket. Do not persist its account/mnemonic banner.
    startup = (startup + chunk).slice(-512);
    listening ||= startup.includes("Listening on 127.0.0.1:18545");
  });
  await until(() => { assertRunning(anvil); return listening; });
  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl, { retryCount: 0, timeout: 10000 }) });
  await until(async () => { assertRunning(anvil); const id = await client.getChainId(); assertRunning(anvil); return id === 1; });
  await client.request({ method: "anvil_setBalance", params: [signer.address, `0x${parseEther("100").toString(16)}`] });
  const wallet = createWalletClient({ account: signer, chain: mainnet, transport: http(rpcUrl, { retryCount: 0, timeout: 10000 }) });
  const deposit = await wallet.writeContract({ address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", abi: parseAbi(["function deposit() payable"]), functionName: "deposit", value: parseEther("10") });
  assert((await client.waitForTransactionReceipt({ hash: deposit })).status === "success", "WETH funding failed");
  await signal(); signalTimer = setInterval(() => { void signal(); }, 2000);
  app = await startApp();
  const policy = (await api(`policy?wallet=${signer.address}`)).body;
  assert((await api("policy", { wallet: signer.address, version: policy.version, config: { ...policy.config, minRiskScore: 60, minRiskExposurePct: 10 } }, "PUT")).status === 200, "Policy save failed");
  await api("monitor", { wallet: signer.address, command: "start" });
  const first = await until(async () => {
    const s = (await api("monitor")).body;
    if (s.halted) throw new Error(JSON.stringify({ error: s.lastError, events: s.events }));
    return s.events?.[0]?.session?.verification.status === "PASSED" && s;
  });
  console.log("Fork HTTP → monitor → swap → independent verification: PASSED");
  const repeated = await api("rescue", { wallet: signer.address }); assert(repeated.status === 409, `Repeated manual request expected 409: ${JSON.stringify(repeated)}`);
  await api("monitor", { wallet: signer.address, command: "pause" });
  await api("monitor", { wallet: signer.address, command: "start" });
  await new Promise(r => { app.once("exit", r); app.kill(); });
  app = await startApp();
  await delay(12_000);
  const restarted = (await api("monitor")).body;
  assert(restarted.events.length === 1 && restarted.events[0].id === first.events[0].id, "Restart lost event gate");
  console.log("Repeated request, pause/resume and server restart: no second swap");
  calm = true; await signal();
  await until(async () => !(await api("monitor")).body.activeEvent, 55_000);
  calm = false; await signal();
  const second = await until(async () => { const s = (await api("monitor")).body; return s.events?.length === 2 && s.events[0].session?.verification.status === "PASSED" && s; });
  await api("monitor", { wallet: signer.address, command: "pause" });
  assert(second.events.every(e => e.submissions.filter(tx => tx.kind === "SWAP").length === 1), "More than one swap in an event");
  const report = { verifiedAt: new Date().toISOString(), wallet: signer.address, mode: "FORK", inputs: "Demo market changes and Mock investigation; actual local fork balances/quotes/swaps", events: second.events, checks: ["HTTP policy saved", "server-driven first swap", "independent verification", "repeated manual request blocked", "pause/resume retained event", "process restart retained event", "3-sample market recovery", "second event exactly one swap"] };
  await writeFile(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Recovery → second event → independent verification: PASSED\nReport: ${output}/report.json`);
} finally {
  if (signalTimer) clearInterval(signalTimer);
  for (const child of children.reverse()) if (child.exitCode === null) child.kill();
}
