import { RescueRequestSchema, RescueSessionSchema } from "@/domain/schemas";
import { runRescueSession } from "@/integration/rescue";
import { getGuardian } from "@/integration/guardian/runtime";
import { GuardianError } from "@/integration/guardian/contracts";
import { assertLocalRequest, guardianProblem, jsonBody } from "@/integration/guardian/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const parsed = RescueRequestSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new GuardianError(400, "INVALID_REQUEST", "Expected { wallet: string } without extra fields.");
    const session = RescueSessionSchema.parse(await runRescueSession(parsed.data.wallet));
    return Response.json(session, { headers: { "X-Rescue-Mode": getGuardian().policy().mode, "Cache-Control": "no-store" } });
  } catch (error) { return guardianProblem(error, "/api/rescue"); }
}
