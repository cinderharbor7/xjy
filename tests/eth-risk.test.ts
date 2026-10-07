import { describe, expect, it } from "vitest";
import { getRiskLabSnapshot, RiskLabSnapshotSchema } from "@/modules/eth-risk/risk-lab";
import { GET } from "@/app/api/eth-risk/route";

describe("ETH risk lab fixture", () => {
  it("serves a validated mock response without caching or implying live reads", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Risk-Mode")).toBe("MOCK_CHAIN_FIXTURE");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(RiskLabSnapshotSchema.parse(await response.json()).dataMode).toBe("MOCK_CHAIN_FIXTURE");
  });
  it("returns a schema-valid snapshot with auditable chain evidence", () => {
    const snapshot = getRiskLabSnapshot();
    expect(RiskLabSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.asset).toBe("ETH");
    expect(snapshot.dataMode).toBe("MOCK_CHAIN_FIXTURE");
    expect(snapshot.blockRange.from).toBeLessThan(snapshot.blockRange.to);
    expect(snapshot.evidence.some((item) => item.status === "LIMITATION")).toBe(true);
  });

  it("keeps composite confidence separate from the composite score", () => {
    const snapshot = getRiskLabSnapshot();
    expect(snapshot.composite.score).toBeGreaterThan(65);
    expect(snapshot.composite.score).toBeLessThanOrEqual(100);
    expect(snapshot.composite.confidence).toBeGreaterThan(0);
    expect(snapshot.composite.confidence).toBeLessThan(1);
    expect(snapshot.models).toHaveLength(5);
    expect(snapshot.models.every((model) => model.score >= 0 && model.score <= 100)).toBe(true);
  });

  it("makes the recommendation traceable to a risk budget", () => {
    const snapshot = getRiskLabSnapshot();
    expect(snapshot.recommendation.stance).toBe("DEFENSIVE");
    expect(snapshot.recommendation.targetExposurePct).toBeLessThan(snapshot.recommendation.currentExposurePct);
    expect(snapshot.recommendation.action).toContain("Reduce ETH exposure");
    expect(snapshot.recommendation.confidence).toBe(snapshot.composite.confidence);
  });
});
