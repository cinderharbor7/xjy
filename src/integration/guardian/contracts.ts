import { z } from "zod";
import { PolicyConfigSchema, RescueSessionSchema, PortfolioStateSchema, MarketStateSchema, RiskAnalysisSchema, PolicyDecisionSchema } from "@/domain/schemas";

// D-owned envelopes; the shared A/B/C domain contracts remain unchanged.
export const AnalysisSchema = z.strictObject({ before: PortfolioStateSchema, market: MarketStateSchema, riskAnalysis: RiskAnalysisSchema, policyDecision: PolicyDecisionSchema });
export type Analysis = z.infer<typeof AnalysisSchema>;
export const ModeSchema = z.enum(["MOCK", "FORK"]);
export const PolicyPutSchema = z.strictObject({ wallet: z.string().trim().min(1), config: z.unknown(), version: z.number().int().positive() });
export const MonitorCommandSchema = z.strictObject({ wallet: z.string().trim().min(1), command: z.enum(["start", "pause"]) });
export const Recovery = Object.freeze({ intervalMs: 10_000, maxAgeMs: 30_000, consecutive: 3, maxVolatility: 40, minChange5m: -0.5, minChange1h: -2 });
export const SubmissionSchema = z.strictObject({ kind: z.enum(["APPROVE", "SWAP"]), hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/), timestamp: z.iso.datetime() });
export const EventSchema = z.strictObject({
  id: z.string(), createdAt: z.iso.datetime(), closedAt: z.iso.datetime().optional(),
  status: z.enum(["RESERVED", "SUBMITTED_UNKNOWN", "CONFIRMED", "FAILED", "REVIEW"]),
  config: PolicyConfigSchema, version: z.number().int(), analysis: AnalysisSchema,
  submissions: z.array(SubmissionSchema), session: RescueSessionSchema.optional(), note: z.string(),
});
export type GuardianEvent = z.infer<typeof EventSchema>;
export const StateSchema = z.strictObject({
  wallet: z.string(), mode: ModeSchema, config: PolicyConfigSchema, version: z.number().int().positive(),
  enabled: z.boolean(), halted: z.boolean(), activeEvent: z.string().optional(), recoveryCount: z.number().int().nonnegative(),
  lastMarketAt: z.string().optional(), lastTickAt: z.string().optional(), lastError: z.string().optional(),
  latestAnalysis: AnalysisSchema.optional(), latestSession: RescueSessionSchema.optional(),
  lease: z.strictObject({ token: z.string(), expires: z.number() }).optional(),
  networkIdentity: z.string().optional(),
});
export type GuardianState = z.infer<typeof StateSchema>;
export const PolicyResponseSchema = z.strictObject({ wallet: z.string(), mode: ModeSchema, config: PolicyConfigSchema, version: z.number().int(), supportedRiskAssets: z.array(z.string()), supportedDefensiveAssets: z.array(z.string()) });
export const StatusResponseSchema = z.strictObject({
  wallet: z.string(), mode: ModeSchema, enabled: z.boolean(), halted: z.boolean(), busy: z.boolean(),
  recoveryCount: z.number(), recovery: z.object({ intervalMs: z.number(), maxAgeMs: z.number(), consecutive: z.number(), maxVolatility: z.number(), minChange5m: z.number(), minChange1h: z.number() }),
  lastTickAt: z.string().optional(), lastError: z.string().optional(), latestAnalysis: AnalysisSchema.optional(), latestSession: RescueSessionSchema.optional(),
  events: z.array(EventSchema), activeEvent: z.string().optional(), sources: z.string(),
});
export type MonitorStatus = z.infer<typeof StatusResponseSchema>;
export const GuardianProblemSchema = z.strictObject({ type: z.string(), title: z.string(), status: z.number().int(), code: z.string(), detail: z.string(), instance: z.string() });
const guardianErrorTag = Symbol.for("xjy.guardian.control-error");
export class GuardianError extends Error {
  readonly [guardianErrorTag] = true;
  constructor(readonly status: number, readonly code: string, detail: string) { super(detail); }
}
// Instrumentation and Route Handlers can load separate bundles of this class.
// Preserve the trusted error boundary without relying on constructor identity.
export function isGuardianError(error: unknown): error is GuardianError {
  return error instanceof Error && guardianErrorTag in error && error[guardianErrorTag] === true;
}
