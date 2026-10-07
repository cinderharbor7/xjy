# D: persistent Guardian control plane

Implementation branch: `d/guardian-monitor-integration`, main baseline `bc1d504`, C integration `30d5bbb`.

## Run

Node 24 LTS is recommended (`node:sqlite` is used; Node 22.13+ is the minimum for SQLite without its old opt-in flag). Use a persistent local Node process, not serverless hosting or Edge. Start with `pnpm dev --hostname 127.0.0.1` or `pnpm build` then `pnpm start --hostname 127.0.0.1`. The server owns the timer; closing the browser does not stop it. No visual checks are part of this delivery.

Default mode is `MOCK`, bound to `0x1111111111111111111111111111111111111111`. Unlike the earlier stateless demo, arbitrary wallet labels are no longer accepted by HTTP. SQLite defaults to `.guardian/state.sqlite`; config, version, monitor intent, lease, events, frozen authorization, transaction hashes and verification results persist there. The directory is ignored by Git. Keep this file and its WAL/SHM sidecars on the same durable local disk. Never delete/reset it to retry a transaction. A wallet or mode change against the same DB is rejected.

The first run is paused. Save policy, then **Start monitoring**. The status page polls for display only. Manual **Run rescue loop** uses the same event and lock as the timer and can execute when policy permits. **Pause** stops new automatic trading; signed or broadcast transactions remain tracked. It cannot cancel a transaction. An unresolved approval without a swap hash, execution failure, or failed effect verification requires review; start/pause/config updates cannot reset it.

## HTTP

All controls are local-only, same-origin JSON with `Cache-Control: no-store`. Bind the server to loopback; do not expose or reverse-proxy it. There is no multi-user authentication model. `GUARDIAN_ORIGIN` specifies the local scheme/port (default `http://localhost:3000`); literal loopback aliases are allowed. Cross-origin writes, non-loopback request hosts and nonlocal forwarded host headers are refused (Next-generated literal loopback aliases on the configured port are accepted). Secrets, RPC endpoints, routers and factories are never form fields.

| Route | Request | Response |
| --- | --- | --- |
| GET `/api/monitor` | None | Bound wallet/mode, enabled/halted/busy, latest analysis/session, active event, recovery count, latest 20 journal records, source labels |
| POST `/api/monitor` | `{wallet, command: "start" \| "pause"}` | Status; does not reset an event |
| GET `/api/policy?wallet=…` | Bound wallet | `{wallet, mode, config, version, supportedRiskAssets, supportedDefensiveAssets}` |
| PUT `/api/policy` | `{wallet, config, version}` | Normalized saved config with incremented version; saving does not trade |
| POST `/api/rescue` | `{wallet}` only | Existing `RescueSession` on 200; `X-Rescue-Mode: MOCK` or `FORK`; 409 when busy or an event already owns the execution opportunity |

HTTP errors use D's `GuardianProblemSchema` (`type,title,status,code,detail,instance`), not the old rescue-only 400/500 envelope. Typical statuses: 400 invalid JSON/request/config or missing version; 403 wallet/origin/locality mismatch; 409 version conflict, busy, occupied event or review required; 415 non-JSON writes; 503 unavailable runtime, stale data or failed observation. Raw adapter exceptions are never included. C's policy validator is reused; only ETH in the risk list and USDC in the defensive list are executable here. Empty lists disable matching actions. Frontend confidence percentages are divided by 100; reduction retains percentage-point semantics.

Config commits take effect from the next observation. Each admitted event keeps a private snapshot of config/version, portfolio, market and decision. Editing config does not change an in-flight swap's authorization or reset event occupancy. The result and its originating config can be inspected in event history.

## Event lifecycle

1. Acquire a durable 120s observation lease in a short SQLite `BEGIN IMMEDIATE` transaction. Concurrent manual/timer/process requests cannot enter the same observation. Previous unfinished execution is reconciled before new work.
2. Read and analyze via `RescueOrchestrator.analyze`. Before/market freshness is checked. Persist a new event **before** calling its execution phase, and only if full Policy approves.
3. For Fork writes, locally sign, derive the exact signed transaction hash and commit it to SQLite **before broadcasting**. Approval and swap have separate journal kinds. Transport retries are disabled; no automatic swap retransmission occurs. If signing completed but broadcast did not, the hash may remain unknown indefinitely: query only, then inspect manually.
4. On confirmation, independently re-read Portfolio and run the existing verification. A successful swap with failed verification retains its consumed event and halts automatic trading. A read failure after broadcast retains the hash for later receipt lookup/re-read.
5. A confirmed, successfully verified event closes only on market recovery. Pending/review/failed events cannot close through recovery. Closing is a separate observation; only a later full Policy trigger can reserve a new event.

