"use client";

import { useEffect, useState } from "react";
import { RiskLabSnapshotSchema } from "@/modules/eth-risk/risk-lab";
import type { RiskLabSnapshot } from "@/modules/eth-risk/risk-lab";
import styles from "./risk-lab.module.css";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function Icon({ name, size = 18 }: { name: "mark" | "arrow" | "pulse" | "shield" | "book" | "refresh"; size?: number }) {
  const paths = {
    mark: <><circle cx="12" cy="12" r="8.2" /><path d="m12 7.5 4.5 4.5-4.5 4.5L7.5 12 12 7.5Z" opacity=".45" /></>,
    arrow: <><path d="M5 12h13" /><path d="m13 7 5 5-5 5" /></>,
    pulse: <path d="M3 12h4l2.2-5 4.1 10 2.4-5H21" />,
    shield: <><path d="M12 3.5 19 6v5.3c0 4.2-2.4 7.4-7 9.2-4.6-1.8-7-5-7-9.2V6l7-2.5Z" /><path d="m9 12 2 2 4-4" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z" /><path d="M4 5.5v15" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.9-3L3 11" /><path d="M3 6v5h5" /><path d="M4 13a8 8 0 0 0 14.9 3L21 13" /><path d="M21 18v-5h-5" /></>,
  };
  return <svg className={styles.icon} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "elevated" | "watch" | "good" }) {
  return <span className={`${styles.badge} ${styles[tone]}`}><span className={styles.badgeDot} />{children}</span>;
}

function ScoreBar({ value, tone = "elevated" }: { value: number; tone?: "elevated" | "watch" | "good" }) {
  return <span className={styles.scoreBar}><i className={styles[tone]} style={{ width: `${value}%` }} /></span>;
}

function Curve({ curve }: { curve: RiskLabSnapshot["curve"] }) {
  const points = curve.map((point, index) => `${50 + index * 200},${160 - point.score * 1.18}`).join(" ");
  return <div className={styles.curveWrap}>
    <svg viewBox="0 0 680 190" role="img" aria-label="Composite risk curve">
      <line x1="42" y1="42" x2="638" y2="42" className={styles.gridLine} /><line x1="42" y1="101" x2="638" y2="101" className={styles.gridLine} /><line x1="42" y1="160" x2="638" y2="160" className={styles.gridLine} />
      <text x="4" y="46">100</text><text x="12" y="105">50</text><text x="22" y="164">0</text>
      <polyline points={points} className={styles.curveLine} />
      {curve.map((point, index) => { const [x, y] = points.split(" ")[index].split(","); return <g key={point.label}><circle cx={x} cy={y} r="6" className={index === 2 ? styles.currentDot : styles.curveDot} /><text x={Number(x) - 24} y="184">{point.label}</text><text x={Number(x) - 13} y={Number(y) - 13} className={styles.pointLabel}>{point.score}</text></g>; })}
    </svg>
  </div>;
}

function MetricCard({ metric }: { metric: RiskLabSnapshot["metrics"][number] }) {
  return <article className={styles.metricCard}>
    <div className={styles.metricTop}><span className={styles.metricLabel}>{metric.label}</span><Badge tone={metric.state === "ELEVATED" ? "elevated" : metric.state === "WATCH" ? "watch" : "good"}>{metric.state}</Badge></div>
    <div className={styles.metricValue}>{metric.display}</div>
    <div className={styles.metricUnit}>{metric.unit}</div>
    <ScoreBar value={metric.percentile} tone={metric.state === "ELEVATED" ? "elevated" : "watch"} />
    <p>{metric.rationale}</p>
  </article>;
}

function ModelCard({ model }: { model: RiskLabSnapshot["models"][number] }) {
  const tone = model.score >= 75 ? "elevated" : "watch";
  return <article className={styles.modelCard}>
    <div className={styles.modelHeader}><div><span className={styles.modelId}>{model.id.toUpperCase()}</span><h3>{model.title}</h3></div><strong className={styles.modelScore}>{model.score}</strong></div>
    <div className={styles.modelMeta}><span>{model.method}</span><Badge tone={tone}>{Math.round(model.confidence * 100)}% confidence</Badge></div>
    <p className={styles.modelOutput}>{model.output}</p>
    <div className={styles.formula}>{model.formula}</div>
    <p className={styles.modelRationale}>{model.rationale}</p>
    <div className={styles.inputList}>{model.inputs.map((input) => <span key={input}>{input}</span>)}</div>
    <footer>{model.citation}</footer>
  </article>;
}

