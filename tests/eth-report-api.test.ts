import { afterEach, expect, it, vi } from "vitest";
import { dispatchApi } from "../server/api";
import { collectSnapshot } from "../server/eth-report";
import { sampleSnapshot } from "./helpers/eth-report";
vi.mock("../server/eth-report", async (original) => ({ ...(await original<typeof import("../server/eth-report")>()), collectSnapshot: vi.fn() }));
const collect = vi.mocked(collectSnapshot);
const req = (query = "days=1", headers = {}, method = "GET") => new Request(`http://localhost:3000/api/eth-report-snapshot?${query}`, { method, headers });
afterEach(() => vi.resetAllMocks());
it("serves the exact collected snapshot with no-store", async () => {
  collect.mockResolvedValue(sampleSnapshot());
  const response = await dispatchApi(req());
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).snapshotId).toBeDefined(); expect(collect).toHaveBeenCalledExactlyOnceWith(1);
});
it.each(["", "days=0", "days=1&days=7", "days=7&url=https://evil.example", "days=1&wallet=x"])("rejects invalid input %s before collection", async (query) => {
  expect((await dispatchApi(req(query))).status).toBe(400); expect(collect).not.toHaveBeenCalled();
});
it("rejects a foreign origin and unsupported HTTP method", async () => {
  expect((await dispatchApi(req("days=1", { origin: "https://evil.example" }))).status).toBe(403);
  expect((await dispatchApi(req("days=1", {}, "POST"))).status).toBe(405);
  expect(collect).not.toHaveBeenCalled();
});
it("never serializes internal errors or returns a fabricated snapshot", async () => {
  collect.mockRejectedValue(new Error("https://secret@provider.example/API_KEY"));
  const response = await dispatchApi(req());
  expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/secret|API_KEY/);
});
