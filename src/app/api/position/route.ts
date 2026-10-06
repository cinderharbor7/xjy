import { NextResponse } from "next/server";
import { PositionProblemSchema, PositionQuerySchema, PositionSnapshotSchema } from "@/extensions/aave/schemas";
import type { PositionProblem } from "@/extensions/aave/types";
import { getAavePositionSnapshot } from "@/extensions/aave/integration";
import { PositionReadError } from "@/extensions/aave/position-read.error";

export const runtime = "nodejs";

function problem(status: PositionProblem["status"], code: PositionProblem["code"], title: string, detail: string) {
  const body = PositionProblemSchema.parse({ type: `urn:xjy:position:${code}`, title, status, detail, instance: "/api/position", code });
  return NextResponse.json(body, { status, headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return problem(400, "INVALID_WALLET", "Invalid position query", "Request body must be valid JSON containing an Ethereum wallet address.");
  }
  const parsed = PositionQuerySchema.safeParse(input);
  if (!parsed.success) {
    return problem(400, "INVALID_WALLET", "Invalid position query", "Expected only { wallet: string } with 0x followed by 40 hexadecimal characters.");
  }
  try {
    const snapshot = PositionSnapshotSchema.parse(await getAavePositionSnapshot(parsed.data.wallet));
    return NextResponse.json(snapshot, { headers: { "X-Position-Mode": "LIVE", "Cache-Control": "no-store" } });
  } catch (cause) {
    if (cause instanceof PositionReadError) {
      if (cause.code === "CONFIGURATION_ERROR") return problem(503, cause.code, "Position reader is not configured", cause.message);
      if (cause.code !== "NO_DEBT") return problem(502, cause.code, "Position read failed", cause.message);
    }
    // Unexpected exceptions may include private RPC URLs. Never return their text.
    return problem(502, "RPC_READ_FAILED", "Position read failed", "Unable to read the required Ethereum/Aave data. Check the server RPC configuration.");
  }
}
