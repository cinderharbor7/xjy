import { NextResponse } from "next/server";
import { RescueRequestSchema, RescueSessionSchema } from "@/domain/schemas";
import { runRescueSession } from "@/integration/rescue";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = RescueRequestSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { wallet: string } with a nonempty test wallet and no extra fields." }, { status: 400 });
  }
  try {
    const session = RescueSessionSchema.parse(await runRescueSession(parsed.data.wallet));
    return NextResponse.json(session, {
      headers: { "X-Rescue-Mode": "MOCK", "Cache-Control": "no-store" },
    });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Rescue session failed." }, { status: 500 });
  }
}
