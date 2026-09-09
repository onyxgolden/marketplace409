# Capital One account-group reconciliation plan (NOT executed)

Status: **written, reviewed-for-inclusion, NOT run.** No statement in this
document has been executed against any database. No Stripe API call is
involved anywhere in this plan — every step is a local Postgres write
through the already-audited, already-smoke-tested SECURITY DEFINER RPCs
added by `supabase/migrations/20260909080000_create_financial_account_groups.sql`.
This file exists so the *first real production use* of the account-group
feature is reviewed and approved as its own explicit action, separate from
merging the code that makes it possible.

## What this plan does, in one sentence

Creates one `financial_account_groups` row representing "the one real-world
Capital One account," with the live Stripe Financial Connections
representation as its balance authority, and adds the pre-existing manual/CSV
representation as a second, non-authoritative member — so the manual row's
83 historical transactions are retained as history and its stale balance is
superseded, without deleting or modifying either underlying `financial_accounts`
row.

## Target rows

- Canonical (balance authority) member — Stripe Financial Connections:
  financial account belonging to connection
  `connection_stripe_financial_connections_fcsess_1UDb0CF3Krk1yqTDwScZnrUJ`.
- Second member — manual/CSV:
  `financial_account_simplifi_7c0f54dcd5e2c3ea0948e3e692265a33`.

Neither row's `id`, `provider`, `current_value`/`current_balance`, or history
is changed by anything below. `financial_account_group_members` rows only
*point at* these accounts; they never mutate them.

## Preconditions (assert, do not assume)

Run these as read-only `select`s against the **linked production project**
before touching anything, and stop if any assertion fails:

```sql
-- 1. Both accounts exist, belong to the same owner, and are not already grouped.
select id, owner_id, provider, current_value, current_balance, as_of
from financial_accounts
where id in (
  (select financial_account_id from financial_connections_accounts
     where connection_id = 'connection_stripe_financial_connections_fcsess_1UDb0CF3Krk1yqTDwScZnrUJ'),
  'financial_account_simplifi_7c0f54dcd5e2c3ea0948e3e692265a33'
);
-- Expect: 2 rows, same owner_id, Stripe row's as_of is recent (live), manual
-- row's current_value/current_balance is the known-stale $3,942.33.

select financial_account_id
from financial_account_group_members
where revoked_at is null
  and financial_account_id in (
    (select financial_account_id from financial_connections_accounts
       where connection_id = 'connection_stripe_financial_connections_fcsess_1UDb0CF3Krk1yqTDwScZnrUJ'),
    'financial_account_simplifi_7c0f54dcd5e2c3ea0948e3e692265a33'
  );
-- Expect: 0 rows. If either account is already an active member of a group,
-- STOP -- add_financial_account_group_member will reject it, and that's a
-- sign the plan's assumptions about current state are stale.

-- 2. Confirm the actor executing this (a real authenticated session, not a
-- service role) has workspace access to that owner_id -- the RPCs enforce
-- this themselves via has_workspace_access(), this is just a pre-check.
select has_workspace_access(:owner_id);
-- Expect: true.
```

If any assertion fails, stop and re-derive the plan from the actual current
state rather than proceeding on stale assumptions.

## Execution (assert-then-act, run as the authenticated owner, one statement at a time)

```sql
-- Step 1: create the group, canonical member = the live Stripe account.
-- This one call: creates the group row, creates the first member row, and
-- sets balance_authority_account_id to that same account (see the RPC body
-- in the migration -- three statements inside one transaction).
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

Deliberately **not** part of this initial step, and not to be run until a
human has manually reviewed the 83 CSV transactions against the live Stripe
feed and confirmed there is no gap or overlap:

```sql
-- advance_financial_account_group_coverage_status(:group_id, 'importing');
-- ... (walk the state machine to 'reconciled' only after manual verification)
-- set_financial_account_group_transaction_cutover(:group_id, :verified_cutover_date);
```

Until `transaction_coverage_status` reaches `reconciled` and a cutover date
is explicitly set, `FinancialWorkspaceQueryService` filters nothing -- all 83
CSV rows keep showing up exactly as they do today. Only the balance changes
immediately upon Step 2 completing, because `FinancialPositionQueryService`'s
balance-authority resolution applies as soon as a group exists, independent
of transaction-coverage status.

## Post-execution verification (read-only)

```sql
select g.id, g.balance_authority_account_id, g.transaction_coverage_status,
       m.financial_account_id, m.revoked_at
from financial_account_groups g
join financial_account_group_members m on m.group_id = g.id
where g.id = :group_id;
-- Expect: 1 group row (revoked_at null), 2 member rows (both revoked_at
-- null), balance_authority_account_id = the Stripe account id.
```

Then confirm in the application itself (`/financial-snapshot` or the
Forge financial dashboard) that:
- Displayed Capital One balance is Stripe's **$4,690.62**.
- The stale manual balance (**$3,942.33**) no longer appears as a separate
  asset -- it appears only in `supersededBalances`, not in `assets`.
- Cash and net worth are reduced by **$3,942.33** relative to before this
  step (since the manual row is no longer double-counted alongside Stripe).
- All 83 existing CSV transactions are still visible in the transaction
  history (coverage status is not yet `reconciled`, so no cutover filtering
  is active).
- No row in `financial_accounts`, `financial_events`, or any other table was
  deleted or modified -- only two new rows exist, in
  `financial_account_groups` and `financial_account_group_members`.

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

## Explicit scope boundary for this plan

This document is descriptive and reviewable only. Per the current
instruction, it must **not** be executed in this turn — no `create_financial_account_group`
or `add_financial_account_group_member` call against production, no
migration deploy, no Stripe API call. Running it is a separate, explicitly
approved action for later.
