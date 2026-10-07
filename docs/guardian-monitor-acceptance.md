# D integration acceptance

Baseline: main `bc1d504`; C code integrated at `30d5bbb`; branch `d/guardian-monitor-integration`.

## Actual local Fork run

Recorded UTC: `2026-10-07T02:36:15.232Z`. Local artifact: `.guardian/acceptance-1791340498968/report.json` (ignored runtime output).

Anvil 1.7.1 on 127.0.0.1:18545 forked a read-only Ethereum RPC. A randomly generated disposable wallet received gas through Anvil and wrapped 10 ETH on the local Fork. Next production server used port 3107 and its own durable database. No mainnet writes or browser/visual inspection occurred. Both child processes were stopped after validation.

HTTP policy was saved with risk threshold 60, exposure threshold 10%, confidence 0.85 and maximum reduction 30 percentage points, to allow a second event with the reduced wallet balance. Market changes and investigation were demo inputs throughout; balances, quotes, swaps and re-reads were real on the local Fork.

| Event | WETH sold | USDC received | Exposure before → after | Independent verification |
| --- | ---: | ---: | --- | --- |
| First | 3 | 7,810.776302 | 100% → 70.04715899195948% | PASSED |
| After recovery | 2.997980261042498 | 7,793.722263 | 70.04715899195948% → 40.05599423671217% | PASSED |

Local Fork swap hashes (not mainnet explorer references):

- First: `0xd166013b0ffe3cb690037b7e082557ed0ddbf4d7be4ed930fea0f2f81c9a4fff`
- Second: `0xa0857ca070156ef290e3f8a0165fbbf0b175b7c7e92f4026ea1f56db4f996250`

The first event was retained after a repeated manual request (409), pause/resume and terminating/restarting the actual Next server. No second swap appeared during continued high risk. Three fresh calm samples closed the event at `2026-10-07T02:36:04.030Z`. A later high-risk sample created the second event; each event had exactly one recorded SWAP intent. Approval records were distinct from swaps.

## Automated checks and limits

Final checks: `pnpm typecheck` passed; `pnpm test` reported **345 passed, 2 skipped** (19 passing files and the one opt-in C suite skipped); `pnpm build` passed. Production HTTP smoke on the final build returned page 200, browser-style same-origin controls 200, foreign-origin 403, Mock rescue verification PASSED and duplicate manual execution 409. The HTTP smoke exercised Next's real Host normalization and instrumentation/route bundle boundaries.

Unit/integration coverage includes SQLite persistence across connections, concurrent entry, interrupted reservation, unknown hash lookup while paused, market-only recovery, stale/duplicate samples, config version and wallet mismatch, failed verification, signed hash persistence before broadcast, failed journaling preventing broadcast, local node identity, API error sanitization and separate execution/verification UI labels.

The opt-in C `tests/fork-integration.test.ts` suite is skipped in the ordinary test run (2 cases). The full D HTTP/Fork acceptance above is separate and was actually executed using `scripts/verify-guardian-fork.mjs`; it does not claim those skipped C cases passed. No real A/B anomaly/LLM integration or mainnet trading was tested. Recovery constants still require B calibration. No visual review was performed at the user's request.
