-- Ledger parity slice 3: fund transfers.
--
-- Adds a transfer_group_id column to financial_events plus the
-- create_fund_transfer RPC, which posts a transfer between two of the owner's
-- bank accounts as a single atomic write: an expense leg (money out of the
-- source account) and an income leg (money into the destination account),
-- both stamped with the same transfer_group_id so each leg can show its
-- counterpart. Any failure rolls back both legs -- a one-sided transfer is
-- impossible.
--
-- Conventions copied from 20260927120000_ledger_transaction_fields.sql:
-- SECURITY INVOKER, owner predicates, execute granted to authenticated only,
-- server-side validation with plain-English errors. Owner resolution follows
-- the shared workspace pattern (20260829001500): the RPC derives the
-- effective owner with public.resolve_effective_owner_id(), so an authorized
-- co-owner's transfer lands in the primary owner's books instead of being
-- rejected or, worse, written under the co-owner's own id.
--
-- This migration is NOT applied anywhere by the slice-3 code or tests. It is
-- reviewed and applied on Jason's word, same as every other ledger migration.

-- ---------------------------------------------------------------------------
-- 1. transfer_group_id on financial_events
-- ---------------------------------------------------------------------------
alter table financial_events
  add column if not exists transfer_group_id text;

create index if not exists idx_financial_events_transfer_group
  on financial_events(transfer_group_id)
  where transfer_group_id is not null;

-- ---------------------------------------------------------------------------
-- 2. create_fund_transfer RPC
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
-- 3. update_transfer_leg_with_history RPC
-- ---------------------------------------------------------------------------
-- A fund transfer is one economic event: both legs must always share the same
-- date (split dates would put the debit and credit in different accounting
-- periods). The PATCH route calls this RPC -- and nothing else -- when the
-- edited event is a transfer leg. Everything below runs inside the function's
-- single implicit transaction:
--   1. the initiating leg's edit + audit row, delegated to
--      update_transaction_with_history (a plain PL/pgSQL call -- no EXCEPTION
--      blocks anywhere here, so the delegated write inherits this
--      transaction and rolls back with it on any failure), and
--   2. the pair-wide date propagation to every non-deleted leg of the pair.
-- Any failure in either step aborts the function and rolls everything back:
-- the edit, the audit row, and the pair dates are all-or-nothing, so the legs
-- can never be left with different dates.
--
-- transfer_group_id is added by THIS migration (section 1), which is why this
-- RPC lives here and not in 20260927120000_ledger_transaction_fields.sql.
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

  -- 1. The initiating leg's edit + audit row, atomically, via the shared RPC.
  -- A plain function call (no EXCEPTION blocks) runs inside THIS function's
  -- implicit transaction: any failure rolls back with it.
  v_result := update_transaction_with_history(
    effective_owner_id, v_event_id, p_event, p_changes, p_edited_by, p_cleared_at
  );

  -- 2. Pair-wide date propagation in the SAME transaction. Only legs whose
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
