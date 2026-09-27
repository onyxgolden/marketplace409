-- Ledger parity slice 1: richer transaction fields + per-transaction edit history.
--
-- 1. financial_events gains the transaction-form fields the reference ledger shows:
--    display_as (custom display name), ref_number, payee_mailing_address,
--    assigned_to (vendor), is_recurring + recurrence_rule, depreciate.
--    Plain owner-table columns — they inherit financial_events' existing RLS,
--    the same way payee/check_number were added in
--    20260926150000_rental_ledger_foundation.sql (no new policies needed).
-- 2. financial_event_edits: lightweight audit trail. One row per edit with a
--    JSONB diff ({ field: { from, to } }) of the changed columns. RLS mirrors
--    the splits/attachments pattern: has_workspace_access(owner_id).
-- 3. create_expense_with_tenant_charge is replaced so the atomic expense+charge
--    path stores the new event keys too (it builds the financial_events row
--    from explicit columns).
-- 4. update_transaction_with_history: the transaction PATCH applies its edit
--    AND writes the financial_event_edits audit row inside one function call,
--    so both commit or both roll back. A successful edit always carries its
--    audit record — a failed history insert fails the whole edit loudly
--    instead of being swallowed.

-- ---------------------------------------------------------------------------
-- 1. New columns on financial_events
-- ---------------------------------------------------------------------------
alter table financial_events
  add column if not exists display_as text,
  add column if not exists ref_number text,
  add column if not exists payee_mailing_address text,
  add column if not exists assigned_to text,
  add column if not exists is_recurring boolean not null default false,
  add column if not exists recurrence_rule text,
  add column if not exists depreciate boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. financial_event_edits
-- ---------------------------------------------------------------------------
create table if not exists financial_event_edits (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null,
  event_id text not null references financial_events(id) on delete cascade,
  edited_at timestamptz not null default now(),
  edited_by text,
  changes jsonb not null default '{}'::jsonb
);

create index if not exists idx_financial_event_edits_event
  on financial_event_edits(event_id, edited_at desc);

alter table financial_event_edits enable row level security;
alter table financial_event_edits force row level security;

