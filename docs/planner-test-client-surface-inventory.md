# Planner owner-only test client — surface inventory matrix

Slice: owner-only test client with DB-enforced isolation + sample loader.
Migrations: `20261117120000_forge_planner_owner_test_visibility.sql`
(visibility) and `20261117130000_forge_planner_test_samples_cleanup.sql`
(loader / preview / purge).
Base: main `7f6509e1`. Migration application to production is on explicit
HOLD (brief gate) — this matrix covers the code + migration state, not a
production apply.

## How to read this matrix

Every row names the **surface** (where a test row could leak), the
**table / RPC** it reads or writes, the **effective role** (who the
database sees), the **test filter** (what keeps test rows from a
non-owner), and the **negative proof** (the test that fails if the filter
is removed). "Owner" below always means the platform owner identity
(`auth.uid()::text = p_owner_id` plus the existing platform/actor owner
authorization) — never `has_workspace_access`, never a co-owner role,
never a caller-supplied flag.

The appended RLS predicate (migration 1, on every replaced policy) is:

```sql
has_workspace_access(owner_id)
  AND forge_has_app_entitlement(owner_id, 'planner')
  AND (NOT forge_test_<x>_is_test(owner_id, <linking id>)
       OR auth.uid()::text = owner_id)
```

The policy diff is clean: 68 policies replaced, only the test predicate
appended, 0 policies added or removed. `anon` holds no SELECT grant on
any table below (asserted as a `permission denied` error, not 0 rows).

## A. DB layer — tables with replaced SELECT/INSERT/UPDATE/DELETE policies

55 tables. A non-owner's direct `SELECT`/`JOIN` against any of them
returns 0 test rows; the owner sees test rows only when acting as the
platform owner. Proof for the whole family: migration test
`plannerTestClient.migration.test.js` (16/16, PGlite + real PG16,
five identities: owner / Brandy co-owner / ordinary member / unrelated
owner / anon), plus non-vacuity proofs 1 and 3 below.

| Surface family | Tables | Linking id the predicate resolves through |
|---|---|---|
| Hierarchy | `forge_clients`, `forge_sites`, `forge_projects`, `forge_hierarchy_audit` | client / site / project ancestry (immutable FK chain) |
| Packages | `forge_work_packages` | `forge_project_id` → project → site → client |
| Steps | `forge_work_steps`, `forge_work_step_order`, `forge_work_step_revisions`, `forge_work_step_curve_placements`, `forge_work_step_curve_placement_revisions`, `forge_work_step_drawing_links`, `forge_work_step_drawing_link_revisions` | `work_package_id` / `step_id` → package → project |
| Links | `forge_work_package_links`, `forge_work_links`, `forge_work_link_confirmations` | `package_id` / `forge_project_id` (polymorphic links resolve through the linked package or project) |
| Baselines | `forge_work_package_baselines`, `forge_work_scope_baselines`, `forge_work_scope_changes`, `forge_work_progress_snapshots` | package |
| Budgets | `forge_work_control_estimates`, `forge_work_control_estimate_revisions`, `forge_work_package_budget_revisions` | package |
| Schedules | `forge_work_manpower_days`, `forge_work_weekly_commitments` | package |
| Drawings | `forge_work_drawings`, `forge_wp_drawing_artifacts`, `forge_wp_drawing_field_redlines`, `forge_wp_drawing_ifc_releases`, `forge_wp_drawing_redlines`, `forge_wp_drawing_review_events`, `forge_wp_drawing_reviews`, `forge_wp_drawing_revisions` | `package_id` |
| Gates | `forge_work_gate_attestations`, `forge_work_gate_evaluations`, `forge_work_gate_overrides` | package |
| Observations | `forge_work_inspection_observations` | package |
| Change orders | `forge_work_change_orders`, `forge_work_change_order_revisions` | package |
| Busts | `forge_work_package_busts`, `forge_work_package_bust_revisions`, `forge_work_package_bust_change_orders` | package |
| Craft | `forge_work_craft_assignments`, `forge_work_craft_assignment_revisions`, `forge_work_craft_rates`, `forge_work_craft_rate_revisions` | package |
| Progress | `forge_work_progress_entries`, `forge_work_progress_revisions` | package |
| Takeoff | `forge_work_takeoff_lines` | package |
| Planning process | `forge_work_planning_process_checklist`, `forge_work_planning_process_instances`, `forge_work_planning_process_revisions` | package |
| Permit annotations | `forge_work_permit_annotations`, `forge_work_permit_annotation_revisions` | package |
| Transitions / deletions | `forge_work_package_transitions`, `forge_work_package_deletions` | package |

