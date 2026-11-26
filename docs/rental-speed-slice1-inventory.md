# Rental Partial Open — Slice 1: current-head inventory, DTO/query/bundle ledger, and baseline status

**Status: BASELINE BLOCKED — IMPLEMENTATION STOPPED (see §6). No code changed in this slice beyond this file.**
**Base:** marketplace409 `ed48965c22c579402992bcff1fa6053ea444f786` (origin/main, fetched 2026-11-26 ~13:38 CST)
**Worktree:** `~/workspace/build-wt/rental-speed-slice1`, branch `feat/rental-partial-open-speed`
**Scope brief:** `results/chatgpt/forge-app-speed-scope-2026-11-26.md` (drop); scoping request `commands/chatgpt/forge-app-speed-scope-2026-11-26.md`
**Build word:** Jason, 2026-11-26 ~13:37 CST ("Build it — Rental speed slice 1")
**Inventory date:** 2026-11-26 ~13:38–13:50 CST (America/Chicago)
**Sanitization:** counts and column names only. No tenant names, IDs, emails, financial row contents, tokens, or screenshots in this file.

## 1. Current-head inventory (code surface)

### 1a. Files in the brief §3 surface (all present at base)

| Path | Lines | Role at base |
|---|---|---|
| `src/app/forge/rental/page.jsx` | 24 | Server auth + landing redirect; passes `?section=` / record context to the client. Fetches no rental data itself. |
| `src/components/forge/rental/RentalPageClient.jsx` | 81 | Client section/record state; `history.pushState` deep links; Back/Forward restores section + record. No data fetching. |
| `src/components/forge/rental/RentalApplicationShell.jsx` | 437 | Nav rail + mobile select + `buildRentalSurface(activeId)`; 28 import statements, **49 distinct statically imported panel/context modules, 0 `next/dynamic`**. Renders exactly one panel at a time, but the initial bundle carries all of them. |
| `src/components/forge/rental/useRentalDashboardPayload.js` | 36 | Shared SWR key `rental:dashboard-summary`, 30s TTL, localStorage disk cache. |
| `src/components/forge/rental/rentalSummaryClient.js` | 99 | `getRentalSummaryPayload()`: ONE `/api/rental` + ONE `/api/rental/reports` pair, in-flight dedup, network-only retry (250ms, 750ms). Reports soft (never throws). |
| `src/components/forge/rental/RentalOverviewPanel.jsx` | 237 | Summary. Consumes `buildRentalDashboardSummary(rentalBody, report)`; Today's Priorities section + Property Performance panel inside. |
| `src/components/forge/rental/RentalTenantPanel.jsx` | 638 | Tenants index + dedicated tenant record page + full-page ledger. |
| `src/app/api/rental/route.js` | 307 | GET = the monolith (see §2). POST = operation dispatch table (unchanged by this slice). |
| `src/application/rental/rentalReadProjections.js` | — | **Does not exist yet.** To be created by the implementation. |

### 1b. Shell panel inventory

`buildRentalSurface` renders one of ~45 surfaces (`overview` default). Static imports in the shell file cover every panel: overview, tenants, leases, charges, insurance (+addons), maintenance, documents, communications, messages, reconciliation, bank-ledger, vendors, receipts, chart-of-accounts, batch-entry, rentec-payment-import, rentec-financial-history-import, reports, tax-1099, tax-strategies, finding-the-money, financial-setup, deposits, checks-deposits, inspections, lease-lifecycle, lease-preparation, autopay, animals, support, terminology, team, setup-guide, listings, applications, guide, readiness, renewal, mailing, owners, owner-statements, setup, rentec-migration, rentec-files, plus setup-wizard, help modal, contextual surface, and the terminology provider. **Zero are demand-loaded.** The shell itself fetches only `/api/rental/team/permissions` and the setup-wizard status — the data weight is in the panels, not the shell chrome.

### 1c. Client fetch inventory (Slice-1 surfaces)

