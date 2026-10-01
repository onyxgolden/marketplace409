-- 20261001013000_owner_disbursement_atomic_rpc.sql
--
-- Rentec-parity R9 follow-up: close the ChatGPT GO WITH FIXES finding on PR #514.
--
-- THE RACE: POST /api/rental/owner-movements used to load financial events and
-- cash movements, compute the available owner balance in application code,
-- validate amountCents <= balanceCents, and only afterward perform a separate
-- INSERT. Two concurrent disbursement requests could both read the same
-- balance before either insert committed and both could succeed, producing
-- total active disbursements greater than the owner balance.
--
-- THE FIX: record_owner_disbursement() performs the balance re-check and the
-- insert in ONE database transaction, serialized per effective owner:
--   1. take a stable per-owner advisory lock
--      (pg_advisory_xact_lock on a namespaced hash of the effective owner id;
--      transaction-scoped, released automatically at commit/rollback),
--   2. recompute the LIVE balance AFTER the lock, mirroring
--      buildOwnerBalance in src/application/rental/ownerStatements.js
--      (income - expenses - active disbursements + active contributions,
--      per-row abs(round(amount * 100)) cents, live events only),
--   3. enforce amount <= balance (RAISE EXCEPTION otherwise),
--   4. insert the disbursement row.
-- Competing disbursements for the same effective owner are mutually
-- exclusive: the loser recomputes the balance after the winner's insert
-- committed and fails the invariant itself. Contributions need no lock — they
-- only ever increase the available balance, so they cannot violate the
-- invariant in either interleaving order.
--
-- The route keeps its application-level precheck for fast UX failure; this
-- RPC is the enforcement boundary (the chart-of-accounts race migration
-- 20260928100000 follows the same precheck-in-route / enforce-in-RPC split).
--
-- This is a NEW migration on top of 20261001010000_owner_cash_movements.sql
-- (the already-reviewed R9 migration is not rewritten).

create or replace function record_owner_disbursement(
  p_owner_id text,
  p_property_id text,
  p_amount numeric,
  p_movement_date date,
  p_method text,
  p_memo text,
  p_created_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  required_owner text := nullif(btrim(p_owner_id), '');
  v_amount_cents bigint;
  v_income_cents bigint;
  v_expense_cents bigint;
  v_disbursement_cents bigint;
  v_contribution_cents bigint;
  v_balance_cents bigint;
  v_row owner_cash_movements%rowtype;
begin
  -- The RPC only ever writes for the authenticated workspace.
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if required_owner is null or required_owner <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;

  -- Server-side floor validation. The route performs the full validation;
  -- this keeps direct RPC callers honest without duplicating the whole
  -- validator.
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

  -- SERIALIZATION POINT. There is no natural owner row to lock (the balance
  -- is derived from financial_events + owner_cash_movements), so take a
  -- stable per-owner advisory lock. Everything below — the balance
  -- recompute, the invariant check, and the insert — runs in this one
  -- transaction while the lock is held.
  perform pg_advisory_xact_lock(hashtext('rental_owner_disbursement:' || effective_owner_id));

  -- Recompute the LIVE balance AFTER acquiring the lock. Mirrors
  -- buildOwnerBalance: per-row abs(round(amount * 100)) cents; live events
  -- are those not soft-deleted whose status is not inactive/deleted
  -- (coalesce keeps NULL-status rows live, exactly like the JS
  -- !EXCLUDED_STATUSES.has(event.status) check); live movements are
  -- status = 'active'.
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
     and ocm.status = 'active';

  select coalesce(sum(abs(round(ocm.amount * 100))::bigint), 0) into v_contribution_cents
    from owner_cash_movements ocm
   where ocm.owner_id = effective_owner_id
     and ocm.kind = 'contribution'
     and ocm.status = 'active';

  v_balance_cents := v_income_cents - v_expense_cents - v_disbursement_cents + v_contribution_cents;

  -- The invariant, enforced at the database boundary. The OVER_DISBURSEMENT
  -- token lets the route map this to its 422 (same user-facing message as
  -- the application precheck); the available balance rides along so the
  -- route can report it.
  if v_amount_cents > v_balance_cents then
    raise exception 'OVER_DISBURSEMENT: The disbursement exceeds the amount due to the owner. Available balance: %s cents; requested: %s cents.', v_balance_cents, v_amount_cents
      using errcode = 'P0001';
  end if;

  insert into owner_cash_movements (
    owner_id, property_id, kind, amount, movement_date, method, memo, status, created_by
  )
  values (
    effective_owner_id,
    nullif(btrim(p_property_id), ''),
    'disbursement',
    round(p_amount, 2),
    p_movement_date,
    p_method,
    coalesce(p_memo, ''),
    'active',
    nullif(btrim(p_created_by), '')
  )
  returning * into v_row;

  return jsonb_build_object('movement', to_jsonb(v_row), 'balanceCents', v_balance_cents);
end;
$$;

revoke all on function record_owner_disbursement(text, text, numeric, date, text, text, text) from public;
grant execute on function record_owner_disbursement(text, text, numeric, date, text, text, text) to authenticated;
