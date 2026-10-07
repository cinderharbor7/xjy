import { z } from "zod";
import { RiskAnalysisSchema } from "@/domain/schemas";
import { EthereumDataResultSchema } from "@/modules/onchain/read-results";

// Presentation DTO only: the frozen domain contracts remain unchanged.
export const OnchainReportRequestSchema = z.strictObject({
  wallet: z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/),
  investigationMode: z.enum(["RULES", "AI"]).default("RULES"),
});
export const OnchainReportSchema = EthereumDataResultSchema.options[3].extend({
  analysisMethod: z.literal("SELL_PRESSURE_HEURISTIC"),
  riskAnalysis: RiskAnalysisSchema,
  limitations: z.array(z.string().min(1)).min(1),
  investigationMode: z.enum(["RULES", "AI"]),
  checkedAt: z.iso.datetime(),
}).superRefine((report, ctx) => {
  if (report.portfolio.state.timestamp !== report.market.state.timestamp
    || report.market.state.timestamp !== report.signal.windowEnd
    || report.portfolio.state.blockNumber === undefined
    || Math.abs(report.riskAnalysis.riskExposurePct - report.portfolio.state.riskExposurePct) > 0.0001
    || report.riskAnalysis.confidence !== report.riskAnalysis.investigation.confidence) {
    ctx.addIssue({ code: "custom", message: "Report requires one snapshot and consistent portfolio/risk/confidence." });
  }
});
export type OnchainReportRequest = z.infer<typeof OnchainReportRequestSchema>;
export type OnchainReport = z.infer<typeof OnchainReportSchema>;
