-- Charge-tenant (Option B + B1): ad-hoc tenant charges live on rent_charges.
--
-- 1. Widen charge_type to include damage / fee / utility / other (ad-hoc tenant
--    charges). The old CHECK was added inline in 20260812002500, so it carries the
--    auto-generated name rent_charges_charge_type_check; drop it dynamically to be
--    safe and re-add with an explicit name.
-- 2. schedule_id becomes NULLABLE. An ad-hoc charge has a lease but no rent
--    schedule; the FK (owner_id, schedule_id) permits NULL (skips the check).
-- 3. Atomic expense+charge RPC: create_expense_with_tenant_charge inserts the
--    financial_events expense row and the rent_charges row in one transaction —
--    never an expense without its charge or vice versa.
--
-- Audit of schedule_id assumptions (2026-09-26):
-- - The pre-effective-date void in 20260812001700 is a one-time UPDATE joining
--   charge.schedule_id = schedule.id; NULL schedule_ids never match the join, so
--   ad-hoc charges are unaffected.
-- - generate_monthly_rent_charge requires a schedule id; unaffected.
-- - No triggers exist on rent_charges.
-- - rent-due-reminders already requires charge.schedule_id for eligibility, so
--   ad-hoc charges are excluded from reminders by construction (an explicit
--   charge_type allowlist is also applied in application code).
-- - The portal payment-session schedule gate is null-schedule aware in
--   application code (falls back to the lease's active schedule).
--
-- NOT APPLIED — authored for Jason's explicit approval before touching production.

-- 1. Nullable schedule_id for ad-hoc (schedule-less) charges.
alter table rent_charges alter column schedule_id drop not null;

-- 2. Widen the charge_type check.
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
    from pg_constraint
   where conrelid = 'rent_charges'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%charge_type%';
  if constraint_name is not null then
    execute format('alter table rent_charges drop constraint %I', constraint_name);
  end if;
end
$$;

alter table rent_charges
  add constraint rent_charges_charge_type_check
  check (charge_type in ('rent', 'proration', 'late_fee', 'damage', 'fee', 'utility', 'other'));

-- 3. Atomic expense + tenant-charge creation.
--
-- Inserts the manual financial_events expense row and the ad-hoc rent_charges
-- row in a single transaction. Any failure rolls back both — the owner can
-- never end up with an expense missing its tenant charge, or a tenant charge
-- missing its expense.
--
-- The charge is schedule-less (schedule_id NULL), status 'due', source_key
-- 'tenantcharge:<financial_event_id>'. The event's metadata records the tenant
-- intent (charged_to_tenant) and the created charge id for the two-way link.
--
-- Reversal policy (enforced by convention + the existing void_rental_rent_charge
-- RPC): void the charge, never delete it. Voiding the charge does NOT delete
-- the expense — the owner still spent the money. A charge with paid_amount_cents
-- > 0 cannot be voided; resolve through refunds/credits first.
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
    true, true, false, 'manual',
    jsonb_strip_nulls(jsonb_build_object(
      'tenant_id', v_tenant_id,
      'charged_to_tenant', true,
      'memo', v_memo
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
