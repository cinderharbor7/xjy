import { InvestigationResultSchema } from "@/domain/schemas";
import type { InvestigationResult, MarketState, OnchainSignalState, PortfolioState, RiskAnalysis, TransactionCheckReport } from "@/domain/types";
import type { InvestigationAdapter } from "./investigation.adapter";
import { OnchainSellPressureInvestigationAdapter } from "./onchain-investigation.adapter";

export interface AiInvestigationOptions {
  /** OpenAI-compatible API key. If absent, falls back to deterministic template. */
  apiKey?: string;
  /** OpenAI-compatible chat completions endpoint. Defaults to OpenAI v1. */
  apiUrl?: string;
  /** Model identifier. Defaults to gpt-4o-mini for speed/cost balance. */
  model?: string;
  /** Optional transaction-check reports to include as verified evidence. */
  reports?: TransactionCheckReport[];
  /** Timeout in ms for the LLM call. */
  timeoutMs?: number;
}

const DEFAULT_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_CONFIDENCE = 0.9;

/**
 * Builds a strict system prompt that requires the model to distinguish
 * facts, inferences, and unknowns while never fabricating hashes or
 * claiming certainty.
 */
function buildSystemPrompt(): string {
  return `You are an on-chain investigation analyst. Your job is to produce a structured report about an Ethereum portfolio and market conditions based ONLY on the data provided.

OUTPUT FORMAT: Return a single JSON object with these exact keys:
- "summary": string (1-2 sentences describing the overall observation)
- "primaryCause": string (the most direct cause supported by evidence)
- "evidence": string[] (each item must cite specific data points with their source; do not fabricate tx hashes, block hashes, or block numbers)
- "uncertainties": string[] (at least 4 items listing what is NOT known or cannot be concluded from the evidence)
- "confidence": number between 0.0 and 0.9 (never 1.0; this measures evidence coverage, not prediction certainty)

RULES:
1. FACTS are only on-chain data that is explicitly provided (balances, prices, transaction hashes, block numbers, swap events).
2. INFERENCES are limited conclusions drawn by deterministic rules (e.g., "sell pressure is X× baseline"). State them as rules, not predictions.
3. UNKNOWNS must include: gross sell does not net buys; single-pool evidence does not represent the whole market; schema validation is not cryptographic proof of existence; confidence is not a price-fall probability.
4. If transaction-check reports are provided, reference their confirmedFacts but do not fabricate additional facts.
5. Do not claim the portfolio will lose value, do not give investment advice, and do not invoke any execution or policy action.
6. If evidence is weak or missing, lower confidence accordingly and expand uncertainties.
7. Respond ONLY with the JSON object. No markdown code fences, no preamble, no trailing text.`;
}

function buildUserPrompt(
  portfolio: PortfolioState,
  market: MarketState,
  risk: RiskAnalysis,
  signal: OnchainSignalState,
  reports?: TransactionCheckReport[],
): string {
  const sections: string[] = [];

  sections.push(`## PORTFOLIO\n${JSON.stringify(portfolio, null, 2)}`);
  sections.push(`## MARKET\n${JSON.stringify(market, null, 2)}`);
  sections.push(`## RISK ANALYSIS\n${JSON.stringify({
    riskScore: risk.riskScore,
    confidence: risk.confidence,
    riskExposurePct: risk.riskExposurePct,
    recommendedAction: risk.recommendedAction,
    stressTests: risk.stressTests,
  }, null, 2)}`);
  sections.push(`## ONCHAIN SIGNAL\n${JSON.stringify(signal, null, 2)}`);

  if (reports && reports.length > 0) {
    sections.push(`## TRANSACTION CHECK REPORTS\n${JSON.stringify(
      reports.map((r) => ({
        txHash: r.observation.transaction.hash,
        classification: r.classification,
        confirmedFacts: r.confirmedFacts,
        uncertainties: r.uncertainties,
      })),
      null,
      2,
    )}`);
  }

  sections.push(`\nProduce the InvestigationResult JSON now.`);
  return sections.join("\n\n");
}

async function callLlm(
  apiKey: string,
  apiUrl: string,
  model: string,
  system: string,
  user: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
        max_tokens: 1500,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`LLM HTTP ${response.status}: ${text}`);
    }

    const body = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (body.error?.message) {
      throw new Error(`LLM API error: ${body.error.message}`);
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("LLM response missing content.");
    }

    return JSON.parse(content);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * AI-powered investigation adapter.
 *
 * - When LLM_API_KEY is configured, it calls an OpenAI-compatible chat
 *   completions endpoint with a strict JSON schema prompt.
 * - When the key is missing or the call fails, it falls back to the
 *   deterministic OnchainSellPressureInvestigationAdapter so the system
 *   remains runnable without model credentials.
 *
 * The adapter never carries execution authority; it only produces text
 * evidence and bounded confidence for downstream Policy evaluation.
 */
export class AiInvestigationAdapter implements InvestigationAdapter {
  private readonly fallback: OnchainSellPressureInvestigationAdapter;
  private readonly signal: OnchainSignalState;
  private readonly options: Required<Pick<AiInvestigationOptions, "apiUrl" | "model" | "timeoutMs">> &
    Pick<AiInvestigationOptions, "apiKey" | "reports">;

  constructor(signal: OnchainSignalState, options: AiInvestigationOptions = {}) {
    this.signal = signal;
    this.fallback = new OnchainSellPressureInvestigationAdapter(signal);
    this.options = {
      apiKey: options.apiKey,
      apiUrl: options.apiUrl?.trim() || DEFAULT_API_URL,
      model: options.model?.trim() || DEFAULT_MODEL,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      reports: options.reports,
    };
  }

  async investigate(portfolio: PortfolioState, market: MarketState, risk: RiskAnalysis): Promise<InvestigationResult> {
    const { apiKey } = this.options;

    if (!apiKey || apiKey.trim().length === 0) {
      // Graceful degradation: no key → deterministic template.
      return this.fallback.investigate(portfolio, market, risk);
    }

    try {
      const system = buildSystemPrompt();
      const user = buildUserPrompt(portfolio, market, risk, this.signal, this.options.reports);
      const raw = await callLlm(apiKey, this.options.apiUrl, this.options.model, system, user, this.options.timeoutMs);

      // Safety: clamp confidence and ensure uncertainties exist.
      const parsed = InvestigationResultSchema.parse(raw);
      const safeConfidence = Math.min(MAX_CONFIDENCE, Math.max(0, parsed.confidence));
      let safeUncertainties = parsed.uncertainties;
      if (safeUncertainties.length < 4) {
        const fallbackResult = await this.fallback.investigate(portfolio, market, risk);
        safeUncertainties = [...safeUncertainties, ...fallbackResult.uncertainties];
      }

      return InvestigationResultSchema.parse({
        ...parsed,
        confidence: safeConfidence,
        uncertainties: safeUncertainties,
      });
    } catch {
      // Any failure (network, parse, schema) → fallback template.
      return this.fallback.investigate(portfolio, market, risk);
    }
  }
}
