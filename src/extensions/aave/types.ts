import type { z } from "zod";
import type { AavePositionStateSchema, PositionEvidenceSchema, PositionMarketChangesSchema, PositionSnapshotSchema, PositionProblemSchema } from "./schemas";

export type AavePositionState = z.infer<typeof AavePositionStateSchema>;
export type PositionEvidence = z.infer<typeof PositionEvidenceSchema>;
export type PositionMarketChanges = z.infer<typeof PositionMarketChangesSchema>;
export type PositionSnapshot = z.infer<typeof PositionSnapshotSchema>;
export type PositionProblem = z.infer<typeof PositionProblemSchema>;