Notes:

- `forge_work_document_library` is **not** in this list on purpose: it has
  no package reference at all, so no row can identify a linked package.
  (Verified in the slice: the table carries no `package_id` / project FK.)
- `forge_hierarchy_audit` rows carry the full row JSON of the changed
  hierarchy row, so the audit table gained a denormalized `is_test` flag
  and its policy carries the same predicate; a non-owner cannot read
  test audit rows.
- `forge_work_package_links` gained a denormalized `is_test` flag that
  survives deletion ("once test, stays test forever") so a deleted
  test link never becomes readable as a real link.

## B. DB layer — SECURITY DEFINER RPCs (full-body replacements)

These run as the definer, so RLS does not protect their reads — each
one applies the same visibility predicate itself and proves actor
authority on the actual client ancestor. Replays require fresh
actor/visibility checks before returning a cached receipt.

| RPC | Surface | Test filter / authority proof | Negative proof |
|---|---|---|---|
| `forge_hierarchy_selector` | Project picker data for every work surface | Returns only the caller's visible tree; test subtree only for the platform owner | Migration test: Brandy's selector call returns 1 real client, 0 test; validate on a hidden test project raises `FORGE_HIERARCHY_NOT_FOUND` (non-disclosing) |
| `forge_hierarchy_admin_inventory` | Planner admin inventory (PlannerHierarchyManager) | Same visibility predicate; `canUseOwnerTestData` returned for the owner only | Migration test (inventory rows); component tests (co-owner sees no Test section) |
| `forge_hierarchy_test_inventory` | Test-mode inventory (Real/Test switch) | Owner-only; non-owner gets an empty test tree | Migration test; component test "co-owner sees nothing"; fixture check co-owner case |
| `forge_hierarchy_validate_selection` | Selection validation on every pick | Hidden test project → `FORGE_HIERARCHY_NOT_FOUND` | Migration test |
| `forge_hierarchy_client_create` | Regular client create | Always `is_test = false`; rejects a caller-supplied test flag | Migration test: regular create always real |
| `forge_hierarchy_client_create_test` | Test client create (new) | Owner-only; `FORGE_HIERARCHY_FORBIDDEN` for others; replay returns the same id | Migration test |
| `forge_hierarchy_client_update` / `site_update` / `project_update` | Hierarchy edits | `is_test` immutable — PATCH to it raises `FORGE_HIERARCHY_TEST_MARKER_IMMUTABLE` (even for the setup superuser); no reparenting across the test/real boundary | Migration test (immutability trigger) |
| `forge_hierarchy_client_delete` / `site_delete` / `project_delete` | Hierarchy deletes | Archive-first: direct delete of an active row raises `FORGE_HIERARCHY_NOT_ARCHIVED`; delete only after archive (version 1→2) | Migration test |
| `forge_hierarchy_site_create` / `project_create` | Site / project create | Authority proven on the actual client ancestor; a test parent requires the platform owner | Migration test |
| `forge_work_package_set_project` | Linking a package to a project (projectScope) | Proves authority on BOTH source and destination ancestors; test package → real project raises `FORGE_PRB_TEST_BOUNDARY` (owner); cross-test-client raises `FORGE_PRB_TEST_CLIENT_MISMATCH`; a non-owner addressing a test package gets `FORGE_PRB_PACKAGE_NOT_FOUND` (non-disclosing) | Migration test (all four cases); `projectScope.js` maps them to 409 / 404 |
| `forge_work_planning_process_checklist` | Planning-process checklist RPC | Writes go through the step guard triggers (§C); reads resolve through the package | Migration test non-vacuity proof 2 (drop the three step triggers → a co-owner step-create leaks) |
| `forge_planner_test_load_samples` | Sample loader (migration 2) | Owner-only; project must be a test project (`NOT_A_TEST_PROJECT` otherwise); one transaction, packages born linked (no Unassigned state); idempotent by request id; concurrent loads yield exactly 6 packages / 31 steps | Migration test (load / double-load / concurrent loads / restore semantics) |
| `forge_planner_test_purge_preview` | Purge preflight (migration 2) | Owner-only; lists/counts the full transitive dependent rows from the actual `pg_constraint` inventory; returns a 64-hex digest | Migration test (preview counts + digest) |
| `forge_planner_test_purge` | Transactional purge (migration 2) | Owner-only; expected digest + request id + confirm name must all match (`FORGE_PLANNER_TEST_DIGEST_MISMATCH` / `REQUEST_ID_CONFLICT` / `CONFIRM_NAME_MISMATCH`); non-sample packages attached to the test project are BLOCKERS, not destroyed (`FORGE_PLANNER_TEST_PURGE_BLOCKED`); deletes only positively identified test seed rows in child-before-parent FK order, then projects, sites, client; minimal privileged purge receipt stored outside the deleted subtree | Migration test (purge deletes exactly the scope, real data survives, replay → `alreadyPurged`); real-PG16 23503 proof (non-vacuity 6) |
| `forge_planner_test_purge_scope` | Purge scope helper (migration 2) | Same authority as purge; the scope is computed from the FK graph, not from a caller-supplied list | Migration test |

