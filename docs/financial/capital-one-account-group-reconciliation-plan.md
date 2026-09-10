# Capital One account-group reconciliation plan (NOT executed)

Status: **written, dry-run tested locally inside a rolled-back transaction,
NOT run against production.** No statement in this document has been
executed against any real database, and no Stripe API call is involved
anywhere in this plan — every step is a local Postgres write through the
already-audited, already-smoke-tested SECURITY DEFINER RPCs added by
`supabase/migrations/20260909080000_create_financial_account_groups.sql`.
This file exists so the *first real production use* of the account-group
feature is reviewed and approved as its own explicit action, separate from
merging the code that makes it possible.

**Revision note:** an earlier version of this document queried a
`financial_connections_accounts` table that does not exist in this schema,
and read balance fields (`current_value`/`current_balance`/`as_of`) directly
off `financial_accounts`, which has no such columns — balances live
exclusively in the separate `account_balances` time-series table. It also
said the RPC sequence creates "two new rows"; it actually creates **three**
(one `financial_account_groups` row plus **two**
`financial_account_group_members` rows — the canonical Stripe member and the
manual/CSV member). Every query below has been corrected and re-verified
against the real schema, and the full flow was dry-run end-to-end inside a
`begin; ... rollback;` block against the local, migration-applied Postgres
instance (see **Local dry-run evidence** below) before this revision was
written.

## What this plan does, in one sentence

Creates one `financial_account_groups` row representing "the one real-world
Capital One account," with the live Stripe Financial Connections
representation as its balance authority, and adds the pre-existing manual/CSV
representation as a second, non-authoritative member — so the manual row's
83 historical transactions are retained as history and its stale balance is
superseded, without deleting or modifying either underlying `financial_accounts`
or `account_balances` row. This step alone sets balance authority; it does
**not** set transaction authority or a cutover date (see **Explicitly out of
scope for this step**, below) — those require their own later, separate
human confirmation.

## Target rows

- Canonical (balance authority) member — Stripe Financial Connections: the
  `financial_accounts` row with
  `connection_id = 'connection_stripe_financial_connections_fcsess_1UDb0CF3Krk1yqTDwScZnrUJ'`
  (found by querying `financial_accounts` directly — see Preconditions;
  there is no separate connection-to-account join table in this schema).
- Second member — manual/CSV:
  `financial_account_simplifi_7c0f54dcd5e2c3ea0948e3e692265a33`.

Neither row's `id`, `provider`, or history is changed by anything below.
Balances are never touched at all — they live in `account_balances`, an
append-only time-series table this plan only ever reads.
`financial_account_group_members` rows only *point at* the two accounts;
they never mutate them.

## Schema facts this plan relies on (verified against the real migrations, not assumed)

- `financial_accounts` (`supabase/migrations/20260717_create_financial_accounts.sql`):
  `id, owner_id, connection_id, provider, provider_account_id, institution_id,
  name, type, subtype, currency_code, active`. No balance column of any kind.
  `owner_id` is plain `text`, **no foreign key**.
- `account_balances` (`supabase/migrations/20260718_create_account_balances.sql`):
  `id, owner_id, financial_account_id, connection_id, provider,
  provider_account_id, currency_code, current_balance_cents,
  available_balance_cents, as_of`. Append-only — one row per snapshot, not
  one row per account — so "the current balance" is always
  `... order by as_of desc limit 1` per `financial_account_id`, exactly as
  `SupabaseAccountBalanceRepository.findLatestByOwnerId` already does it.
  **`owner_id` here is `uuid`, with a real foreign key into `auth.users(id)`**
  — unlike `financial_accounts.owner_id`. This was actually caught by the
  local dry run below (it failed on the first attempt with
  `account_balances_owner_id_fkey` until a matching `auth.users` row existed)
  — a genuine schema fact, not a theoretical one.
