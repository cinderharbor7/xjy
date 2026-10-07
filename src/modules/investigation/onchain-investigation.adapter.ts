import { InvestigationResultSchema, OnchainSignalStateSchema } from "@/domain/schemas";
import type { InvestigationResult, MarketState, OnchainEvidence, OnchainSignalState, PortfolioState, RiskAnalysis } from "@/domain/types";
import type { InvestigationAdapter } from "./investigation.adapter";

/** References and transactions treated as a well-sampled window. */
const EVIDENCE_TARGET = 3;
const SAMPLE_TARGET = 12;

/** Confidence never claims certainty; the schema validates shape, not on-chain truth. */
const MAX_CONFIDENCE = 0.9;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** How well the supplied references and sample support the finding (not a crash probability). */
export function sellPressureConfidence(signal: OnchainSignalState): number {
  const coverage = clamp01(signal.evidence.length / EVIDENCE_TARGET);
  const sample = clamp01(signal.txCount / SAMPLE_TARGET);
  return Number((MAX_CONFIDENCE * (0.6 * coverage + 0.4 * sample)).toFixed(2));
}

function reference(evidence: OnchainEvidence): string {
  switch (evidence.type) {
    case "TRANSACTION":
      return `tx ${evidence.txHash}`;
    case "BLOCK":
      return `block ${evidence.blockHash}`;
    case "CONTRACT_EVENT":
      return `tx ${evidence.txHash} @ contract ${evidence.contractAddress}`;
  }
}

function describe(evidence: OnchainEvidence): string {
  return `${evidence.type} ${reference(evidence)} (block ${evidence.blockNumber}): ${evidence.description} — source: ${evidence.source}`;
}

/**
 * B's investigation of A's frozen signal. The signal is bound at construction,
 * so the frozen InvestigationAdapter signature (portfolio, market, risk) is unchanged.
 */
export class OnchainSellPressureInvestigationAdapter implements InvestigationAdapter {
  private readonly signal: OnchainSignalState;

  constructor(signal: OnchainSignalState) {
    this.signal = OnchainSignalStateSchema.parse(signal);
  }

  async investigate(portfolio: PortfolioState, market: MarketState, risk: RiskAnalysis): Promise<InvestigationResult> {
    const signal = this.signal;
    return InvestigationResultSchema.parse({
      summary: `ETH DEX gross sell volume is ${signal.anomalyRatio.toFixed(2)}× the equal-length previous window over ${signal.windowStart}–${signal.windowEnd}.`,
      primaryCause: "Elevated ETH gross sell volume on the observed DEX window.",
      evidence: [
        `Aggregate: $${signal.currentSellVolumeUsd} gross sells vs $${signal.baselineSellVolumeUsd} baseline (${signal.anomalyRatio.toFixed(2)}×) over ${signal.txCount} sell transactions and ${signal.uniqueWallets} unique wallets — source: A OnchainSignalState.`,
        ...signal.evidence.map(describe),
        `Portfolio risk exposure ${risk.riskExposurePct}%; signal-augmented risk score ${risk.riskScore}/100.`,
      ],
      uncertainties: [
        "Gross ETH sell volume does not net buys and does not by itself establish a directional price move.",
        "evidence.length samples the window; it is not txCount and cannot be extrapolated to uniqueWallets.",
        "The frozen schema validates reference format and internal consistency, not that the transactions exist.",
        "Confidence measures how well the supplied references cover the window, not the probability that ETH keeps falling.",
      ],
      confidence: sellPressureConfidence(signal),
    });
  }
}
