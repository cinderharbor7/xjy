# BOT report attestation

## Scope and branch
User requested independent BOT Chain 968 report attestation via MetaMask; preserve Ethereum risk analysis and local Fork execution. Branch d/bot-report-attestation starts at D branch dba34bf; main is under review, so this is a stacked feature branch. Keep incoming next-env.d.ts local modification. No browser/visual inspection.

## Implementation
Versioned canonical JSON report envelope for Guardian events, standalone sessions, and ETH research snapshots. Full source provenance retained; no unrelated execution appended to research. Solidity hash/publisher/time registry, per-publisher duplicate protection; pinned solc 0.8.30 / Paris compiler artifact. Dedicated /attestations page with MetaMask deploy/publish, receipt progress/resume, download/upload, and independent tamper/chain verification. No server private key or automatic wallet operation.

## Evidence and next steps
BOT RPC returned chain id 0x3c8. Full suite: 359 passed, 6 optional integration cases skipped. New contract was actually deployed on isolated Anvil and 4/4 EVM tests passed separately. Contract artifact reproducibility, typecheck and build passed. Production HTTP page/feed returned 200; reading the report page left the monitor paused with no events. No visual checks. Real BOT deployment/publication remain user wallet steps, documented in docs/bot-report-attestation.md. Next: commit/push stacked branch and draft PR; retain incoming next-env.d.ts modification.