| Caller | Key / endpoint | What it fetches today |
|---|---|---|
| Overview + Today's Priorities (shared) | SWR `rental:dashboard-summary` → `getRentalSummaryPayload()` | Full `GET /api/rental` + `GET /api/rental/reports` (pair, deduped). |
| Tenants index + record | SWR `rental:tenants`, 60s TTL → `fetch("/api/rental")` | **Full `GET /api/rental`** (same monolith). |
| Tenant ledger / payment history | `GET /api/rental/tenant-ledger?tenantId=…` | Already narrow per-tenant. Precedent for the detail projection. |
| Tenant detail sub-views | `CustomFieldsEditor`, `NoticeLogList` | Own narrow endpoints (unchanged). |
| All mutations (POST `/api/rental`) | operations below | Full-payload revalidation after every success (see §1d). |

### 1d. Mutation inventory (Slice-1 surfaces) — all revalidate the monolith today

Tenants record/index mutations in `RentalTenantPanel.jsx`, each `POST /api/rental` then `await refresh()` on the `rental:tenants` SWR key (a fresh full `GET /api/rental`):

`save-tenant`, `delete-unused-tenant`, `update-tenant-email`, `send-tenant-invite`, `update-tenant-profile`, `set-primary-tenant`, `add-co-tenant`, `remove-co-tenant`, `save-late-fee-tenant-override`, `save-payment-policy-tenant-override`.

Feedback that already exists: the create-tenant save button shows `Saving…` and disables via shared `working` state; the invite button shows `Sending…` and disables; the invite path has a typed confirmation + per-day idempotency key. What does **not** exist: row-only cache reconciliation (every success refetches the whole payload), next-frame selected/loading paint on section navigation (the old panel unmounts at once; the new panel shows its own `Loading tenants…` / `Loading rental summary…` with no stale-content labeling), and per-control disabling (mutations share one `working` flag across the whole record page).

### 1e. Navigation feedback today

`NavFunctionButton` sets `activeFunctionId` synchronously (React state), so the nav itself paints `aria-current="page"` on the next render — the click is not dead at the nav level. The dead-click symptom lives one level down: a cold panel fetch takes the full monolith round-trip with only a generic loading line and no progress, and the SWR disk cache only helps on repeat visits within TTL.

## 2. Query inventory — GET /api/rental (the monolith)

35 parallel reads in one `Promise.all`, plus per-record signed photo URLs for every unit and tenant, plus a second `rental_billing_settings` read for `billingEnabled`. Order and columns are exactly as in `route.js` at base.

| # | Table | Columns | Notes |
|---|---|---|---|
| 1 | `rent_charges` | explicit 12 cols; open statuses only; ordered by due_date | |
| 2 | `rental_units` | id, property_id, label, status, photo_bucket, photo_object_path; ordered by label | + signed URL per unit |
| 3 | `rental_tenants` | explicit 26 cols; ordered by display_name | + signed URL per tenant |
| 4 | `rent_schedules` | explicit 14 cols | |
| 5 | `rental_maintenance_requests` | explicit 14 cols | 0 rows in production (see §3) |
| 6 | `rental_notification_outbox` | explicit 16 cols | |
| 7 | `rental_payments` | explicit 16 cols | |
| 8 | `rental_settlements` | explicit 15 cols | |
| 9 | `rental_security_deposits` | `select("*")` | |
| 10 | `rental_security_deposit_transactions` | `select("*")` | |
| 11 | `rental_inspections` | `select("*")` | 0 rows in production |
| 12 | `rental_inspection_items` | `select("*")` | |
| 13 | `rental_inspection_acknowledgements` | `select("*")` | |
| 14 | `rental_leases` | `select("*")` | |
| 15 | `rental_lease_tenants` | lease_id, tenant_id, occupancy_role | |
| 16 | `rental_lease_changes` | `select("*")` | |
| 17 | `rental_late_fee_rules` | `select("*")` | |
| 18 | `rental_late_fee_assessments` | `select("*")` | |
| 19 | `rental_billing_settings` | explicit 10 cols; owner-scoped; maybeSingle | also read again for `billing_enabled` |
| 20 | `rental_late_fee_tenant_overrides` | `select("*")` | |
| 21 | `rental_contractors` | `select("*")` | |
| 22 | `rental_maintenance_work_orders` | `select("*")` | |
| 23 | `rental_maintenance_work_events` | `select("*")` | |
| 24 | `rental_lease_preparations` | `select("*")` | |
| 25 | `rental_lease_preparation_versions` | `select("*")` | |
| 26 | `rental_lease_signatures` | explicit 7 cols | |
| 27 | `rental_autopay_enrollments` | `select("*")` | |
| 28 | `renters_insurance_policies` | `select("*")` | |
| 29 | `renters_insurance_requirements` | lease_id, required, minimum_liability_cents | |
| 30 | `rental_animals` | `select("*")` | |
| 31 | `rental_support_cases` | `select("*")` | |
| 32 | `property_financial_setups` | property_id, purchase_date, purchase_price_cents, down_payment_cents, closing_costs_cents; owner-scoped | |
| 33 | `financial_events` | event_date, amount, transaction_kind, source_system, status, is_deleted, business_scope, property_id, normalized_category, affects_noi, capitalized — via `fetchAllOwnerFinancialEvents` (paginated; owner subset 5,600+ rows) | **Dominant payload. Must stay complete/uncapped inside the Summary projection (brief §2A).** |
| 34 | `rental_conversations` | explicit 8 cols | 0 rows in production |
| 35 | `rental_tenant_credits` | id, lease_id, tenant_id, remaining_cents, status | |

