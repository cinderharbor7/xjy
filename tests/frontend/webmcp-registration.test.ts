// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { registerReportTools } from "../../web/report/tools.js";
import { ReportSession } from "../../src/modules/eth-report/session";
import { sampleSnapshot } from "../helpers/eth-report";
it("uses current WebMCP AbortSignal registration and removes partial registrations on failure", async () => {
  const tools = new Set<string>();
  const context = { registerTool: vi.fn(async (tool: any, options: { signal: AbortSignal }) => {
    if (tools.size === 2) throw new Error("denied");
    tools.add(tool.name); options.signal.addEventListener("abort", () => tools.delete(tool.name));
  }) };
  await expect(registerReportTools(new ReportSession(async () => sampleSnapshot()), { context })).rejects.toThrow("denied");
  expect(tools.size).toBe(0);
});
it("registration completing after navigation aborts its registration signal", async () => {
  let alive = true, finish!: () => void;
  const tools = new Set<string>();
  const context = { registerTool: vi.fn((tool: any, options: { signal: AbortSignal }) => new Promise<void>((resolve) => {
    tools.add(tool.name); options.signal.addEventListener("abort", () => tools.delete(tool.name)); finish = resolve;
  })) };
  const pending = registerReportTools(new ReportSession(async () => sampleSnapshot()), { context, isAlive: () => alive });
  alive = false; finish();
  expect((await pending).available).toBe(false); expect(tools.size).toBe(0);
});
it("publishes strict JSON schemas and executes through the same validation layer", async () => {
  const tools: any[] = [];
  const context = { registerTool: async (tool: any) => { tools.push(tool); } };
  const registration = await registerReportTools(new ReportSession(async () => sampleSnapshot()), { context });
  expect(registration.available).toBe(true);
  for (const tool of tools) expect(tool.inputSchema.additionalProperties).toBe(false);
  await expect(tools[0].execute({ windowDays: 3 })).rejects.toThrow();
  registration.dispose();
});

it("navigation aborts pending registration immediately and allows a new page to register", async () => {
  const tools = new Map<string, any>(); let finish!: () => void; let first = true;
  const context = { registerTool: vi.fn((tool: any, options: { signal: AbortSignal }) => {
    if (tools.has(tool.name)) throw new Error("duplicate");
    tools.set(tool.name, tool); options.signal.addEventListener("abort", () => tools.delete(tool.name), { once: true });
    if (first) { first = false; return new Promise<void>((resolve) => { finish = resolve; }); }
    return Promise.resolve();
  }) };
  const controller = new AbortController();
  const old = registerReportTools(new ReportSession(async () => sampleSnapshot()), { context, signal: controller.signal });
  expect(tools.size).toBe(1); controller.abort(); expect(tools.size).toBe(0);
  const fresh = await registerReportTools(new ReportSession(async () => sampleSnapshot()), { context });
  expect(fresh.available).toBe(true); expect(tools.size).toBe(6);
  finish(); expect((await old).available).toBe(false); expect(tools.size).toBe(6);
  fresh.dispose(); expect(tools.size).toBe(0);
});