export default function RiskLabPage() {
  const [snapshot, setSnapshot] = useState<RiskLabSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadSnapshot() {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/eth-risk", { cache: "no-store" });
      if (!response.ok) throw new Error(`Risk feed failed (HTTP ${response.status}).`);
      const parsed = RiskLabSnapshotSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The risk feed did not match the research contract.");
      setSnapshot(parsed.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The risk feed failed."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadSnapshot(); }, []);

  if (loading) return <main className={styles.shell}><div className={styles.loading}><Icon name="pulse" size={24} /><p>Loading the ETH signal stack…</p></div></main>;
  if (error || !snapshot) return <main className={styles.shell}><div className={styles.error}><Badge tone="elevated">FEED ERROR</Badge><h1>Risk feed unavailable.</h1><p>{error ?? "No snapshot returned."}</p><button className={styles.primaryButton} onClick={() => void loadSnapshot()}>Retry <Icon name="refresh" size={16} /></button></div></main>;

  const compositeTone = snapshot.composite.band === "CRITICAL" || snapshot.composite.band === "HIGH" ? "elevated" : snapshot.composite.band === "WATCH" ? "watch" : "good";
  return <main className={styles.shell}>
    <header className={styles.topbar}><a className={styles.brand} href="/" aria-label="Verdant home"><span className={styles.brandMark}><Icon name="mark" size={21} /></span><span><strong>VERDANT / ETH RISK LAB</strong><small>Crash-risk research interface</small></span></a><nav className={styles.nav} aria-label="Primary navigation"><a className={styles.active} href="#overview">Overview</a><a href="#signals">Signals</a><a href="#models">Models</a><a href="#method">Method</a></nav><div className={styles.feedStatus}><span className={styles.liveDot} />{snapshot.dataMode.replaceAll("_", " ")}</div></header>

    <section className={styles.hero} id="overview"><div><p className={styles.eyebrow}>Ethereum mainnet · evidence-led demo</p><h1>Read the crash risk<br /><em>before it arrives.</em></h1><p className={styles.heroCopy}>A composite early-warning system for ETH. It layers chain flow, volatility, leverage, bubble dynamics and left-tail estimates into one decision surface, with every model assumption visible.</p><div className={styles.heroActions}><a className={styles.primaryButton} href="#models">Inspect the model stack <Icon name="arrow" size={16} /></a><button className={styles.ghostButton} onClick={() => void loadSnapshot()}><Icon name="refresh" size={15} />Refresh fixture</button></div></div><aside className={styles.heroAside}><div className={styles.asideTop}><span>Current composite</span><Badge tone={compositeTone}>{snapshot.composite.band}</Badge></div><div className={styles.bigScore}>{snapshot.composite.score}<small>/100</small></div><ScoreBar value={snapshot.composite.score} tone={compositeTone === "good" ? "good" : compositeTone === "watch" ? "watch" : "elevated"} /><p>{snapshot.composite.interpretation}</p><div className={styles.asideFoot}><span>{Math.round(snapshot.composite.confidence * 100)}% confidence</span><span>{snapshot.composite.horizon}</span></div></aside></section>

    <section className={styles.disclosure}><Icon name="shield" size={18} /><span><strong>Demo boundary.</strong> This snapshot is a deterministic chain-shaped fixture. It demonstrates the data contract and model presentation; it does not query an RPC, place an order or claim live predictive performance.</span><span className={styles.blockTag}>BLOCK {snapshot.blockRange.to.toLocaleString()}</span></section>

    <section className={styles.kpiGrid}><article className={styles.kpi}><span>ETH spot</span><strong>{usd.format(snapshot.priceUsd)}</strong><small>fixture market price</small></article><article className={styles.kpi}><span>Risk confidence</span><strong>{Math.round(snapshot.composite.confidence * 100)}%</strong><small>weighted model agreement</small></article><article className={styles.kpi}><span>Current ETH exposure</span><strong>{snapshot.recommendation.currentExposurePct}%</strong><small>illustrative portfolio</small></article><article className={styles.kpi}><span>Suggested target</span><strong>{snapshot.recommendation.targetExposurePct}%</strong><small>after de-risking</small></article></section>

    <section className={styles.splitGrid}><article className={`${styles.panel} ${styles.darkPanel}`}><div className={styles.panelHead}><div><span className={styles.smallCaps}>Composite trajectory</span><h2>Agreement across layers</h2><p>From normal conditions to a stress case, the score rises as independent warnings stack.</p></div><span className={styles.panelIndex}>01</span></div><Curve curve={snapshot.curve} /></article><article className={`${styles.panel} ${styles.recommendation}`}><div className={styles.panelHead}><div><span className={styles.smallCaps}>Position guidance</span><h2>Move defensive</h2></div><Icon name="shield" size={22} /></div><Badge tone="elevated">{snapshot.recommendation.stance}</Badge><h3>{snapshot.recommendation.action}</h3><div className={styles.exposureTransition}><span>{snapshot.recommendation.currentExposurePct}%<small>current ETH</small></span><Icon name="arrow" size={18} /><strong>{snapshot.recommendation.targetExposurePct}%<small>target ETH</small></strong></div><p>{snapshot.recommendation.rationale}</p><div className={styles.confidenceLine}><span>Recommendation confidence</span><strong>{Math.round(snapshot.recommendation.confidence * 100)}%</strong></div></article></section>

    <section className={styles.section} id="signals"><div className={styles.sectionHead}><div><p className={styles.eyebrow}>Observable inputs</p><h2>What the chain is saying</h2></div><p>Percentiles are within the demo’s rolling reference window.</p></div><div className={styles.metricGrid}>{snapshot.metrics.map((metric) => <MetricCard key={metric.key} metric={metric} />)}</div></section>

    <section className={styles.section} id="models"><div className={styles.sectionHead}><div><p className={styles.eyebrow}>Evidence stack</p><h2>Five lenses, one decision</h2></div><p>Scores are comparable by design; confidence keeps them from pretending to be certainty.</p></div><div className={styles.modelGrid}>{snapshot.models.map((model) => <ModelCard key={model.id} model={model} />)}</div></section>

    <section className={styles.splitGrid} id="method"><article className={`${styles.panel} ${styles.lightPanel}`}><div className={styles.panelHead}><div><span className={styles.smallCaps}>Chain evidence</span><h2>Every signal keeps a reference</h2></div><Icon name="book" size={22} /></div><div className={styles.evidenceList}>{snapshot.evidence.map((item) => <div className={styles.evidenceRow} key={item.label}><span className={`${styles.evidenceStatus} ${styles[item.status.toLowerCase()]}`} /> <div><strong>{item.label}</strong><p>{item.value}</p><small>{item.source}</small></div></div>)}</div></article><article className={`${styles.panel} ${styles.darkPanel}`}><div className={styles.panelHead}><div><span className={styles.smallCaps}>Research design</span><h2>How to read the result</h2></div><span className={styles.panelIndex}>02</span></div><ol className={styles.methodSteps}><li><strong>Observe</strong><span>Preserve window, block range and transaction-level references.</span></li><li><strong>Estimate</strong><span>This fixture shows deterministic proxies and illustrative outputs; fitted models on lagged inputs are future work.</span></li><li><strong>Decide</strong><span>Use agreement and confidence to size exposure; never treat one score as a trade signal.</span></li></ol><div className={styles.methodNote}>Next research step: replace the fixture with an indexed ETH panel, fit coefficients out-of-sample, and report AUC, calibration, false alarms and lead time.</div></article></section>

    <footer className={styles.footer}><span>VERDANT / ETH RISK LAB · demo interface</span><span>Synthetic demo · research notes: <code>docs/eth-risk-lab.md</code></span></footer>
  </main>;
}