Supporting functions (not directly callable surfaces): 18
`forge_test_*_is_test` resolvers (one per link type), the
`forge_clients_is_test_immutable` trigger function, and
`forge_test_guard_mutation`.

## C. DB layer — guard triggers and immutability

- **47 guard triggers** (`forge_test_guard_mutation`, one per
  writeable descendant table): a write that would move a row across
  the test/real boundary, or that a non-owner makes against a test
  row, is rejected inside the database — the app layer cannot bypass
  them by calling a different service. Proof: non-vacuity 2 (dropping
  the three triggers the step-create RPC writes through —
  `forge_work_steps` / `forge_work_step_order` /
  `forge_work_step_revisions` — lets a co-owner step-create succeed).
- **Immutability trigger** (`forge_clients_is_test_immutable`): any
  UPDATE touching `is_test` raises
  `FORGE_HIERARCHY_TEST_MARKER_IMMUTABLE`, including for the setup
  superuser. No test→real conversion exists anywhere.
- **Link-confirmation immutability**
  (`forge_work_link_confirmations_immutable`, migration 2):
  `forge_work_link_confirmations` rows are append-only; the purge
  deletes test-linked confirmation rows only under the
  transaction-local `app.forge_planner_test_purge` flag, after the
  durable external purge receipt exists — the audited exception of
  brief §4 option (a). A real-package link row touching the test
  subtree is a PERMANENT purge blocker (history immutable), never
  silently deleted.

## D. App layer — API routes

