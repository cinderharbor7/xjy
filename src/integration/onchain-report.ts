import { OnchainReportRequestSchema, OnchainReportSchema, type OnchainReport } from "./onchain-report.contracts";
import { createEthereumReadClient, validateRpcUrl } from "@/modules/onchain/live-data";
import { analyzeOnchainData } from "./onchain-analysis";

export class ReportModeRemovedError extends Error {
  readonly code = "AI_MODE_REMOVED";
  constructor() { super("AI_MODE_REMOVED"); }
}

/** Legacy readonly rule report; model inference is now exclusively external. */
export async function generateOnchainReport(input: unknown): Promise<OnchainReport> {
  const request = OnchainReportRequestSchema.parse(input);
  if (request.investigationMode === "AI") throw new ReportModeRemovedError();
  const client = createEthereumReadClient(validateRpcUrl(process.env.ETHEREUM_RPC_URL));
  const analysis = await analyzeOnchainData(client, request.wallet);
  return OnchainReportSchema.parse({ ...analysis, investigationMode: "RULES", checkedAt: new Date().toISOString() });
}
