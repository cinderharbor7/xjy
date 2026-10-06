"use client";

import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { RescueSessionSchema } from "@/domain/schemas";
import type { RescueSession } from "@/domain/types";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Findings({ items }: { items: string[] }) {
  return items.length > 0 ? (
    <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
  ) : <p>None reported.</p>;
}

export default function DemoPage() {
  const [wallet, setWallet] = useState("0x1111111111111111111111111111111111111111");
  const [session, setSession] = useState<RescueSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSession(null);

    try {
      const response = await fetch("/api/rescue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet }),
      });
      if (!response.ok) {
        throw new Error(`Demo request failed (HTTP ${response.status}).`);
      }
      const parsed = RescueSessionSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error("The API response does not match the RescueSession contract.");
      }
      setSession(parsed.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The demo request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header>
        <p className="mock-banner">MOCK MODE · Simulated positions, investigation and transactions</p>
        <h1>DeFi Risk Rescue Agent</h1>
        <p>We don’t drive your portfolio. We protect it when things go wrong.</p>
        <p className="muted">Developer demo. No real wallet signatures or on-chain transactions.</p>
      </header>

      <form onSubmit={runDemo} aria-busy={loading}>
        <label htmlFor="wallet">Wallet address</label>
        <p id="wallet-help" className="muted">Any nonempty test wallet is accepted in Mock mode.</p>
        <div className="form-row">
          <input
            id="wallet"
            name="wallet"
            type="text"
            value={wallet}
            onChange={(event) => setWallet(event.target.value)}
            required
            disabled={loading}
            aria-describedby="wallet-help"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" disabled={loading || wallet.trim().length === 0}>
            {loading ? "Running Demo…" : "Run Demo"}
          </button>
        </div>
      </form>

      {loading && <p role="status">Running the rescue flow and reading the position again…</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {session && (
        <div className="session" aria-label="Rescue session results">
          <p className="wallet-result">Test wallet: <code>{session.before.wallet}</code></p>

          <section aria-labelledby="before-heading">
            <h2 id="before-heading">BEFORE</h2>
            <dl className="metrics">
              <Metric label="Collateral">{usd.format(session.before.collateralUsd)}</Metric>
              <Metric label="Debt">{usd.format(session.before.debtUsd)}</Metric>
              <Metric label="Health Factor">{session.before.healthFactor.toFixed(2)}</Metric>
              <Metric label="ETH Price">{usd.format(session.before.ethPrice)}</Metric>
            </dl>
          </section>

          <p className="flow-arrow" aria-hidden="true">↓</p>
          <section aria-labelledby="risk-heading">
            <h2 id="risk-heading">RISK ANALYSIS</h2>
            <dl className="metrics">
              <Metric label="Risk Score">{session.riskAnalysis.riskScore} / 100</Metric>
              <Metric label="Confidence">{(session.riskAnalysis.confidence * 100).toFixed(0)}%</Metric>
              <Metric label="Recommended Action">{session.riskAnalysis.recommendedAction}</Metric>
            </dl>
            <h3>Stress Tests</h3>
            <div className="table-container">
              <table>
                <thead><tr><th scope="col">ETH Change</th><th scope="col">Projected HF</th><th scope="col">Liquidation Risk</th></tr></thead>
                <tbody>
                  {session.riskAnalysis.stressTests.map((test, index) => (
                    <tr key={index}>
                      <td>{test.ethChangePct}%</td>
                      <td>{test.projectedHealthFactor.toFixed(2)}</td>
                      <td>{test.liquidationRisk ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Agent Investigation · Mock</h3>
            <p>{session.riskAnalysis.investigation.summary}</p>
            <p><strong>Primary Cause:</strong> {session.riskAnalysis.investigation.primaryCause}</p>
            <h3>Evidence</h3>
            <Findings items={session.riskAnalysis.investigation.evidence} />
            <h3>Uncertainty</h3>
            <Findings items={session.riskAnalysis.investigation.uncertainties} />
          </section>

          <p className="flow-arrow" aria-hidden="true">↓</p>
          <section aria-labelledby="policy-heading">
            <h2 id="policy-heading">POLICY</h2>
            <dl className="metrics">
              <Metric label="Decision">{session.policyDecision.triggered ? "Triggered" : "Not Triggered"}</Metric>
              <Metric label="Approved Action">{session.policyDecision.action}</Metric>
              <Metric label="Repay Amount">{usd.format(session.policyDecision.repayAmountUsd)}</Metric>
            </dl>
            <h3>Reasons</h3>
            <Findings items={session.policyDecision.reasons} />
          </section>

          <p className="flow-arrow" aria-hidden="true">↓</p>
          <section aria-labelledby="execution-heading">
            <h2 id="execution-heading">EXECUTION · MOCK</h2>
            {!session.policyDecision.triggered ? (
              <p>Skipped — Policy did not approve execution.</p>
            ) : (
              <>
                <p><strong>{session.execution.success ? "Success" : "Failed"}</strong> · Mock {session.execution.action} {usd.format(session.execution.amountUsd)}</p>
                {session.execution.error && <p className="error">{session.execution.error}</p>}
              </>
            )}
            {session.execution.txHash && (
              <p className="tx-hash"><strong>Tx Hash · Mock:</strong> <code>{session.execution.txHash}</code></p>
            )}
          </section>

          <p className="flow-arrow" aria-hidden="true">↓</p>
          <section aria-labelledby="after-heading">
            <h2 id="after-heading">AFTER</h2>
            {session.after ? (
              <>
                <p className="hf-change">HF {session.before.healthFactor.toFixed(2)} → {session.after.healthFactor.toFixed(2)}</p>
                <dl className="metrics">
                  <Metric label="Debt">{usd.format(session.after.debtUsd)}</Metric>
                  <Metric label="Health Factor">{session.after.healthFactor.toFixed(2)}</Metric>
                </dl>
                <p className={session.after.healthFactor > session.before.healthFactor ? "verified" : "error"}>
                  {session.after.healthFactor > session.before.healthFactor
                    ? "Verified from the position read after execution: Health Factor improved."
                    : "Position read after execution: Health Factor did not improve."}
                </p>
              </>
            ) : <p>No position read after execution: execution was skipped or failed.</p>}
          </section>
        </div>
      )}
    </main>
  );
}
