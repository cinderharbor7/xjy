import { getGuardian } from "@/integration/guardian/runtime";
import { GuardianError, MonitorCommandSchema } from "@/integration/guardian/contracts";
import { assertLocalRequest, guardianJson, guardianProblem, jsonBody } from "@/integration/guardian/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { assertLocalRequest(request); return guardianJson(getGuardian().status()); }
  catch (error) { return guardianProblem(error, "/api/monitor"); }
}
export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const parsed = MonitorCommandSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new GuardianError(400, "INVALID_REQUEST", "Expected wallet and command (start or pause), without extra fields.");
    const monitor = getGuardian();
    return guardianJson(monitor.command(parsed.data.wallet, parsed.data.command));
  } catch (error) { return guardianProblem(error, "/api/monitor"); }
}
