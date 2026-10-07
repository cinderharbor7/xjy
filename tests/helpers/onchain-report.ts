import { readFileSync } from "node:fs";
import { OnchainReportSchema } from "@/integration/onchain-report.contracts";

// Saved historical LIVE observation for offline contract regression, not a live test.
export function historicalReport() {
  return OnchainReportSchema.parse({
    ...JSON.parse(readFileSync("docs/evidence/2026-10-07-a/onchain-analysis.json", "utf8")),
    investigationMode: "RULES", checkedAt: "2026-10-07T09:00:00.000Z",
  });
}
