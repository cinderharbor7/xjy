import { randomUUID } from "node:crypto";
import type { PolicyConfig, RescueSession } from "@/domain/types";
import type { RescueOrchestrator } from "@/modules/rescue/rescue.orchestrator";
import { validatePolicyConfig } from "@/modules/policy/policy-config.service";
import { GuardianError, isGuardianError, Recovery, StatusResponseSchema, type GuardianEvent, type GuardianState } from "./contracts";
import { GuardianStore } from "./store";

export interface MonitorRuntime {
  create(config: PolicyConfig, state: GuardianState, journal: (kind: "APPROVE" | "SWAP", hash: string) => void): Promise<RescueOrchestrator>;
  resolve(event: GuardianEvent): Promise<RescueSession | "PENDING" | "REVERTED" | "UNVERIFIABLE">;
}

/** Server timer and manual HTTP run share this durable admission gate. */
export class GuardianMonitor {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  constructor(readonly store: GuardianStore, private readonly runtime: MonitorRuntime, private readonly now = () => Date.now()) {}
  assertWallet(wallet: string) {
    if (wallet.trim().toLowerCase() !== this.store.read().wallet.toLowerCase()) throw new GuardianError(403, "WALLET_MISMATCH", "Only the server-bound demo wallet is permitted.");
  }
  policy() {
    const { wallet, mode, config, version } = this.store.read();
    return { wallet, mode, config, version, supportedRiskAssets: ["ETH"], supportedDefensiveAssets: ["USDC"] };
  }
  savePolicy(wallet: string, input: unknown, version: number) {
    this.assertWallet(wallet);
    let config: PolicyConfig;
    try { config = validatePolicyConfig(input, { executableAssets: ["ETH", "USDC"] }); }
    catch { throw new GuardianError(400, "INVALID_CONFIG", "Invalid policy fields, units or unsupported assets."); }
    if (config.allowedRiskAssets.some(a => a !== "ETH") || config.allowedDefensiveAssets.some(a => a !== "USDC")) throw new GuardianError(400, "INVALID_CONFIG", "This demo only supports WETH (ETH) to USDC.");
    this.store.change(state => {
      if (state.version !== version) throw new GuardianError(409, "VERSION_CONFLICT", "Reload the policy before saving; another update changed its version.");
      state.config = config; state.version++;
    });
    return this.policy();
  }
  command(wallet: string, command: "start" | "pause") {
    this.assertWallet(wallet);
    this.store.change(state => {
      if (command === "start" && state.halted) throw new GuardianError(409, "REVIEW_REQUIRED", "Execution is halted for review. Starting cannot clear an event or retry a transaction.");
      state.enabled = command === "start";
      // Pauses break a sequence of continuous recovery samples, never the event itself.
      state.recoveryCount = 0;
    });
    return this.status();
  }
  status() {
    const s = this.store.read();
    return StatusResponseSchema.parse({ wallet: s.wallet, mode: s.mode, enabled: s.enabled, halted: s.halted,
      busy: !!s.lease && s.lease.expires > this.now(), activeEvent: s.activeEvent,
      recoveryCount: s.recoveryCount, recovery: Recovery, lastTickAt: s.lastTickAt, lastError: s.lastError,
      latestAnalysis: s.latestAnalysis, latestSession: s.latestSession, events: this.store.events(),
      sources: s.mode === "FORK" ? "Local Fork WETH/USDC balances and pool spot quote; DEMO market changes and MOCK investigation. Gas ETH is excluded." : "MOCK balances, market changes, investigation and execution; no chain transactions.",
    });
  }
  startLoop() {
    if (this.timer) return;
    this.stopped = false;
    const loop = async () => {
      try { await this.tick(false); } catch { /* Sanitized status is stored by tick; no raw RPC logging. */ }
      if (!this.stopped) { this.timer = setTimeout(loop, Recovery.intervalMs); this.timer.unref(); }
    };
    this.timer = setTimeout(loop, 0); this.timer.unref();
  }
  stopLoop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }

  async tick(manual: boolean): Promise<RescueSession | undefined> {
    const token = randomUUID();
    const snapshot = this.store.change(state => {
      if (state.lease && state.lease.expires > this.now()) {
        if (manual) throw new GuardianError(409, "BUSY", "Another observation is in progress.");
        return undefined;
      }
      // Receipt resolution must continue while paused, but no new transaction can start.
      if (!manual && !state.enabled && !state.activeEvent) return undefined;
      state.lease = { token, expires: this.now() + 120_000 };
      return structuredClone(state);
    });
    if (!snapshot) return;
    let reserved: string | undefined;
    try {
      if (snapshot.activeEvent) {
        const active = this.store.event(snapshot.activeEvent);
        if (active.status === "RESERVED" || active.status === "SUBMITTED_UNKNOWN") {
          const swap = active.submissions.find(s => s.kind === "SWAP");
          if (!swap) {
            this.halt(active, "REVIEW", "Interrupted execution: no durable swap hash. Check the known approval and wallet nonce; do not resend.", token);
          } else {
            const result = await this.runtime.resolve(active);
            if (result === "PENDING") this.updateEvent(active.id, e => { e.status = "SUBMITTED_UNKNOWN"; e.note = "Querying the recorded swap hash; no resubmission."; }, token);
            else if (typeof result === "string") this.halt(active, result === "REVERTED" ? "FAILED" : "REVIEW", "Receipt reverted or could not be verified. Manual review required.", token);
            else this.complete(active.id, result, token);
          }
        }
      }
      const current = this.store.read();
      if (current.halted) throw new GuardianError(409, "REVIEW_REQUIRED", "An execution or verification requires review; automatic trading is halted.");
      if (!manual && !current.enabled) return;
      if (manual && current.activeEvent) throw new GuardianError(409, "EVENT_OCCUPIED", "This risk event already owns its execution opportunity; the server continues observations.");
      const orchestrator = await this.runtime.create(snapshot.config, snapshot, (kind, hash) => {
        if (!reserved) throw new Error("No reserved event");
        this.store.change((state, save) => {
          this.owned(state, token);
          if ((!manual && !state.enabled) || state.halted) throw new GuardianError(409, "PAUSED", "Monitoring paused before transaction broadcast.");
          const event = this.store.event(reserved!);
          if (this.now() - Date.parse(event.analysis.market.timestamp) > Recovery.maxAgeMs) throw new Error("Frozen market quote expired before broadcast");
          if (event.submissions.some(s => s.kind === kind)) throw new Error("Transaction intent already exists");
          event.submissions.push({ kind, hash, timestamp: new Date(this.now()).toISOString() });
          if (kind === "SWAP") event.status = "SUBMITTED_UNKNOWN";
          event.note = "Signed transaction hash durably recorded before broadcast; no automatic resend.";
          save(event);
        });
      });
      const analysis = await orchestrator.analyze(snapshot.wallet);
      const time = Date.parse(analysis.market.timestamp);
      const age = this.now() - time;
      const portfolioAge = this.now() - Date.parse(analysis.before.timestamp);
      if (age < -5_000 || age > Recovery.maxAgeMs || portfolioAge < -5_000 || portfolioAge > Recovery.maxAgeMs) throw new GuardianError(503, "STALE_DATA", "The market or portfolio observation is not fresh.");
      const admitted = this.store.change((state, save) => {
        this.owned(state, token);
        if (state.lastMarketAt && time <= Date.parse(state.lastMarketAt)) throw new GuardianError(503, "STALE_DATA", "A new market observation is required.");
        const consecutive = !state.lastMarketAt || time - Date.parse(state.lastMarketAt) <= Recovery.maxAgeMs;
        state.lastMarketAt = analysis.market.timestamp; state.lastTickAt = new Date(this.now()).toISOString();
        state.latestAnalysis = analysis; delete state.lastError;
        if (!manual && !state.enabled) return false;
        if (state.activeEvent) {
          const event = this.store.event(state.activeEvent);
          const recovered = analysis.market.volatilityScore <= Recovery.maxVolatility
            && analysis.market.priceChange5mPct >= Recovery.minChange5m && analysis.market.priceChange1hPct >= Recovery.minChange1h;
          // Pending / unverified transactions never release their event, even on calm data.
          state.recoveryCount = event.status === "CONFIRMED" && event.session?.verification.status === "PASSED" && recovered ? (consecutive ? state.recoveryCount : 0) + 1 : 0;
          if (state.recoveryCount >= Recovery.consecutive) {
            event.closedAt = new Date(this.now()).toISOString(); save(event);
            delete state.activeEvent; state.recoveryCount = 0;
          }
          return false; // Rearming cannot execute in the same recovery observation.
        }
        if (!analysis.policyDecision.triggered) return true;
        reserved = randomUUID(); state.activeEvent = reserved; state.recoveryCount = 0;
        save({ id: reserved, createdAt: new Date(this.now()).toISOString(), status: "RESERVED", config: snapshot.config, version: snapshot.version, analysis, submissions: [], note: "Policy approved. Event reserved before any external execution." });
        return true;
      });
      if (!admitted) {
        if (manual) throw new GuardianError(409, "EVENT_OCCUPIED", "This risk event already owns its execution opportunity; continuing observations only.");
        return;
      }
      const session = await orchestrator.executeAnalysis(analysis);
      if (reserved) this.complete(reserved, session, token);
      else this.store.change(state => { this.owned(state, token); state.latestSession = session; });
      return session;
    } catch (error) {
      // A late result no longer owns this journal. A newer observation may have
      // already resolved and closed its event; never roll that result backwards.
      const currentLease = this.store.read().lease;
      if (reserved && currentLease?.token === token && currentLease.expires > this.now()) {
        const event = this.store.event(reserved);
        if (event.status !== "CONFIRMED") {
          if (event.submissions.some(s => s.kind === "SWAP")) this.updateEvent(reserved, e => { e.status = "SUBMITTED_UNKNOWN"; e.note = "Execution interrupted. Resolve the known swap hash; do not resend."; }, token);
          else this.halt(event, "REVIEW", "Execution interrupted before a known swap receipt. Automatic execution is halted.", token);
        }
      }
      const safe = isGuardianError(error) ? error : new GuardianError(503, "OBSERVATION_FAILED", "Observation or execution could not be completed. No automatic transaction retry.");
      this.store.change(state => { if (state.lease?.token === token && safe.code !== "EVENT_OCCUPIED") { state.lastError = safe.message; state.recoveryCount = 0; } });
      if (manual) throw safe;
    } finally {
      this.store.change(state => { if (state.lease?.token === token) delete state.lease; });
    }
  }
  private owned(state: GuardianState, token: string) {
    if (state.lease?.token !== token || state.lease.expires <= this.now()) throw new GuardianError(409, "LEASE_LOST", "The observation lease expired; execution is blocked.");
  }
  private updateEvent(id: string, fn: (event: GuardianEvent) => void, token: string) {
    this.store.change((state, save) => { this.owned(state, token); const e = this.store.event(id); fn(e); save(e); });
  }
  private halt(event: GuardianEvent, status: "FAILED" | "REVIEW", note: string, token: string) {
    this.store.change((state, save) => { this.owned(state, token); state.halted = true; state.enabled = false; state.recoveryCount = 0; event.status = status; event.note = note; save(event); });
  }
  private complete(id: string, session: RescueSession, token: string) {
    this.store.change((state, save) => {
      this.owned(state, token);
      const event = this.store.event(id);
      event.session = session; state.latestSession = session;
      const unknown = !session.execution.success && event.submissions.some(s => s.kind === "SWAP") && !session.execution.error?.startsWith("SWAP_REVERTED");
      event.status = session.execution.success ? "CONFIRMED" : unknown ? "SUBMITTED_UNKNOWN" : "FAILED";
      event.note = unknown ? "Swap outcome unknown; query the recorded hash only." : `Execution ${event.status}; verification ${session.verification.status}.`;
      if ((!session.execution.success && !unknown) || session.verification.status === "FAILED") { state.halted = true; state.enabled = false; }
      save(event);
    });
  }
}
