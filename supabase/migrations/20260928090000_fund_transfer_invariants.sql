-- Fund-transfer RPC hardening (retrospective review of slice 3).
--
-- ChatGPT's retrospective review of the slice-3 reconstruction returned
-- RETRO-CHANGES with two findings, both fixed here in a NEW migration. The
-- already-applied 20260927140000_fund_transfer.sql is NOT modified.
--
-- Finding 1: update_transfer_leg_with_history trusted the API route's
-- structural check (amount / transaction kind / bank account unchanged).
-- That check runs against a read that can go stale under concurrency, and a
-- direct authenticated RPC call skips the route entirely -- so one leg of a
-- transfer could be edited into a different amount, kind, or account while
-- the other leg kept the original values, silently breaking the two-leg
-- invariant. The RPC now locks BOTH legs (SELECT ... FOR UPDATE) before
-- anything is written, verifies the pair currently balances, and rejects any
-- structural change against the LOCKED rows -- the database is the
-- enforcement boundary, the route's comparison is just the early UX
-- rejection.
--
-- Finding 2: create_fund_transfer validated amount > 0 but never enforced
-- two-decimal currency precision in SQL, so a direct RPC caller could post
-- fractional cents (the client rounds, the database did not). The RPC now
-- rounds to the cent in SQL, re-checks positivity after rounding, and
-- rejects absurdly large amounts.
--
-- This migration is NOT applied anywhere by the tests. It is reviewed and
-- applied on Jason's word, same as every other ledger migration.

