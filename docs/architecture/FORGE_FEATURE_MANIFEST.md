# Forge Feature Manifest

Status checkpoint after Step 15. Feature table below is unverified since Step 15 - see FORGE_STATUS.md for current capability status.

## Verified Green State

- Branch: main
- Tests: 338 files passing
- Test count: 1,677 passing
- Production build: passing
- Verified: 2026-07-31 via npx vitest run and npm run build

## Feature Status

| Feature | Status | Evidence |
|---|---:|---|
| Net Worth domain | Present | src/domains/networth |
| Forge Net Worth UI | Present | src/app/forge/page.js imports NetWorthService |
| TraceResolver | Present | src/domains/ledger/trace/TraceResolver.js |
| TraceQueryService | Present | src/domains/ledger/trace/TraceQueryService.js |
| TraceIntelligenceService | Present | src/domains/ledger/trace/TraceIntelligenceService.js |
| TraceExplorerService | Present | src/domains/ledger/trace/TraceExplorerService.js |
| useTraceExplorer hook | Present | src/domains/ledger/trace/useTraceExplorer.js |
| Trace Explorer UI panel | Not currently mounted | src/app/forge/page.js does not import useTraceExplorer |
| AuditEntry domain | Present | src/domains/audit/AuditEntry.js |
| AutonomousAuditAgent | Present | src/domains/audit/AutonomousAuditAgent.js |
| Live Audit Dashboard UI | Present | src/app/forge/page.js has Live Audit tab |
| Risk Scoring Engine | Not started | Step 16 planned |

## Current Observability Flow

Ledger
→ TraceResolver
→ TraceIntelligenceService
→ AutonomousAuditAgent
→ Live Audit Dashboard UI

## Important Rule

Do not assume a feature exists because a previous session planned it.

Before modifying Forge UI, inspect:

```bash
grep -nE "NetWorthService|useTraceExplorer|autonomousAuditAgent|Live Audit|trace|audit" src/app/forge/page.js
```