| Route | Reads / writes | Effective role | Test filter | Negative proof |
|---|---|---|---|---|
| `GET /api/forge/hierarchy` (+ `?mode=test`) | `forge_hierarchy_selector` / `test_inventory` via `hierarchy.js` | Authenticated caller; RPCs enforce visibility | Server returns `canUseOwnerTestData` only for the owner; `?mode=test` without it returns an empty test tree | Route tests 32/32 (`hierarchy/route.test.js`); component tests; fixture check |
| `POST /api/forge/planner/test-data/load` | `forge_planner_test_load_samples` | Authenticated owner | RPC owner check + test-project check | Route tests (`test-data/load/route.test.js`) |
| `GET /api/forge/planner/test-data/preview` | `forge_planner_test_purge_preview` | Authenticated owner | RPC owner check | Route tests (`test-data/preview/route.test.js`) |
| `POST /api/forge/planner/test-data/purge` | `forge_planner_test_purge` | Authenticated owner | RPC owner + digest + request id + confirm name | Route tests (`test-data/purge/route.test.js`) |
| `GET /api/work-packages` (list) | `forge_work_packages` via `workPackages.js` + `projectScope.js` | Authenticated caller (RLS) | RLS predicate (§A); NO_SCOPE returns the chooser state (empty list + Unassigned count), never an all-projects aggregate; `constrainPackageQuery` narrows by scope | Migration test (owner real aggregate vs unfiltered); non-vacuity 4 (remove real-mode exclusion → owner real aggregate includes the 6 test packages) |
| `/api/work-packages/[packageId]/…` (busts, change-orders, attestations, transitions, …) | Child tables + write RPCs (§B) via the work services | Authenticated caller (RLS) or definer RPC | RLS predicate; packageId-scoped — a non-owner cannot address a test package id they cannot see, and the services re-check through `projectScope.js` | Migration test (child-table reads); non-vacuity 3 (remove steps predicate → direct step leak) |
| `GET /api/rental/work-packages?propertyId=…` | `forge_work_packages` via `listWorkPackagesForRentalLedger` | Authenticated caller (RLS), owner-scoped | RLS predicate (§A) AND `property_id` exact match; sample packages are born with `property_id` NULL, so no rental-ledger read can return one | Migration test (Brandy sees 0 test packages by direct SELECT); the route's own `route.test.js` (pre-existing) |
| `GET /api/work-documents` | `forge_work_drawings` (+ document library) | Authenticated caller (RLS) | RLS predicate on drawings (§A); the document library has no package reference, so it cannot identify a package | Migration test (drawings predicate) |
| `/api/work-assets/…` | `forge_work_assets` | Authenticated caller (RLS) | Out of scope — see §H (no package/project/client FK) | — |
| `/api/forge/scheduling/[projectId]/export/{excel,project-xml,xer}` | Scheduling exports | Authenticated caller | No `forge_work_*` read at all (verified by grep: zero matches in the scheduling export routes); scoped by scheduling project id, which is a different domain from hierarchy projects | Grep-verified; no work data in the export |
| `/api/forge/dashboard/…` (summary + transactions) | Financial-event RPCs only (`forge_dashboard_financial_summary_v1`, `forge_dashboard_financial_transactions_v1`) | Authenticated caller | No `forge_work_*` read at all (verified against both dashboard migrations) | Grep-verified; dashboards cannot surface test packages |

Error mapping (added in this slice): `projectScope.js` +
`planningProcess.js` map `FORGE_PRB_TEST_BOUNDARY` /
`FORGE_PRB_TEST_CLIENT_MISMATCH` → 409 and
`FORGE_PLANNER_TEST_NOT_FOUND` → 404. Other services' mappers were
NOT updated — a guard-trigger raise through them surfaces a 500 with
a non-leaking message. Noted here, not hidden.

## E. App layer — services

| Service | Surface | Test handling |
|---|---|---|
| `src/application/forge-shared-hierarchy/hierarchy.js` | `isTest` on every hierarchy row, `canUseOwnerTestData` from the authenticated actor, test-create via `forge_hierarchy_client_create_test`, test inventory | Server-provided flag only; no caller-supplied `isOwner` |
| `src/application/work-management/plannerTestData.js` | Load / preview / purge service (used by the three test-data routes) | Passes through to the migration-2 RPCs; messages aligned to the real RPC strings |
| `src/application/work-management/projectScope.js` | Project-scope resolution for every work-package read/write | Enforces the test/real boundary on link + reparent; maps boundary errors to 409 / 404 |
| `src/application/work-management/workPackages.js` | Package list, detail, rental ledger | `constrainPackageQuery` + scope kinds; RLS is the enforcement, the service never widens it |
| `src/application/work-management/planningProcess.js` | Planning-process writes | Maps the new boundary errors; checklist writes go through the guarded RPC |

## F. UI layer

| Component | Surface | Test handling | Negative proof |
|---|---|---|---|
| `PlannerHierarchyManager.jsx` (in `PlannerAdminClient.jsx` / Planner admin nav) | Owner-only Test data section (`data-testid="planner-test-data-section"`), Real/Test mode switch (default Real), "New test client" button (Test mode only), per-project "Load sample packages" / "Restore missing samples", per-client purge preview (`data-testid="purge-preview-<clientId>"`, typed-name gate, "Delete test data" disabled until the typed name matches exactly), TEST badges on client ("TEST — OWNER ONLY") / site / project | The section renders only when the server says `canUseOwnerTestData`; Brandy/members never see the control or an empty section; Test mode shows only test rows; normal saves confirm in plain words | Component tests 34/34 (incl. co-owner sees nothing; purge typed-name gate); fixture check 15/15 (owner-real / owner-test / co-owner × 360/390/412/430/1919) |
| `HierarchyProjectSelector.jsx` | Project picker used across work surfaces | Test options prefixed "TEST — "; a picked test chain shows a TEST badge (`data-testid="hierarchy-selector-test-badge"`) + "Test project — fictional test data, visible only to the owner." | Component tests (TEST prefix + badge on a test chain; no badge on a real chain) |
| `WorkPackageProjectLink.jsx` | Project link shown on a package | `chainName()` prefixes "TEST — " when `selection.client?.isTest` | Component test (4 tests, incl. a test-chain selection rendering "TEST — Fictional Test Client › Fictional Test Site › Fictional Test Project") |
| `src/app/test-data-fixture/page.jsx` | Dev-only fixture page (production 404, phone-fixture precedent) | `?case=` owner-real / owner-test / co-owner; sets `data-fixture-ready` | Fixture check 15/15, real Chromium 151.0.7922.34 |

