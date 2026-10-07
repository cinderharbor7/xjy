---
source: "User-approved A/B/C/D integration PR; D-to-A Fork read-side handoff in this conversation; existing D2C-handoff.md"
status: ready
slices:
  - id: P-001
    status: done
    depends: []
  - id: P-002
    status: done
    depends: [P-001]
  - id: P-003
    status: done
    depends: [P-002]
---

# Team Guardian integration

## Goal And Boundaries

Integrate the four published deliveries on `codex/integrate-guardian`, preserve their commit history, validate the combined behavior, and publish a reviewable PR against `main`. Sources are A `f14699e`, B `21eab08`, C `c062479`, and D `dba34bf` (implementation `eef9e09`, latest D-to-A handoff); starting main is `bc1d504`. Main itself is not merged or overwritten by this task.

Preserve frozen domain schemas, Policy-only authorization, structured execution, independent after reads, and one swap per durable risk event. A's native ETH/mainnet read-only data and Fork's WETH/local execution remain explicitly distinct. B's transparent rule analysis is not a fitted predictive model or a real LLM. No mainnet writes, BOT Chain deployment, wallet custody, or additional product features are introduced. Existing D SQLite event persistence is retained as required by the previously confirmed monitor scope.

## P-001 Combined branch baseline

Merge D and C, then A and B, resolving shared documentation/configuration sequentially. Keep the Dashboard and research page. The combined source tree must install using the frozen lockfile and pass the inherited test suite before integration fixes.

> writes: `README.md`, `.env.example`, `package.json`, `pnpm-lock.yaml`, inherited branch files
> anchors: integrate all published branches; preserve existing valid code; do not merge main
> verify: `pnpm install --frozen-lockfile`; `pnpm test` — inherited combined baseline: 641 passed, 2 opt-in Fork tests skipped
> review: shared schema and execution boundary changes must remain explicit

## P-002 Verified read and analysis boundaries

Connect A's real read-only snapshot getters to B's frozen RiskAnalysis through a read-only composition entry. Correct normal sell-pressure descriptions and prevent repeated identical references from inflating the confidence heuristic. Preserve the original fixed Mock demo and label its investigation as Mock.

For the local Fork, enforce protected-wallet identity, WETH/USDC ERC20 balances and decimals, approved pair identities, positive reserves, verifiable canonical block/time, one before observation shared with its quote, and independent after reading. Reconcile receipt/block time without manufacturing chain timestamps. Preserve simulated balances across untriggered monitor observations.

Real sell-pressure monitoring/recovery calibration is deferred: B did not deliver a recovery contract; the existing Fork monitor continues using explicitly labeled demo market changes and Mock investigation. A/B's real read-only analysis can be accepted separately without enabling trading on that feed.

> writes: `src/modules/onchain/`, `src/modules/investigation/onchain-investigation.adapter.ts`, `src/integration/`, `scripts/`, `tests/`, relevant documentation/configuration
> anchors: D-to-A read-side handoff; A-to-B stable contracts; existing Demo behavior; independently read after; truthful source labels
> verify: targeted read/analysis/runtime tests, then `pnpm typecheck` and `pnpm test`
> review: independent review of exact integration diff, data provenance, authorization and replay boundaries

## P-003 Acceptance and reviewable PR

Run the final combined build, real HTTP smoke and isolated local Fork acceptance where the available read-only RPC permits it. Record exact fresh results and any unavailable or skipped checks. Publish the integration branch and create a PR against main with the concrete resulting behavior and limitations.

> writes: `docs/team-integration-acceptance.md`, `README.md`, `docs/guardian-monitor.md`, this plan, PR description
> anchors: typecheck/test/build; complete Fork path; validation criteria; publish integration PR
> verify: `pnpm install --frozen-lockfile`; `pnpm typecheck`; `pnpm test`; `pnpm build`; isolated HTTP/Fork verification; `git diff --check`; PR URL and attached artifact
> review: fix Critical/Important independent findings and freshly verify before publication

## Integration And Final Verification

- Default Mock rescue and persistent event gating remain usable without keys.
- A/B read-only analysis includes source evidence and never gains Executor access.
- Fork request/protected/signing wallets agree case-insensitively; tradable ETH is WETH and gas ETH is excluded.
- Receipt evidence, fresh balances and verification remain distinct; unknown submissions cannot be resent.
- Preserve the research fixture page and independent Aave read-only extension.
- Report skipped opt-in tests separately from actual isolated Fork acceptance.

## Handoff And Residual Risks

- Real Guardian anomaly feed and recovery calibration remain a B/D follow-up; current rules and confidence are transparent heuristics.
- USDC at $1 and Fork historical price changes remain explicit demo assumptions.
- Upstream RPC availability can block a fresh Fork run; no retry or Mock substitution may hide it.
- Resume from the frontmatter; use the captured source commits and current clean/merged state before fetching new team changes.

Publication: [PR #3](https://github.com/cinderharbor7/xjy/pull/3) was created against main; the original integration task did not merge main. The user subsequently authorized merging and a README update on 2026-10-07. PR #3 merged at `2026-10-07T03:53:48Z`, preserving integration history in commit `3d264a2`. Local main was fast-forwarded to the merge. The README and acceptance record now include the later Computer use checks and the pending V2 work; no V2 implementation or BOT deployment is included. GitHub CI results remain separate from local acceptance.
