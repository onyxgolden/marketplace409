-- Rentec parity R4: pay vendors — record check/ACH payments against vendor bills.
--
-- R3 built the AP subledger (rental_vendors, rental_vendor_bills): recording a
-- bill posts NO financial_events row — FORGE reports cash-basis, so the expense
-- posts when the bill is PAID. That is this slice's job.
--
-- Status machine (R3 owns open ⇄ voided; R4 owns partial/paid):
--   open    — recorded, unpaid. Editable. Voidable with a reason.
--   partial — partially paid. A further payment (or a payment void) moves it.
--   paid    — fully paid. Locked; resolves through payment voids, never edits.
--   voided  — reversed, never deleted. Immutable.
--
-- Ledger design:
-- - rental_vendor_payments is the payment header (one row per check/ACH),
--   rental_vendor_payment_applications splits it across bills. One payment can
--   pay many bills; one bill can take many partial payments.
-- - The expense posts to financial_events when paid: ONE event row per bill
--   application, so each row carries the bill's exact expense account and
--   property (the splits table's fixed category list cannot hold custom chart
--   codes). The rows share the payment's check number, and the payment id
--   travels in each row's metadata.
-- - Overpayment is blocked fail-closed: an application can never exceed the
--   bill's remaining balance, and the applications must sum to the payment.
-- - Reversal = void with a reason. The ledger events are soft-deleted
--   (is_deleted/status='deleted', mirroring the transactions DELETE route),
--   never hard-removed; the bill balances roll back under row locks.
-- - A payment whose events appear on an ACTIVE bank reconciliation cannot be
--   edited or voided — the statement period is closed. Undoing the
--   reconciliation re-opens it.
--
-- NOT APPLIED — authored for the owner's explicit approval before touching production.

-- ---------------------------------------------------------------------------
-- 1. rental_vendor_payments — one row per check/ACH
-- ---------------------------------------------------------------------------
create table if not exists rental_vendor_payments (
  owner_id text not null,
  id text not null,
  vendor_id text not null,
  payment_date date not null,
  payment_method text not null check (payment_method in ('check', 'ach')),
  amount_cents bigint not null check (amount_cents > 0),
  bank_account_id text not null,
  check_number text,
  memo text,
  financial_event_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(financial_event_ids) = 'array'),
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  voided_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint rental_vendor_payments_vendor_fk
    foreign key (owner_id, vendor_id) references rental_vendors(owner_id, id),
  constraint rental_vendor_payments_check_needs_number
    check (payment_method <> 'check' or (check_number is not null and btrim(check_number) <> '')),
  constraint rental_vendor_payments_void_has_reason
    check (status <> 'voided' or (void_reason is not null and btrim(void_reason) <> ''))
);

create index if not exists idx_rental_vendor_payments_owner_vendor
  on rental_vendor_payments(owner_id, vendor_id, payment_date desc);
create index if not exists idx_rental_vendor_payments_owner_status
  on rental_vendor_payments(owner_id, status, payment_date desc);

-- ---------------------------------------------------------------------------
-- 2. rental_vendor_payment_applications — payment ⇄ bill split lines
-- ---------------------------------------------------------------------------
create table if not exists rental_vendor_payment_applications (
  owner_id text not null,
  payment_id text not null,
  bill_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  primary key (owner_id, payment_id, bill_id),
  constraint rental_vendor_payment_applications_payment_fk
    foreign key (owner_id, payment_id) references rental_vendor_payments(owner_id, id),
  constraint rental_vendor_payment_applications_bill_fk
    foreign key (owner_id, bill_id) references rental_vendor_bills(owner_id, id)
);

create index if not exists idx_rental_vendor_payment_applications_owner_bill
  on rental_vendor_payment_applications(owner_id, bill_id);

-- ---------------------------------------------------------------------------
-- 3. Row-level security — same owner-scoped contract as R3's tables
-- ---------------------------------------------------------------------------
alter table rental_vendor_payments enable row level security;
alter table rental_vendor_payments force row level security;

drop policy if exists "rental_vendor_payments_owner_select" on rental_vendor_payments;
create policy "rental_vendor_payments_owner_select" on rental_vendor_payments for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_vendor_payments_owner_insert" on rental_vendor_payments;
create policy "rental_vendor_payments_owner_insert" on rental_vendor_payments for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_vendor_payments_owner_update" on rental_vendor_payments;
create policy "rental_vendor_payments_owner_update" on rental_vendor_payments for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_vendor_payments_owner_delete" on rental_vendor_payments;
create policy "rental_vendor_payments_owner_delete" on rental_vendor_payments for delete to authenticated
  using (has_workspace_access(owner_id));

