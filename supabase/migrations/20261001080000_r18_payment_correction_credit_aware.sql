-- ============================================================================
-- R18 fix-forward (ChatGPT NO-GO review): credit-aware payment correction
-- ============================================================================
-- The reviewed correct_rental_payment applied (newAmount - oldAmount)
-- directly to the charge's paid_amount_cents and never touched the
-- offline-overpayment credit model (rental_tenant_credits /
-- rental_credit_applications). An offline payment records its FULL received
-- amount while the charge only holds the APPLIED portion — the excess lives
-- in a credit sourced from the payment. Correcting the payment amount later
-- therefore corrupted both sides: a false unpaid charge plus an orphan/excess
-- credit for money the corrected payment no longer contains.
--
-- Fix (all inside the correction's single transaction):
--   1. reconcile_credit_for_payment_correction (new SECURITY DEFINER helper
--      below — the credit tables grant no direct writes to caller roles, so
--      every credit mutation goes through a definer RPC per the 20260925
--      contract): re-splits the corrected amount between charge and credit.
--      It locks the credit row sourced from this payment, derives the
--      payment's applied portion (old amount minus the recorded excess),
--      recomputes what the charge can absorb now, and voids/adjusts/creates
--      the credit to hold the new excess.
--   2. Credit applications are immutable history: when part of the credit was
--      already applied to later charges, the new excess must still cover the
--      applied total — otherwise the correction is blocked with a clear 409
--      (P0001, "credit applications" marker the route maps to 409) until
--      those applications are reversed.
--   3. correct_rental_payment is CREATE OR REPLACE'd (never rewriting the
--      reviewed R18 migration): the amount block now calls the helper and
--      moves the charge by (appliedNew - appliedOld) instead of the naive
--      delta. The audit trail and the mirrored financial_events behavior are
--      unchanged; the return payload gains the credit reconciliation.
--
-- Lock order is payment -> charge -> credit, matching
-- apply_rental_tenant_credit's charge -> credit order — no new deadlock edge.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. reconcile_credit_for_payment_correction — SECURITY DEFINER credit writer
-- ---------------------------------------------------------------------------
create or replace function reconcile_credit_for_payment_correction(
  p_owner_id text, p_payment_id text,
  p_old_amount_cents bigint, p_new_amount_cents bigint,
  p_charge_paid_cents bigint, p_charge_amount_cents bigint,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit rental_tenant_credits%rowtype;
  v_credit_found boolean := false;
  v_payment rental_payments%rowtype;
  v_old_excess bigint;
  v_applied_old bigint;
  v_others bigint;
  v_capacity bigint;
  v_applied_new bigint;
  v_new_excess bigint;
  v_applied_credit bigint := 0;
  v_credit_id text;
  v_action text;
begin
  if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
    raise exception 'Authenticated owner id is required.' using errcode = '42501';
  end if;

  -- The caller (correct_rental_payment) holds the payment and charge row
  -- locks; the credit row is locked next: payment -> charge -> credit.
  select * into v_credit from rental_tenant_credits
   where owner_id = p_owner_id and source_payment_id = p_payment_id
   for update;
  v_credit_found := found;

  -- The charge only ever held this payment's applied portion: the old amount
  -- minus the excess that became credit at recording time.
  v_old_excess := coalesce(v_credit.amount_cents, 0);
  v_applied_old := p_old_amount_cents - v_old_excess;
  if v_applied_old < 0 then
    raise exception 'The payment''s recorded credit exceeds the recorded payment amount.'
      using errcode = 'P0001';
  end if;

  -- Everyone else's share of the charge must be intact for the recomputation
  -- to be meaningful; otherwise the books are already inconsistent.
  v_others := p_charge_paid_cents - v_applied_old;
  if v_others < 0 or v_others > p_charge_amount_cents then
    raise exception 'The charge balance is inconsistent with this payment.'
      using errcode = 'P0001';
  end if;

  v_capacity := p_charge_amount_cents - v_others;
  v_applied_new := least(p_new_amount_cents, v_capacity);
  v_new_excess := p_new_amount_cents - v_applied_new;

  if v_credit_found then
    -- Immutable history: money already moved onto other charges cannot be
    -- un-moved, so the corrected excess must still cover it.
    select coalesce(sum(amount_cents), 0) into v_applied_credit
      from rental_credit_applications
     where owner_id = p_owner_id and credit_id = v_credit.id;
    if v_applied_credit > v_new_excess then
      raise exception 'Part of this payment''s overpayment credit ($%) has already been applied to other charges, and the corrected amount leaves only $% of excess to cover it. Correct to an amount that keeps at least $% of excess, or reverse the credit applications first.',
        (v_applied_credit / 100.0), (v_new_excess / 100.0), (v_applied_credit / 100.0)
        using errcode = 'P0001';
    end if;

    if v_new_excess = 0 then
      -- The excess is gone entirely, and nothing was ever applied (the block
      -- above fired otherwise): void the untouched remainder with a full
      -- audit trail.
      update rental_tenant_credits
         set remaining_cents = 0, status = 'void',
             voided_at = now(), voided_by = auth.uid()::text,
             void_reason = 'Payment ' || p_payment_id || ' corrected from $' ||
               (p_old_amount_cents / 100.0) || ' to $' || (p_new_amount_cents / 100.0) ||
               ' (' || nullif(btrim(p_reason), '') || ') — overpayment excess eliminated.',
             updated_at = now()
       where owner_id = p_owner_id and id = v_credit.id;
      v_action := 'void';
    else
      update rental_tenant_credits
         set amount_cents = v_new_excess,
             remaining_cents = v_new_excess - v_applied_credit,
             status = case when v_new_excess - v_applied_credit = 0 then 'fully_applied' else 'open' end,
             updated_at = now()
       where owner_id = p_owner_id and id = v_credit.id;
      v_action := 'adjust';
    end if;
    v_credit_id := v_credit.id;
  else
    if v_new_excess > 0 then
      -- The correction pushes the payment over the charge's remaining
      -- capacity: the new excess becomes an open credit, exactly as
      -- record_offline_rental_payment does at recording time.
      select * into v_payment from rental_payments
       where owner_id = p_owner_id and id = p_payment_id;
      v_credit_id := 'rental_credit_' || gen_random_uuid()::text;
      insert into rental_tenant_credits (owner_id, id, tenant_id, lease_id, amount_cents,
        remaining_cents, source, source_payment_id, status, notes, created_at, updated_at)
      values (p_owner_id, v_credit_id, v_payment.tenant_id, v_payment.lease_id,
        v_new_excess, v_new_excess, 'overpayment', p_payment_id, 'open',
        'Overpayment excess from corrected payment ' || p_payment_id, now(), now());
      v_action := 'create';
    else
      v_action := 'none';
    end if;
  end if;

  return jsonb_build_object(
    'appliedOldCents', v_applied_old,
    'appliedNewCents', v_applied_new,
    'oldExcessCents', v_old_excess,
    'newExcessCents', v_new_excess,
    'appliedCreditCents', v_applied_credit,
    'creditId', v_credit_id,
    'creditAction', v_action
  );
end;
$$;

revoke all on function reconcile_credit_for_payment_correction(text, text, bigint, bigint, bigint, bigint, text) from public, anon;
grant execute on function reconcile_credit_for_payment_correction(text, text, bigint, bigint, bigint, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. correct_rental_payment — credit-aware CREATE OR REPLACE
-- ---------------------------------------------------------------------------
-- The reviewed 20261001070000 migration is NOT rewritten; only the amount
-- block changes (see the inline comment): the charge moves by
-- (appliedNew - appliedOld) after the helper reconciles the credit.
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
  v_credit_result jsonb;
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
  -- Charge balance rolls with the CREDIT-AWARE amount delta (row-locked).
  -- The payment row holds the FULL received amount, but the charge only ever
  -- held this payment's APPLIED portion — any overpayment excess lives in
  -- rental_tenant_credits sourced from this payment. The helper below
  -- re-splits the corrected amount between charge and credit inside this
  -- same transaction (void/adjust/create the credit, or raise a 409 when
  -- already-applied credit cannot be covered). The delta must keep the
  -- charge's paid total inside [0, amount]; the status follows the new paid
  -- total. Mirrors the pure computeCreditAwareCorrection() domain helper.
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
    -- Credit-aware allocation: reconcile this payment's overpayment
    -- credit (if any) BEFORE moving the charge balance. The helper runs in
    -- this same transaction; the charge row is already locked here and the
    -- helper locks the credit row next (payment -> charge -> credit matches
    -- apply_rental_tenant_credit's charge -> credit order: no new deadlock).
    v_credit_result := reconcile_credit_for_payment_correction(
      effective_owner_id, v_payment.id, v_payment.amount_cents, v_amount_cents,
      v_charge.paid_amount_cents, v_charge.amount_cents, v_reason);
    v_balance_delta := (v_credit_result ->> 'appliedNewCents')::bigint
                     - (v_credit_result ->> 'appliedOldCents')::bigint;
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
    'reconciledWarning', v_reconciled_count > 0,
    'credit', v_credit_result
  );
end;
$$;

revoke all on function correct_rental_payment(text, text, jsonb, text) from public, anon;
grant execute on function correct_rental_payment(text, text, jsonb, text) to authenticated;