- `financial_account_groups` / `financial_account_group_members`
  (`supabase/migrations/20260909080000_create_financial_account_groups.sql`):
  the tables and RPCs this plan calls. No `financial_connections_accounts`
  table exists anywhere in this schema.

## Preconditions (assert, do not assume)

Run these as read-only `select`s against the **linked production project**
before touching anything, and stop if any assertion fails:

```sql
-- 1. Both accounts exist, belong to the same owner, and are not already grouped.
-- (financial_accounts has no balance columns -- connection_id/provider are enough to identify
-- the Stripe row; the manual/CSV row is already known by id.)
select id, owner_id, connection_id, provider
from financial_accounts
where connection_id = 'connection_stripe_financial_connections_fcsess_1UDb0CF3Krk1yqTDwScZnrUJ'
   or id = 'financial_account_simplifi_7c0f54dcd5e2c3ea0948e3e692265a33';
-- Expect: 2 rows, same owner_id.

-- 1b. Current balances -- from account_balances, NOT financial_accounts. Confirms the Stripe
-- balance is the live $4,690.62 and the manual balance is the known-stale $3,942.33 before
-- proceeding.
select fa.id, fa.provider, ab.current_balance_cents / 100.0 as current_value, ab.as_of
from financial_accounts fa
join account_balances ab on ab.financial_account_id = fa.id
where fa.id in (:stripe_financial_account_id, 'financial_account_simplifi_7c0f54dcd5e2c3ea0948e3e692265a33')
order by fa.id, ab.as_of desc;
-- (:stripe_financial_account_id is the id captured from query 1, above.)

-- 2. Neither account is already an active member of any group.
select financial_account_id
from financial_account_group_members
where revoked_at is null
  and financial_account_id in (:stripe_financial_account_id, 'financial_account_simplifi_7c0f54dcd5e2c3ea0948e3e692265a33');
-- Expect: 0 rows. If either account is already an active member of a group,
-- STOP -- add_financial_account_group_member will reject it, and that's a
-- sign the plan's assumptions about current state are stale.

-- 3. Confirm the actor executing this (a real authenticated session, not a
-- service role) has workspace access to that owner_id -- the RPCs enforce
-- this themselves via has_workspace_access(), this is just a pre-check.
select has_workspace_access(:owner_id);
-- Expect: true.
```

If any assertion fails, stop and re-derive the plan from the actual current
state rather than proceeding on stale assumptions.

## Execution (assert-then-act, run as the authenticated owner, one statement at a time)

```sql
-- Step 1: create the group, canonical member = the live Stripe account. This one call creates
-- the group row AND the first member row, and sets balance_authority_account_id to that same
-- account (three statements inside one transaction -- see the RPC body in the migration).
select * from create_financial_account_group(
  p_canonical_financial_account_id := :stripe_financial_account_id,
  p_note := 'Capital One -- Stripe Financial Connections is the live balance authority; manual/CSV retained for history only.'
);
-- Capture the returned id as :group_id.

-- Step 2: add the manual/CSV account as a second, non-authoritative member.
select * from add_financial_account_group_member(
  p_group_id := :group_id,
  p_financial_account_id := 'financial_account_simplifi_7c0f54dcd5e2c3ea0948e3e692265a33'
);
```

This creates **three rows total**: one `financial_account_groups` row (Step
1) and **two** `financial_account_group_members` rows (the canonical Stripe
member, created as part of Step 1's own transaction, plus the manual/CSV
member from Step 2) — not two rows.

## Explicitly out of scope for this step

Not run as part of this initial linking, and not to be run until a human has
manually reviewed the 83 CSV transactions against the live Stripe feed and
confirmed there is no gap or overlap:

```sql
-- set_financial_account_group_transaction_authority(:group_id, :verified_transaction_authority_account_id);
-- advance_financial_account_group_coverage_status(:group_id, 'importing');
-- ... (walk the state machine to 'reconciled' only after manual verification)
-- set_financial_account_group_transaction_cutover(:group_id, :verified_cutover_date);
```