alter table rental_vendor_payment_applications enable row level security;
alter table rental_vendor_payment_applications force row level security;

drop policy if exists "rental_vendor_payment_applications_owner_select" on rental_vendor_payment_applications;
create policy "rental_vendor_payment_applications_owner_select" on rental_vendor_payment_applications for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_vendor_payment_applications_owner_insert" on rental_vendor_payment_applications;
create policy "rental_vendor_payment_applications_owner_insert" on rental_vendor_payment_applications for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_vendor_payment_applications_owner_update" on rental_vendor_payment_applications;
create policy "rental_vendor_payment_applications_owner_update" on rental_vendor_payment_applications for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_vendor_payment_applications_owner_delete" on rental_vendor_payment_applications;
create policy "rental_vendor_payment_applications_owner_delete" on rental_vendor_payment_applications for delete to authenticated
  using (has_workspace_access(owner_id));

-- updated_at maintenance, reusing R3's trigger function
drop trigger if exists trg_rental_vendor_payments_updated_at on rental_vendor_payments;
create trigger trg_rental_vendor_payments_updated_at
  before update on rental_vendor_payments
  for each row execute function public.touch_rental_vendor_updated_at();

-- ---------------------------------------------------------------------------
-- 4. record_vendor_payment — atomic payment posting
-- ---------------------------------------------------------------------------
-- One RPC, one database transaction: the payment header, its applications,
-- one financial_events expense row per application (each with the bill's exact
-- expense account and property), and the bill balance/status updates all land
-- together or not at all. Bills are locked in bill-id order so concurrent
-- payments serialize instead of double-paying.
--
-- p_payment: { id, vendorId, paymentDate, paymentMethod ('check'|'ach'),
--   checkNumber, bankAccountId, memo, amountCents,
--   applications: [{ billId, amountCents }] }
create or replace function record_vendor_payment(p_owner_id text, p_payment jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  v_actor_id text := auth.uid()::text;
  v_payment_id text := nullif(btrim(p_payment ->> 'id'), '');
  v_vendor_id text := nullif(btrim(p_payment ->> 'vendorId'), '');
  v_payment_date date := nullif(btrim(p_payment ->> 'paymentDate'), '')::date;
  v_method text := nullif(btrim(p_payment ->> 'paymentMethod'), '');
  v_check_number text := nullif(btrim(p_payment ->> 'checkNumber'), '');
  v_bank_account_id text := nullif(btrim(p_payment ->> 'bankAccountId'), '');
  v_memo text := nullif(btrim(p_payment ->> 'memo'), '');
  v_amount_cents bigint := (p_payment ->> 'amountCents')::bigint;
  v_vendor_name text;
  v_apps jsonb := coalesce(p_payment -> 'applications', '[]'::jsonb);
  v_app jsonb;
  v_bill_id text;
  v_app_cents bigint;
  v_bill rental_vendor_bills%rowtype;
  v_balance bigint;
  v_total_applied bigint := 0;
  v_event_ids text[] := '{}';
  v_event_id text;
  v_cat_active boolean;
  v_new_paid bigint;
  v_new_status text;
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;

  -- Server-side floor validation. The route validates first with friendlier
  -- messages; this keeps direct RPC callers honest.
  if v_payment_id is null then
    raise exception 'A payment id is required.' using errcode = '22023';
  end if;
  if v_vendor_id is null then
    raise exception 'A vendor is required.' using errcode = '22023';
  end if;
  if v_payment_date is null then
    raise exception 'A payment date is required.' using errcode = '22023';
  end if;
  if v_method is null or v_method not in ('check', 'ach') then
    raise exception 'Payment method must be check or ach.' using errcode = '22023';
  end if;
  if v_method = 'check' and v_check_number is null then
    raise exception 'A check number is required for check payments.' using errcode = '22023';
  end if;
  if v_bank_account_id is null then
    raise exception 'A bank account is required.' using errcode = '22023';
  end if;
  if v_amount_cents is null or v_amount_cents <= 0 then
    raise exception 'The payment amount must be positive.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_apps) <> 'array' or jsonb_array_length(v_apps) = 0 then
    raise exception 'At least one bill application is required.' using errcode = '22023';
  end if;

  -- The bank account must belong to this owner.
  perform 1 from financial_accounts
   where owner_id = effective_owner_id and id = v_bank_account_id;
  if not found then
    raise exception 'The selected bank account was not found.' using errcode = 'P0002';
  end if;

  -- The vendor must exist (friendly error ahead of the FK).
  select name into v_vendor_name from rental_vendors
   where owner_id = effective_owner_id and id = v_vendor_id;
  if not found then
    raise exception 'The vendor was not found.' using errcode = 'P0002';
  end if;

  -- Validate every application against its locked bill, in bill-id order so
  -- concurrent payments serialize instead of deadlocking or double-paying.
  select jsonb_agg(a order by (a ->> 'billId'))
    into v_apps
    from jsonb_array_elements(v_apps) as a;
  for v_app in select * from jsonb_array_elements(v_apps) loop
    v_bill_id := nullif(btrim(v_app ->> 'billId'), '');
    v_app_cents := (v_app ->> 'amountCents')::bigint;
    if v_bill_id is null then
      raise exception 'Every application needs a bill.' using errcode = '22023';
    end if;
    if v_app_cents is null or v_app_cents <= 0 then
      raise exception 'Every application amount must be positive.' using errcode = '22023';
    end if;
    select * into v_bill from rental_vendor_bills
     where owner_id = effective_owner_id and id = v_bill_id
     for update;
    if not found then
      raise exception 'A bill was not found.' using errcode = 'P0002';
    end if;
    if v_bill.vendor_id <> v_vendor_id then
      raise exception 'All bills on a payment must belong to the same vendor.' using errcode = '22023';
    end if;
    if v_bill.status not in ('open', 'partial') then
      raise exception 'Only open bills can be paid.' using errcode = '22023';
    end if;
    v_balance := v_bill.amount_cents - v_bill.paid_amount_cents;
    if v_app_cents > v_balance then
      raise exception 'The payment exceeds the bill balance.' using errcode = '22023';
    end if;
    v_total_applied := v_total_applied + v_app_cents;
  end loop;
  if v_total_applied <> v_amount_cents then
    raise exception 'The bill applications must add up to the payment amount.' using errcode = '22023';
  end if;

  -- 1. The payment header. The PK is the idempotency key: a retried submit
  -- with the same id hits the constraint and the route returns the payment
  -- instead of double-posting.
  insert into rental_vendor_payments (
    owner_id, id, vendor_id, payment_date, payment_method, amount_cents,
    bank_account_id, check_number, memo, created_by
  ) values (
    effective_owner_id, v_payment_id, v_vendor_id, v_payment_date, v_method,
    v_amount_cents, v_bank_account_id, v_check_number, v_memo, v_actor_id
  );

  -- 2. One expense event per application, each with the bill's exact expense
  -- account and property. The bills stay locked for the whole transaction,
  -- so the re-select below sees exactly what was validated above.
  for v_app in select * from jsonb_array_elements(v_apps) loop
    v_bill_id := nullif(btrim(v_app ->> 'billId'), '');
    v_app_cents := (v_app ->> 'amountCents')::bigint;
    select * into v_bill from rental_vendor_bills
     where owner_id = effective_owner_id and id = v_bill_id;

    -- Coordinate with concurrent deactivation: lock the account row in SHARE
    -- mode and re-check is_active while holding it (mirrors
    -- create_ledger_transaction).
    if to_regclass('public.chart_of_accounts') is not null then
      select is_active into v_cat_active from chart_of_accounts
       where owner_id = effective_owner_id and code = v_bill.expense_account_code
       for share;
      if not found then
        raise exception 'Unknown account code.' using errcode = '22000';
      end if;
      if not v_cat_active then
        raise exception 'This account has been deactivated. Choose an active account.' using errcode = '22000';
      end if;
    end if;

    insert into financial_events (
      owner_id, property_id, event_date, description, amount, transaction_kind,
      normalized_category, payee, check_number, bank_account_id, cleared, cleared_at,
      tax_deductible, affects_noi, capitalized, source_system, metadata,
      status, is_deleted, created_by, updated_by
    ) values (
      effective_owner_id,
      v_bill.property_id,
      v_payment_date,
      'Vendor payment — ' || v_vendor_name || ' (bill ' || v_bill.bill_date || ')',
      (v_app_cents / 100.0),
      'expense',
      v_bill.expense_account_code,
      v_vendor_name,
      case when v_method = 'check' then v_check_number else null end,
      v_bank_account_id,
      false, null,
      true, true, false, 'manual',
      jsonb_strip_nulls(jsonb_build_object(
        'vendor_payment_id', v_payment_id,
        'vendor_bill_id', v_bill.id,
        'payment_method', v_method,
        'memo', v_memo
      )),
      'active', false, v_actor_id, v_actor_id
    ) returning id into v_event_id;
    v_event_ids := v_event_ids || v_event_id;

    insert into rental_vendor_payment_applications (owner_id, payment_id, bill_id, amount_cents)
    values (effective_owner_id, v_payment_id, v_bill.id, v_app_cents);

    v_new_paid := v_bill.paid_amount_cents + v_app_cents;
    v_new_status := case when v_new_paid >= v_bill.amount_cents then 'paid' else 'partial' end;
    update rental_vendor_bills
       set paid_amount_cents = v_new_paid, status = v_new_status
     where owner_id = effective_owner_id and id = v_bill.id;
  end loop;

  update rental_vendor_payments
     set financial_event_ids = to_jsonb(v_event_ids)
   where owner_id = effective_owner_id and id = v_payment_id;

  return jsonb_build_object('paymentId', v_payment_id, 'eventIds', to_jsonb(v_event_ids));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. void_vendor_payment — atomic payment reversal
-- ---------------------------------------------------------------------------
-- Reversal, never delete: the payment is marked voided with a reason, its
-- ledger events are soft-deleted (is_deleted/status='deleted', mirroring the
-- transactions DELETE route — never hard-removed), and each bill's balance
-- rolls back under row locks. Fail-closed: a payment already on an ACTIVE
-- bank reconciliation cannot be voided — the statement period is closed.
create or replace function void_vendor_payment(p_owner_id text, p_payment_id text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  v_actor_id text := auth.uid()::text;
  v_payment_id text := nullif(btrim(p_payment_id), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_payment rental_vendor_payments%rowtype;
  v_app rental_vendor_payment_applications%rowtype;
  v_bill rental_vendor_bills%rowtype;
  v_event_ids text[];
  v_reconciled_count integer;
  v_rolled_back bigint;
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;
  if v_payment_id is null then
    raise exception 'A payment id is required.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'A reason is required to void a payment.' using errcode = '22023';
  end if;

  select * into v_payment from rental_vendor_payments
   where owner_id = effective_owner_id and id = v_payment_id
   for update;
  if not found then
    raise exception 'The payment was not found.' using errcode = 'P0002';
  end if;
  if v_payment.status <> 'active' then
    raise exception 'Only active payments can be voided.' using errcode = '22023';
  end if;

  select coalesce(array_agg(x), '{}') into v_event_ids
    from jsonb_array_elements_text(v_payment.financial_event_ids) as x;

  -- Reconciliation guard: any event already cleared on an active statement
  -- locks the whole payment. The route surfaces this as a 409.
  if coalesce(array_length(v_event_ids, 1), 0) > 0 then
    select count(*) into v_reconciled_count from bank_reconciliations
     where owner_id = effective_owner_id
       and status = 'active'
       and cleared_event_ids ?| v_event_ids;
    if v_reconciled_count > 0 then
      raise exception 'This payment is already reconciled and cannot be voided.' using errcode = 'P0001';
    end if;
  end if;

  -- Reverse the ledger entries: soft-delete, never hard-remove.
  if coalesce(array_length(v_event_ids, 1), 0) > 0 then
    update financial_events
       set is_deleted = true, deleted_at = now(), status = 'deleted', updated_by = v_actor_id
     where owner_id = effective_owner_id
       and id = any(v_event_ids)
       and is_deleted = false;
  end if;

  -- Roll each bill back under a row lock. A bill voided after payment cannot
  -- absorb a rollback — fail closed instead of silently rewriting history.
  for v_app in select * from rental_vendor_payment_applications
                where owner_id = effective_owner_id and payment_id = v_payment.id
                order by bill_id
  loop
    select * into v_bill from rental_vendor_bills
     where owner_id = effective_owner_id and id = v_app.bill_id
     for update;
    if not found then
      raise exception 'A bill for this payment is missing.' using errcode = 'P0002';
    end if;
    if v_bill.status = 'voided' then
      raise exception 'A bill for this payment was voided. Restore it before voiding the payment.' using errcode = '22023';
    end if;
    v_rolled_back := v_bill.paid_amount_cents - v_app.amount_cents;
    if v_rolled_back < 0 then
      raise exception 'The bill balance cannot roll back below zero.' using errcode = '22023';
    end if;
    update rental_vendor_bills
       set paid_amount_cents = v_rolled_back,
           status = case when v_rolled_back = 0 then 'open' else 'partial' end
     where owner_id = effective_owner_id and id = v_bill.id;
  end loop;

  update rental_vendor_payments
     set status = 'voided', void_reason = v_reason, voided_at = now()
   where owner_id = effective_owner_id and id = v_payment.id;

  return jsonb_build_object(
    'paymentId', v_payment.id,
    'reversedEvents', coalesce(array_length(v_event_ids, 1), 0)
  );
end;
$$;

revoke all on function record_vendor_payment(text, jsonb) from public, anon;
grant execute on function record_vendor_payment(text, jsonb) to authenticated;

revoke all on function void_vendor_payment(text, text, text) from public, anon;
grant execute on function void_vendor_payment(text, text, text) to authenticated;
