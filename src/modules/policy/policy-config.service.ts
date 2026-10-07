import { PolicyConfigSchema } from "@/domain/schemas";
import type { PolicyConfig } from "@/domain/types";

export interface PolicyConfigValidationOptions {
  /**
   * Symbols the current chain config can actually trade (for the fork demo:
   * `Object.keys(ForkChainConfig.tokens)`). When provided, every allowlist entry
   * must be executable, not merely a well-formed string.
   */
  executableAssets?: readonly string[];
}

/**
 * Thrown by `validatePolicyConfig`. `issues` is a flat list of human-readable
 * problems so an HTTP layer can map them to its own 400 payload without
 * importing Zod.
 */
export class PolicyConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid policy config: ${issues.join(" | ")}`);
    this.name = "PolicyConfigValidationError";
  }
}

const normalizeSymbolList = (value: unknown): unknown => {
  if (!Array.isArray(value)) return value;
  // " eth " and "eth" both mean the approved "ETH". Never deduplicate here:
  // duplicate or overlapping entries must fail validation, not be repaired silently.
  return value.map((entry) => (typeof entry === "string" ? entry.trim().toUpperCase() : entry));
};

/** Shallow, lossless normalization: only trims and upper-cases asset symbols. */
export function normalizePolicyConfig(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;
  return {
    ...raw,
    allowedRiskAssets: normalizeSymbolList(raw.allowedRiskAssets),
    allowedDefensiveAssets: normalizeSymbolList(raw.allowedDefensiveAssets),
  };
}

/**
 * The single validation entry point for user presets. Reuses the frozen
 * `PolicyConfigSchema` — do not build a second set of field names or units.
 * Returns the normalized config (trimmed, upper-cased symbols) on success and
 * throws `PolicyConfigValidationError` otherwise.
 */
export function validatePolicyConfig(
  input: unknown,
  options: PolicyConfigValidationOptions = {},
): PolicyConfig {
  const parsed = PolicyConfigSchema.safeParse(normalizePolicyConfig(input));

  if (!parsed.success) {
    throw new PolicyConfigValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(config)"}: ${issue.message}`),
    );
  }

  if (options.executableAssets) {
    const executable = new Set(options.executableAssets.map((asset) => asset.toUpperCase()));
    const notExecutable = [...parsed.data.allowedRiskAssets, ...parsed.data.allowedDefensiveAssets]
      .filter((symbol) => !executable.has(symbol.toUpperCase()));
    if (notExecutable.length > 0) {
      throw new PolicyConfigValidationError(notExecutable.map(
        (symbol) => `${symbol}: no on-chain token config on this chain; a whitelisted asset must be executable, not just well-formed.`,
      ));
    }
  }

  return parsed.data;
}
