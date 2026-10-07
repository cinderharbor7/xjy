import * as rescue from "../src/app/api/rescue/route";
import * as monitor from "../src/app/api/monitor/route";
import * as policy from "../src/app/api/policy/route";
import * as position from "../src/app/api/position/route";
import * as investigation from "../src/app/api/transaction-checks/route";
import * as research from "../src/app/api/eth-risk/route";
import * as onchainAnalysis from "../src/app/api/onchain-analysis/route";
import { market, detail } from "./fingerprint.js";
type Handler = (request: Request) => Response | Promise<Response>;
const routes: Record<string, Record<string, Handler>> = {
  "/api/rescue": { POST: rescue.POST },
  "/api/monitor": { GET: monitor.GET, POST: monitor.POST },
  "/api/policy": { GET: policy.GET, PUT: policy.PUT },
  "/api/position": { POST: position.POST },
  "/api/transaction-checks": { POST: investigation.POST },
  "/api/eth-risk": { GET: research.GET },
  "/api/onchain-analysis": { POST: onchainAnalysis.POST },
  "/api/market": {
    GET: async () =>
      Response.json(await market(), {
        headers: { "Cache-Control": "no-store" },
      }),
  },
  "/api/detail": {
    GET: async (request) => {
      const url = new URL(request.url),
        data = await detail(
          url.searchParams.get("coin"),
          url.searchParams.get("days") === "7" ? 7 : 1,
        );
      return Response.json(data ?? { error: "Unknown coin" }, {
        status: data ? 200 : 404,
        headers: { "Cache-Control": "no-store" },
      });
    },
  },
};
export async function dispatchApi(request: Request): Promise<Response> {
  const route = routes[new URL(request.url).pathname];
  if (!route) return Response.json({ error: "Not found" }, { status: 404 });
  const handler = route[request.method];
  if (typeof handler !== "function")
    return Response.json(
      { error: "Method not allowed" },
      {
        status: 405,
        headers: {
          Allow: Object.keys(route)
            .filter((k) => typeof route[k] === "function")
            .join(", "),
        },
      },
    );
  return handler(request);
}
