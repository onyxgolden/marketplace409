# RV and Short-Term Rental Multi-User Operations Handoff

**Status:** Owner authorized for implementation and PR preparation  
**Assigned executor:** Claude  
**Authorized at:** 2026-09-01  
**Required base:** `main` at or after `2b4b63abb56ffe567d28374f18f2c9cc88af5b5d`  
**Production authority:** Stop before merge, migration push, or deployment while the owner is away.

## Objective

Deliver one cohesive RV and short-term rental operations slice:

1. Prove and harden multi-user workspace access.
2. Only after access and isolation are green, add useful operational graphics for RV spaces and cabins.
3. Prepare a focused PR with validation evidence for owner review.

Do not duplicate completed reservation, bulk-import, tenant-deduplication, Stripe, private-financing, Financial Overview, or Forge Brain work.

## Mandatory Starting Inspection

Before editing:

1. Fetch current `main`.
2. Read the latest turnover checkpoints in:
   - `docs/architecture/FORGE_ENGINEERING_CONTROL_CENTER.md`
   - `docs/architecture/FORGE_STATUS.md`
   - `docs/architecture/FORGE_SESSION.md`
3. Inspect all unmerged Claude branches and local changes created after the turnover checkpoint.
4. Reconcile existing implementation against this specification.
5. Preserve unrelated work and stop if an overlapping dirty worktree cannot be safely isolated.
6. Use a fresh branch/worktree from current `main`.

## Phase 1 — Multi-User RV Access

Verify the complete workflow using disposable fixtures or isolated test users:

- An RV/cabin landlord can create or select a workspace.
- The owner can invite another user.
- A recipient with an existing 409 Marketplace account can accept access.
- A recipient without an account receives a clear create-account-first path and can then accept access.
- An authorized second user can view the same RV/cabin inventory, reservations, guests, rates, and operational dashboard permitted by their role.
- The interface clearly distinguishes owner and non-owner access.
- Workspace switching is deterministic when a user belongs to more than one workspace.
- A user cannot read or mutate another workspace by changing identifiers.
- Revoked or inactive membership immediately loses access.
- Duplicate invitations or memberships resolve idempotently rather than creating duplicate access records.
- Invitations and successful membership changes produce clear success feedback.

### Roles

Reuse existing workspace membership and authorization concepts. Do not invent a parallel identity system.

At minimum, prove:

- Owner: full workspace control.
- Manager: operational inventory/reservation access without owner-only authority.
- Viewer, if already supported by the repository: read-only operations.

Do not widen roles or permissions merely to make a test pass.

### Authorization Tests

Add focused tests for:

- Existing-account acceptance.
- New-account acceptance path.
- Owner access.
- Manager permitted actions.
- Non-owner denial for owner-only actions.
- Cross-workspace read denial.
- Cross-workspace mutation denial.
- Revoked membership denial.
- Exact retry/idempotent invitation acceptance.

Use real PostgreSQL validation when database authorization, RLS, or atomic membership behavior is changed. Do not revalidate unrelated completed layers.

## Phase 2 — Operational Dashboard

Begin only after Phase 1 is green.

Build a read-only operational dashboard from canonical reservation, inventory, rate, and payment data. Do not create accounting truth in the UI.

### Required Summary Metrics

- Total active inventory.
- Occupied inventory.
- Available inventory.
- Occupancy rate for the selected period.
- Expected revenue.
- Collected revenue.
- Outstanding or overdue amount when supported by canonical data.
- Upcoming arrivals.
- Upcoming departures.

### Required Graphics

Keep the first slice useful and compact:

1. Occupied versus available inventory.
2. Expected versus collected revenue.
3. Occupancy trend by month or selected period.
4. Revenue split between RV spaces and cabins.

Every chart must include:

- Plain-language title.
- Visible legend or direct labels.
- Currency and percentage formatting.
- Empty state.
- Loading state.
- Error state.
- Accessible text equivalent or summary.
- Light- and dark-mode readability.
- No misleading partial-period comparison.

### Filters

Where supported by current data:

- Selected period.
- All inventory, RV spaces, or cabins.
- Workspace/property.

Do not add speculative forecasting, competitor benchmarking, dynamic pricing, or AI recommendations in this slice.

## Payment Boundary

Mike currently uses Square, but this assignment does not authorize pricing changes, Stripe production configuration, customer fee changes, live payment activation, or money movement.

Dashboard reporting may display existing payment truth only.

## UX Requirements

- A newly invited or added user receives immediate confirmation and a clear next destination.
- Successful access actions navigate or visibly update; do not leave the user wondering whether the action worked.
- Mobile and desktop layouts must remain usable.
- Existing Rental Manager navigation and the restored Financial UI must not regress.

## Validation

Run only focused validation relevant to changed files and authorization boundaries:

- Focused component and domain tests.
- Focused API/authorization tests.
- Real disposable PostgreSQL validation if database policy or membership logic changes.
- Scoped ESLint.
- `git diff --check`.
- Relevant production build.

Document any pre-existing failure separately; do not hide it or broaden scope to repair unrelated debt.

## Deliverable and Stop Condition

Claude may:

- Inspect.
- Implement on a fresh branch.
- Add focused tests and disposable validation.
- Push the branch.
- Open a PR.
- Report exact validation evidence and any owner decisions still needed.

Claude must stop before:

- Merging the PR.
- Deploying to Production.
- Running a Production migration.
- Sending an invitation or email to a real person.
- Enabling or changing live Stripe/Square payment behavior.
- Creating or modifying real production tenant, guest, reservation, payment, or membership records.

The owner will review the PR and provide action-time approval after returning.
