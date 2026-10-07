import { NextResponse } from "next/server";
import { getRiskLabSnapshot, RiskLabSnapshotSchema } from "@/modules/eth-risk/risk-lab";

export const runtime = "nodejs";

export async function GET() {
  const snapshot = RiskLabSnapshotSchema.parse(getRiskLabSnapshot());
  return NextResponse.json(snapshot, {
    headers: {
      "X-Risk-Mode": snapshot.dataMode,
      "Cache-Control": "no-store",
    },
  });
}
