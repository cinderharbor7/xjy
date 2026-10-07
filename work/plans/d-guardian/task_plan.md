# D: Guardian monitoring and integration

## Scope
Implement README + D2C handoff on `d/guardian-monitor-integration`, from main bc1d504; integrate C 30d5bbb without changing frozen domain contracts. Keep existing generated next-env.d.ts changes out of commits. No visual/browser inspection.

## Decisions
- One fixed server-bound wallet; MOCK default, explicit local FORK only. WETH is displayed under logical ETH; gas excluded.
- SQLite durable config/version, monitor state and event/execution journal. Lock plus pre-broadcast intent prevents duplicate sends, including process death. No automatic retry of swap.
- Every 10s; recovery: volatility <=40, 5m change >=-0.5%, 1h >=-2%, three distinct fresh observations; engineering demo parameters, not a B-validated financial model. Independent of balances/confidence.
- C policy validator reused. Policy snapshot frozen per event. Dedicated monitor/API schemas, core contracts unchanged.
- Fork balances/spot quote read through integration bridge pending A; investigation and market changes remain explicitly synthetic. Persistent signed transaction hash before broadcast; only receipt lookup after unknown outcome.

## Current state
Implementation complete. C 30d5bbb merged into D branch. SQLite policy/version/lease/event journal, server timer, manual shared gate, Fork integration/read bridge, pre-broadcast signed hash journal, receipt recovery, API/UI and documentation implemented. Shared domain contracts and A/B/C module ownership preserved.

## Evidence
- Final typecheck/build passed; 345 tests passed, 2 opt-in C tests skipped.
- Actual local Anvil HTTP workflow passed: first swap, independent verification, repeated manual request 409, pause/resume, terminating/restarting Next, three-sample market recovery, second event one swap and verification PASSED. Full details: docs/guardian-monitor-acceptance.md. Local report .guardian/acceptance-1791340498968/report.json.
- Final production HTTP smoke verified same-origin browser headers after Next URL normalization, foreign-origin rejection and duplicate 409. No visual/browser inspection.
- Native Anvil installed under ignored .guardian/tools; acceptance used disposable generated keys in child process environments only and stopped its own nodes/servers.
- Next-generated forwarding headers and separate instrumentation/route error-class bundles required integration repairs; tests cover both.
- GitHub CLI authentication returns suspended-account 403; Git fetch works. Commit/push/PR delivery is next; do not merge main.

## Acceptance
Policy normalization/version/wallet/origin errors; server-driven start/pause/restart; repeated/concurrent/manual calls; unknown receipt and reread failures; market recovery hysteresis; no raw errors/keys; HTTP smoke, typecheck, tests, build. Fork end-to-end only claimed if actually executed. Commit/push branch and create draft PR if access permits; never merge main.
