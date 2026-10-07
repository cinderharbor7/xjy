import type { ExecutionResult, StressTestResult, VerificationResult } from "@/domain/types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function VerificationBadge({ verification }: { verification: VerificationResult }) {
  const tone = verification.status === "PASSED" ? "success" : verification.status === "FAILED" ? "warning" : "neutral";
  const label = verification.status === "PASSED" ? "Verified after read" : verification.status === "FAILED" ? "Verification failed" : "Verification skipped";
  return <span className={`status-pill ${tone}`}><span className="status-dot" />{label}</span>;
}

export function VerificationDetails({ verification }: { verification: VerificationResult }) {
  return <div className="verification-details">
    <h3>Independent verification · {verification.status}</h3>
    <p>{verification.status === "PASSED"
      ? "The independent re-read confirms the approved swap and reduced risk exposure."
      : verification.status === "FAILED"
        ? "Execution completed, but the re-read did not verify the approved outcome. Do not claim protection succeeded."
        : "No completed swap is being claimed; independent outcome verification was skipped."}</p>
    <ul>{verification.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
  </div>;
}

export function ExecutionBadge({ execution }: { execution: ExecutionResult }) {
  const failed = !execution.success && execution.action !== "NONE";
  return <span className={`status-pill ${execution.success ? "success" : failed ? "warning" : "neutral"}`}>
    <span className="status-dot" />{execution.success ? "Success" : failed ? "Failed" : "Skipped"}
  </span>;
}

export function StressChart({ tests, baselineUsd }: { tests: StressTestResult[]; baselineUsd: number }) {
  if (!tests.length) return <p className="muted-on-dark">No stress scenarios returned.</p>;
  // Chart and table both use the actual before snapshot, not the best stress scenario.
  const points = tests.map((test, index) => ({
    x: tests.length === 1 ? 350 : 58 + index * 580 / (tests.length - 1),
    y: 152 - (baselineUsd > 0 ? Math.max(0, Math.min(1, test.projectedPortfolioUsd / baselineUsd)) : 0) * 124,
  }));
  return <>
    {baselineUsd > 0 && <div className="stress-chart"><svg viewBox="0 0 690 190" role="img" aria-label="Projected portfolio value as a percentage of the before snapshot">
      <line x1="42" y1="28" x2="650" y2="28" className="grid-line" />
      <line x1="42" y1="90" x2="650" y2="90" className="grid-line" />
      <line x1="42" y1="152" x2="650" y2="152" className="grid-line" />
      <text x="7" y="32">100%</text><text x="7" y="94">50%</text><text x="7" y="156">0%</text>
      <polyline points={points.map(({ x, y }) => `${x},${y}`).join(" ")} className="stress-line" />
      {tests.map((test, index) => <g key={test.priceChangePct}>
        <circle cx={points[index].x} cy={points[index].y} r="5" className="stress-dot"><title>{usd.format(test.projectedPortfolioUsd)}</title></circle>
        <text x={points[index].x - 20} y="178">ETH {test.priceChangePct}%</text>
      </g>)}
    </svg></div>}
    <div className="stress-values"><table><caption>Before snapshot: {usd.format(baselineUsd)}</caption>
      <thead><tr><th scope="col">ETH shock</th><th scope="col">Projected value</th><th scope="col">Projected loss</th></tr></thead>
      <tbody>{tests.map(test => <tr key={test.priceChangePct}><td>{test.priceChangePct}%</td><td>{usd.format(test.projectedPortfolioUsd)}</td><td>{usd.format(test.projectedLossUsd)}</td></tr>)}</tbody>
    </table></div>
  </>;
}
