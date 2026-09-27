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
