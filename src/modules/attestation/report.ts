import { z } from "zod";
import { keccak256, stringToHex } from "viem";
import { EventSchema, type GuardianEvent } from "@/integration/guardian/contracts";
import { RiskLabSnapshotSchema, type RiskLabSnapshot } from "@/modules/eth-risk/risk-lab";
import { RescueSessionSchema } from "@/domain/schemas";
import type { RescueSession } from "@/domain/types";

export const REPORT_SCHEMA = "xjy.risk-investigation-report/v1";
export const HASH_FORMAT = "sorted-json-utf8-v1";
const common = { schema: z.literal(REPORT_SCHEMA), capturedAt: z.iso.datetime(), analysisChainId: z.literal(1) };
const provenance = z.strictObject({ balancesAndExecution: z.enum(["MOCK", "LOCAL_ETHEREUM_FORK"]), investigationAndMarketChanges: z.literal("DEMO_INPUTS") });
export const ReportSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...common, kind: z.literal("GUARDIAN_EVENT"), dataMode: z.enum(["MOCK", "FORK"]),
    provenance, event: EventSchema }),
  z.strictObject({ ...common, kind: z.literal("GUARDIAN_SESSION"), dataMode: z.enum(["MOCK", "FORK"]), provenance, session: RescueSessionSchema }),
  z.strictObject({ ...common, kind: z.literal("ETH_RISK_LAB"), dataMode: z.enum(["MOCK_CHAIN_FIXTURE", "LIVE_CHAIN_READ"]), snapshot: RiskLabSnapshotSchema,
    policyDecision: z.null(), execution: z.null(), verification: z.null() }),
]).superRefine((r, context) => {
  if (r.kind !== "ETH_RISK_LAB" && r.provenance.balancesAndExecution !== (r.dataMode === "FORK" ? "LOCAL_ETHEREUM_FORK" : "MOCK")
    || r.kind === "ETH_RISK_LAB" && r.dataMode !== r.snapshot.dataMode) context.addIssue({ code: "custom", message: "Report provenance must match its source mode." });
});
export type RiskReport = z.infer<typeof ReportSchema>;
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
export const AnchorSchema = z.strictObject({ chainId: z.union([z.literal(968), z.literal(677)]), contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/), publisher: z.string().regex(/^0x[0-9a-fA-F]{40}$/), transactionHash: hash, timestamp: z.string().regex(/^\d+$/) });
export type ReportAnchor = z.infer<typeof AnchorSchema>;
export const EnvelopeSchema = z.strictObject({ format: z.literal(HASH_FORMAT), algorithm: z.literal("keccak256"), report: ReportSchema, reportHash: hash, anchor: AnchorSchema.optional() });
export type ReportEnvelope = z.infer<typeof EnvelopeSchema>;

/** UTF-16 sorted keys; ECMAScript JSON strings/numbers; array order preserved; no Unicode normalization. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Non-finite JSON number"); return JSON.stringify(value); }
  if (typeof value === "string") {
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw new Error("Unpaired Unicode surrogate");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error("Sparse or extended array");
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(key => `${canonicalJson(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw new Error("Only plain JSON values can be hashed");
}

export function reportHash(report: unknown) {
  ReportSchema.parse(report); // Validate, but hash the ORIGINAL: schema normalization must not hide edits.
  return keccak256(stringToHex(canonicalJson(report)));
}
export function exportReport(report: RiskReport, anchor?: ReportAnchor): ReportEnvelope {
  return { format: HASH_FORMAT, algorithm: "keccak256", report: structuredClone(report), reportHash: reportHash(report), ...(anchor ? { anchor } : {}) };
}
export function guardianReport(event: GuardianEvent, mode: "MOCK" | "FORK"): RiskReport {
  return ReportSchema.parse({ schema: REPORT_SCHEMA, kind: "GUARDIAN_EVENT", capturedAt: event.session?.execution.timestamp ?? event.createdAt, analysisChainId: 1,
    dataMode: mode, provenance: { balancesAndExecution: mode === "FORK" ? "LOCAL_ETHEREUM_FORK" : "MOCK", investigationAndMarketChanges: "DEMO_INPUTS" }, event: structuredClone(event) });
}
export function researchReport(snapshot: RiskLabSnapshot): RiskReport {
  return ReportSchema.parse({ schema: REPORT_SCHEMA, kind: "ETH_RISK_LAB", capturedAt: snapshot.asOf, analysisChainId: 1, dataMode: snapshot.dataMode,
    snapshot: structuredClone(snapshot), policyDecision: null, execution: null, verification: null });
}
export function guardianSessionReport(session: RescueSession, mode: "MOCK" | "FORK"): RiskReport {
  return ReportSchema.parse({ schema: REPORT_SCHEMA, kind: "GUARDIAN_SESSION", capturedAt: session.execution.timestamp, analysisChainId: 1, dataMode: mode,
    provenance: { balancesAndExecution: mode === "FORK" ? "LOCAL_ETHEREUM_FORK" : "MOCK", investigationAndMarketChanges: "DEMO_INPUTS" }, session: structuredClone(session) });
}

/** JSON parser with duplicate-key detection, retaining JSON.parse's numeric/string semantics. */
export function parseReportFile(text: string): { envelope: ReportEnvelope; computedHash: `0x${string}`; matches: boolean } {
  if (text.length > 2_000_000) throw new Error("Report exceeds the 2 MB limit.");
  let index = 0;
  const ws = () => { while (/\s/.test(text[index] ?? "") && index < text.length) index++; };
  const string = (): string => {
    const start = index++;
    while (index < text.length) { if (text[index] === "\\") index += 2; else if (text[index++] === '"') return JSON.parse(text.slice(start, index)); }
    throw new Error("Unterminated JSON string");
  };
  const visit = (depth: number): void => {
    if (depth > 80) throw new Error("JSON nesting too deep");
    ws(); const c = text[index];
    if (c === '"') { string(); return; }
    if (c === "{" || c === "[") {
      index++; ws(); const end = c === "{" ? "}" : "]", keys = new Set<string>();
      if (text[index] === end) { index++; return; }
      for (;;) {
        ws();
        if (c === "{") { if (text[index] !== '"') throw new Error("Invalid JSON key"); const key = string(); if (keys.has(key)) throw new Error("Duplicate JSON key"); keys.add(key); ws(); if (text[index++] !== ":") throw new Error("Invalid JSON object"); }
        visit(depth + 1); ws(); if (text[index] === end) { index++; return; } if (text[index++] !== ",") throw new Error("Invalid JSON separator");
      }
    }
    const start = index; while (index < text.length && !/[\s,\]}]/.test(text[index])) index++;
    if (index === start) throw new Error("Invalid JSON value"); JSON.parse(text.slice(start, index));
  };
  visit(0); ws(); if (index !== text.length) throw new Error("Trailing JSON data");
  const raw: unknown = JSON.parse(text);
  EnvelopeSchema.parse(raw);
  const envelope = raw as ReportEnvelope;
  const computedHash = reportHash(envelope.report);
  return { envelope, computedHash, matches: computedHash === envelope.reportHash };
}
