import { describe, expect, it } from "vitest";
import { ExecutionBadge, StressChart, VerificationBadge, VerificationDetails } from "../web/pages/rescue-display.js";
import type { ExecutionResult, VerificationResult } from "@/domain/types";

const render = (html: string) => html;
const createElement = (component: (props: any) => string, props: any) => component(props);

describe("rescue result presentation", () => {
  it("does not describe a successful transaction with failed verification as protected", () => {
    const verification: VerificationResult = { status: "FAILED", reasons: ["Failed: source balance does not match the receipt."] };
    expect(render(createElement(VerificationBadge, { verification }))).toContain("Verification failed");
    const details = render(createElement(VerificationDetails, { verification }));
    expect(details).toContain("Do not claim protection succeeded");
    expect(details).toContain(verification.reasons[0]);
    expect(details).not.toContain("confirms the approved swap");
  });

  it.each([
    ["PASSED", "Verified after read"], ["SKIPPED", "Verification skipped"],
  ] as const)("renders %s independently of transaction status", (status, label) => {
    expect(render(createElement(VerificationBadge, { verification: { status, reasons: ["Evidence"] } }))).toContain(label);
  });

  it("distinguishes an attempted failed swap from a skipped action", () => {
    const failed: ExecutionResult = {
      success: false, action: "SWAP_TO_SAFE", sourceAsset: "ETH", targetAsset: "USDC",
      timestamp: "2026-10-07T00:00:00Z", error: "Swap failed",
    };
    expect(render(createElement(ExecutionBadge, { execution: failed }))).toContain("Failed");
    expect(render(createElement(ExecutionBadge, { execution: { success: false, action: "NONE", timestamp: failed.timestamp } }))).toContain("Skipped");
  });
  it("shows an unresolved broadcast as pending rather than a confirmed failure", () => {
    const execution: ExecutionResult = { success: false, action: "SWAP_TO_SAFE", sourceAsset: "ETH", targetAsset: "USDC", timestamp: "2026-10-07T00:00:00Z", error: "SUBMITTED_UNKNOWN: Receipt lookup only." };
    expect(render(createElement(ExecutionBadge, { execution }))).toContain("Pending receipt");
    expect(render(createElement(ExecutionBadge, { execution: { ...execution, error: "PRE_SUBMIT_FAILED: Transport interrupted." }, pending: true }))).toContain("Pending receipt");
  });

  it("plots stress values against the before snapshot with aligned 100/50/0 percent ticks", () => {
    const tests = [
      { priceChangePct: 0, projectedPortfolioUsd: 30000, projectedLossUsd: 0 },
      { priceChangePct: -50, projectedPortfolioUsd: 15000, projectedLossUsd: 15000 },
      { priceChangePct: -100, projectedPortfolioUsd: 0, projectedLossUsd: 30000 },
    ];
    const html = render(createElement(StressChart, { tests, baselineUsd: 30000 }));
    expect(html).toContain('points="58,28 348,90 638,152"');
    expect(html).toContain("$15,000");
    expect(html).toContain("Projected loss");
  });

  it("handles empty scenarios and zero-value portfolios without misleading percentages", () => {
    expect(render(createElement(StressChart, { tests: [], baselineUsd: 0 }))).toContain("No stress scenarios");
    const html = render(createElement(StressChart, { tests: [{ priceChangePct: -10, projectedPortfolioUsd: 0, projectedLossUsd: 0 }], baselineUsd: 0 }));
    expect(html).not.toContain("<svg");
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain("$0");
  });
});