`select("*")` count in the GET path: **17 of 35 reads**. No new `select("*")` is allowed in any Slice-1 path.

## 3. Data-volume ledger (fresh production counts, 2026-11-26 ~13:45 CST, counts only)

Read-only `count(*)` via the Supabase connector against project `bzqvenxjlstinmgbuvvg`. No row contents read.

| Measure | Count |
|---|---|
| rental_units | 23 |
| rental_tenants (total; first page of 50 covers all) | 30 |
| rental_leases | 30 |
| rental_lease_tenants | 31 |
| rent_charges (open statuses) | 5 of 20 total |
| rent_schedules | 31 |
| rental_payments | 18 |
| financial_events (all scopes; owner subset 5,600+ per route comment) | 12,813 |
| rental_security_deposits | 23 |
| rental_inspections | 0 |
| rental_maintenance_requests | 0 |
| rental_conversations | 0 |
| rental_tenant_credits | 3 |

Not vacuous: 30 real tenants, 23 units, 30 leases, 12,813 financial events. Tenant total (30) matches the brief's Nov 16 figure; first page of 50 covers the entire list today, so pagination correctness is proven by total-count parity, not by page-2 behavior.

## 4. DTO ledger (field-by-field — what Summary / Tenants / tenant detail actually consume)

Derived from `buildRentalDashboardSummary.js`, `RentalOverviewPanel.jsx`, `RentalTenantPanel.jsx`, `paymentDepositState.js`, `useTodaysPrioritiesSession.js` (same summary inputs as the Overview), and the route. **If a panel reads a field absent from this ledger, the implementation's tests must fail; do not "fix" it by restoring the full payload.**

### 4a. Summary projection (`surface=summary`)

Consumers: `buildRentalDashboardSummary(rentalBody, report)` — used identically by the Overview panel and Today's Priorities. `report` = `GET /api/rental/reports` (operating report; **unchanged by this slice** — already a single-purpose endpoint). Required `report.summary` fields: `overdueBalanceCents`, `openBalanceCents`, `externallyManagedCents`, `externallyManagedChargeCount`, `monthlyScheduledCents`, `collectedCents`.

