export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { getGuardian } = await import("./integration/guardian/runtime");
    // State corruption or a wallet/mode mismatch must not silently start a fresh executor.
    getGuardian().startLoop();
  }
}
