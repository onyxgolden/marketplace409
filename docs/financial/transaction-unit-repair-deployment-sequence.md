# Financial FORGE transaction-pipeline unit-scaling repair: safe deployment sequence

**Status:** Documentation for a reviewed, not-yet-executed correction. Nothing in this document has
been applied to production. See PR (branch `fix/financial-event-import-minor-unit-conversion`) for
the code/migration/test changes this sequence governs.

## Why this needs a specific order, not just "merge and apply"

A migration applied while old (buggy) application code is still processing Stripe Financial
Connections webhooks/imports could repair the current backlog of corrupted rows, and then let
another incorrectly-scaled row land moments later from an in-flight or newly-triggered sync — the
exact defect, reintroduced, undetected, because the repair already "ran." The corrected application
code and the one-time data repair must be sequenced, not simultaneous.

## The sequence

1. **Merge and deploy the corrected application code** (`financial-event-import.service.ts`'s use of
   `minorUnitsToDecimalDollars`, plus the new/updated tests). Wait for the deployment to become fully
   ready — do not proceed to step 2 while a deploy is still in progress.
2. **Confirm the deployed code is actually the corrected version.** Do not assume the deploy
   succeeded just because it reported success — verify (e.g. check the deployed commit SHA matches
   the merge commit, or exercise a safe read-only check confirming the new code path is live) before
   trusting that any *new* transaction-sourced `financial_events` row written from this point forward
   will be correct.
3. **Pause or account for any in-flight Stripe Financial Connections import.** If this repository's
   import/refresh infrastructure supports safely pausing or waiting out an in-flight sync, do so
   before proceeding. If it does not support a safe pause, at minimum confirm no import was actively
   running at the moment of deployment (step 1) — a transaction imported by the *old* code moments
   before deploy, or by the *new* code moments after, must not be ambiguous about which one wrote it.
4. **Apply the repair migration** (`20260911000000_repair_transaction_pipeline_unit_scaling.sql`)
   *separately* from the application deploy — not bundled into the same release step. By this point,
   every existing `source_system = 'transaction'` row with a recognized provider and no
   `unitRepair` marker is known to be a genuinely pre-fix, corrupted row (see step 1-3); the migration
   corrects all of them in one idempotent pass and fails closed (raises, changes nothing) if the
   qualifying row count is unexpectedly large.
5. **Requery for two things**, using the same read-only `supabase db query --linked` mechanism used
   throughout this program's diagnosis:
   - **Unrepaired pre-fix rows**: `source_system = 'transaction' AND metadata->>'provider' IN
     ('stripe_financial_connections', 'plaid') AND metadata->'unitRepair' IS NULL` should return
     zero rows dated before the deploy confirmed in step 2.
   - **Incorrectly-scaled post-fix rows**: any `source_system = 'transaction'` row created *after*
     the deploy confirmed in step 2 should already be correctly scaled (no `unitRepair` marker
     needed, because the new code never mis-scales it in the first place) — spot-check a few real
     post-deploy rows against their known real-world amount if any exist by the time this step runs.
6. **Clear or allow the 5-minute Financial dashboard session cache to expire naturally**
   (`src/app/forge/financial/dashboardCache.js`, `DASHBOARD_CACHE_TTL_MS`). The cache was never the
   root cause of this regression, but a cached pre-repair view could still be shown to a user who
   loaded the dashboard shortly before the repair completed, for up to 5 minutes afterward.
7. **Verify the production dashboard directly** at `/forge/financial`, Business → All Time: confirm
   historical years are visible and no longer flattened, 2026 no longer shows an extreme negative net
   value, and the "Transfers & Other" / total-expenses figures are back in a plausible range.

## Expected production reconciliation (from the read-only diagnosis, 2026-09-11 — re-verify at
## repair time rather than trusting these as still-current)

- **Qualifying row count**: 209 (`source_system = 'transaction'`, `provider =
  'stripe_financial_connections'`, all dated 2026; 0 Plaid rows existed at diagnosis time).
- **Sum of `abs(amount)` before repair**: $47,860,258 (raw, pre-repair stored value).
- **Sum of `abs(amount)` after repair**: $478,602.58 (exactly 1/100th — the corrected total).
- Re-run the exact grouping queries from the diagnosis (`GROUP BY source_system`, `GROUP BY year,
  transaction_kind, category`) both immediately before and immediately after applying the migration,
  and diff the results — this is the authoritative proof, not the numbers written down here, which
  will drift if any new Stripe activity syncs between diagnosis and repair.

## Rollback if something goes wrong mid-sequence

- **Before the migration is applied** (steps 1-3): rolling back is just reverting the application
  deploy — no data was touched.
- **After the migration is applied** (step 4 onward): the migration is not designed to be reversed by
  re-running it (it is idempotent forward, not reversible) — but every repaired row's
  `metadata->'unitRepair'->>'priorAmount'` preserves the exact pre-repair stored value, so a
  hand-reviewed corrective UPDATE (setting `amount = (metadata->'unitRepair'->>'priorAmount')::numeric`
  and removing the marker, for a *specific, reviewed* set of row ids — never a blanket re-reversal
  triggered automatically) remains possible if a genuine mistake is discovered. This is a manual,
  reviewed recovery path, not an automated rollback migration, consistent with this program's
  discipline against automated production correction without explicit authorization.
