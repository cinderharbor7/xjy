import { NextResponse } from "next/server";
import { GuardianError, GuardianProblemSchema, isGuardianError } from "./contracts";

/** Local single-user control plane: run Next bound to loopback, reject foreign browser origins. */
export function assertLocalRequest(request: Request) {
  const url = new URL(request.url);
  const expected = new URL(process.env.GUARDIAN_ORIGIN ?? "http://localhost:3000");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const localAuthority = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    && new URL(`${url.protocol}//${host}`).port === expected.port;
  const host = request.headers.get("host") ?? forwardedHost ?? url.host;
  const localForward = !forwardedHost || localAuthority(forwardedHost);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.port !== expected.port || url.protocol !== expected.protocol
    // Next may normalize request.url to localhost while preserving the literal loopback Host.
    || !localForward || !localAuthority(host)
    || request.headers.has("forwarded")) throw new GuardianError(403, "LOCAL_ONLY", "Guardian controls are available only on the configured local server.");
  const origin = request.headers.get("origin");
  const browserOrigin = new URL(`${url.protocol}//${host}`).origin;
  if ((origin && origin !== browserOrigin) || request.headers.get("sec-fetch-site") === "cross-site") throw new GuardianError(403, "ORIGIN_REJECTED", "Cross-origin control requests are not permitted.");
  if (request.method !== "GET" && !request.headers.get("content-type")?.startsWith("application/json")) throw new GuardianError(415, "JSON_REQUIRED", "Use application/json.");
}
export function guardianJson(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } }); }
export function guardianProblem(error: unknown, instance: string) {
  const safe = isGuardianError(error) ? error : new GuardianError(503, "GUARDIAN_UNAVAILABLE", "Guardian could not complete the request. Check server configuration; no automatic resend.");
  return NextResponse.json(GuardianProblemSchema.parse({ type: `urn:xjy:guardian:${safe.code}`, title: "Guardian request failed", status: safe.status, code: safe.code, detail: safe.message, instance }), { status: safe.status, headers: { "Cache-Control": "no-store", "Content-Type": "application/problem+json" } });
}
export async function jsonBody(request: Request) {
  try { return await request.json(); } catch { throw new GuardianError(400, "INVALID_REQUEST", "Request body must be valid JSON."); }
}
