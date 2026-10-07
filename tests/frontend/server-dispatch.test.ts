import { expect, it } from "vitest";
import { dispatchApi } from "../../server/api";
it("preserves read-only research route schema and provenance headers", async () => {
  const response = await dispatchApi(
    new Request("http://localhost:3000/api/eth-risk"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Risk-Mode")).toBe("MOCK_CHAIN_FIXTURE");
  expect((await response.json()).asset).toBe("ETH");
});
it("rejects unsupported methods without entering a stateful handler", async () => {
  const response = await dispatchApi(
    new Request("http://localhost:3000/api/rescue"),
  );
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
});
it("keeps local-origin enforcement at the original API boundary", async () => {
  const response = await dispatchApi(
    new Request("http://localhost:3000/api/monitor", {
      headers: { origin: "https://example.com" },
    }),
  );
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("ORIGIN_REJECTED");
});
it("does not confuse an unknown coin with empty live data", async () => {
  const response = await dispatchApi(
    new Request("http://localhost:3000/api/detail?coin=NOTREAL"),
  );
  expect(response.status).toBe(404);
});
