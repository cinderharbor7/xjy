import { getGuardian } from "@/integration/guardian/runtime";
import { GuardianError, PolicyPutSchema } from "@/integration/guardian/contracts";
import { assertLocalRequest, guardianJson, guardianProblem, jsonBody } from "@/integration/guardian/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    assertLocalRequest(request); const monitor = getGuardian();
    monitor.assertWallet(new URL(request.url).searchParams.get("wallet") ?? "");
    return guardianJson(monitor.policy());
  } catch (error) { return guardianProblem(error, "/api/policy"); }
}
export async function PUT(request: Request) {
  try {
    assertLocalRequest(request);
    const parsed = PolicyPutSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new GuardianError(400, "INVALID_REQUEST", "Expected wallet, config and a positive version, without extra fields.");
    const { wallet, config, version } = parsed.data;
    return guardianJson(getGuardian().savePolicy(wallet, config, version));
  } catch (error) { return guardianProblem(error, "/api/policy"); }
}