Recovery is intentionally independent of portfolio exposure and investigation confidence. D's demo parameters: 10s interval; market and portfolio age ≤30s; market timestamp must advance; volatility ≤40, 5m change ≥−0.5%, 1h change ≥−2%, for 3 consecutive valid observations. Failures, stale/duplicate observations, long gaps and pause break the consecutive count without clearing the event. These engineering choices are **not a B-validated market recovery model**. They are centralized in `src/integration/guardian/contracts.ts` for B/D calibration.

All writes to the event gate are atomic. Crashes after reservation but before a known swap hash halt for review. Crashes after a known swap hash resume receipt queries only, including while paused. Active C execution may outlast the lease; later executions still cannot be admitted because the reserved event is durable. A lost/expired lease cannot journal a new signed transaction. An unavailable/corrupted state file must fail closed; the runtime does not silently replace it.

## Local Fork

Set `GUARDIAN_MODE=FORK`, `FORK_RPC_URL=http://127.0.0.1:8545`, `FORK_PRIVATE_KEY=<disposable local key>`, `GUARDIAN_WALLET=<address derived from that key>` and a **separate new DB path for this fork** in the server environment. Never use a funded mainnet key. Start Anvil as `anvil --fork-url <read-only-mainnet-rpc> --host 127.0.0.1 --port 8545` (chain id 1, no `--chain-id 1337`). Fund the disposable wallet with gas on this local node, then deposit native ETH into WETH on this node before starting monitoring.

Runtime rejects remote RPC URLs, wrong chain id, missing Anvil fork metadata, signer/recipient mismatch and changed Anvil instance identity. Resetting Anvil is a new chain instance and cannot reuse existing event state. Local hashes are shown as text, never linked to mainnet explorers.

D's temporary `ForkReadBridge` lives in integration, leaving A's module ownership intact. It reads WETH/USDC balances at a pinned block and prices WETH from Uniswap V2 reserves (token ordering read on-chain); USDC is assumed $1. Native ETH is excluded from tradable holdings and used for gas only. C receives frozen before/market snapshots for amount calculation, checks live tradable balance and swap quote, and returns receipt evidence. The after portfolio is a new chain read; it is not manufactured from receipt amounts. Quote drift, fees and slippage may produce a legitimate `FAILED` verification and halt trading.

**Real on local Fork:** ERC20 balances, pool spot price, exact-amount approval, WETH→USDC swap, receipts and portfolio re-read. **Demonstration inputs:** 5m/1h changes, volatility and investigation/confidence. There is no A/B real-time anomaly feed or live `DEX_SELL_PRESSURE` ingestion. The Research Lab remains a separate fixture page.

By default each observation uses the fixed demo shock. To exercise recovery, set `GUARDIAN_SIGNAL_FILE` to a local JSON file containing exactly:

```json
{"timestamp":"2026-10-07T00:00:00.000Z","priceChange5mPct":0,"priceChange1hPct":0,"volatilityScore":20}
```

Update its UTC timestamp as new demo samples are produced. An old timestamp stays old; repeated reads cannot manufacture freshness. This is a labeled scenario input, never a real evidence source.

## Reproducible verification

`pnpm typecheck`, `pnpm test`, `pnpm build` cover contracts, modules, routes, persistent event state, recovery, crash/unknown outcomes and journal-before-broadcast. Fork live tests are opt-in and must not be counted as passed when skipped.

After building, `node scripts/verify-guardian-fork.mjs <absolute-anvil-executable> <read-only-mainnet-rpc>` starts isolated Anvil (18545) and Next (3107), creates a disposable key in process memory, prepares local gas/WETH, saves policy through HTTP, starts server monitoring and verifies real Fork swaps. It tests duplicate manual calls, pause/resume, process restart, three-sample recovery and a second event. The report and local logs are written under ignored `.guardian/acceptance-*`; it stops its own child processes at exit. It does not modify a developer's existing Fork or port 3000 service. Upstream RPC availability is required.

## Handoff boundaries

- A: replace the integration read bridge with your Fork portfolio/market adapters using these balance/valuation/freshness conventions.
- B: provide real independent market/anomaly observations and calibrate recovery; do not use lower exposure or confidence as recovery.
- C: D wraps the signing client to persist hashes before broadcast and sanitizes C error strings; no shared schema or C module change was needed. Durable unknown receipt resolution is owned by D. Future C adapter changes must preserve the injected client seam and snapshot callbacks.
- Review halted events manually against stored hashes, chain nonce, receipt and wallet state. No HTTP reset/retry endpoint is intentionally provided in this first single-event implementation.
