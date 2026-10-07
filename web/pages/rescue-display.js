import { esc, money, badge, list, table } from "../ui.js";
export function VerificationBadge({ verification }) {
  return badge(
    verification.status === "PASSED"
      ? "Verified after read"
      : verification.status === "FAILED"
        ? "Verification failed"
        : "Verification skipped",
    verification.status === "PASSED"
      ? "good"
      : verification.status === "FAILED"
        ? "warn"
        : "",
  );
}
export function VerificationDetails({ verification }) {
  return `<div class="verification-details"><h3>独立结果核验 · ${esc(verification.status)}</h3><p>${verification.status === "PASSED" ? "The independent re-read confirms the approved swap and reduced risk exposure." : verification.status === "FAILED" ? "Execution completed, but the re-read did not verify the approved outcome. Do not claim protection succeeded." : "No completed swap is being claimed; independent outcome verification was skipped."}</p>${list(verification.reasons)}</div>`;
}
export function ExecutionBadge({ execution, pending = false }) {
  const unknown = pending || execution.error?.startsWith("SUBMITTED_UNKNOWN:");
  return badge(
    unknown
      ? "Pending receipt"
      : execution.success
        ? "Success"
        : execution.action !== "NONE"
          ? "Failed"
          : "Skipped",
    unknown ? "warn" : execution.success ? "good" : "",
  );
}
export function StressChart({ tests, baselineUsd }) {
  if (!tests.length) return "<p>No stress scenarios returned.</p>";
  const points = tests.map((test, i) => ({
    x: tests.length === 1 ? 350 : 58 + (i * 580) / (tests.length - 1),
    y:
      152 -
      (baselineUsd > 0
        ? Math.max(0, Math.min(1, test.projectedPortfolioUsd / baselineUsd))
        : 0) *
        124,
  }));
  return `${baselineUsd > 0 ? `<svg class="research-chart" viewBox="0 0 690 190" role="img" aria-label="压力情景相对 Before 组合价值的百分比">${[28, 90, 152].map((y, i) => `<line x1="42" y1="${y}" x2="650" y2="${y}"/><text x="4" y="${y + 4}">${100 - i * 50}%</text>`).join("")}<polyline points="${points.map((p) => `${p.x},${p.y}`).join(" ")}"/>${tests.map((t, i) => `<circle cx="${points[i].x}" cy="${points[i].y}" r="4"/><text x="${points[i].x - 18}" y="178">${esc(t.priceChangePct)}%</text>`).join("")}</svg>` : ""}<p class="note">Before snapshot: ${money(baselineUsd)}</p>${table(
    ["ETH shock", "Projected value", "Projected loss"],
    tests.map((t) => [
      `${esc(t.priceChangePct)}%`,
      money(t.projectedPortfolioUsd),
      money(t.projectedLossUsd),
    ]),
  )}`;
}
