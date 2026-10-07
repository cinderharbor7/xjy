"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { PolicyConfig } from "@/domain/types";
import { GuardianProblemSchema, PolicyResponseSchema, StatusResponseSchema, type MonitorStatus } from "@/integration/guardian/contracts";

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body: unknown = await response.json();
  if (!response.ok) {
    const problem = GuardianProblemSchema.safeParse(body);
    throw new Error(problem.success ? problem.data.detail : `Request failed (${response.status}).`);
  }
  return body;
}
const fields = [
  ["minRiskScore", "Risk score above", 1], ["minConfidence", "Confidence above (%)", 100],
  ["minRiskExposurePct", "Exposure above (%)", 1], ["maxDeRiskPct", "Maximum reduction (points)", 1],
] as const;

export function GuardianControls({ onStatus }: { onStatus: (status: MonitorStatus) => void }) {
  const [status, setStatus] = useState<MonitorStatus>();
  const [draft, setDraft] = useState<PolicyConfig>();
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  async function loadPolicy(wallet: string) {
    const policy = PolicyResponseSchema.parse(await request(`/api/policy?wallet=${encodeURIComponent(wallet)}`));
    setDraft(policy.config); setVersion(policy.version);
  }
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    let initialized = false;
    const poll = async () => {
      try {
        const next = StatusResponseSchema.parse(await request("/api/monitor"));
        if (stopped) return;
        setStatus(next); onStatus(next);
        if (!initialized) { await loadPolicy(next.wallet); initialized = true; }
      } catch { if (!stopped) setError("Guardian status is unavailable. Check the local server configuration."); }
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [onStatus]);
  async function command(command: "start" | "pause") {
    if (!status) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const next = StatusResponseSchema.parse(await request("/api/monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: status.wallet, command }) }));
      setStatus(next); onStatus(next);
      setNotice(command === "pause" ? "Paused new automatic trades. Already signed transactions remain tracked." : "Server monitoring started. It continues when this page is closed.");
    } catch (e) { setError(e instanceof Error ? e.message : "Monitor request failed."); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!status || !draft) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const policy = PolicyResponseSchema.parse(await request("/api/policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: status.wallet, config: draft, version }) }));
      setDraft(policy.config); setVersion(policy.version); setNotice(`Policy v${policy.version} saved. Applies to the next observation; active event snapshots are unchanged.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed."); }
    finally { setBusy(false); }
  }
  return <section id="guardian-controls" className="guardian-controls light-panel" aria-label="Persistent Guardian controls">
    <div className="panel-head"><div><p className="eyebrow">Single-wallet control plane</p><h2>Policy & continuous monitoring</h2><p>{status?.sources ?? "Connecting to the local Guardian…"}</p></div><span className={`status-pill ${status?.halted ? "warning" : "neutral"}`}>{status?.halted ? "Review required" : status?.events.find(e => e.id === status.activeEvent)?.status === "SUBMITTED_UNKNOWN" ? "Awaiting receipt" : status?.enabled ? "Monitoring" : "Paused"}</span></div>
    {status && <><p className="wallet-binding">Protected wallet <code>{status.wallet}</code> · {status.mode}</p><div className="monitor-actions"><button className="primary-button" disabled={busy || status.enabled || status.halted} onClick={() => command("start")}>Start monitoring</button><button className="secondary-button" disabled={busy || !status.enabled} onClick={() => command("pause")}>Pause</button><span>{status.busy ? "Observation in progress" : "Server interval: 10 seconds"}</span></div><p className="field-note">One swap per risk event. Recovery requires 3 fresh samples: volatility ≤ 40, 5m change ≥ −0.5%, 1h ≥ −2%. These are demo thresholds.</p></>}
    {draft && <form className="policy-form" onSubmit={save}><div className="policy-fields">{fields.map(([key, label, factor]) => <label key={key}>{label}<input type="number" min="0" max="100" step="0.1" required disabled={busy} value={Number.isFinite(draft[key]) ? Number((draft[key] * factor).toFixed(6)) : ""} onChange={e => setDraft({ ...draft, [key]: e.target.value === "" ? NaN : Number(e.target.value) / factor })} /></label>)}</div><div className="allowlist-fields"><label><input type="checkbox" checked={draft.allowedRiskAssets.includes("ETH")} disabled={busy} onChange={e => setDraft({ ...draft, allowedRiskAssets: e.target.checked ? ["ETH"] : [] })} />Sell: ETH (WETH in Fork)</label><label><input type="checkbox" checked={draft.allowedDefensiveAssets.includes("USDC")} disabled={busy} onChange={e => setDraft({ ...draft, allowedDefensiveAssets: e.target.checked ? ["USDC"] : [] })} />Receive: user-approved USDC</label></div><div className="monitor-actions"><button className="primary-button" disabled={busy} type="submit">Save policy</button><button className="secondary-button" disabled={busy || !status} type="button" onClick={() => { if (status) void loadPolicy(status.wallet).then(() => setNotice("Policy reloaded.")).catch(() => setError("Reload failed.")); }}>Reload saved policy</button><span>Loaded version {version} · saving does not trade</span></div></form>}
    {error && <p role="alert" className="error-band">{error}</p>}{notice && <p role="status" className="field-note">{notice}</p>}
    {status?.lastError && <p className="error-band">{status.lastError}</p>}
    {status?.activeEvent && <p className="field-note">Active event · {status.activeEvent} · recovery {status.recoveryCount}/3</p>}
    {status && status.events.length > 0 && <div className="event-history"><h3>Durable event history</h3>{status.events.map(event => <details key={event.id}><summary>{event.createdAt} · {event.status} · {event.closedAt ? "Market recovered" : "Event retained"} · policy v{event.version}</summary><p>{event.note}</p><p>Execution: {event.session?.execution.success ? "Confirmed" : event.status === "SUBMITTED_UNKNOWN" ? "Unknown — receipt lookup only" : event.status} · Verification: {event.session?.verification.status ?? "Not available"}</p>{event.submissions.map(tx => <p key={tx.hash}>{tx.kind} · <code>{tx.hash}</code></p>)}<p>Frozen policy: risk &gt; {event.config.minRiskScore}, confidence &gt; {event.config.minConfidence * 100}%, exposure &gt; {event.config.minRiskExposurePct}%, reduce ≤ {event.config.maxDeRiskPct} points.</p></details>)}</div>}
  </section>;
}