drop policy if exists "financial_event_edits_owner_select" on financial_event_edits;
create policy "financial_event_edits_owner_select" on financial_event_edits for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "financial_event_edits_owner_insert" on financial_event_edits;
create policy "financial_event_edits_owner_insert" on financial_event_edits for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "financial_event_edits_owner_update" on financial_event_edits;
create policy "financial_event_edits_owner_update" on financial_event_edits for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "financial_event_edits_owner_delete" on financial_event_edits;
create policy "financial_event_edits_owner_delete" on financial_event_edits for delete to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- 3. create_expense_with_tenant_charge: accept the new event keys
-- ---------------------------------------------------------------------------
create or replace function create_expense_with_tenant_charge(
  p_owner_id text,
  p_event jsonb,
  p_charge jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  authenticated_owner_id text := auth.uid()::text;
  required_owner text := nullif(btrim(p_owner_id), '');
  v_event_id text;
  v_charge_id text;
  v_lease_id text := nullif(btrim(p_charge ->> 'leaseId'), '');
  v_charge_type text := nullif(btrim(p_charge ->> 'chargeType'), '');
  v_amount_cents bigint := nullif(btrim(p_charge ->> 'amountCents'), '')::bigint;
  v_due_date date := (nullif(btrim(p_charge ->> 'dueDate'), ''))::date;
  v_charge_date date := (nullif(btrim(p_charge ->> 'chargeDate'), ''))::date;
  v_description text := nullif(btrim(p_charge ->> 'description'), '');
  v_tenant_id text := nullif(btrim(p_event ->> 'tenantId'), '');
  v_event_amount numeric := nullif(btrim(p_event ->> 'amount'), '')::numeric;
  v_bank_account_id text := nullif(btrim(p_event ->> 'bankAccountId'), '');
  v_currency text;
  v_period text;
  v_memo text := nullif(btrim(p_event ->> 'memo'), '');
  v_payment_method text := nullif(btrim(p_event ->> 'paymentMethod'), '');
  v_recurrence_rule text := nullif(btrim(p_event ->> 'recurrenceRule'), '');
begin
  if authenticated_owner_id is null then
    raise exception 'Authenticated owner id is required.' using errcode = '42501';
  end if;
  if required_owner is null or required_owner <> authenticated_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;

  -- Charge validation: ad-hoc tenant charges only (rent billing never flows here).
  if v_charge_type is null or v_charge_type not in ('damage', 'fee', 'utility', 'other') then
    raise exception 'Tenant charge type must be damage, fee, utility, or other.' using errcode = '22023';
  end if;
  if v_lease_id is null then
    raise exception 'Tenant charge requires a lease.' using errcode = '22023';
  end if;
  select currency_code into v_currency from rental_leases
   where owner_id = required_owner and id = v_lease_id;
  if not found then
    raise exception 'Lease was not found.' using errcode = 'P0002';
  end if;
  if v_amount_cents is null or v_amount_cents <= 0 then
    raise exception 'Tenant charge amount must be a positive number of cents.' using errcode = '22023';
  end if;
  if v_due_date is null then
    raise exception 'Tenant charge requires a due date.' using errcode = '22023';
  end if;
  if v_charge_date is null then
    raise exception 'Tenant charge requires a charge date.' using errcode = '22023';
  end if;
  if v_description is null then
    raise exception 'Tenant charge requires a description.' using errcode = '22023';
  end if;
  v_period := to_char(v_charge_date, 'YYYY-MM');

  -- Event validation: charge-tenant only ever attaches to an expense.
  if (p_event ->> 'transactionKind') <> 'expense' then
    raise exception 'Charge-tenant requires an expense event.' using errcode = '22023';
  end if;
  if v_event_amount is null or v_event_amount <= 0 then
    raise exception 'Expense amount must be positive.' using errcode = '22023';
  end if;
  if nullif(btrim(p_event ->> 'description'), '') is null then
    raise exception 'Expense description is required.' using errcode = '22023';
  end if;
  if (p_event ->> 'eventDate') is null or btrim(p_event ->> 'eventDate') = '' then
    raise exception 'Expense date is required.' using errcode = '22023';
  end if;
  if v_recurrence_rule is not null and v_recurrence_rule not in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly') then
    raise exception 'Recurrence rule must be weekly, biweekly, monthly, quarterly, or yearly.' using errcode = '22023';
  end if;
  -- The bank account must belong to this owner — a foreign id fails honestly
  -- instead of writing a dangling reference.
  if v_bank_account_id is not null then
    perform 1 from financial_accounts where owner_id = required_owner and id = v_bank_account_id;
    if not found then
      raise exception 'The selected bank account was not found.' using errcode = 'P0002';
    end if;
  end if;

  -- 1. The owner's expense (as today: manual source, active, not deleted).
  insert into financial_events (
    owner_id, property_id, event_date, description, amount, transaction_kind,
    normalized_category, payee, check_number, bank_account_id, cleared, cleared_at,
    display_as, ref_number, payee_mailing_address, assigned_to,
    is_recurring, recurrence_rule, depreciate,
    tax_deductible, affects_noi, capitalized, source_system, metadata,
    status, is_deleted, created_by, updated_by
  ) values (
    required_owner,
    nullif(btrim(p_event ->> 'propertyId'), ''),
    (p_event ->> 'eventDate')::date,
    btrim(p_event ->> 'description'),
    v_event_amount,
    'expense',
    nullif(btrim(p_event ->> 'normalizedCategory'), ''),
    nullif(btrim(p_event ->> 'payee'), ''),
    nullif(btrim(p_event ->> 'checkNumber'), ''),
    v_bank_account_id,
    coalesce((p_event ->> 'cleared')::boolean, false),
    case when coalesce((p_event ->> 'cleared')::boolean, false) then now() else null end,
    nullif(btrim(p_event ->> 'displayAs'), ''),
    nullif(btrim(p_event ->> 'refNumber'), ''),
    nullif(btrim(p_event ->> 'payeeMailingAddress'), ''),
    nullif(btrim(p_event ->> 'assignedTo'), ''),
    coalesce((p_event ->> 'isRecurring')::boolean, false),
    case when coalesce((p_event ->> 'isRecurring')::boolean, false) then v_recurrence_rule else null end,
    coalesce((p_event ->> 'depreciate')::boolean, false),
    true, true, false, 'manual',
    jsonb_strip_nulls(jsonb_build_object(
      'tenant_id', v_tenant_id,
      'charged_to_tenant', true,
      'memo', v_memo,
      'payment_method', v_payment_method
    )),
    'active', false, authenticated_owner_id, authenticated_owner_id
  )
  returning id into v_event_id;

  -- 2. The tenant's charge: schedule-less, due, uniquely keyed to the event.
  v_charge_id := 'rent_charge_tenant_' || replace(gen_random_uuid()::text, '-', '');
  insert into rent_charges (
    owner_id, id, lease_id, schedule_id, period, due_date, amount_cents,
    paid_amount_cents, currency_code, status, source_key, notes
  ) values (
    required_owner, v_charge_id, v_lease_id, null, v_period, v_due_date, v_amount_cents,
    0, v_currency, 'due', 'tenantcharge:' || v_event_id, v_description
  );

  -- 3. Two-way link: the event records its charge.
  update financial_events
     set metadata = metadata || jsonb_build_object('tenant_charge_id', v_charge_id),
         updated_at = now()
   where owner_id = required_owner and id = v_event_id;

  return jsonb_build_object('eventId', v_event_id, 'chargeId', v_charge_id);
end;
$$;

revoke all on function create_expense_with_tenant_charge(text, jsonb, jsonb) from public;
grant execute on function create_expense_with_tenant_charge(text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. update_transaction_with_history: atomic transaction edit + audit row
-- ---------------------------------------------------------------------------
-- The PATCH route calls this once. Everything below runs inside the function's
-- single implicit transaction: if the history insert fails (transient DB error,
-- constraint violation, anything), the whole function aborts and the event
-- edit rolls back with it. The caller therefore never sees a "successful"
-- edit without its audit record, and the route surfaces the failure as a 500
-- instead of swallowing it.
--
-- Authorization follows the shared workspace pattern: the caller's effective
-- owner is resolved with public.resolve_effective_owner_id(), so an
-- authorized co-owner edits the primary owner's books instead of being
-- rejected (or writing under their own id). The caller must name that
-- effective owner in p_owner_id; anyone naming a different workspace is
-- rejected. The actor (updated_by / edited_by) is recorded server-side from
-- auth.uid() — the caller-supplied p_edited_by is never trusted.
create or replace function update_transaction_with_history(
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
  -- The workspace this edit belongs to: the caller's own id, or the primary
  -- owner's id when the caller is an authorized co-owner. Null when
  -- unauthenticated (resolve_effective_owner_id returns null then).
  effective_owner_id text := public.resolve_effective_owner_id();
  required_owner text := nullif(btrim(p_owner_id), '');
  v_event_id text := nullif(btrim(p_event_id), '');
  v_bank_account_id text := nullif(btrim(p_event ->> 'bankAccountId'), '');
  v_tenant_id text := nullif(btrim(p_event ->> 'tenantId'), '');
  v_changes jsonb := coalesce(p_changes, '{}'::jsonb);
  v_edited_by text;
  v_row financial_events%rowtype;
begin
  -- Authenticated callers only.
  if v_actor_id is null or effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  -- The caller must name the workspace they are actually authorized for —
  -- their own effective owner. An authorized co-owner therefore edits the
  -- primary owner's books; anyone naming a different workspace is rejected
  -- as an outsider.
  if required_owner is null or required_owner <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;
  if v_event_id is null then
    raise exception 'Transaction id is required.' using errcode = '22023';
  end if;
  -- The actor is recorded server-side from auth.uid(): the caller-supplied
  -- p_edited_by is kept in the signature for call-shape stability but never
  -- trusted, so a co-owner cannot impersonate the primary owner (or anyone
  -- else) in the audit trail.
  v_edited_by := v_actor_id;

  -- The bank account must belong to this owner — a foreign id fails honestly
  -- instead of writing a dangling reference.
  if v_bank_account_id is not null then
    perform 1 from financial_accounts where owner_id = required_owner and id = v_bank_account_id;
    if not found then
      raise exception 'The selected bank account was not found.' using errcode = 'P0002';
    end if;
  end if;

  -- 1. Apply the edit. The row must be an owned, non-deleted manual event —
  -- imported events and other workspaces' rows fail here, not silently.
  update financial_events set
    property_id = nullif(btrim(p_event ->> 'propertyId'), ''),
    event_date = (p_event ->> 'eventDate')::date,
    description = btrim(p_event ->> 'description'),
    amount = (p_event ->> 'amount')::numeric,
    transaction_kind = p_event ->> 'transactionKind',
    normalized_category = nullif(btrim(p_event ->> 'normalizedCategory'), ''),
    payee = nullif(btrim(p_event ->> 'payee'), ''),
    check_number = nullif(btrim(p_event ->> 'checkNumber'), ''),
    bank_account_id = v_bank_account_id,
    cleared = coalesce((p_event ->> 'cleared')::boolean, false),
    cleared_at = p_cleared_at,
    display_as = nullif(btrim(p_event ->> 'displayAs'), ''),
    ref_number = nullif(btrim(p_event ->> 'refNumber'), ''),
    payee_mailing_address = nullif(btrim(p_event ->> 'payeeMailingAddress'), ''),
    assigned_to = nullif(btrim(p_event ->> 'assignedTo'), ''),
    is_recurring = coalesce((p_event ->> 'isRecurring')::boolean, false),
    recurrence_rule = nullif(btrim(p_event ->> 'recurrenceRule'), ''),
    depreciate = coalesce((p_event ->> 'depreciate')::boolean, false),
    metadata = jsonb_strip_nulls(jsonb_build_object(
      'memo', nullif(btrim(p_event ->> 'memo'), ''),
      'tenant_id', v_tenant_id,
      'charged_to_tenant', case when v_tenant_id is not null
        then coalesce((p_event ->> 'chargeTenant')::boolean, false) end,
      'payment_method', nullif(btrim(p_event ->> 'paymentMethod'), '')
    )),
    updated_by = v_edited_by,
    updated_at = now()
  where owner_id = required_owner
    and id = v_event_id
    and source_system = 'manual'
    and is_deleted = false
  returning * into v_row;
  if not found then
    raise exception 'Transaction was not found.' using errcode = 'P0002';
  end if;

  -- 2. Record the edit history in the SAME transaction. Any failure here
  -- aborts the function and rolls back the edit above — a successful edit
  -- therefore always has its audit row.
  if v_changes <> '{}'::jsonb then
    insert into financial_event_edits (owner_id, event_id, edited_by, changes)
    values (required_owner, v_event_id, v_edited_by, v_changes);
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'event_date', v_row.event_date,
    'description', v_row.description,
    'amount', v_row.amount,
    'transaction_kind', v_row.transaction_kind,
    'normalized_category', v_row.normalized_category,
    'payee', v_row.payee,
    'check_number', v_row.check_number,
    'bank_account_id', v_row.bank_account_id,
    'cleared', v_row.cleared,
    'cleared_at', v_row.cleared_at,
    'property_id', v_row.property_id
  );
end;
$$;

revoke all on function update_transaction_with_history(text, text, jsonb, jsonb, text, timestamptz) from public;
grant execute on function update_transaction_with_history(text, text, jsonb, jsonb, text, timestamptz) to authenticated;