| Source | Fields the Summary needs |
|---|---|
| units | `id`, `label`, `photo_url` (signed; only first 8 in label order for the portfolio strip + first 6 vacant for the vacant list — do not sign all 23) |
| leases | `id`, `unit_id`, `status`, `end_date` |
| payments | `id`, `status`, `succeeded_at`, `received_at`, `created_at`, `amount_cents`, `refunded_amount_cents`, `deposit_state` |
| settlements | `payment_id`, `status` (only `paid_out` matters, via `resolveDepositState`) |
| maintenanceRequests + workOrders | `id`, `title`, `priority`, `status`, `submitted_at`, `unit_id` |
| insurancePolicies | `lease_id`, `status` |
| deposits | `lease_id` |
| inspections | `lease_id`, `inspection_type`, `status` |
| supportCases | `status` (count of non-closed/resolved/cancelled) |
| schedules | `collection_mode` (counts only) |
| billing flag | `billingEnabled` boolean (from `rental_billing_settings.billing_enabled`, owner-scoped) |
| propertyFinancialSetups | `property_id`, `purchase_date`, `purchase_price_cents`, `down_payment_cents`, `closing_costs_cents` |
| financialEvents | `event_date`, `amount`, `transaction_kind`, `source_system`, `status`, `is_deleted`, `business_scope`, `property_id`, `normalized_category`, `affects_noi`, `capitalized` — **complete, uncapped** (feeds `buildRentalFinancialPerformance` + property performance; no lookback cap) |
| derived in-route | `collectionSummary` (forge vs externally-managed cents/counts) — computed from open charges + schedules; the Overview does not render it directly, but it ships in the body today. **Open question for the implementer: drop it from the Summary projection (nothing in `buildRentalDashboardSummary` reads it) or keep it — decide from the consumer inventory, do not guess.** |

**NOT needed by Summary:** tenants, leaseMemberships, leaseChanges, late-fee tables, contractors, preparations/versions, signatures, autopay, insuranceRequirements, animals, conversations, credits, notifications, open charges as rows. Removing those reads is the slice's first win.

### 4b. Tenants list projection (`surface=tenants&page=1&pageSize=50`)

List columns (from `RentalRecordBrowser` + helpers): Tenant `display_name`; Email; Invite label (derived from `auth_user_id` / `invited_at`); Property (active lease → unit `label`, via memberships + leases + units); Status (Moved In iff an active lease exists); Active balance (open charges for active leases: `amount_cents − paid_amount_cents`).

| Source | Fields |
|---|---|
| tenants (page 1, server-ordered by `display_name` asc, max 50) | `id`, `display_name`, `email`, `invited_at`, `auth_user_id`, `photo_bucket`, `photo_object_path` (+ signed `photo_url` per row) — **plus `totalCount`** |
| leaseMemberships | `lease_id`, `tenant_id`, `occupancy_role` (all rows; small) |
| leases | `id`, `unit_id`, `status` |
| units | `id`, `label` |
| openCharges | `lease_id`, `amount_cents`, `paid_amount_cents` |

Client-side search/sort/filter over the current 50-row page (brief §2C). No server search unless real volume exceeds one page — it does not today (30 total).

### 4c. Tenant detail projection (`surface=tenant-detail&tenantId=…`)

One authorized tenant ID only. The record page needs:

| Source | Fields |
|---|---|
| tenant row | full profile field set: `id`, `display_name`, `email`, `phone`, `work_phone`, `employer_name`, `employer_phone`, `monthly_income_cents`, `emergency_contact_name`, `emergency_contact_phone`, `application_status`, `application_submitted_at`, `screening_provider`, `screening_reference`, `screening_status`, `screening_completed_at`, `ssn_last_four`, `landlord_notes`, `status`, `invited_at`, `auth_user_id`, `payment_policy`, `photo_url` |
| household | leases for this tenant (via memberships): `id`, `unit_id`, `status`, `start_date`, `end_date`, `monthly_rent_cents`, `property_id`; memberships for the lease (`tenant_id`, `occupancy_role`); co-tenant rows (compact: `id`, `display_name`, `email` — full rows only if the implementer shows they are read); unit `id`, `label` |
| openCharges for the household leases | `lease_id`, `amount_cents`, `paid_amount_cents` |
| lateFeeTenantOverride for this tenant | full override row |
| workspace payment policy default | `payment_policy` (from `rental_billing_settings`, owner-scoped) |
| ledger / payment history | **Already narrow:** `GET /api/rental/tenant-ledger?tenantId=…` (used by `TenantPaymentHistory` + `TenantLedgerPage`). Reuse, do not re-fetch through the monolith. |
| custom fields / notice log | Own narrow endpoints (unchanged). |

