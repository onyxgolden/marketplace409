# Slice 5 Discovery Note — Actionable Intelligence Surface

## Reused sources and contracts

### 1. Brain query API (`src/app/api/forge/engineering-brain/query/route.js`)
- Auth: `ProgrammerAuthorizationApplication` → 404 on unauthorized (same "don't reveal" pattern as page gate).
- Data: Supabase `fetchLatestRun`, `fetchAllRecordsForRun`, `fetchBugFixesForRun` via `readEngineeringBrainFromSupabase.mjs`.
- Returns: `latestRun {generatedAt, commitSha, extractorVersion}`, query `result`, `related_fixes[]`.
- RLS: caller's cookie session; `is_forge_programmer()` enforced by Postgres.
- Excerpts never resolved server-side (no git on Vercel).

### 2. Runtime coverage registry (`scripts/engineering-brain/runtimeCoverageRegistry.mjs`)
- Static `CAPABILITIES` array (~21 entries): id, name, execution_path, trigger {kind, crons/description}, moves_money, durable_evidence[], expected_cadence, monitoring_status.
- `MONITORING_STATUSES`: covered | partially-covered | uncovered | unable-to-verify.
- Pure, importable, no I/O. Safe to bundle into API routes and UI.

### 3. Bug catalog (`scripts/engineering-brain/query/searchBugCatalog.mjs`)
- `searchBugCatalog({records, queryText, maxResults})` — keyword overlap ranking, newest-first ties.
- Records: {sha, date, subject, pr, class, files[]}.
- Sourced per-run from Supabase via `fetchBugFixesForRun`.

### 4. Watchdog alert state (`~/workspace/brain-watchdog/alert-state.json`)
- LOCAL FILE on operator VM. Shape: `{ "<capability>|<slot_iso>": {state, first_seen_at, resolved_at} }`.
- States observed: "ambiguous". Watchdog scheduler DISABLED.
- **Not readable from Vercel.** Dashboard must NOT claim live watchdog monitoring.
- Dashboard reports watchdog as `enabled: false` with explicit "not actively monitoring" wording.

### 5. Existing UI (`src/components/forge/developer/EngineeringBrainPanel.jsx`)
- Client component, SWR-based query interface, programmer-gated page.
- `RelatedFixesSection` already renders `related_fixes` — reuse its visual language.

## Gap analysis

| Slice 5 requirement | Existing coverage | Gap |
|---|---|---|
| Unified health overview | Query UI only; no aggregate view | NEW: health API + dashboard component |
| Runtime coverage visibility | Static registry exists, not surfaced in UI | NEW: surface via health API |
| Evidence-linked findings | Bug catalog + related_fixes exist as data | NEW: finding assembly with dedup + confidence |
| Regression awareness | `searchBugCatalog` is keyword-based | NEW: file-path matching against bug catalog |
| Review handoff drafts | None | NEW: pure formatter, client-side preview/copy |
| Watchdog status honesty | Disabled, local-only state | Must explicitly show "not enabled" |

## Implementation plan

### New pure modules (`scripts/engineering-brain/health/`)
1. `aggregateHealth.mjs` — `aggregateHealth({capabilities, latestRun, bugFixCount})` → snapshot with per-section {state, freshness, provenance}. States: confirmed | suspected | unavailable | stale | not-enabled.
2. `assembleFindings.mjs` — `assembleFindings({capabilities, bugFixes, latestRun})` → findings[] with {id (stable dedup key), what, subsystem, whyItMatters, confidence, lastSeen, evidenceLinks[], nextStep}. Dedup by `capability_id` or `bug_sha`.
3. `matchRegressions.mjs` — `matchRegressions({changedPaths, bugCatalog})` → exposures[] with {path, priorFix {sha, subject, pr, date}, matchedFiles[], reason}. File-path overlap only; no LLM matching.
4. `formatHandoffDraft.mjs` — `formatHandoffDraft({title, findings, files, questions})` → markdown string. Pure, no I/O.

### New API routes (same auth pattern as query route)
5. `src/app/api/forge/engineering-brain/health/route.js` — GET returns health snapshot. Reads Supabase latest run + bug fix count; imports static CAPABILITIES.
6. `src/app/api/forge/engineering-brain/regression-check/route.js` — POST {paths[]} returns exposures. Reads bug catalog from Supabase.

### New UI
7. `src/components/forge/developer/BrainHealthDashboard.jsx` — sections: Runtime coverage, Index freshness, Known defects (recent fixes), Risks, Watchdog status (disabled notice), Handoff draft builder (client-side, preview/copy).

### Tests
- `aggregateHealth`: stale/missing run, empty capabilities, not-enabled watchdog wording.
- `assembleFindings`: dedup by stable id, confidence wording never claims "root cause".
- `matchRegressions`: exact file match → exposure; no overlap → empty; does NOT claim regression occurred.
- `formatHandoffDraft`: no side effects (pure string), contains all sections.
- API routes: 404 on unauthorized (mirror query route tests).
- UI: renders sections, shows disabled watchdog honestly.

## Non-goals (per assignment)
- No watchdog activation, no cron changes, no new polling.
- No merges, deploys, autonomous fixes, production writes.
- No new notification channels, no new AI dependencies.
- Alert-state.json stays local; dashboard does not read it.
