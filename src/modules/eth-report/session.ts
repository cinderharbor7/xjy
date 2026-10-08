import { z } from "zod";
import { SnapshotSchema, WindowSchema, GroupSchema, ReportSubmissionSchema, validateSubmission, INDICATOR_DEFINITIONS, type Snapshot } from "./contracts";

export const TOOL_INPUTS = {
  create_eth_snapshot: WindowSchema,
  get_eth_snapshot: z.strictObject({ snapshotId: z.uuid() }),
  get_eth_indicator_definitions: z.strictObject({}),
  get_eth_evidence: z.strictObject({ snapshotId: z.uuid(), group: GroupSchema }),
  submit_eth_report: ReportSubmissionSchema,
  get_eth_report: z.strictObject({ reportId: z.uuid() }),
};
export type ToolName = keyof typeof TOOL_INPUTS;
export type AcceptedReport = { version: 1; reportId: string; acceptedAt: string; origin: "EXTERNAL_AGENT"; validation: "STRUCTURE_AND_REFERENCES_ONLY"; analysis: z.infer<typeof ReportSubmissionSchema>; snapshot: Snapshot; indicatorDefinitions: typeof INDICATOR_DEFINITIONS };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** One page, one active snapshot. Nothing persists or grants trading authority. */
export class ReportSession {
  private alive = true;
  private busy = false;
  private snapshot: Snapshot | null = null;
  private report: AcceptedReport | null = null;
  constructor(private collect: (days: 1 | 7) => Promise<unknown>, private onChange: () => void = () => {}) {}
  get state() { return copy({ busy: this.busy, snapshot: this.snapshot, report: this.report }); }
  dispose() { this.alive = false; this.snapshot = null; this.report = null; }
  private active() { if (!this.alive) throw new Error("SESSION_CLOSED"); }
  private matching(id: string) {
    this.active();
    if (this.busy) throw new Error("SNAPSHOT_BUSY");
    if (!this.snapshot || this.snapshot.snapshotId !== id) throw new Error("SNAPSHOT_MISMATCH");
    return this.snapshot;
  }
  async call(name: ToolName, input: unknown): Promise<unknown> {
    this.active();
    if (!(name in TOOL_INPUTS)) throw new Error("UNKNOWN_TOOL");
    // Validate in execute too: browser discovery metadata is not an authorization boundary.
    const args: any = TOOL_INPUTS[name].parse(input);
    if (name === "get_eth_indicator_definitions") return copy(INDICATOR_DEFINITIONS);
    if (name === "create_eth_snapshot") {
      if (this.busy) throw new Error("SNAPSHOT_BUSY");
      this.busy = true; this.snapshot = null; this.report = null; this.onChange();
      try {
        const snapshot = SnapshotSchema.parse(await this.collect(args.windowDays));
        this.active();
        if (snapshot.windowDays !== args.windowDays) throw new Error("WINDOW_MISMATCH");
        this.snapshot = snapshot;
        return copy(snapshot);
      } finally {
        this.busy = false;
        if (this.alive) this.onChange();
      }
    }
    if (name === "get_eth_report") {
      if (this.busy) throw new Error("SNAPSHOT_BUSY");
      if (!this.report || this.report.reportId !== args.reportId) throw new Error("REPORT_NOT_FOUND");
      return copy(this.report);
    }
    const snapshot = this.matching(args.snapshotId);
    if (name === "get_eth_snapshot") return copy(snapshot);
    if (name === "get_eth_evidence") return copy(snapshot.evidence.filter((e) => e.group === args.group));
    const analysis = validateSubmission(args, snapshot);
    if (this.report) {
      if (JSON.stringify(analysis) !== JSON.stringify(this.report.analysis)) throw new Error("REPORT_ALREADY_SUBMITTED");
      return copy(this.report);
    }
    this.report = { version: 1, reportId: crypto.randomUUID(), acceptedAt: new Date().toISOString(), origin: "EXTERNAL_AGENT", validation: "STRUCTURE_AND_REFERENCES_ONLY", analysis, snapshot: copy(snapshot), indicatorDefinitions: copy(INDICATOR_DEFINITIONS) };
    this.onChange();
    return copy(this.report);
  }
}