-- ---------------------------------------------------------------------------
-- 1. create_fund_transfer: enforce currency precision + amount bounds in SQL
-- ---------------------------------------------------------------------------
create or replace function create_fund_transfer(
  p_from_account_id text,
  p_to_account_id text,
  p_event jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor_id text := auth.uid()::text;
  -- The workspace owner this transfer belongs to: the caller's own id, or
  -- the primary owner's id when the caller is an authorized co-owner. Null
  -- when unauthenticated (resolve_effective_owner_id returns null then).
  effective_owner_id text := public.resolve_effective_owner_id();
  v_amount numeric;
  v_event_date date;
  v_memo text;
  v_check_number text;
  v_from_name text;
  v_to_name text;
  v_group_id text := 'transfer_' || replace(gen_random_uuid()::text, '-', '');
  v_out_event_id text;
  v_in_event_id text;
begin
  -- Authenticated callers only (mirrors create_expense_with_tenant_charge).
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  -- The two accounts must differ.
  if p_from_account_id is null or p_to_account_id is null or
     p_from_account_id = p_to_account_id then
    raise exception 'The source and destination accounts must be two different accounts.'
      using errcode = '22000';
  end if;

  -- Amount must be positive.
  v_amount := nullif(p_event ->> 'amount', '')::numeric;
  if v_amount is null or v_amount <= 0 then
    raise exception 'The transfer amount must be greater than zero.'
      using errcode = '22000';
  end if;

  -- Currency precision is enforced in SQL, not just in the client: fractional
  -- cents are rounded to the cent, so a direct RPC caller cannot post
  -- sub-cent amounts. The rounded amount is what both legs store, and it is
  -- returned to the caller so nothing is hidden.
  v_amount := round(v_amount, 2);
  if v_amount <= 0 then
    raise exception 'The transfer amount must be greater than zero.'
      using errcode = '22000';
  end if;

  -- Sanity bound: a transfer between two of the owner's own accounts has no
  -- legitimate reason to reach a billion dollars; reject garbage/overflow.
  if v_amount >= 1000000000 then
    raise exception 'The transfer amount is unreasonably large.'
      using errcode = '22000';
  end if;

  -- Event date is required.
  begin
    v_event_date := (p_event ->> 'eventDate')::date;
  exception when others then
    v_event_date := null;
  end;
  if v_event_date is null then
    raise exception 'The transfer date is required.' using errcode = '22000';
  end if;

  -- Both accounts must belong to the effective owner. One lookup, two rows
  -- required. A co-owner's effective owner is the primary owner, so their
  -- transfer moves the workspace's money, not their own.
  select max(case when id = p_from_account_id then name end),
         max(case when id = p_to_account_id then name end)
    into v_from_name, v_to_name
    from financial_accounts
    where owner_id = effective_owner_id
      and id in (p_from_account_id, p_to_account_id);
  if v_from_name is null or v_to_name is null then
    raise exception 'One of the selected accounts was not found.'
      using errcode = '22000';
  end if;

  v_memo := nullif(trim(coalesce(p_event ->> 'memo', '')), '');
  v_check_number := nullif(trim(coalesce(p_event ->> 'checkNumber', '')), '');

  -- Leg 1: money OUT of the source account (expense / debit).
  insert into financial_events (
    owner_id, event_date, description, amount, transaction_kind,
    normalized_category, source_system, bank_account_id, check_number,
    transfer_group_id, metadata, created_by
  ) values (
    effective_owner_id, v_event_date,
    'Transfer to ' || v_to_name, v_amount, 'expense',
    'transfer', 'manual', p_from_account_id, v_check_number,
    v_group_id,
    jsonb_build_object(
      'memo', v_memo,
      'transfer_direction', 'out',
      'counterpart_account_id', p_to_account_id,
      'counterpart_account_name', v_to_name
    ),
    v_actor_id
  ) returning id into v_out_event_id;

  -- Leg 2: money INTO the destination account (income / credit).
  insert into financial_events (
    owner_id, event_date, description, amount, transaction_kind,
    normalized_category, source_system, bank_account_id, check_number,
    transfer_group_id, metadata, created_by
  ) values (
    effective_owner_id, v_event_date,
    'Transfer from ' || v_from_name, v_amount, 'income',
    'transfer', 'manual', p_to_account_id, v_check_number,
    v_group_id,
    jsonb_build_object(
      'memo', v_memo,
      'transfer_direction', 'in',
      'counterpart_account_id', p_from_account_id,
      'counterpart_account_name', v_from_name
    ),
    v_actor_id
  ) returning id into v_in_event_id;

  -- Cross-link the legs so each points at the other.
  update financial_events
    set metadata = metadata || jsonb_build_object('counterpart_event_id', v_in_event_id)
    where id = v_out_event_id;
  update financial_events
    set metadata = metadata || jsonb_build_object('counterpart_event_id', v_out_event_id)
    where id = v_in_event_id;

  return jsonb_build_object(
    'transfer_group_id', v_group_id,
    'out_event_id', v_out_event_id,
    'in_event_id', v_in_event_id,
    'from_account_id', p_from_account_id,
    'to_account_id', p_to_account_id,
    'amount', v_amount,
    'event_date', v_event_date
  );
end;
$$;

revoke all on function create_fund_transfer(text, text, jsonb) from public;
grant execute on function create_fund_transfer(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. update_transfer_leg_with_history: lock both legs, enforce the pair
--    invariant at the database boundary
-- ---------------------------------------------------------------------------
-- Everything below runs inside the function's single implicit transaction:
--   1. both legs are locked and the pair invariant is verified,
--   2. structural edits (amount / transaction kind / bank account) are
--      rejected against the LOCKED rows,
--   3. the initiating leg's edit + audit row, delegated to
--      update_transaction_with_history (a plain PL/pgSQL call -- no EXCEPTION
--      blocks anywhere here, so the delegated write inherits this
--      transaction and rolls back with it on any failure), and
--   4. the pair-wide date propagation to every non-deleted leg of the pair.
-- Any failure in any step aborts the function and rolls everything back.
create or replace function update_transfer_leg_with_history(
  p_owner_id text,
  p_event_id text,
  p_event jsonb,
  p_changes jsonb,
  p_edited_by text,
  p_cleared_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor_id text := auth.uid()::text;
  -- The workspace owner this edit belongs to: the caller's own id, or the
  -- primary owner's id when the caller is an authorized co-owner. Null when
  -- unauthenticated (resolve_effective_owner_id returns null then).
  effective_owner_id text := public.resolve_effective_owner_id();
  required_owner text := nullif(btrim(p_owner_id), '');
  v_event_id text := nullif(btrim(p_event_id), '');
  -- p_edited_by stays in the signature for call-shape stability but is never
  -- trusted: the actor recorded below is always auth.uid(), recorded
  -- server-side, so a caller cannot falsify the audit trail.
  v_group_id text;
  v_new_date date := (p_event ->> 'eventDate')::date;
  v_result jsonb;
  -- Locked structural snapshots of both legs.
  v_init_id text;
  v_init_amount numeric;
  v_init_kind text;
  v_init_account text;
  v_peer_id text;
  v_peer_amount numeric;
  v_peer_kind text;
  v_peer_account text;
  -- Proposed structural values from the caller's edit.
  v_new_amount numeric;
  v_new_kind text;
  v_new_account text;
begin
  -- Authenticated callers only (mirrors create_fund_transfer).
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if required_owner is null or required_owner <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;
  if v_event_id is null then
    raise exception 'Transaction id is required.' using errcode = '22023';
  end if;

  -- The edited event must be an owned, non-deleted manual transfer leg. Its
  -- group id drives the pair-wide propagation below; anything else used the
  -- wrong RPC and fails here, not silently.
  select transfer_group_id into v_group_id
    from financial_events
   where owner_id = effective_owner_id
     and id = v_event_id
     and source_system = 'manual'
     and is_deleted = false;
  if not found or v_group_id is null then
    raise exception 'This transaction is not part of a fund transfer.' using errcode = 'P0002';
  end if;

  -- 1. Lock BOTH legs of the pair before anything is written. Row locks
  -- serialize concurrent edits: no direct RPC caller or second session can
  -- change either leg's structural fields between this check and the
  -- delegated write below. The route performs the same structural comparison
  -- for UX, but its read can go stale -- the locked rows are the authority.
  select id, amount, transaction_kind, bank_account_id
    into v_init_id, v_init_amount, v_init_kind, v_init_account
    from financial_events
   where owner_id = effective_owner_id
     and id = v_event_id
     and is_deleted = false
     for update;
  if not found then
    raise exception 'This transaction is not part of a fund transfer.' using errcode = 'P0002';
  end if;

  select id, amount, transaction_kind, bank_account_id
    into v_peer_id, v_peer_amount, v_peer_kind, v_peer_account
    from financial_events
   where owner_id = effective_owner_id
     and transfer_group_id = v_group_id
     and id <> v_event_id
     and is_deleted = false
     for update;
  if not found then
    raise exception 'This fund transfer is missing its counterpart leg.' using errcode = 'P0002';
  end if;

  -- A transfer is exactly two non-deleted legs. A third row sharing the
  -- group id means the id was reused or corrupted -- refuse rather than
  -- propagate into a broken pair.
  perform 1
    from financial_events
   where owner_id = effective_owner_id
     and transfer_group_id = v_group_id
     and id not in (v_init_id, v_peer_id)
     and is_deleted = false;
  if found then
    raise exception 'This fund transfer does not have exactly two legs. Delete the transfer and re-create it.' using errcode = 'P0002';
  end if;

  -- The pair must currently balance: equal amounts, opposite kinds (expense
  -- out / income in), two distinct bank accounts. If the legs already
  -- diverged, refuse to edit -- delete and re-create the transfer instead
  -- of propagating a broken pair's date.
  if v_init_amount is distinct from v_peer_amount
     or v_init_kind is not distinct from v_peer_kind
     or coalesce(v_init_kind, '') not in ('expense', 'income')
     or coalesce(v_peer_kind, '') not in ('expense', 'income')
     or v_init_account is not distinct from v_peer_account
     or v_init_account is null
     or v_peer_account is null then
    raise exception 'This fund transfer''s legs do not balance. Delete the transfer and re-create it.' using errcode = 'P0002';
  end if;

  -- 2. Structural edits are rejected at the database boundary. The route
  -- performs this same comparison against its own read, but that read can go
  -- stale under concurrency, and a direct authenticated RPC call skips the
  -- route entirely -- so the proposed values are compared against the locked
  -- rows, never against the caller's earlier read.
  v_new_amount := (p_event ->> 'amount')::numeric;
  v_new_kind := p_event ->> 'transactionKind';
  v_new_account := nullif(btrim(p_event ->> 'bankAccountId'), '');
  if v_new_amount is distinct from v_init_amount
     or v_new_kind is distinct from v_init_kind
     or v_new_account is distinct from v_init_account then
    raise exception 'This transaction is part of a fund transfer. Delete the transfer and re-create it to change the amount or accounts.'
      using errcode = '22000';
  end if;

  -- 3. The initiating leg's edit + audit row, atomically, via the shared RPC.
  -- A plain function call (no EXCEPTION blocks) runs inside THIS function's
  -- implicit transaction: any failure rolls back with it.
  v_result := update_transaction_with_history(
    effective_owner_id, v_event_id, p_event, p_changes, p_edited_by, p_cleared_at
  );

  -- 4. Pair-wide date propagation in the SAME transaction. Only legs whose
  -- date actually differs are touched, so an already-matching leg keeps its
  -- own updated_by / updated_at (the initiating leg was just stamped with
  -- v_new_date above, so the distinct-from guard excludes it). The actor is
  -- the server-side auth.uid() -- the caller-supplied p_edited_by is never
  -- trusted here, consistent with update_transaction_with_history.
  if v_new_date is not null then
    update financial_events
       set event_date = v_new_date,
           updated_by = v_actor_id,
           updated_at = now()
     where owner_id = effective_owner_id
       and transfer_group_id = v_group_id
       and is_deleted = false
       and event_date is distinct from v_new_date;
  end if;

  return v_result;
end;
$$;

revoke all on function update_transfer_leg_with_history(text, text, jsonb, jsonb, text, timestamptz) from public;
grant execute on function update_transfer_leg_with_history(text, text, jsonb, jsonb, text, timestamptz) to authenticated;
