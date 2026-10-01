-- ============================================================================
-- R18 (rentec-parity): payment correction + un-void / re-issue flows
-- ============================================================================
-- Demand (c) remainder: the last "can't edit this?!" moments.
--
-- 1. rental_payment_corrections — append-only audit for tenant payment
--    corrections. The payment row is updated to the corrected values (that is
--    what every read model — tenant ledger, statements, receipts — reads),
--    while the ORIGINAL values are preserved here, per field, with
--    before/after, a required reason, and the actor. History is never
--    rewritten in place without this trail.
-- 2. correct_rental_payment RPC — atomic correction: row-locks the payment
--    and its charge, validates, updates the payment + the charge balance +
--    the mirrored financial_events row, and writes the audit row. Fail-closed
--    on reconciliation (money-touching corrections blocked; notes-only
--    corrections allowed with a warning flag).
-- 3. rental_void_audits — append-only audit for un-void actions (vendor
--    bills) and re-issues (vendor payments). Void actions predate this table;
--    only R18-and-later actions are recorded here.
-- 4. rental_vendor_payments.reissued_from_payment_id — links a re-issued
--    check/ACH to the voided payment it replaces. One live re-issue per
--    voided payment (a re-issue that was itself voided may be re-issued
--    again).
-- 5. record_vendor_payment learns an optional "reissuedFrom" key in its
--    p_payment jsonb so a re-issue is created atomically through the same
--    validated path as any other payment.
--
-- Un-void decisions (documented, per-entity):
--   vendor bills    YES — a voided bill was untouched (void requires open +
--                   unpaid), so restoring it to open is safe. Blocked when a
--                   probable replacement bill exists (same vendor + property +
--                   bill date + amount, created after the voided bill).
--   vendor payments NO  — voiding soft-deletes shared ledger events and rolls
--                   bill balances back; the bills may have moved on (re-paid,
--                   voided, edited). Re-issue is the safe recovery path.
--   tenant charges  NO  — voided charges are immutable by design
--                   ("Voided charges cannot be edited"); record a new charge.
--   owner movements / bank deposits (R9 / R7) — those slices are not merged
--                   yet, so no tables exist to implement against here. Intended
--                   policy: un-void allowed for owner movements (simple ledger
--                   postings, no counterparty state) with a replacement guard;
--                   deposits re-created, never un-voided (a deposit aggregates
--                   many payments — un-voiding would double-count).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. rental_payment_corrections — append-only correction audit
-- ---------------------------------------------------------------------------
create table if not exists rental_payment_corrections (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null,
  payment_id text not null,
  corrected_at timestamptz not null default now(),
  corrected_by text,
  reason text not null check (btrim(reason) <> ''),
  -- changes: { field: { from, to } } for every corrected field. Field names
  -- are the rental_payments columns: amount_cents, received_at,
  -- payment_method, receipt_reference, notes.
  changes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(changes) = 'object'),
  balance_delta_cents bigint not null default 0,
  -- True when the payment sat on an active bank reconciliation: only
  -- non-money fields (notes, receipt reference) were corrected.
  reconciled_warning boolean not null default false,
  constraint rental_payment_corrections_payment_fk
    foreign key (owner_id, payment_id)
    references rental_payments(owner_id, id) on delete cascade
);

create index if not exists idx_rental_payment_corrections_owner_payment
  on rental_payment_corrections(owner_id, payment_id, corrected_at desc);

alter table rental_payment_corrections enable row level security;
alter table rental_payment_corrections force row level security;