## 5. Bundle ledger

**BLOCKED — same cause as §6.** Standing record: `npm run build` fails at the base commit (not a usable gate); not re-verified this run. No authenticated first-entry bundle measurement is possible from this environment (see §6). What is established from code: the Rental shell statically imports ~49 modules (0 dynamic), so the initial entry chunk carries every panel; the implementation's `next/dynamic` split must be proven by before/after chunk bytes from a real (Vercel preview / production) build, not from a local dev server.

## 6. BASELINE BLOCKED — implementation stopped

The brief (§4, §7 step 1) requires a **fresh live baseline before any implementation**: 10 warm + 5 cold trials per targeted page (Rental Summary, Rental Tenants list, one named tenant detail; controls `/forge`, Planner list/detail, Scheduling list, Designer list), at **390 CSS px S26+ emulation and 1919 CSS px desktop**, on the **real authenticated owner workspace**, recording click-to-feedback, TTFB/API duration, first useful data paint, click-to-usable, rows/bytes/query count, JS bytes/chunks, errors, median/p90/max. The stop condition (§7 step 2) — stop with a measurement-only receipt if fresh medians are already ≤1.0s with p90 ≤1.5s and no dead-click symptom — **cannot be evaluated without that baseline**, so no build may proceed on assumption.

### What was attempted (2026-11-26 ~13:40–13:50 CST)

1. **Live browser:** not available to this environment. Subagents cannot operate a live browser or launch browser tasks; the parent agent holds the browser capability. No measurement possible here.
2. **Saved auth state:** none in the repo. No `storageState`, no `.auth/` directory, no saved owner session.
3. **Repo Playwright suite (`e2e/`):** tenant-portal smoke suite against a provisioned scratch/preview target with test Stripe keys. `global.setup.js` **refuses production targets** ("A missing or production target aborts"). It measures nothing about the owner workspace.
4. **Direct production HTTP:** `https://409marketplace.online/forge/rental` is reachable (HTTP 308 to the login flow) but unauthenticated; `GET /api/rental` requires Jason's user session (Supabase JWT via `createAuthenticatedRentalManagerApplication`). No JWT is available in this environment, and minting one is not authorized.
5. **Geometry guard (`scripts/phone-layout-geometry-check.mjs`):** runs against a local dev server with the FCCU fixture. It measures layout, not timings, and the brief explicitly forbids fixture timings as a baseline ("fixtures are correctness aids only").
6. **Direct database timing:** read-only counts were taken for §3 (above). Timing the 35 queries via direct Postgres would measure database time only, not browser click-to-usable — it is not the required baseline and is not presented as one.

### What is owed to unblock the build (parent's call)

A live baseline taken in the parent agent's browser with Jason's signed-in session, following brief §4 exactly: same owner/workspace, same browser, 390px S26+ emulation + 1919px desktop, 10 warm + 5 cold trials each for Rental Summary, Rental Tenants list, and one named tenant detail, plus the control pages; raw timings (click-to-feedback, TTFB/API, first useful paint, click-to-usable), rows/bytes/query counts, JS bytes/chunks for first Rental entry, errors, median/p90/max, and the data-volume ledger from §3 (already fresh). **If the fresh medians are already ≤1.0s / p90 ≤1.5s with no dead-click symptom, the correct outcome is a NO CURRENT PERFORMANCE DEFECT / MEASUREMENT ONLY receipt — not this build.**

### What is already done for the re-dispatch

This inventory + DTO ledger + volume ledger are committed in this worktree (branch `feat/rental-partial-open-speed`). The re-dispatch starts from here: take the baseline, evaluate the stop condition, and if the build proceeds, implement in the brief's order (projections → demand-loaded shell → feedback/reconciliation) with the §4 guard and §5 acceptance. Nothing in this file authorizes a merge, migration, deployment, or production mutation.
