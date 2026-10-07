import { OnchainReportRequestSchema, OnchainReportSchema, type OnchainReport } from "./onchain-report.contracts";
import { AiInvestigationAdapter, AiInvestigationError, type AiInvestigationOptions } from "@/modules/investigation/ai-investigation.adapter";
import { createEthereumReadClient, validateRpcUrl } from "@/modules/onchain/live-data";
import { analyzeOnchainData } from "./onchain-analysis";

export function aiReportConfiguration(): AiInvestigationOptions {
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!apiKey) throw new AiInvestigationError("AI_CONFIGURATION_REQUIRED");
  const apiUrl = process.env.LLM_API_URL?.trim();
  if (apiUrl) {
    try { if (!["http:", "https:"].includes(new URL(apiUrl).protocol)) throw new Error(); }
    catch { throw new AiInvestigationError("AI_CONFIGURATION_REQUIRED"); }
  }
  const thinkingMode = process.env.LLM_THINKING_MODE?.trim() || undefined;
  if (thinkingMode !== undefined && thinkingMode !== "enabled" && thinkingMode !== "disabled") {
    throw new AiInvestigationError("AI_CONFIGURATION_REQUIRED");
  }
  return { apiKey, apiUrl, thinkingMode, model: process.env.LLM_MODEL?.trim() || undefined };
}

/** One explicit readonly run. No Guardian, policy, executor, storage or fallback. */
export async function generateOnchainReport(input: unknown): Promise<OnchainReport> {
  const request = OnchainReportRequestSchema.parse(input);
  // Fail before paying for RPC reads when the selected AI mode is unconfigured.
  const ai = request.investigationMode === "AI" ? aiReportConfiguration() : undefined;
  const client = createEthereumReadClient(validateRpcUrl(process.env.ETHEREUM_RPC_URL));
  const analysis = await analyzeOnchainData(client, request.wallet, undefined,
    ai ? (signal) => new AiInvestigationAdapter(signal, ai) : undefined);
  return OnchainReportSchema.parse({ ...analysis, investigationMode: request.investigationMode,
    checkedAt: new Date().toISOString() });
}