Copied URLs: there is no test mode in a shareable URL that reveals
names/IDs — the fixture `?case=` parameter exists only on the dev-only
fixture page; the real admin page carries no mode in the URL, and the
server validates the mode and returns a generic 404 for a non-owner.

## G. Cross-cutting surfaces

| Surface | Finding | Proof |
|---|---|---|
| Service-role / admin client | **No planner-data path uses the service role.** The only service-role callers are auth routes, DSCR-lender admin, and the platform trials expiry cron — none touches `forge_work_*`, `forge_hierarchy_*`, or `forge_clients` (verified by grep over every `SUPABASE_SERVICE_ROLE` / `supabaseAdmin` caller). | Grep-verified 2026-11-17; migration test anon case (no SELECT grant at all) |
| Search / combobox | There is no package search endpoint. The only picker is the hierarchy selector (§B), which is visibility-filtered. Staff search (`forge_planner_staff_search`) searches workspace members, not packages. | Grep-verified: no `search` route under `api/forge/work-packages` or `api/forge/planner` |
| Activity / audit views | `forge_hierarchy_audit` is read only through `hierarchy.js`; its policy carries the test predicate (§A). Package transitions (`forge_work_package_transitions`) likewise. | Migration test (audit rows) |
| Background summary / scheduler reads | **None in production code.** No cron/sweep handler under `src/app/api` reads `forge_work_packages` or `forge_work_steps` (verified by grep). The only matches in the repo are AI-agent planning-wiring test fixtures/battery oracles under `scripts/ai-agents/`, which run against synthetic data, not production. | Grep-verified 2026-11-17 |
| Metrics / dashboards | Financial dashboards read financial events only (§D). No work-package metric, export, CSV, or report endpoint reads test rows outside §A's predicate. | Grep-verified against both dashboard migrations |
| Storage (`storage.objects`) | Drawing/document blobs are addressed by opaque storage paths with no package identity in the path; the metadata rows that link a blob to a package are the `forge_work_drawings` / `forge_wp_drawing_*` rows covered in §A. No change. | Schema-verified |
| Import / source tracking | Normal import validation is unchanged by this slice. Samples carry `source_system = 'forge_planner_test_seed_v1'` with a stable `source_record_id` per client/project/ordinal; the loader never leaves a sample Unassigned (0 Unassigned seed packages — asserted in the migration test), so the transient-Unassigned leak class cannot occur. | Migration test (loader: 0 Unassigned; non-vacuity 5: a sample-stamped Unassigned package IS visible to Brandy — the loader never creates one) |

## H. Explicitly out of scope (with the reason, not by omission)

| Table / surface | Why it is not covered |
|---|---|
| `forge_work_document_library` | No package reference (no `package_id`, no project FK). No row can identify a linked package. 3 policies deliberately skipped. |
| `forge_work_assets` | Owner-scoped asset register (`owner_id` only). No package, project, or client FK; samples reference no asset. Cannot reveal test data and cannot be reached from a test row. |
| `forge_work_planning_process_template` | Shared workspace process templates (22-step canonical weights). No package/client link; read by the checklist function to build instances. The *instances* (`forge_work_planning_process_instances`) ARE covered in §A. |
| `forge_scheduling_projects` | Separate scheduling domain; no FK to hierarchy projects. Scheduling exports (§D) read no work data. |
| `forge_clients` `is_test` backfill | None. All existing clients stay real (`DEFAULT false`, no backfill of true values). |

## I. Negative-proof index (non-vacuity — each proven, 2026-11-17)

