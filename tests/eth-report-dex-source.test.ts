import { afterEach, expect, it, vi } from "vitest";
import { buildSnapshot } from "../server/eth-report";
import { providerData } from "./helpers/eth-report";
const address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
afterEach(() => { vi.unstubAllGlobals(); });
it.each(["all-missing", "one-missing", "actual-zero", "actual-values"])("preserves %s DEX fields through actual detail adapter and snapshot", async (scenario) => {
  vi.resetModules();
  const full = { baseToken: { address }, liquidity: { usd: 100 }, txns: { h24: { buys: 4, sells: 5 } } };
  const pools = scenario === "actual-zero" ? [{ ...full, liquidity: { usd: 0 }, txns: { h24: { buys: 0, sells: 0 } } }]
    : scenario === "actual-values" ? [full, full] : scenario === "one-missing" ? [full, { baseToken: { address } }] : [{ baseToken: { address } }];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("dexscreener") ? pools : url.includes("api.github") ? { stargazers_count: 1, forks_count: 1, open_issues_count: 0, pushed_at: new Date().toISOString() } : [])));
  const { detail } = await import("../server/fingerprint.js");
  const d = await detail("ETH", 1);
  expect(d!.dex).toMatchObject(scenario === "actual-zero" ? { liquidity: 0, largest: 0, buys: 0, sells: 0 } : scenario === "actual-values" ? { liquidity: 200, largest: 100, buys: 8, sells: 10 } : { liquidity: null, largest: null, buys: null, sells: null });
  const { m } = providerData();
  const evidence = buildSnapshot(m, d, 1).evidence.find((e) => e.group === "dex")!;
  expect(evidence.data).toMatchObject({ pools: pools.length, liquidity: scenario === "actual-zero" ? 0 : scenario === "actual-values" ? 200 : null });
});
