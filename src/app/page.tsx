"use client";

import { useState } from "react";
import Link from "next/link";
import type { FormEvent, ReactNode } from "react";
import { RescueProblemSchema, RescueSessionSchema } from "@/domain/schemas";
import type { PortfolioState, RescueSession } from "@/domain/types";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const amount = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

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

function Portfolio({ portfolio }: { portfolio: PortfolioState }) {
  return (
    <>
      <div className="table-container">
        <table>
          <thead>
            <tr><th scope="col">Asset</th><th scope="col">Balance</th><th scope="col">Value</th><th scope="col">Category</th></tr>
          </thead>
          <tbody>
            {portfolio.assets.map((asset) => (
              <tr key={asset.symbol}>
                <td>{asset.symbol}</td>
                <td>{amount.format(asset.amount)} {asset.symbol}</td>
                <td>{usd.format(asset.usdValue)}</td>
                <td>{asset.category === "RISK" ? "Risk asset" : "User-approved defensive asset"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="metrics">
        <Metric label="Total Value">{usd.format(portfolio.totalUsd)}</Metric>
        <Metric label="Risk Asset Value">{usd.format(portfolio.riskAssetUsd)}</Metric>
        <Metric label="Defensive Asset Value">{usd.format(portfolio.defensiveAssetUsd)}</Metric>
        <Metric label="Risk Exposure">{percent.format(portfolio.riskExposurePct)}%</Metric>
      </dl>
      <p className="muted">Portfolio read: <time dateTime={portfolio.timestamp}>{portfolio.timestamp}</time></p>
      {portfolio.blockNumber !== undefined && <p className="muted">Block: {portfolio.blockNumber}</p>}
    </>
  );
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
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("The API returned an unreadable response.");
      }
      if (!response.ok) {
        const problem = RescueProblemSchema.safeParse(payload);
        throw new Error(problem.success && problem.data.status === response.status
          ? problem.data.detail
          : `Demo request failed (HTTP ${response.status}).`);
      }
      const parsed = RescueSessionSchema.safeParse(payload);
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

  const initialMarketAsset = session?.before.assets.find((asset) => asset.symbol === session.market.asset);
  const initialPrice = initialMarketAsset && initialMarketAsset.amount > 0
    ? initialMarketAsset.usdValue / initialMarketAsset.amount
    : undefined;

  return (
    <main>
      <header>
        <p className="mock-banner">MOCK MODE · Simulated portfolio, market, investigation and swaps</p>
        <h1>Autonomous On-chain Risk Guardian</h1>
        <p>We don’t drive your portfolio. We protect it when things go wrong.</p>
        <p>Humans decide when to take risk. The system only helps reduce it.</p>
        <p className="muted">Developer demo. No real wallet signatures or on-chain transactions.</p>
        <p className="muted">Automatic permission: RISK → user-approved DEFENSIVE only. No automatic re-entry.</p>
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

      {loading && <p role="status">Running the guardian flow and independently reading the portfolio again…</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {session && (
        <div className="session" aria-label="Rescue session results">
          <p className="wallet-result">Test wallet: <code>{session.before.wallet}</code></p>

          <section aria-labelledby="before-heading">
            <h2 id="before-heading">PORTFOLIO BEFORE · INITIAL</h2>
            <Portfolio portfolio={session.before} />
          </section>

          <p className="flow-arrow" aria-hidden="true">↓</p>
          <section aria-labelledby="market-heading">
            <h2 id="market-heading">SIMULATED MARKET SHOCK</h2>
            <dl className="metrics">
              <Metric label={`${session.market.asset} Price`}>
                {initialPrice !== undefined && <>{usd.format(initialPrice)} → </>}{usd.format(session.market.priceUsd)}
              </Metric>
              <Metric label="5-minute Price Change">{percent.format(session.market.priceChange5mPct)}%</Metric>
              <Metric label="1-hour Price Change">{percent.format(session.market.priceChange1hPct)}%</Metric>
              <Metric label="Volatility Score">{session.market.volatilityScore} / 100</Metric>
            </dl>
            <p>The initial valuation precedes this market shock. The Demo swap uses the shocked market price.</p>
            <p className="muted">Market observation: <time dateTime={session.market.timestamp}>{session.market.timestamp}</time></p>
          </section>

          <p className="flow-arrow" aria-hidden="true">↓</p>
          <section aria-labelledby="risk-heading">
            <h2 id="risk-heading">RISK ANALYSIS</h2>
            <dl className="metrics">
              <Metric label="Risk Score">{session.riskAnalysis.riskScore} / 100</Metric>
              <Metric label="Confidence">{(session.riskAnalysis.confidence * 100).toFixed(0)}%</Metric>
              <Metric label="Risk Exposure">{percent.format(session.riskAnalysis.riskExposurePct)}%</Metric>
              <Metric label="Recommended Action">{session.riskAnalysis.recommendedAction}</Metric>
            </dl>
            <h3>Stress Tests · Initial portfolio valuation</h3>
            <p className="muted">These hypothetical shocks use the independently read initial portfolio as their baseline.</p>
            <div className="table-container">
              <table>
                <thead><tr><th scope="col">Price Change</th><th scope="col">Projected Portfolio Value</th><th scope="col">Projected Loss</th></tr></thead>
                <tbody>
                  {session.riskAnalysis.stressTests.map((test, index) => (
                    <tr key={index}>
                      <td>{percent.format(test.priceChangePct)}%</td>
                      <td>{usd.format(test.projectedPortfolioUsd)}</td>
                      <td>{usd.format(test.projectedLossUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Agent Investigation · Mock</h3>
            <p>{session.riskAnalysis.investigation.summary}</p>
            <p><strong>Primary Cause:</strong> {session.riskAnalysis.investigation.primaryCause}</p>
            <p className="muted">The Agent explains risk. Policy approves execution.</p>
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
              {session.policyDecision.triggered && (
                <>
                  <Metric label="Approved Direction">{session.policyDecision.sourceAsset} → {session.policyDecision.targetAsset}</Metric>
                  <Metric label="Exposure Reduction">{percent.format(session.policyDecision.reduceExposurePct!)} percentage points</Metric>
                </>
              )}
            </dl>
            <h3>Reasons</h3>
            <Findings items={session.policyDecision.reasons} />
            <p className="muted">USDC is the Demo user’s approved defensive asset.</p>
          </section>

          <p className="flow-arrow" aria-hidden="true">↓</p>
          <section aria-labelledby="execution-heading">
            <h2 id="execution-heading">ACTION · MOCK</h2>
            {!session.policyDecision.triggered ? (
              <p>Skipped — Policy did not approve execution.</p>
            ) : (
              <>
                <p><strong>{session.execution.success ? "Success" : "Failed"}</strong> · Mock {session.execution.action}</p>
                {session.execution.success && (
                  <p><strong>{amount.format(session.execution.sourceAmount!)} {session.execution.sourceAsset} → {amount.format(session.execution.targetAmount!)} {session.execution.targetAsset}</strong></p>
                )}
                {session.execution.error && <p className="error">{session.execution.error}</p>}
              </>
            )}
            {session.execution.txHash && (
              <p className="tx-hash"><strong>Tx Hash · Mock:</strong> <code>{session.execution.txHash}</code></p>
            )}
            <p className="muted">Demo assumption: USDC = $1; swap fees and slippage are omitted.</p>
          </section>

          <p className="flow-arrow" aria-hidden="true">↓</p>
          <section aria-labelledby="after-heading">
            <h2 id="after-heading">PORTFOLIO AFTER · INDEPENDENT RE-READ</h2>
            {session.after ? (
              <>
                <p><strong>Risk Exposure: {percent.format(session.before.riskExposurePct)}% → {percent.format(session.after.riskExposurePct)}%</strong></p>
                <Portfolio portfolio={session.after} />
                {session.verification.status === "PASSED" && (
                  <p>{usd.format(session.before.totalUsd)} → {usd.format(session.after.totalUsd)} reflects the simulated market shock. The Demo swap exchanges equal value at that shocked price.</p>
                )}
              </>
            ) : <p>No portfolio read after execution: execution was skipped or failed.</p>}
            <p className={session.verification.status === "PASSED" ? "verified" : session.verification.status === "FAILED" ? "error" : "muted"}>
              <strong>Risk reduction verification: {session.verification.status}</strong>
            </p>
            <Findings items={session.verification.reasons} />
            <p>The session stops here. No automatic swap from defensive assets back to risk assets.</p>
          </section>
        </div>
      )}

      <p className="muted"><Link href="/position">Optional Aave extension · Read only</Link>. Separate from the Guardian Mock flow.</p>
    </main>
  );
}