`transaction_authority_account_id` is a separate pointer from
`balance_authority_account_id` and is never set as a side effect of Step 1/2
above — it stays null (and `set_financial_account_group_transaction_cutover`
will refuse to run) until a human explicitly identifies it via
`set_financial_account_group_transaction_authority`, which in turn requires
`transaction_coverage_status = 'reconciled'`. Until then,
`FinancialWorkspaceQueryService` filters nothing — all 83 CSV rows keep
showing up exactly as they do today. Only the balance changes immediately
upon Step 2 completing, because `FinancialPositionQueryService`'s
balance-authority resolution applies as soon as a group exists, independent
of transaction-coverage/transaction-authority state.

## Post-execution verification (read-only)

```sql
select g.id, g.balance_authority_account_id, g.transaction_authority_account_id,
       g.transaction_coverage_status, m.financial_account_id, m.revoked_at
from financial_account_groups g
join financial_account_group_members m on m.group_id = g.id
where g.id = :group_id;
-- Expect: 1 group row (revoked_at null) + 2 member rows (both revoked_at
-- null) = 3 rows total. balance_authority_account_id = the Stripe account
-- id; transaction_authority_account_id is null (not set by this step).
```

Then confirm in the application itself (`/financial-snapshot` or the
Forge financial dashboard) that:
- Displayed Capital One balance is Stripe's **$4,690.62**.
- The stale manual balance (**$3,942.33**) no longer appears as a separate
  asset -- it appears only in `supersededBalances`, not in `assets`.
- Cash and net worth are reduced by **$3,942.33** relative to before this
  step (since the manual row is no longer double-counted alongside Stripe).
- All 83 existing CSV transactions are still visible in the transaction
  history (no transaction authority/cutover has been set, so no cutover
  filtering is active).
- No row in `financial_accounts`, `account_balances`, `financial_events`, or
  any other table was deleted or modified — only three new rows exist, in
  `financial_account_groups` (1) and `financial_account_group_members` (2).

## Rollback

Both mutating steps have single-call, fully-audited reversals that leave a
row-level trail rather than delete anything:

```sql
select revoke_financial_account_group_member(:member_id);  -- undoes step 2 only
-- or, to unwind everything:
select revoke_financial_account_group(:group_id);          -- cascades to both members
```

After either, `balance_authority_account_id` no longer resolves to an active
member, so `FinancialPositionQueryService` treats the account as ungrouped
again and both original balances reappear exactly as before.

## Local dry-run evidence

Before this revision, the full corrected flow above (Preconditions →
Execution → Post-execution verification) was run against the local,
migration-applied Postgres instance (`marketplace409-reservation-validation`)
using substitute fixture rows in place of the real Capital One ids, wrapped
in `begin; ... rollback;` so nothing persisted:

- A throwaway `auth.users` row was required before `account_balances` would
  accept an insert (the FK fact noted above).
- Precondition queries against `financial_accounts` and
  `account_balances` (joined) returned the expected rows with no error —
  proving every referenced table/column in this document actually exists.
- `create_financial_account_group` + `add_financial_account_group_member`
  succeeded; the post-execution query confirmed exactly **1 group row + 2
  member rows = 3 rows total**, `balance_authority_account_id` pointing at
  the Stripe fixture, `transaction_authority_account_id` null.
- The balance query against `account_balances` returned `4690.62` /
  `3942.33` for the Stripe/manual fixtures respectively, matching the real
  Capital One figures this plan targets.
- After `rollback`, a follow-up query confirmed zero leftover rows in either
  table — the dry run left no trace.

## Explicit scope boundary for this plan

This document is descriptive and reviewable only. Per the current
instruction, it must **not** be executed against production in this turn —
no `create_financial_account_group` or `add_financial_account_group_member`
call against the linked production project, no migration deploy, no Stripe
API call. Running it for real is a separate, explicitly approved action for
later.
