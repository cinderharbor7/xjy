import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { canonicalJson, exportReport, guardianReport, guardianSessionReport, parseReportFile, reportHash, researchReport } from "@/modules/attestation/report";
import { getRiskLabSnapshot } from "@/modules/eth-risk/risk-lab";
import { createMockRescueOrchestrator } from "@/integration/rescue";
import { DEMO_POLICY_CONFIG, DEMO_WALLET } from "@/mocks/scenarios";

describe("risk report content hash", () => {
  it("has a deterministic byte-level vector, with sorted keys and retained array order", () => {
    const value = { z: [3, 1], a: { "中文": "证据", b: 1e-7 }, n: -0 };
    const canonical = '{"a":{"b":1e-7,"中文":"证据"},"n":0,"z":[3,1]}';
    expect(canonicalJson(value)).toBe(canonical); expect(keccak256(toHex(canonicalJson(value)))).toBe(keccak256(toHex(canonical)));
  });
  it("repeated exports and object reorder/formatting preserve the report hash", () => {
    const report = researchReport(getRiskLabSnapshot()), one = exportReport(report), two = exportReport(report);
    expect(one.reportHash).toBe(two.reportHash);
    const reordered = Object.fromEntries(Object.entries(report).reverse());
    expect(reportHash(reordered)).toBe(one.reportHash);
    expect(parseReportFile(JSON.stringify(one, null, 4)).matches).toBe(true);
  });
  it("detects changed text, evidence, array order and model values", () => {
    const base = exportReport(researchReport(getRiskLabSnapshot()));
    for (const change of ["text", "evidence", "order", "number"]) {
      const file = structuredClone(base); if (file.report.kind !== "ETH_RISK_LAB") throw new Error("fixture");
      if (change === "text") file.report.snapshot.composite.interpretation += " revised";
      if (change === "evidence") file.report.snapshot.evidence[0].value += " changed";
      if (change === "order") file.report.snapshot.models.reverse();
      if (change === "number") file.report.snapshot.priceUsd += 1;
      expect(parseReportFile(JSON.stringify(file)).matches, change).toBe(false);
    }
  });
  it("rejects duplicate JSON keys including escaped equivalents, oversized and malformed files", () => {
    const raw = JSON.stringify(exportReport(researchReport(getRiskLabSnapshot())));
    expect(() => parseReportFile(raw.replace('"algorithm":"keccak256"', '"algorithm":"keccak256","algor\\u0069thm":"keccak256"'))).toThrow(/Duplicate/);
    expect(() => parseReportFile(raw + "{}" )).toThrow(); expect(() => parseReportFile(" ".repeat(2_000_001))).toThrow(/limit/);
    expect(() => canonicalJson({ invalid: NaN })).toThrow(); expect(() => canonicalJson({ invalid: undefined })).toThrow();
    expect(() => canonicalJson("\ud800")).toThrow(); expect(() => canonicalJson(new Date())).toThrow();
  });
  it("includes Guardian decisions, evidence, existing results and provenance without executing anything during export", async () => {
    const session = await createMockRescueOrchestrator(DEMO_WALLET).runRescueSession(DEMO_WALLET);
    const event = { id: "event-1", createdAt: session.before.timestamp, status: "CONFIRMED" as const, config: DEMO_POLICY_CONFIG, version: 1,
      analysis: { before: session.before, market: session.market, riskAnalysis: session.riskAnalysis, policyDecision: session.policyDecision }, submissions: [], session, note: "fixture" };
    const report = guardianReport(event, "MOCK"), exported = exportReport(report);
    expect(report.kind).toBe("GUARDIAN_EVENT");
    if (report.kind !== "GUARDIAN_EVENT") throw new Error("fixture");
    expect(report.event.session?.execution.success).toBe(true); expect(report.event.analysis.policyDecision.action).toBe("SWAP_TO_SAFE");
    expect(report.event.analysis.riskAnalysis.investigation.evidence.length).toBeGreaterThan(0);
    event.note = "later update"; expect(report.event.note).toBe("fixture");
    const changed = structuredClone(exported); if (changed.report.kind !== "GUARDIAN_EVENT") throw new Error("fixture");
    changed.report.event.analysis.before.wallet = ` ${DEMO_WALLET} `;
    expect(parseReportFile(JSON.stringify(changed)).matches).toBe(false); // Zod trimming must never mask tampering.
    expect(guardianReport(event, "FORK")).toMatchObject({ provenance: { balancesAndExecution: "LOCAL_ETHEREUM_FORK", investigationAndMarketChanges: "DEMO_INPUTS" } });
  });
  it("keeps receipt metadata outside the report hash and marks research execution absent", () => {
    const report = researchReport(getRiskLabSnapshot());
    expect(report).toMatchObject({ policyDecision: null, execution: null, verification: null, dataMode: "MOCK_CHAIN_FIXTURE" });
    const anchor = { chainId: 968 as const, contract: `0x${"11".repeat(20)}`, publisher: `0x${"22".repeat(20)}`, transactionHash: `0x${"ab".repeat(32)}`, timestamp: "1790000000" };
    const a = exportReport(report), b = exportReport(report, anchor); expect(a.reportHash).toBe(b.reportHash);
    expect(parseReportFile(JSON.stringify(b)).matches).toBe(true);
  });
  it("accepts mainnet anchors without changing the report hash or dropping historical testnet files", () => {
    const report = researchReport(getRiskLabSnapshot());
    const anchor = { chainId: 677 as const, contract: `0x${"11".repeat(20)}`, publisher: `0x${"22".repeat(20)}`, transactionHash: `0x${"ab".repeat(32)}`, timestamp: "1790000000" };
    const file = exportReport(report, anchor);
    expect(parseReportFile(JSON.stringify(file)).matches).toBe(true);
    expect(file.reportHash).toBe(exportReport(report).reportHash);
  });
  it("exports a non-triggered session without fabricating an event or historical policy version", async () => {
    const session = await createMockRescueOrchestrator(DEMO_WALLET, { ...DEMO_POLICY_CONFIG, minRiskScore: 100 }).runRescueSession(DEMO_WALLET);
    const report = guardianSessionReport(session, "MOCK");
    expect(report).toMatchObject({ kind: "GUARDIAN_SESSION", session: { policyDecision: { triggered: false }, execution: { action: "NONE" }, verification: { status: "SKIPPED" } } });
    expect(report).not.toHaveProperty("event"); expect(report).not.toHaveProperty("config");
    expect(parseReportFile(JSON.stringify(exportReport(report))).matches).toBe(true);
  });
});
