import { NextResponse } from "next/server";
import { RescueProblemSchema, RescueRequestSchema, RescueSessionSchema } from "@/domain/schemas";
import { runRescueSession } from "@/integration/rescue";

export const runtime = "nodejs";

function problem(status: 400 | 500, detail: string) {
  const code = status === 400 ? "INVALID_REQUEST" : "RESCUE_FAILED";
  return NextResponse.json(RescueProblemSchema.parse({
    type: `urn:xjy:rescue:${code}`,
    title: status === 400 ? "Invalid rescue request" : "Rescue session failed",
    status, detail, instance: "/api/rescue", code,
  }), { status, headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return problem(400, "Request body must be valid JSON.");
  }
  const parsed = RescueRequestSchema.safeParse(input);
  if (!parsed.success) {
    return problem(400, "Expected { wallet: string } with a nonempty test wallet and no extra fields.");
  }
  try {
    const session = RescueSessionSchema.parse(await runRescueSession(parsed.data.wallet));
    return NextResponse.json(session, {
      headers: { "X-Rescue-Mode": "MOCK", "Cache-Control": "no-store" },
    });
  } catch {
    // Adapter/configuration exceptions may contain credentials. Never expose raw messages.
    return problem(500, "The Mock Guardian session could not be completed. Check the server configuration.");
  }
}
