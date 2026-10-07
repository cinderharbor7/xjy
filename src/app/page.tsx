"use client";

import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { RescueSessionSchema } from "@/domain/schemas";
import type { RescueSession } from "@/domain/types";
import { ExecutionBadge, StressChart, VerificationBadge, VerificationDetails } from "./rescue-display";

import { GuardianControls } from "./guardian-controls";
import { GuardianProblemSchema, type MonitorStatus } from "@/integration/guardian/contracts";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function Icon({ name, size = 18 }: { name: "mark" | "arrow" | "back" | "shield" | "activity" | "check" | "warning"; size?: number }) {
  const paths = {
    mark: <><circle cx="12" cy="12" r="8.2" /><path d="m12 7.5 4.5 4.5-4.5 4.5L7.5 12 12 7.5Z" opacity=".45" /></>,
    arrow: <><path d="M5 12h13" /><path d="m13 7 5 5-5 5" /></>,
    back: <><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></>,
    shield: <><path d="M12 3.5 19 6v5.3c0 4.2-2.4 7.4-7 9.2-4.6-1.8-7-5-7-9.2V6l7-2.5Z" /><path d="m9 12 2 2 4-4" /></>,
    activity: <><path d="M3 12h4l2.2-5 4.1 10 2.4-5H21" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    warning: <><path d="M12 4 21 19H3L12 4Z" /><path d="M12 9v4" /><path d="M12 16h.01" /></>,
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Metric({ label, value, note, tone = "" }: { label: string; value: ReactNode; note?: string; tone?: string }) {
  return <div className="metric"><dt>{label}</dt><dd className={tone}>{value}</dd>{note && <span>{note}</span>}</div>;
}

function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" | "success" }) {
  return <span className={`status-pill ${tone}`}><span className="status-dot" />{children}</span>;
}

function assetValue(portfolio: RescueSession["before"], symbol: string) {
  return portfolio.assets.find((asset) => asset.symbol === symbol)?.usdValue ?? 0;
}

function EmptyState({ onRun }: { onRun: () => void }) {
  return <section className="empty-state"><div className="empty-orb"><Icon name="activity" size={28} /></div><p className="eyebrow">Guardian observation</p><h2>Read the position before you touch it.</h2><p>The server-bound wallet follows the complete rescue loop: read, stress test, investigate, approve, execute, then read again.</p><button className="primary-button" onClick={onRun}>Run the first reading <Icon name="arrow" size={17} /></button></section>;
}

function Findings({ title, items, tone = "" }: { title: string; items: string[]; tone?: string }) {
  return <div className={`finding-block ${tone}`}><h3>{title}</h3>{items.length ? <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="muted">None reported.</p>}</div>;
}

export default function DemoPage() {
  const [wallet, setWallet] = useState("0x1111111111111111111111111111111111111111");
  const [session, setSession] = useState<RescueSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [monitor, setMonitor] = useState<MonitorStatus>();
  useEffect(() => { if (monitor) { setWallet(monitor.wallet); if (monitor.latestSession) setSession(monitor.latestSession); } }, [monitor]);
  const mode = monitor?.mode ?? "Connecting";

  async function runDemo(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (loading || !wallet.trim() || !monitor || monitor.halted) return;
    setLoading(true); setError(null); setSession(null);
    try {
      const response = await fetch("/api/rescue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet }) });
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error("The API returned an unreadable response."); }
      if (!response.ok) {
        const problem = GuardianProblemSchema.safeParse(payload);
        throw new Error(problem.success && problem.data.status === response.status ? problem.data.detail : `Demo request failed (HTTP ${response.status}).`);
      }
      const parsed = RescueSessionSchema.safeParse(payload);
      if (!parsed.success) throw new Error("The API response does not match the RescueSession contract.");
      setSession(parsed.data);
      window.setTimeout(() => document.getElementById("rescue-results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The demo request failed."); }
    finally { setLoading(false); }
  }

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const risk = session?.riskAnalysis;
  const policy = session?.policyDecision;
  const beforeEth = session?.before.assets.find(asset => asset.symbol === "ETH");

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#top" aria-label="Verdant Rescue home"><span className="brand-mark"><Icon name="mark" size={21} /></span><span><strong>VERDANT / RESCUE</strong><small>DeFi position intelligence</small></span></a><nav className="nav-links" aria-label="Primary navigation"><button onClick={() => scrollTo("top")} className="active">Overview</button><button onClick={() => scrollTo("rescue-results")}>Rescue loop</button><button onClick={() => scrollTo("method")}>Method</button><a href="/risk-lab">ETH Risk Lab</a><a href="/attestations?source=guardian">Report attestation</a><a href="/position">Aave read-only</a></nav><div className="feed-status"><span className="live-dot" />{mode} · SINGLE-WALLET GUARDIAN</div></header>

    <section id="top" className="hero"><div><p className="eyebrow">Position safety layer · risk guardian</p><h1>Protect the<br /><em>position,</em> calmly.</h1><p className="hero-copy">A measured portfolio protection workflow: inspect the asset mix, make the risk legible, then let a hard policy decide whether capital can move.</p></div><div className="hero-note"><div className="note-icon"><Icon name="shield" size={20} /></div><strong>One action is in scope</strong><span>The only permitted action is a policy-approved ETH → USDC swap. Local Fork trades WETH; risk changes and investigation are explicitly simulated.</span></div></section>

    <GuardianControls onStatus={setMonitor} />
    <section className="control-panel"><div className="control-copy"><p className="eyebrow">Start a rescue reading</p><h2>Observe the protected wallet.</h2><p>The server binds one wallet. Manual observation shares the monitor’s persistent event gate and can execute one approved swap when no active event exists.</p></div><form onSubmit={runDemo} aria-busy={loading}><label htmlFor="wallet">Server-bound wallet</label><div className="input-row"><input id="wallet" name="wallet" type="text" value={wallet} onChange={(event) => setWallet(event.target.value)} required readOnly disabled={loading || !monitor} autoComplete="off" spellCheck={false} /><button className="primary-button" type="submit" disabled={loading || !monitor || monitor.halted || monitor.busy}>{loading ? "Reading…" : "Run rescue loop"}<Icon name="arrow" size={17} /></button></div><p className="field-note">{monitor?.sources ?? "Waiting for runtime configuration."}</p></form></section>

    {loading && <div className="loading-band" role="status"><span className="spinner" />Reading position → running stress tests → waiting for policy…</div>}
    {error && <div className="error-band" role="alert"><Icon name="warning" size={18} />{error}</div>}
    {!session && !loading && <EmptyState onRun={() => runDemo()} />}

    {session && <div id="rescue-results" className="results-stack" aria-label="Rescue session results">
      <div className="result-heading"><div><p className="eyebrow">Rescue session · request complete</p><h2>Evidence before action.</h2><p className="muted">Test wallet <code>{session.before.wallet}</code></p></div><VerificationBadge verification={session.verification} /></div>
      <section className="snapshot-grid"><article className="dark-panel"><div className="panel-head"><div><h2>Before</h2><p>Independent portfolio read · {mode}</p></div><span className="panel-index">01</span></div><dl className="metric-grid"><Metric label="Total portfolio" value={usd.format(session.before.totalUsd)} note="observed value" /><Metric label="ETH position" value={usd.format(assetValue(session.before, "ETH"))} note="risk asset" /><Metric label="Risk exposure" value={`${session.before.riskExposurePct.toFixed(0)}%`} note="of total value" tone="warning-text" /><Metric label="ETH price before" value={beforeEth && beforeEth.amount > 0 ? usd.format(beforeEth.usdValue / beforeEth.amount) : "—"} note="before snapshot" /></dl></article><article className="light-panel"><div className="panel-head"><div><h2>Risk signal</h2><p>Local risk model + investigation</p></div><StatusPill tone="warning">{session.riskAnalysis.riskScore} / 100</StatusPill></div><div className="risk-score-line"><strong>{session.riskAnalysis.riskScore}</strong><span>risk score</span><span className="score-bar"><i style={{ width: `${session.riskAnalysis.riskScore}%` }} /></span></div><dl className="metric-grid compact"><Metric label="Confidence" value={`${(session.riskAnalysis.confidence * 100).toFixed(0)}%`} note="investigation" /><Metric label="Recommendation" value={session.riskAnalysis.recommendedAction} note="model output" /></dl></article></section>
      <section className="dark-panel stress-panel"><div className="panel-head"><div><h2>Stress tests</h2><p>Projected portfolio values under additional shocks to the before snapshot</p></div><span className="panel-index">02</span></div><StressChart tests={risk?.stressTests ?? []} baselineUsd={session.before.totalUsd} /><p className="muted-on-dark">Market quote: {usd.format(session.market.priceUsd)}. Market changes and investigation are demo inputs; Fork swaps include actual pool fees and slippage.</p></section>
      <section className="investigation-grid"><article className="light-panel"><div className="panel-head"><div><h2>Agent investigation</h2><p>Structured evidence · mock investigator</p></div><StatusPill tone="neutral">{((risk?.confidence ?? 0) * 100).toFixed(0)}% confidence</StatusPill></div><p className="investigation-summary">{risk?.investigation.summary}</p><div className="cause-callout"><span>Primary cause</span><strong>{risk?.investigation.primaryCause}</strong></div><div className="finding-columns"><Findings title="Evidence" items={risk?.investigation.evidence ?? []} /><Findings title="Uncertainty" items={risk?.investigation.uncertainties ?? []} tone="uncertainty" /></div></article><article className="dark-panel policy-panel"><div className="panel-head"><div><h2>Policy gate</h2><p>Independent hard-rule decision</p></div><span className="panel-index">03</span></div><div className="policy-decision"><span className={`decision-icon ${policy?.triggered ? "triggered" : "idle"}`}><Icon name={policy?.triggered ? "warning" : "check"} size={23} /></span><div><strong>{policy?.triggered ? "SWAP approved" : "No action"}</strong><span>{policy?.triggered ? `Reduce ${policy.reduceExposurePct?.toFixed(0)} percentage points: ${policy.sourceAsset} → ${policy.targetAsset}` : "Thresholds were not met"}</span></div></div><Findings title="Reasons" items={policy?.reasons ?? []} /></article></section>
      <section className="execution-grid"><article className="light-panel"><div className="panel-head"><div><h2>Execution</h2><p>{mode} executor output</p></div><ExecutionBadge execution={session.execution} pending={monitor?.events[0]?.status === "SUBMITTED_UNKNOWN" && monitor.events[0].session?.execution.timestamp === session.execution.timestamp} /></div><div className="execution-line"><span className="execution-number">04</span><div><strong>{session.execution.action === "SWAP_TO_SAFE" ? `${mode} SWAP ${session.execution.sourceAsset} → ${session.execution.targetAsset}` : "Policy did not approve execution"}</strong><p>{session.execution.error ?? (mode === "FORK" ? "Local Fork execution; no mainnet transaction link." : "Mock execution; no chain transaction.")}</p></div></div>{session.execution.txHash && <p className="tx-hash"><span>Tx hash · {mode}</span><code>{session.execution.txHash}</code></p>}</article><article className="dark-panel after-panel"><div className="panel-head"><div><h2>After</h2><p>Independent portfolio re-read</p></div><span className="panel-index">05</span></div>{session.after ? <><div className="hf-transition"><span>{session.before.riskExposurePct.toFixed(0)}%</span><Icon name="arrow" size={20} /><strong>{session.after.riskExposurePct.toFixed(0)}%</strong></div><p className="muted-on-dark">Observed risk exposure after the independent re-read.</p><dl className="metric-grid compact"><Metric label="Portfolio after" value={usd.format(session.after.totalUsd)} note="position read" /><Metric label="Timestamp" value={new Date(session.after.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} note="independent read" /></dl></> : <p className="muted-on-dark">No portfolio read after execution: the action was skipped or failed.</p>}<VerificationDetails verification={session.verification} /></article></section>
    </div>}

    <section id="method" className="method-panel"><div><p className="eyebrow">Method note</p><h2>A compact safety stack for a noisy market.</h2><p>Portfolio Service reads the asset mix. Market Service supplies the ETH price. Risk and investigation make the exposure legible. Policy owns the allowlisted one-way swap, then Portfolio Service reads again to verify the exposure actually fell.</p></div><div className="formula"><span>trigger</span> = saved policy thresholds<br /><span>event</span> = one swap until market recovery<br /><span>unknown</span> = query known hash only<br /><em>verify</em> = independent wallet re-read</div></section>
    <footer className="footer"><span>VERDANT / RESCUE · interface prototype</span><span>{mode} · ETH settles as WETH in Fork · demo signals</span></footer>
  </main>;
}