drop policy if exists "rental_payment_corrections_owner_select" on rental_payment_corrections;
create policy "rental_payment_corrections_owner_select" on rental_payment_corrections for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_payment_corrections_owner_insert" on rental_payment_corrections;
create policy "rental_payment_corrections_owner_insert" on rental_payment_corrections for insert to authenticated
  with check (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- 2. rental_void_audits — append-only un-void / re-issue audit
-- ---------------------------------------------------------------------------
create table if not exists rental_void_audits (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null,
  entity_type text not null check (entity_type in ('vendor_bill', 'vendor_payment')),
  entity_id text not null,
  action text not null check (action in ('unvoid', 'reissue')),
  reason text not null check (btrim(reason) <> ''),
  actor_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_rental_void_audits_owner_entity
  on rental_void_audits(owner_id, entity_type, entity_id, created_at desc);

alter table rental_void_audits enable row level security;
alter table rental_void_audits force row level security;

drop policy if exists "rental_void_audits_owner_select" on rental_void_audits;
create policy "rental_void_audits_owner_select" on rental_void_audits for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_void_audits_owner_insert" on rental_void_audits;
create policy "rental_void_audits_owner_insert" on rental_void_audits for insert to authenticated
  with check (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- 3. Re-issue linkage on vendor payments
-- ---------------------------------------------------------------------------
alter table rental_vendor_payments
  add column if not exists reissued_from_payment_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'rental_vendor_payments_reissued_from_fk'
  ) then
    alter table rental_vendor_payments
      add constraint rental_vendor_payments_reissued_from_fk
      foreign key (owner_id, reissued_from_payment_id)
      references rental_vendor_payments(owner_id, id) on delete restrict;
  end if;
end $$;

create index if not exists idx_rental_vendor_payments_reissued_from
  on rental_vendor_payments(owner_id, reissued_from_payment_id)
  where reissued_from_payment_id is not null;

-- ---------------------------------------------------------------------------
-- 4. correct_rental_payment — atomic tenant payment correction
-- ---------------------------------------------------------------------------
-- p_changes: { amountCents?, receivedAt?, paymentMethod?, receiptReference?,
--              notes? } — every supplied field is corrected; omitted fields
--              are untouched. The payment row keeps the corrected values (the
--              read models — tenant ledger, statements, receipts — all read
--              rental_payments), and the originals land in
--              rental_payment_corrections with before/after.
--
-- Rules (all fail-closed):
--   - Only completed ('succeeded') payments can be corrected.
--   - Amount/date/method corrections are allowed ONLY on offline
--     (manually recorded: cash / cashiers_check) payments. A Stripe/ACH
--     payment moved real money through a provider — correcting its amount
--     here would lie about what the provider settled; notes and receipt
--     reference are the only correctable fields on provider payments.
--   - Corrected amount must be positive (never zero/negative).
--   - A payment with any refunded amount cannot have its amount corrected
--     (the refund math is anchored to the original amount).
--   - When the payment's ledger event sits on an ACTIVE bank reconciliation,
--     money-touching corrections are blocked ("undo the reconciliation
--     first", mirroring R4's void guard). Notes/receipt-reference
--     corrections still go through, flagged reconciled_warning = true.
create or replace function correct_rental_payment(
  p_owner_id text, p_payment_id text, p_changes jsonb, p_reason text
)
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
  v_payment rental_payments%rowtype;
  v_charge rent_charges%rowtype;
  v_changes jsonb := coalesce(p_changes, '{}'::jsonb);
  v_amount_cents bigint;
  v_received_at timestamptz;
  v_payment_method text;
  v_receipt_reference text;
  v_has_notes boolean;
  v_notes text;
  v_touches_money boolean := false;
  v_balance_delta bigint := 0;
  v_new_paid bigint;
  v_new_status text;
  v_event_id text;
  v_reconciled_count integer := 0;
  v_audit_changes jsonb := '{}'::jsonb;
  v_field_count integer := 0;
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
    raise exception 'A reason is required to correct a payment.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_changes) <> 'object' then
    raise exception 'Correction fields must be an object.' using errcode = '22023';
  end if;

  select * into v_payment from rental_payments
   where owner_id = effective_owner_id and id = v_payment_id
   for update;
  if not found then
    raise exception 'The payment was not found.' using errcode = 'P0002';
  end if;
  if v_payment.status <> 'succeeded' then
    raise exception 'Only completed payments can be corrected.' using errcode = '22023';
  end if;

  -- ---- Parse + validate each supplied field --------------------------------
  if v_changes ? 'amountCents' then
    v_amount_cents := (v_changes ->> 'amountCents')::bigint;
    if v_amount_cents is null or v_amount_cents <= 0 then
      raise exception 'The corrected amount must be positive.' using errcode = '22000';
    end if;
    if v_payment.provider <> 'offline' then
      raise exception 'Only manually recorded payments can have their amount corrected. A provider-settled payment moved real money — correct its notes instead.' using errcode = '22023';
    end if;
    if coalesce(v_payment.refunded_amount_cents, 0) > 0 then
      raise exception 'A payment with a refund cannot have its amount corrected.' using errcode = '22023';
    end if;
    if v_amount_cents <> v_payment.amount_cents then
      v_touches_money := true;
    end if;
  end if;

  if v_changes ? 'receivedAt' then
    v_received_at := nullif(btrim(v_changes ->> 'receivedAt'), '')::timestamptz;
    if v_received_at is null then
      raise exception 'Enter a valid received date.' using errcode = '22023';
    end if;
    if v_received_at > now() + interval '5 minutes' then
      raise exception 'The received date cannot be in the future.' using errcode = '22023';
    end if;
    if v_payment.provider <> 'offline' then
      raise exception 'Only manually recorded payments can have their date corrected. A provider-settled payment moved real money — correct its notes instead.' using errcode = '22023';
    end if;
    if v_received_at <> v_payment.received_at then
      v_touches_money := true;
    end if;
  end if;

  if v_changes ? 'paymentMethod' then
    v_payment_method := nullif(btrim(v_changes ->> 'paymentMethod'), '');
    if v_payment_method is null or v_payment_method not in ('cash', 'cashiers_check') then
      raise exception 'The corrected payment method must be cash or cashier''s check.' using errcode = '22023';
    end if;
    if v_payment.provider <> 'offline' then
      raise exception 'Only manually recorded payments can have their method corrected.' using errcode = '22023';
    end if;
    if v_payment_method <> coalesce(v_payment.payment_method, '') then
      v_touches_money := true;
    end if;
  end if;

  if v_changes ? 'receiptReference' then
    v_receipt_reference := nullif(btrim(v_changes ->> 'receiptReference'), '');
  end if;

  v_has_notes := v_changes ? 'notes';
  if v_has_notes then
    v_notes := nullif(btrim(v_changes ->> 'notes'), '');
  end if;

  -- ---- Reconciliation guard --------------------------------------------------
  -- The payment's mirrored ledger event (source_system='forge_rental_payment')
  -- on an ACTIVE reconciliation locks money-touching corrections. Notes and
  -- receipt reference don't move money, so they stay correctable — flagged.
  select id into v_event_id from financial_events
   where owner_id = effective_owner_id
     and source_system = 'forge_rental_payment'
     and source_record_id = v_payment.id
     and is_deleted = false
   limit 1;
  if v_event_id is not null then
    select count(*) into v_reconciled_count from bank_reconciliations
     where owner_id = effective_owner_id
       and status = 'active'
       and cleared_event_ids ? v_event_id;
  end if;
  if v_reconciled_count > 0 and v_touches_money then
    raise exception 'This payment is already reconciled and its amount, date, or method cannot be corrected. Undo the bank reconciliation first.' using errcode = 'P0001';
  end if;

  -- ---- Apply the correction --------------------------------------------------
  -- Charge balance rolls with the amount delta (row-locked). The delta must
  -- keep the charge's paid total inside [0, amount]; the status follows the
  -- new paid total. Mirrors the pure applyCorrectionDelta() domain helper.
  if v_changes ? 'amountCents' and v_amount_cents <> v_payment.amount_cents then
    select * into v_charge from rent_charges
     where owner_id = effective_owner_id and id = v_payment.charge_id
     for update;
    if not found then
      raise exception 'The charge for this payment is missing.' using errcode = 'P0002';
    end if;
    if v_charge.status = 'void' then
      raise exception 'The charge for this payment was voided. Restore it before correcting the payment.' using errcode = '22023';
    end if;
    v_balance_delta := v_amount_cents - v_payment.amount_cents;
    v_new_paid := v_charge.paid_amount_cents + v_balance_delta;
    if v_new_paid < 0 or v_new_paid > v_charge.amount_cents then
      raise exception 'The corrected amount would push the charge balance below zero or above the charge total.' using errcode = '22023';
    end if;
    v_new_status := case
      when v_new_paid >= v_charge.amount_cents then 'paid'
      when v_new_paid > 0 then 'partially_paid'
      else v_charge.status
    end;
    update rent_charges
       set paid_amount_cents = v_new_paid, status = v_new_status, updated_at = now()
     where owner_id = effective_owner_id and id = v_charge.id;
    v_audit_changes := v_audit_changes || jsonb_build_object(
      'amount_cents', jsonb_build_object('from', v_payment.amount_cents, 'to', v_amount_cents));
    v_field_count := v_field_count + 1;
  end if;

  if v_changes ? 'receivedAt' and v_received_at <> v_payment.received_at then
    v_audit_changes := v_audit_changes || jsonb_build_object(
      'received_at', jsonb_build_object('from', v_payment.received_at, 'to', v_received_at));
    v_field_count := v_field_count + 1;
  end if;

  if v_changes ? 'paymentMethod' and v_payment_method <> coalesce(v_payment.payment_method, '') then
    v_audit_changes := v_audit_changes || jsonb_build_object(
      'payment_method', jsonb_build_object('from', v_payment.payment_method, 'to', v_payment_method));
    v_field_count := v_field_count + 1;
  end if;

  if v_changes ? 'receiptReference' and coalesce(v_receipt_reference, '') <> coalesce(v_payment.receipt_reference, '') then
    v_audit_changes := v_audit_changes || jsonb_build_object(
      'receipt_reference', jsonb_build_object('from', v_payment.receipt_reference, 'to', v_receipt_reference));
    v_field_count := v_field_count + 1;
  end if;

  if v_has_notes and coalesce(v_notes, '') <> coalesce(v_payment.notes, '') then
    v_audit_changes := v_audit_changes || jsonb_build_object(
      'notes', jsonb_build_object('from', v_payment.notes, 'to', v_notes));
    v_field_count := v_field_count + 1;
  end if;

  if v_field_count = 0 then
    raise exception 'Nothing to correct — every field already matches.' using errcode = '22023';
  end if;

  update rental_payments
     set amount_cents = coalesce(v_amount_cents, amount_cents),
         received_at = coalesce(v_received_at, received_at),
         payment_method = coalesce(v_payment_method, payment_method),
         receipt_reference = case when v_changes ? 'receiptReference' then v_receipt_reference else receipt_reference end,
         notes = case when v_has_notes then v_notes else notes end,
         updated_at = now()
   where owner_id = effective_owner_id and id = v_payment.id;

  -- Keep the mirrored ledger entry honest: it must show the corrected amount
  -- and date, so statements and the bank ledger never show the old error.
  -- (The post-insert trigger only fires on insert/status change, so the RPC
  -- syncs the row explicitly.)
  if v_event_id is not null and v_touches_money then
    update financial_events
       set amount = coalesce(v_amount_cents, v_payment.amount_cents) / 100.0,
           event_date = coalesce(v_received_at, v_payment.received_at, v_payment.succeeded_at, v_payment.created_at)::date,
           updated_by = v_actor_id,
           metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('corrected_at', now())
     where owner_id = effective_owner_id and id = v_event_id;
  end if;

  insert into rental_payment_corrections
    (owner_id, payment_id, corrected_by, reason, changes, balance_delta_cents, reconciled_warning)
  values
    (effective_owner_id, v_payment.id, v_actor_id, v_reason, v_audit_changes,
     v_balance_delta, v_reconciled_count > 0);

  return jsonb_build_object(
    'paymentId', v_payment.id,
    'changes', v_audit_changes,
    'balanceDeltaCents', v_balance_delta,
    'reconciledWarning', v_reconciled_count > 0
  );
end;
$$;

revoke all on function correct_rental_payment(text, text, jsonb, text) from public, anon;
grant execute on function correct_rental_payment(text, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. record_vendor_payment — optional "reissuedFrom" for re-issues
-- ---------------------------------------------------------------------------
-- A re-issue is recorded through the same validated path as any payment; the
-- jsonb may carry reissuedFrom (the voided payment's id). Server-side checks:
-- the original exists, is voided, belongs to this workspace, and has no
-- other LIVE re-issue (a re-issue that was itself voided may be replaced).
-- This is a faithful copy of the R4 function with ONLY the re-issue
-- additions marked [R18] below — nothing else changes.
do $$
declare
  v_body text;
begin
  select pg_get_functiondef(oid) into v_body
    from pg_proc
   where proname = 'record_vendor_payment'
     and pg_function_is_visible(oid);
  if v_body is null then
    raise exception 'record_vendor_payment is missing — apply the R4 migration first.' using errcode = 'P0002';
  end if;
end $$;

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
  v_reissued_from text := nullif(btrim(p_payment ->> 'reissuedFrom'), ''); -- [R18]
  v_original rental_vendor_payments%rowtype; -- [R18]
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;

  -- [R18] Re-issue linkage: the original must be a voided payment of this
  -- workspace with no other live re-issue. (Supersession guard — the route
  -- surfaces this as a 409 naming the replacement's check number.)
  if v_reissued_from is not null then
    select * into v_original from rental_vendor_payments
     where owner_id = effective_owner_id and id = v_reissued_from;
    if not found then
      raise exception 'The voided payment to re-issue was not found.' using errcode = 'P0002';
    end if;
    if v_original.status <> 'voided' then
      raise exception 'Only a voided payment can be re-issued.' using errcode = '22023';
    end if;
    if exists (
      select 1 from rental_vendor_payments
       where owner_id = effective_owner_id
         and reissued_from_payment_id = v_reissued_from
         and status = 'active'
    ) then
      raise exception 'This voided payment already has a live re-issue.' using errcode = 'P0001';
    end if;
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
    bank_account_id, check_number, memo, created_by, reissued_from_payment_id -- [R18] last column
  ) values (
    effective_owner_id, v_payment_id, v_vendor_id, v_payment_date, v_method,
    v_amount_cents, v_bank_account_id, v_check_number, v_memo, v_actor_id, v_reissued_from -- [R18]
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

  return jsonb_build_object('paymentId', v_payment_id, 'eventIds', to_jsonb(v_event_ids), 'reissuedFrom', v_reissued_from); -- [R18] reissuedFrom
end;
$$;

revoke all on function record_vendor_payment(text, jsonb) from public, anon;
grant execute on function record_vendor_payment(text, jsonb) to authenticated;
