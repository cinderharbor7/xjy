# Task: Unified vanilla frontend and per-asset fingerprints

## Goal
Integrate the complete currency-fingerprint project into xjy, replace all served React/Next frontend pages with HTML/CSS/JavaScript/Tailwind, reorganize the original features around per-asset fingerprints. Swiss layout, existing xjy paper/ink/moss/clay palette. No browser launches, screenshots or visual checks; user owns visual acceptance.

## State
- Read current xjy routes, schema contracts, UI, styles, docs. Branch d/bot-report-attestation; pre-existing next-env.d.ts edit must remain unchanged.
- Features to preserve: Guardian policy versioning/start/pause/manual execution/event history/independent verification; ETH Risk Lab; transaction checks; Aave read-only; BOT report export/import/deploy/publish/receipt/verification; fingerprint market/details/NFT.
- Integrated native web shell, all original workbench pages, per-asset fingerprints, market adapters, NFT contract and docs. React/Next dependencies and frontend files retired; original API handlers use standard Responses.
- Complete: typecheck/build; 927 Vitest passed + 6 environment-gated skipped; 5 fingerprint/local NFT tests; registry compiler check; 11-route isolated HTTP checks including policy/Mock execution/deduplication.
- User visual acceptance remains intentionally unperformed. New preview http://127.0.0.1:3100 is isolated MOCK, initially paused; existing 3000 process was not restarted.
- Engineering implementation and verification complete. Deliver via the requested branch commit; next-env.d.ts remains excluded. User visual acceptance and real-chain confirmations are outside the completed checks.

## Decisions
- One web/ frontend, one Node HTTP origin. Keep TypeScript domain services and frozen API schemas; replace NextResponse with standard Response without changing contracts.
- Existing /investigate, /risk-lab, /position, /attestations URLs remain. Guardian moves to /guardian; / is asset-centric overview; /coins/:id integrates data, fingerprints and applicable research tools; /collection for NFT.
- Coin identity is registry-backed. ETH-only tools remain ETH-only. USDC/WETH appearances receive identity fingerprints without fabricated market/sentiment data or implied support for trading additional assets.
- Existing .guardian state, secrets, other running services and active 3000 server remain untouched. Functional checks and preview use a separate port and isolated MOCK SQLite state, no mainnet/Fork operations.
- User subsequently requested branch + commit. Work moved to codex/unified-vanilla-fingerprints; commit only task-owned changes, exclude pre-existing next-env.d.ts. No push/public deployment/real NFT transactions requested.
- Preserve provenance, duplicate trade gates, report hashing and receipt checks. No AI/Agent features introduced.

## Migration
- Integrate standalone src into web/, data server into server/; docs in docs/currency-fingerprint; Solidity in contracts and scripts; tests retained.
- Archived 21 original source/config/doc files under ignored work/archive/currency-fingerprint-original with SHA-256 verification (output/fingerprint-archive-manifest.json). Original parent directory was process-locked; moving source entries succeeded, leaving runtime caches plus a migration README. Original task-owned 5173 server stopped after replacement preview verification. No unrelated processes were stopped.

## Verification evidence
- tests/frontend: DOM-only user actions, provenance/precision, invalid query, policy versioning, pending report transaction lock, tampered report rejection, all-asset navigation/search. No browser or screenshots.
- scripts/verify-web.mjs: native server start with separate SQLite; 11 page URLs and static resources; cross-origin rejection; invalid tx hash; preserved risk mode; threshold change yields NONE, approved Mock run yields verification PASSED/70% risk exposure, second request blocked 409.
- tests/fingerprint: local EVM 968 deploy, metadata, owner/hash, duplicate and invalid URI rejection, transfer. No public BOT transactions.
- Unresolved limitations: user visual acceptance; optional Fork/local-registry endpoint suites skipped; third-party Zod annotation warnings; optional Ganache native module falls back to JS.

## Follow-up: production fluid rendering
- Remote verified with ls-remote + fetch: feature branch absent, main does not contain 5705c98; no push or merge performed.
- Reproduced source vs production Shader Park: source creates Mesh, minified production throws `ReferenceError: input is not defined` during runtime DSL compilation.
- Fixed by precompiling DSL to GLSL at build time, loading one Three.js renderer in the browser; added contextual errors and resource cleanup instead of generic device blame.
- Checks passed: 5 fluid lifecycle/material tests + existing home test; production regression creates all 8 materials with eval disabled and verifies browser compiler absent; typecheck and build. No browser or GPU visual check.
