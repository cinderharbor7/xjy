// No BOT funds or wallet secrets are used. Runs the actual compiled contract on a local Anvil EVM.
import { spawn } from "node:child_process";
import { createPublicClient, http } from "viem";
const binary = process.env.ANVIL_BIN || process.argv[2];
if (!binary) throw new Error("Set ANVIL_BIN or pass the absolute Anvil executable path.");
const url = "http://127.0.0.1:19545";
const client = createPublicClient({ transport: http(url, { retryCount: 0, timeout: 1000 }) });
let occupied = false; try { await client.getChainId(); occupied = true; } catch { /* Expected: this test owns a new server. */ }
if (occupied) throw new Error("Port 19545 is already an RPC server; refusing to modify it.");
const anvil = spawn(binary, ["--host", "127.0.0.1", "--port", "19545", "--chain-id", "968", "--silent"], { windowsHide: true, stdio: "ignore" });
let startError; anvil.on("error", error => { startError = error; });
try {
  let ready = false;
  for (let i = 0; i < 30; i++) { if (startError) throw startError; try { if (await client.getChainId() === 968) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 200)); }
  if (!ready) throw new Error("Local Anvil did not start.");
  const test = spawn(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/attestation-contract.test.ts"], { windowsHide: true, stdio: "inherit", env: { ...process.env, ATTESTATION_TEST_RPC: url } });
  const exit = await new Promise((resolve, reject) => { test.once("exit", resolve); test.once("error", reject); });
  if (exit !== 0) throw new Error(`Contract EVM tests failed (${exit}).`);
} finally { anvil.kill(); }
