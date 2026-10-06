"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  PositionProblemSchema,
  PositionQuerySchema,
  PositionSnapshotSchema,
} from "@/extensions/aave/schemas";
import type { PositionSnapshot } from "@/extensions/aave/types";

const testWallet = "0x485c028c475dba482297656229d11b4eaf22357b";
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function ExplorerLink({ kind, value }: { kind: "address" | "block" | "tx"; value: string }) {
  return (
    <a href={`https://etherscan.io/${kind}/${value}`} target="_blank" rel="noopener noreferrer">
      <code>{value}</code>
    </a>
  );
}

export default function PositionPage() {
  const [wallet, setWallet] = useState(testWallet);
  const [snapshot, setSnapshot] = useState<PositionSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSnapshot(null);

    const query = PositionQuerySchema.safeParse({ wallet });
    if (!query.success) {
      setError("Enter a valid Ethereum address: 0x followed by 40 hexadecimal characters.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query.data),
      });

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        setError(`The position API returned invalid JSON (HTTP ${response.status}).`);
        return;
      }

      if (!response.ok) {
        const problem = PositionProblemSchema.safeParse(body);
        setError(problem.success && problem.data.status === response.status
          ? `${problem.data.title}: ${problem.data.detail}`
          : `The position API returned an invalid error response (HTTP ${response.status}).`);
        return;
      }

      const result = PositionSnapshotSchema.safeParse(body);
      if (!result.success) {
        setError("The position API response does not match the PositionSnapshot contract.");
        return;
      }
      setSnapshot(result.data);
    } catch {
      setError("Could not reach the position API. Check that the app is running and your network is available.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header>
        <p className="mock-banner">Optional Aave Extension · Ethereum Mainnet · Aave V3 Core · LIVE / READ ONLY</p>
        <h1>Aave Position Reader · Optional Extension</h1>
        <p>Load a wallet’s borrowed position from Aave, with prices and evidence from the same block.</p>
        <p className="muted">Read-only queries. No wallet connection, signatures or transactions.</p>
        <p><Link href="/">Back to Guardian Mock Demo</Link></p>
      </header>

      <form onSubmit={loadPosition} aria-busy={loading}>
        <label htmlFor="wallet">Wallet address</label>
        <p id="wallet-help" className="muted">
          Enter an Ethereum address. The prefilled public test wallet has verified Borrow evidence;
          its current position can change.
        </p>
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
            aria-invalid={error !== null && !PositionQuerySchema.safeParse({ wallet }).success}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" disabled={loading || wallet.trim().length === 0}>
            {loading ? "Loading Position…" : "Load Position"}
          </button>
        </div>
      </form>

      {loading && <p role="status">Reading the Aave position and oracle prices from Ethereum…</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {snapshot && (
        <div aria-label="Live Aave position results">
          <p className="wallet-result">
            Wallet: <ExplorerLink kind="address" value={snapshot.wallet} />
          </p>
          <p role="status">Live read complete · {snapshot.status}</p>

          <section aria-labelledby="position-heading">
            <h2 id="position-heading">POSITION · LIVE</h2>
            {snapshot.status === "ACTIVE" ? (
              <>
                <dl className="metrics">
                  <Metric label="Collateral USD">{usd.format(snapshot.position.collateralUsd)}</Metric>
                  <Metric label="Debt USD">{usd.format(snapshot.position.debtUsd)}</Metric>
                  <Metric label="Health Factor">{snapshot.position.healthFactor.toFixed(4)}</Metric>
                  <Metric label="ETH Price · Aave Oracle">{usd.format(snapshot.position.ethPrice)}</Metric>
                </dl>
                <p className="muted">Collateral includes only assets enabled as collateral in Aave; it is not the wallet balance.</p>
                <p>Block timestamp: <time dateTime={snapshot.position.timestamp}>{snapshot.position.timestamp}</time></p>
              </>
            ) : (
              <p>No borrowed debt. Health Factor is not applicable.</p>
            )}
          </section>

          {snapshot.status === "ACTIVE" && (
            <>
              <p className="flow-arrow" aria-hidden="true">↓</p>
              <section aria-labelledby="market-heading">
                <h2 id="market-heading">ETH ORACLE PRICE CHANGE</h2>
                <dl className="metrics">
                  <Metric label="ETH Change">
                    {snapshot.marketChanges.ethChangePct > 0 ? "+" : ""}{snapshot.marketChanges.ethChangePct.toFixed(4)}%
                  </Metric>
                  <Metric label="Reference ETH Price">{usd.format(snapshot.marketChanges.previousEthPrice)}</Metric>
                  <Metric label="Window">{snapshot.marketChanges.lookbackBlocks.toLocaleString("en-US")} blocks</Metric>
                  <Metric label="Actual Duration">
                    {snapshot.marketChanges.lookbackSeconds.toLocaleString("en-US")} seconds
                    {" "}({(snapshot.marketChanges.lookbackSeconds / 3600).toFixed(2)} hours)
                  </Metric>
                </dl>
                <p className="muted">The window follows actual block timestamps; it is not an exact 24-hour change.</p>
                <p>From: <time dateTime={snapshot.marketChanges.referenceTimestamp}>{snapshot.marketChanges.referenceTimestamp}</time></p>
                <p>To: <time dateTime={snapshot.evidence.blockTimestamp}>{snapshot.evidence.blockTimestamp}</time></p>
                <p className="wallet-result">
                  Reference block: <ExplorerLink kind="block" value={String(snapshot.marketChanges.referenceBlockNumber)} />
                  <br />Reference block hash: <code>{snapshot.marketChanges.referenceBlockHash}</code>
                  <br />Reference oracle: <ExplorerLink kind="address" value={snapshot.marketChanges.referenceOracleAddress} />
                </p>
              </section>
            </>
          )}

          <p className="flow-arrow" aria-hidden="true">↓</p>
          <section aria-labelledby="evidence-heading">
            <h2 id="evidence-heading">CHAIN EVIDENCE</h2>
            <p>Ethereum Mainnet · Chain ID {snapshot.evidence.chainId} · Aave V3 Core</p>
            <ul className="wallet-result">
              <li>Wallet: <ExplorerLink kind="address" value={snapshot.wallet} /></li>
              <li>Addresses Provider: <ExplorerLink kind="address" value={snapshot.evidence.providerAddress} /></li>
              <li>Aave Pool: <ExplorerLink kind="address" value={snapshot.evidence.poolAddress} /></li>
              <li>Aave Oracle: <ExplorerLink kind="address" value={snapshot.evidence.oracleAddress} /></li>
              <li>ETH Price Asset · WETH: <ExplorerLink kind="address" value={snapshot.evidence.ethAssetAddress} /></li>
              <li>Block: <ExplorerLink kind="block" value={String(snapshot.evidence.blockNumber)} /></li>
              <li>Block hash: <code>{snapshot.evidence.blockHash}</code></li>
              <li>Block timestamp: <time dateTime={snapshot.evidence.blockTimestamp}>{snapshot.evidence.blockTimestamp}</time></li>
              {snapshot.evidence.txHash && (
                <li>Transaction evidence: <ExplorerLink kind="tx" value={snapshot.evidence.txHash} /></li>
              )}
            </ul>
            <p className="muted">This read does not create a transaction or a transaction hash.</p>
          </section>

          {snapshot.status === "ACTIVE" && (
            <>
              <p className="flow-arrow" aria-hidden="true">↓</p>
              <section aria-labelledby="json-heading">
                <h2 id="json-heading">AavePositionState JSON</h2>
                <p className="muted">An Aave-specific camelCase contract for this optional reader.</p>
                <div className="table-container"><pre><code>{JSON.stringify(snapshot.position, null, 2)}</code></pre></div>
              </section>
            </>
          )}
        </div>
      )}
    </main>
  );
}
