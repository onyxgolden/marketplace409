-- Bank reconciliations (2026-09-26) — AUTHORED, NOT APPLIED. Jason applies migrations.
--
-- One row per saved reconciliation of a bank account against a statement:
-- the statement period and ending balance (typed by the user from the
-- statement), the totals computed by src/domains/rental/bankReconciliation.js
-- at save time, and a snapshot of every financial_events cleared-state change
-- the reconciliation made — each item's cleared/cleared_at BEFORE the change —
-- so undoing it restores those items exactly.
--
-- Reversible, never destructive:
--   * No DELETE: no delete policy and no delete grant. A reconciliation is
--     undone (status 'active' -> 'undone', with who/when/why), never removed.
--   * The recorded figures, period, account and snapshot are immutable: a
--     trigger rejects any UPDATE other than the one-way active -> undone
--     transition and its audit columns.
--
-- Security model (the ledger-table pattern, see 20260926150000): RLS forced;
-- select/insert/update policies gated on has_workspace_access(owner_id).
-- Grants follow the explicit-grant contract: Supabase's default privileges
-- are revoked from anon and authenticated, then exactly select/insert/update
-- are granted to authenticated.
--
-- Additive only: no existing table is changed. The app treats the table as
-- optional until applied (the reconciliation list reports it as unavailable).

create table if not exists bank_reconciliations (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null,
  bank_account_id text not null references financial_accounts(id),

  period_start date not null,
  period_end date not null,
  check (period_start <= period_end),

  -- From the statement, as typed by the user.
  statement_ending_balance_cents bigint not null,

  -- Computed at save time from the register (bankReconciliation.js).
  cleared_balance_cents bigint not null,
  book_balance_cents bigint not null,
  difference_cents bigint not null,
  outstanding_count integer not null check (outstanding_count >= 0),
  outstanding_deposits_cents bigint not null check (outstanding_deposits_cents >= 0),
  outstanding_payments_cents bigint not null check (outstanding_payments_cents >= 0),

  -- [{ eventId, clearedBefore, clearedAtBefore, clearedAfter }]
  cleared_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(cleared_snapshot) = 'array'),
  -- Ids of every item counted as cleared on this statement (for the report).
  cleared_event_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(cleared_event_ids) = 'array'),
  -- Ids still outstanding at save time.
  outstanding_event_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(outstanding_event_ids) = 'array'),

  status text not null default 'active' check (status in ('active', 'undone')),
  created_by text not null,
  created_at timestamptz not null default now(),
  undone_by text,
  undone_at timestamptz,
  undo_reason text,
  check (status <> 'undone' or (undone_by is not null and undone_at is not null))
);

create index if not exists idx_bank_reconciliations_account_period
  on bank_reconciliations(owner_id, bank_account_id, period_end);

-- Immutability: the only permitted change is active -> undone (+ its audit columns).
create or replace function bank_reconciliations_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'active' or new.status <> 'undone' then
    raise exception 'bank_reconciliations: only an active reconciliation can be undone';
  end if;
  if new.id <> old.id
     or new.owner_id <> old.owner_id
     or new.bank_account_id <> old.bank_account_id
     or new.period_start <> old.period_start
     or new.period_end <> old.period_end
     or new.statement_ending_balance_cents <> old.statement_ending_balance_cents
     or new.cleared_balance_cents <> old.cleared_balance_cents
     or new.book_balance_cents <> old.book_balance_cents
     or new.difference_cents <> old.difference_cents
     or new.outstanding_count <> old.outstanding_count
     or new.outstanding_deposits_cents <> old.outstanding_deposits_cents
     or new.outstanding_payments_cents <> old.outstanding_payments_cents
     or new.cleared_snapshot <> old.cleared_snapshot
     or new.cleared_event_ids <> old.cleared_event_ids
     or new.outstanding_event_ids <> old.outstanding_event_ids
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'bank_reconciliations: recorded reconciliation figures are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists bank_reconciliations_guard_update on bank_reconciliations;
create trigger bank_reconciliations_guard_update
  before update on bank_reconciliations
  for each row execute function bank_reconciliations_guard_update();

alter table bank_reconciliations enable row level security;
alter table bank_reconciliations force row level security;

drop policy if exists "bank_reconciliations_owner_select" on bank_reconciliations;
create policy "bank_reconciliations_owner_select" on bank_reconciliations for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "bank_reconciliations_owner_insert" on bank_reconciliations;
create policy "bank_reconciliations_owner_insert" on bank_reconciliations for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "bank_reconciliations_owner_update" on bank_reconciliations;
create policy "bank_reconciliations_owner_update" on bank_reconciliations for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
-- Deliberately no delete policy.

revoke all on bank_reconciliations from anon, authenticated;
grant select, insert, update on bank_reconciliations to authenticated;
