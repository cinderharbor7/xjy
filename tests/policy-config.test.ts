import { describe, expect, it } from "vitest";
import {
  PolicyConfigValidationError, normalizePolicyConfig, validatePolicyConfig,
} from "@/modules/policy/policy-config.service";

const VALID = {
  minRiskScore: 80,
  minConfidence: 0.85,
  minRiskExposurePct: 70,
  maxDeRiskPct: 30,
  allowedRiskAssets: ["ETH"],
  allowedDefensiveAssets: ["USDC"],
};

const FORK_TOKENS = ["ETH", "USDC"];

describe("validatePolicyConfig: the single entry point for user presets", () => {
  it("accepts a valid preset and returns the frozen policy shape", () => {
    const config = validatePolicyConfig(VALID, { executableAssets: FORK_TOKENS });
    expect(config).toEqual(VALID);
  });

  it("normalizes symbols instead of failing on casing or padding", () => {
    const config = validatePolicyConfig(
      { ...VALID, allowedRiskAssets: [" eth "], allowedDefensiveAssets: ["usdc"] },
      { executableAssets: FORK_TOKENS },
    );
    expect(config.allowedRiskAssets).toEqual(["ETH"]);
    expect(config.allowedDefensiveAssets).toEqual(["USDC"]);
  });

  it("leaves non-object input for the schema to reject", () => {
    expect(normalizePolicyConfig(null)).toBeNull();
    expect(() => validatePolicyConfig(null)).toThrow(PolicyConfigValidationError);
  });

  it("rejects overlapping allowlists rather than repairing them", () => {
    expect(() => validatePolicyConfig({ ...VALID, allowedDefensiveAssets: ["ETH"] }))
      .toThrow(/unique and disjoint/);
  });

  it("rejects duplicate allowlist entries", () => {
    expect(() => validatePolicyConfig({ ...VALID, allowedRiskAssets: ["ETH", "eth"] }))
      .toThrow(PolicyConfigValidationError);
  });

  it("rejects out-of-range thresholds and unknown fields", () => {
    expect(() => validatePolicyConfig({ ...VALID, maxDeRiskPct: 120 })).toThrow(PolicyConfigValidationError);
    expect(() => validatePolicyConfig({ ...VALID, minConfidence: 1.5 })).toThrow(PolicyConfigValidationError);
    expect(() => validatePolicyConfig({ ...VALID, wallet: "0xabc" })).toThrow(PolicyConfigValidationError);
  });

  it("rejects a whitelisted asset the chain cannot execute", () => {
    expect(() => validatePolicyConfig(
      { ...VALID, allowedDefensiveAssets: ["DAI"] },
      { executableAssets: FORK_TOKENS },
    )).toThrow(/no on-chain token config/);
  });

  it("exposes the problems as a flat list for the HTTP layer to map", () => {
    try {
      validatePolicyConfig({ ...VALID, allowedDefensiveAssets: ["DAI"] }, { executableAssets: FORK_TOKENS });
      throw new Error("validation should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(PolicyConfigValidationError);
      expect((error as PolicyConfigValidationError).issues.join(" ")).toContain("DAI");
    }
  });

  it("skips the executability check when no chain options are supplied", () => {
    expect(validatePolicyConfig({ ...VALID, allowedDefensiveAssets: ["DAI"] }).allowedDefensiveAssets).toEqual(["DAI"]);
  });
});