All seven proofs ran against the real-PG16 leg unless noted; each one
removes exactly the guard it names and observes the leak, then restores
it.

1. **Revert the test-client RLS policy** → Brandy's direct query leaks
   2 test clients; restore → 0.
2. **Drop the three guard triggers the step-create RPC writes through**
   (`forge_work_steps` / `forge_work_step_order` /
   `forge_work_step_revisions`) → Brandy's step-create succeeds
   ("Leak step"); restore → raises again.
3. **Remove the steps SELECT predicate** → Brandy sees 31 steps by
   DIRECT table count (a join through packages would still be blocked
   by the packages predicate — defense in depth).
4. **Unfiltered owner aggregate = 7 packages vs real-mode filtered =
   1** — differs by exactly 6 (the sample packages).
5. **A sample-stamped Unassigned package IS visible to Brandy (1
   row)** — the loader never leaves samples Unassigned (0), which is
   what closes this class.
6. **Real-PG naive direct client delete raises 23503** (FK violation);
   the real purge then succeeds.
7. **Deliberate double-load → exactly 6 packages / 31 steps** (no
   duplicates), same request id → `alreadyLoaded`.

Positive controls on every security surface: the same migration test
asserts the owner sees 3 clients / 2 test / 6 sample packages /
31 steps / 132 checklist rows / test audit > 0, and a real client +
real package remain visible to Brandy and survive the purge.

## J. FK closure and purge design (brief §4)

- FK closure: **45 descendant tables** under a test client (inventory
  taken from the actual `pg_constraint` graph in migration 2's
  `forge_planner_test_purge_scope`; the purge preflight lists/counts
  them from that inventory, it does not trust a hand list).
- Purge design: brief option **(a)** — a strictly test-scoped,
  auditable retirement/purge exception. `forge_work_package_links` is
  append-only with three restrictive FKs; the purge deletes
  test-linked audit entries only after the durable external purge
  receipt exists, under the transaction-local
  `app.forge_planner_test_purge` flag, and stores a minimal privileged
  purge receipt outside the deleted subtree (IDs hashed/redacted,
  counts, actor/time/request ID). Real-package link rows touching the
  test subtree are permanent blockers. Proven against real PostgreSQL
  16 with the complete transitive FK graph (PGlite alone was not
  accepted as proof).
- Bug found by the tests and fixed in-slice: migration 2's blocker-1
  query (and 6 sibling spots) used `NOT (w.source_system = '…' AND …)`,
  which evaluates to NULL — not TRUE — for NULL-source real packages,
  so a hand-attached real package did NOT block the purge. Fixed with
  NULL-safe forms (`IS DISTINCT FROM`, `NOT IN`,
  `COALESCE(…, '') NOT LIKE`) in 7 lines; re-proven on real PG16
  (NULL-source package on a test project now yields `canPurge: false`,
  blocker `non_sample_package`).

## Test evidence (all green, 2026-11-17)

| Suite | Result |
|---|---|
| Migration tests `src/application/forge-shared-hierarchy/plannerTestClient.migration.test.js` | 16/16 (~42s) — PGlite leg (35/35 migrations apply) + real-PG16 leg (fresh scratch cluster) + 7 non-vacuity proofs |
| Route tests (hierarchy + 3 test-data routes) | 32/32 |
| Component tests (`PlannerHierarchyManager.test.jsx`, `HierarchyProjectSelector.test.jsx`, `WorkPackageProjectLink.test.jsx`) | 38/38 |
| Playwright fixture check `scripts/test-data-fixture-check.mjs` | 15/15 — real Chromium 151.0.7922.34; 3 cases × 360/390/412/430/1919; `scrollWidth <= innerWidth+1` at every width; co-owner page text contains no test name; receipts in `.test-data-evidence/` (git-ignored) |
| Full test battery | See the PR report — run after this matrix; failures attributed against base (pre-existing `npm run build` failure on `/api/call-shield/cases` page-data collection is a base defect, not this slice) |

## Deliberately left out of scope

- Other services' error mappers were NOT updated for the new boundary
  codes (§D) — a guard-trigger raise through them surfaces a 500 with
  a non-leaking message.
- Migration application to production is on explicit HOLD (brief
  gate) — no apply, no sample data in production.
