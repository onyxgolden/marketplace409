-- 20261101020000_rental_owner_movement_edit.sql
--
-- Rental controls sweep follow-up G13 (M-19): edit active owner cash
-- movements (amount, date, method, memo) with an edit trail. The panel
-- previously offered only void + recreate, which rewrites movement history.
--
-- TWO PARTS, both required before the panel's Edit path can succeed:
--   1. owner_cash_movement_edits — append-only audit rows, one per edit,
--      carrying before/after values for all four editable fields.
--   2. update_owner_movement() — the enforcement boundary, mirroring
--      record_owner_disbursement (20261001013000): same per-owner advisory
--      lock, same live-balance recompute, same OVER_DISBURSEMENT token.
--      A disbursement edit recomputes the balance EXCLUDING the edited row,
--      so the new amount must fit the balance freed by removing the old one.
--      Contributions need no balance check (they only ever raise it).
--
-- NOT APPLIED BY THIS BRANCH. This file joins the migration approval ask
-- (with the G9 personal-check migration) — the route's PUT handler and the
-- panel's Edit form are code-first until then. Code-first behavior is
-- deliberate and safe: the movements GET degrades (no edit badges) when
-- this table is absent, and a PUT edit fails plainly with "database update
-- not applied" wording instead of silently half-applying.
--
-- Audit rows intentionally carry NO foreign key to owner_cash_movements:
-- movements are never hard-deleted, and an audit row must never block a
-- future cleanup or vanish with one.

create table if not exists owner_cash_movement_edits (
    id text primary key default gen_random_uuid()::text,
    owner_id text not null,
    movement_id text not null,
    edited_by text,
    edited_at timestamptz not null default now(),
    old_amount numeric not null,
    new_amount numeric not null,
    old_movement_date date not null,
    new_movement_date date not null,
    old_method text not null,
    new_method text not null,
    old_memo text not null default '',
    new_memo text not null default ''
);

create index if not exists idx_owner_cash_movement_edits_movement
    on owner_cash_movement_edits(owner_id, movement_id, edited_at desc);

create or replace function update_owner_movement(
  p_owner_id text,
  p_movement_id text,
  p_amount numeric,
  p_movement_date date,
  p_method text,
  p_memo text,
  p_edited_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  required_owner text := nullif(btrim(p_owner_id), '');
  v_row owner_cash_movements%rowtype;
  v_amount_cents bigint;
  v_income_cents bigint;
  v_expense_cents bigint;
  v_disbursement_cents bigint;
  v_contribution_cents bigint;
  v_balance_cents bigint;
begin
  -- The RPC only ever writes for the authenticated workspace.
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if required_owner is null or required_owner <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;

  -- Server-side floor validation. The route performs the full validation;
  -- this keeps direct RPC callers honest without duplicating the validator.
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = '22000';
  end if;
  if p_movement_date is null then
    raise exception 'A movement date is required.' using errcode = '22000';
  end if;
  if p_method is null or p_method not in ('check', 'ach', 'wire', 'cash', 'other') then
    raise exception 'Method must be check, ach, wire, cash, or other.' using errcode = '22000';
  end if;
  v_amount_cents := round(p_amount * 100)::bigint;

  -- SERIALIZATION POINT — same namespace as record_owner_disbursement, so
  -- an edit and a concurrent insert serialize against each other.
  perform pg_advisory_xact_lock(hashtext('rental_owner_disbursement:' || effective_owner_id));

  select * into v_row from owner_cash_movements
   where owner_id = effective_owner_id and id = p_movement_id;
  if not found then
    raise exception 'Owner movement not found.' using errcode = 'P0001';
  end if;
  if v_row.status <> 'active' then
    raise exception 'NOT_ACTIVE: Only an active movement can be edited.' using errcode = 'P0001';
  end if;

  -- Disbursement invariant: recompute the LIVE balance AFTER the lock,
  -- EXCLUDING the edited row (its old amount no longer counts against the
  -- balance once replaced). Mirrors buildOwnerBalance otherwise.
  if v_row.kind = 'disbursement' then
    select coalesce(sum(abs(round(fe.amount * 100))::bigint), 0) into v_income_cents
      from financial_events fe
     where fe.owner_id = effective_owner_id
       and fe.transaction_kind = 'income'
       and fe.is_deleted is not true
       and coalesce(fe.status, '') not in ('inactive', 'deleted');

    select coalesce(sum(abs(round(fe.amount * 100))::bigint), 0) into v_expense_cents
      from financial_events fe
     where fe.owner_id = effective_owner_id
       and fe.transaction_kind = 'expense'
       and fe.is_deleted is not true
       and coalesce(fe.status, '') not in ('inactive', 'deleted');

    select coalesce(sum(abs(round(ocm.amount * 100))::bigint), 0) into v_disbursement_cents
      from owner_cash_movements ocm
     where ocm.owner_id = effective_owner_id
       and ocm.kind = 'disbursement'
       and ocm.status = 'active'
       and ocm.id <> p_movement_id;

    select coalesce(sum(abs(round(ocm.amount * 100))::bigint), 0) into v_contribution_cents
      from owner_cash_movements ocm
     where ocm.owner_id = effective_owner_id
       and ocm.kind = 'contribution'
       and ocm.status = 'active';

    v_balance_cents := v_income_cents - v_expense_cents - v_disbursement_cents + v_contribution_cents;

    if v_amount_cents > v_balance_cents then
      raise exception 'OVER_DISBURSEMENT: The disbursement exceeds the amount due to the owner. Available balance: %s cents; requested: %s cents.', v_balance_cents, v_amount_cents
        using errcode = 'P0001';
    end if;
  end if;

  -- The edit and its audit row commit in this one transaction.
  insert into owner_cash_movement_edits (
    owner_id, movement_id, edited_by,
    old_amount, new_amount,
    old_movement_date, new_movement_date,
    old_method, new_method,
    old_memo, new_memo
  ) values (
    effective_owner_id, p_movement_id, nullif(btrim(p_edited_by), ''),
    v_row.amount, round(p_amount, 2),
    v_row.movement_date, p_movement_date,
    v_row.method, p_method,
    coalesce(v_row.memo, ''), coalesce(p_memo, '')
  );

  update owner_cash_movements set
    amount = round(p_amount, 2),
    movement_date = p_movement_date,
    method = p_method,
    memo = coalesce(p_memo, ''),
    updated_at = now()
   where owner_id = effective_owner_id and id = p_movement_id
  returning * into v_row;

  return jsonb_build_object('movement', to_jsonb(v_row));
end;
$$;

revoke all on function update_owner_movement(text, text, numeric, date, text, text, text) from public;
grant execute on function update_owner_movement(text, text, numeric, date, text, text, text) to authenticated;
