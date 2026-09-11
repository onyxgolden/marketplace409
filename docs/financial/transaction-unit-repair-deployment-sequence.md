# Financial FORGE transaction-pipeline unit-scaling repair: safe deployment sequence

**Status:** Documentation for a reviewed, not-yet-executed correction. Nothing in this document has
been applied to production. See PR (branch `fix/financial-event-import-minor-unit-conversion`) for
the code/migration/test changes this sequence governs.

**Revised after review:** the repair migration's safety no longer depends on a "no webhook arrives
during a narrow manual window" assumption. Every event the corrected import code creates carries a
structural, immutable `metadata.amountUnitVersion` marker (see
`src/domains/financial-event/minorUnitsToDecimalDollars.ts`'s
`CANONICAL_TRANSACTION_AMOUNT_UNIT_VERSION`), stamped by the shared import service itself — never
chosen or interpreted by provider-specific code. The migration's targeting predicate excludes any row
already carrying the current version, so it is safe to apply even if a webhook delivers a new,
already-correct event immediately before the migration runs. The deploy-before-repair order below is
still the sensible default (no reason to apply a repair before the fix that prevents new corruption
is live), but the operation no longer *relies* on that ordering being followed within any particular
time window for its correctness.

## The sequence

1. **Merge and deploy the corrected application code** (`financial-event-import.service.ts`'s use of
   `minorUnitsToDecimalDollars` and the `amountUnitVersion` stamp). Wait for the deployment to become
   fully ready — do not proceed to step 2 while a deploy is still in progress.
2. **Confirm the deployed code is actually the corrected version.** Do not assume the deploy succeeded
   just because it reported success — verify (e.g. check the deployed commit SHA matches the merge
   commit).
3. **Capture pre-repair counts**, grouped three ways, using the read-only `supabase db query --linked`
   mechanism used throughout this program's diagnosis:
   ```sql
   -- By provider and amount-unit version (NULL version = pre-versioning legacy rows).
   select metadata->>'provider' as provider, metadata->>'amountUnitVersion' as amount_unit_version, count(*)
   from financial_events
   where source_system = 'transaction'
   group by provider, amount_unit_version
   order by provider, amount_unit_version;

   -- By repair status.
   select (metadata ? 'unitRepair') as already_repaired, count(*)
   from financial_events
   where source_system = 'transaction' and metadata->>'provider' in ('stripe_financial_connections', 'plaid')
   group by already_repaired;

   -- The reusable function the migration itself uses -- the authoritative "how many rows need
   -- repair right now" count.
   select financial_events_unit_repair_qualifying_count();
   ```
   (The last query requires the migration's functions to already exist, which only happens once the
   migration is applied — run it as part of step 5's post-repair verification, or apply the migration
   file's function-definition statements alone, ahead of the full repair, if a true pre-repair count
   from this exact function is wanted. The first two queries work at any time, migration applied or
   not.)
4. **Apply the repair migration** (`20260911000000_repair_transaction_pipeline_unit_scaling.sql`)
   *separately* from the application deploy — not bundled into the same release step. Its own
   fail-closed guard (`assert_financial_events_unit_repair_within_ceiling`) aborts with no changes made
   if the qualifying count unexpectedly exceeds 5000.
5. **Capture post-repair counts and prove all four of these**:
   - **Zero recognized-provider old-version rows remain**:
     `select financial_events_unit_repair_qualifying_count();` returns `0`.
   - **Every post-fix event carries the current unit version**: re-run the by-provider/by-version
     grouping query from step 3 — every `stripe_financial_connections`/`plaid` row's
     `amount_unit_version` is now `1` (either because it always was, or because the repair just set
     it), and no row of a recognized provider has a `NULL` or lower version.
   - **Newly-correct rows were not divided a second time**: for any row known to have been created
     *after* the deploy confirmed in step 2 (i.e. genuinely new, never corrupted), confirm its
     `amount` is unchanged from what it was immediately after import and that it carries no
     `unitRepair` marker — the migration's predicate excludes these by construction (proven in
     `20260911000000_repair_transaction_pipeline_unit_scaling.migration.test.js`'s adversarial
     fixture), but this step confirms it against real production rows, not just the fixture.
   - **Every repaired row changed exactly once**: `select count(*) from financial_events where
     source_system = 'transaction' and metadata->'unitRepair' is not null` should equal the exact
     qualifying count captured in step 3's repair-status query (no more, no fewer) — and re-running
     `financial_events_unit_repair_qualifying_count()` a second time (step 5's first bullet) already
     proves idempotency: a nonzero result here would mean some rows were repaired more than once,
     which the function's own predicate structurally prevents.
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
