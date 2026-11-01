-- Controls-sweep follow-up G9 (M-11): personal-check payments.
--
-- A personal check is an offline payment like cash and a cashier's check,
-- but the old code refused it at three layers: the JS allowlists, the
-- rental_payments.payment_method CHECK, and the record/correct RPC
-- allowlists. This migration opens the two database layers; the JS
-- allowlists and selects ride in the same branch.
--
-- The record_offline_rental_payment body below is a verbatim copy of the
-- latest in-main definition (20260926120000, verified byte-identical to
-- production's live definition) with ONLY the method allowlist lines changed.
-- The correct_rental_payment body below is #710's merged version (see the
-- REBASED note) with ONLY the method allowlist lines changed.
--
-- REBASED ONTO #710 (merged as a5e42cf, applied to production): the
-- correct_rental_payment body below IS #710's version (deposit_state,
-- deposit_amount_cents, charge move) with ONLY the method allowlist lines
-- changed to admit 'check'. Applying this file after #710 no longer reverts
-- #710's changes. The CHECK change and the record_offline_rental_payment
-- redefinition are unaffected by #710.
--
-- NOT APPLIED TO PRODUCTION by this branch — it joins the migration
-- approval ask. Code-first breakage if merged without it: recording a
-- personal check fails at the RPC ("Unsupported offline payment method.")
-- or the column CHECK. Migration-without-code is safe (pure allowlist
-- widening; no rows change, no existing method is removed).

alter table rental_payments drop constraint if exists rental_payments_payment_method_check;
alter table rental_payments add constraint rental_payments_payment_method_check
  check (payment_method is null or payment_method in ('us_bank_account', 'card', 'cash', 'cashiers_check', 'check'));

create or replace function record_offline_rental_payment(
  p_owner_id text, p_charge_id text, p_payment_method text, p_amount_cents bigint,
  p_received_at timestamptz, p_receipt_reference text default null, p_notes text default null,
  p_allow_overpayment_credit boolean default false,
  p_tenant_id text default null,
  p_idempotency_key text default null,
  p_deposit_state text default 'received'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_charge rent_charges%rowtype;
  v_payment_id text;
  v_applied_cents bigint;
  v_excess_cents bigint;
  v_new_paid bigint;
  v_status text;
  v_tenant_id text;
  v_credit_id text;
  v_key text;
  v_replay jsonb;
  v_deposit_state text;
begin
  if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
    raise exception 'Authenticated owner id is required.';
  end if;
  if p_payment_method not in ('cash', 'cashiers_check', 'check') then
    raise exception 'Unsupported offline payment method.';
  end if;
  if p_amount_cents <= 0 then raise exception 'Offline payment amount must be positive.'; end if;
  if p_received_at is null or p_received_at > now() + interval '5 minutes' then
    raise exception 'A valid received date is required.'; end if;
  v_deposit_state := coalesce(nullif(btrim(p_deposit_state), ''), 'received');
  if v_deposit_state not in ('received', 'deposited') then
    raise exception 'Unsupported deposit state.';
  end if;

  v_key := nullif(btrim(p_idempotency_key), '');

  -- Charge lookup (no lock yet) so the tenant can be attributed before the replay check:
  -- a replay must compare the full submission intent, including who paid.
  select * into v_charge from rent_charges where owner_id = p_owner_id and id = p_charge_id;
  if not found then raise exception 'Rent charge is not payable.'; end if;

  -- Honest tenant attribution: a caller that knows who handed over the cash names them
  -- (validated as a member of this lease); callers that predate the parameter keep the
  -- historical first-lease-membership derivation.
  if p_tenant_id is not null and btrim(p_tenant_id) <> '' then
    select lt.tenant_id into v_tenant_id from rental_lease_tenants lt
      where lt.owner_id = p_owner_id and lt.lease_id = v_charge.lease_id
        and lt.tenant_id = btrim(p_tenant_id);
    if not found then raise exception 'Tenant does not belong to this lease.'; end if;
  else
    select lt.tenant_id into v_tenant_id from rental_lease_tenants lt
      where lt.owner_id = p_owner_id and lt.lease_id = v_charge.lease_id
      order by lt.tenant_id limit 1;
    if not found then raise exception 'Lease tenant was not found.'; end if;
  end if;

  -- Idempotent replay, fast path: the same submission intent was already recorded.
  if v_key is not null then
    v_replay := _replay_offline_rental_payment(p_owner_id, v_key, p_charge_id, v_tenant_id,
      p_amount_cents, p_payment_method, p_received_at, p_receipt_reference, p_notes);
    if v_replay is not null then return v_replay; end if;
  end if;

  select * into v_charge from rent_charges where owner_id = p_owner_id and id = p_charge_id for update;
  if not found or v_charge.status in ('paid', 'void') then raise exception 'Rent charge is not payable.'; end if;

  -- Post-lock recheck: a concurrent retry with the same key may have won the race while
  -- this transaction waited on the charge lock. Resolve to the winner instead of
  -- recording the receipt twice.
  if v_key is not null then
    v_replay := _replay_offline_rental_payment(p_owner_id, v_key, p_charge_id, v_tenant_id,
      p_amount_cents, p_payment_method, p_received_at, p_receipt_reference, p_notes);
    if v_replay is not null then return v_replay; end if;
  end if;

  v_applied_cents := least(p_amount_cents, v_charge.amount_cents - v_charge.paid_amount_cents);
  v_excess_cents := p_amount_cents - v_applied_cents;
  if v_excess_cents > 0 and not coalesce(p_allow_overpayment_credit, false) then
    raise exception 'Payment exceeds the remaining rent balance.'; end if;

  v_payment_id := 'rental_payment_' || gen_random_uuid()::text;
  v_new_paid := v_charge.paid_amount_cents + v_applied_cents;
  v_status := case when v_new_paid = v_charge.amount_cents then 'paid' else 'partially_paid' end;

  -- The payment row records the FULL amount actually received — the receipt, the cash
  -- drawer, and the ledger must agree on what came in. Only the applied portion moves
  -- the charge's paid balance; the excess becomes a credit below.
  begin
    insert into rental_payments (owner_id, id, charge_id, lease_id, tenant_id, provider, amount_cents,
      refunded_amount_cents, currency_code, status, idempotency_key, payment_method, received_at,
      recorded_by, receipt_reference, notes, created_at, updated_at, succeeded_at,
      deposit_state, deposited_at)
    values (p_owner_id, v_payment_id, v_charge.id, v_charge.lease_id, v_tenant_id, 'offline', p_amount_cents, 0,
      v_charge.currency_code, 'succeeded', coalesce(v_key, 'offline:' || v_payment_id), p_payment_method,
      p_received_at, auth.uid()::text, nullif(trim(p_receipt_reference), ''), nullif(trim(p_notes), ''),
      now(), now(), p_received_at,
      v_deposit_state, case when v_deposit_state = 'deposited' then now() else null end);
  exception when unique_violation then
    -- Final backstop: a concurrent retry with the same idempotency key won the race
    -- between the post-lock recheck and this insert. Resolve to the winner.
    if v_key is null then raise; end if;
    v_replay := _replay_offline_rental_payment(p_owner_id, v_key, p_charge_id, v_tenant_id,
      p_amount_cents, p_payment_method, p_received_at, p_receipt_reference, p_notes);
    if v_replay is null then raise; end if;
    return v_replay;
  end;

  update rent_charges set paid_amount_cents = v_new_paid, status = v_status, updated_at = now()
    where owner_id = p_owner_id and id = v_charge.id;

  v_credit_id := null;
  if v_excess_cents > 0 then
    v_credit_id := 'rental_credit_' || gen_random_uuid()::text;
    insert into rental_tenant_credits (owner_id, id, tenant_id, lease_id, amount_cents, remaining_cents,
      source, source_payment_id, status, notes, created_at, updated_at)
    values (p_owner_id, v_credit_id, v_tenant_id, v_charge.lease_id, v_excess_cents, v_excess_cents,
      'overpayment', v_payment_id, 'open',
      'Overpayment on charge ' || v_charge.id || ' (' || coalesce(v_charge.period, v_charge.due_date::text) || ')',
      now(), now());
  end if;

  return jsonb_build_object('id', v_payment_id, 'chargeId', v_charge.id, 'amountCents', p_amount_cents,
    'appliedCents', v_applied_cents, 'paymentMethod', p_payment_method, 'status', 'succeeded',
    'receivedAt', p_received_at, 'replayed', false,
    'depositState', v_deposit_state,
    'depositedAt', case when v_deposit_state = 'deposited' then now() else null end,
    'credit', case when v_credit_id is null then null
      else jsonb_build_object('id', v_credit_id, 'amountCents', v_excess_cents,
        'remainingCents', v_excess_cents, 'status', 'open', 'sourcePaymentId', v_payment_id) end);
end;
$$;

revoke all on function record_offline_rental_payment(text, text, text, bigint, timestamptz, text, text, boolean, text, text, text) from public, anon;
grant execute on function record_offline_rental_payment(text, text, text, bigint, timestamptz, text, text, boolean, text, text, text) to authenticated;

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
  v_new_charge rent_charges%rowtype;
  v_changes jsonb := coalesce(p_changes, '{}'::jsonb);
  v_amount_cents bigint;
  v_received_at timestamptz;
  v_payment_method text;
  v_receipt_reference text;
  v_has_notes boolean;
  v_notes text;
  v_deposit_state text;
  v_deposit_state_changed boolean := false;
  v_deposit_amount_cents bigint;
  v_charge_id text;
  v_charge_move boolean := false;
  v_old_applied bigint;
  v_new_applied bigint;
  v_new_excess bigint;
  v_credit_id text;
  v_credit_amount bigint;
  v_credit_applied bigint := 0;
  v_credit_action text := 'none';
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
    if v_payment_method is null or v_payment_method not in ('cash', 'cashiers_check', 'check') then
      raise exception 'The corrected payment method must be cash, cashier''s check, or personal check.' using errcode = '22023';
    end if;
    if v_payment.provider <> 'offline' then
      raise exception 'Only manually recorded payments can have their method corrected.' using errcode = '22023';
    end if;
    if v_payment_method <> coalesce(v_payment.payment_method, '') then
      v_touches_money := true;
    end if;
  end if;

  if v_changes ? 'depositState' then
    v_deposit_state := nullif(btrim(v_changes ->> 'depositState'), '');
    if v_deposit_state is null or v_deposit_state not in ('received', 'deposited') then
      raise exception 'The deposit state must be received or deposited.' using errcode = '22023';
    end if;
    if v_payment.provider <> 'offline' then
      raise exception 'Only manually recorded payments can have their deposit state corrected here. Use the deposit-state control instead.' using errcode = '22023';
    end if;
    if coalesce(v_payment.refunded_amount_cents, 0) > 0 then
      raise exception 'A payment with a refund cannot have its deposit state corrected.' using errcode = '22023';
    end if;
    if v_deposit_state <> coalesce(v_payment.deposit_state, '') then
      v_deposit_state_changed := true;
    end if;
  end if;

  if v_changes ? 'chargeId' then
    v_charge_id := nullif(btrim(v_changes ->> 'chargeId'), '');
    if v_charge_id is null then
      raise exception 'Choose a charge to apply this payment to.' using errcode = '22023';
    end if;
    if v_payment.provider <> 'offline' then
      raise exception 'Only manually recorded payments can be moved to a different charge.' using errcode = '22023';
    end if;
    if coalesce(v_payment.refunded_amount_cents, 0) > 0 then
      raise exception 'A payment with a refund cannot be moved to a different charge.' using errcode = '22023';
    end if;
    if v_charge_id <> v_payment.charge_id then
      v_charge_move := true;
      v_touches_money := true;
    end if;
  end if;

  if v_changes ? 'depositAmountCents' then
    v_deposit_amount_cents := (v_changes ->> 'depositAmountCents')::bigint;
    if v_deposit_amount_cents is null or v_deposit_amount_cents < 0 then
      raise exception 'The deposit amount cannot be negative.' using errcode = '22000';
    end if;
    if v_payment.provider <> 'offline' then
      raise exception 'Only manually recorded payments can have their deposit amount corrected. A provider-settled payment moved real money — correct its notes instead.' using errcode = '22023';
    end if;
    if coalesce(v_payment.refunded_amount_cents, 0) > 0 then
      raise exception 'A payment with a refund cannot have its deposit amount corrected.' using errcode = '22023';
    end if;
  end if;

  -- Cross-field guard: the deposit portion can never exceed the payment it
  -- belongs to — whether the amount shrank or the deposit grew. Refused
  -- with a plain-words message, never silently clamped.
  if coalesce(v_deposit_amount_cents, v_payment.deposit_amount_cents) > coalesce(v_amount_cents, v_payment.amount_cents) then
    raise exception 'The deposit amount cannot exceed the payment amount. Lower the deposit amount first, or correct to a larger payment amount.' using errcode = '22023';
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
  -- on an ACTIVE reconciliation locks money-touching corrections. Notes,
  -- receipt reference, and deposit state don't move money, so they stay
  -- correctable — flagged.
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
    raise exception 'This payment is already reconciled and its amount, date, method, or charge cannot be corrected. Undo the bank reconciliation first.' using errcode = 'P0001';
  end if;

  -- ---- Apply the correction --------------------------------------------------
  -- Charge move: unapply the payment's applied portion from the old charge
  -- and apply min(new amount, new charge remaining) to the new charge,
  -- re-deriving the overpayment credit under the same applied-credit guard
  -- as the amount path. A move handles an amount change with it, so the
  -- amount-only block below is skipped when a move is in flight.
  -- Mirrors the pure computeChargeMoveCorrection() domain helper.
  if v_charge_move then
    select * into v_charge from rent_charges
     where owner_id = effective_owner_id and id = v_payment.charge_id
     for update;
    if not found then
      raise exception 'The charge for this payment is missing.' using errcode = 'P0002';
    end if;
    if v_charge.status = 'void' then
      raise exception 'The charge for this payment was voided. Restore it before correcting the payment.' using errcode = '22023';
    end if;
    select * into v_new_charge from rent_charges
     where owner_id = effective_owner_id and id = v_charge_id
     for update;
    if not found then
      raise exception 'The new charge was not found.' using errcode = 'P0002';
    end if;
    if v_new_charge.lease_id <> v_payment.lease_id then
      raise exception 'A payment can only be moved to another charge on the same lease.' using errcode = '22023';
    end if;
    if v_new_charge.status = 'void' then
      raise exception 'The new charge was voided.' using errcode = '22023';
    end if;
    if v_new_charge.status = 'paid' then
      raise exception 'The new charge is already paid in full.' using errcode = '22023';
    end if;
    -- The old charge only ever held this payment's APPLIED portion: the
    -- full amount minus the excess that became credit at recording time.
    -- (Same single-credit-per-payment read as the helper: no status filter,
    -- matching reconcile_credit_for_payment_correction.)
    select id, amount_cents into v_credit_id, v_credit_amount from rental_tenant_credits
     where owner_id = effective_owner_id and source_payment_id = v_payment.id
     order by created_at desc limit 1
     for update;
    v_old_applied := v_payment.amount_cents - coalesce(v_credit_amount, 0);
    if v_old_applied < 0 then
      raise exception 'The payment''s recorded credit exceeds the recorded payment amount.' using errcode = 'P0001';
    end if;
    if v_charge.paid_amount_cents - v_old_applied < 0 then
      raise exception 'The charge balance is inconsistent with this payment.' using errcode = 'P0001';
    end if;
    v_new_applied := least(coalesce(v_amount_cents, v_payment.amount_cents),
                           v_new_charge.amount_cents - v_new_charge.paid_amount_cents);
    if v_new_applied < 0 then
      raise exception 'The new charge is already paid in full.' using errcode = 'P0001';
    end if;
    v_new_excess := coalesce(v_amount_cents, v_payment.amount_cents) - v_new_applied;
    -- Credit reconcile: already-applied credit is immutable history, so the
    -- new excess must still cover it (same 409 as the amount path).
    if v_credit_id is not null then
      select coalesce(sum(amount_cents), 0) into v_credit_applied
        from rental_credit_applications
       where owner_id = effective_owner_id and credit_id = v_credit_id;
      if v_credit_applied > v_new_excess then
        raise exception 'Part of this payment''s overpayment credit ($%) has already been applied to other charges, and the corrected amount leaves only $% of excess to cover it. Correct to an amount that keeps at least $% of excess, or reverse the credit applications first.',
          (v_credit_applied / 100.0), (v_new_excess / 100.0), (v_credit_applied / 100.0)
          using errcode = 'P0001';
      end if;
      if v_new_excess = 0 then
        update rental_tenant_credits
           set remaining_cents = 0, status = 'void',
               voided_at = now(), voided_by = v_actor_id,
               void_reason = 'Payment ' || v_payment.id || ' moved to charge ' || v_charge_id ||
                 ' — overpayment excess eliminated.',
               updated_at = now()
         where owner_id = effective_owner_id and id = v_credit_id;
        v_credit_action := 'void';
      else
        update rental_tenant_credits
           set amount_cents = v_new_excess,
               remaining_cents = v_new_excess - v_credit_applied,
               status = case when v_new_excess - v_credit_applied = 0 then 'fully_applied' else 'open' end,
               updated_at = now()
         where owner_id = effective_owner_id and id = v_credit_id;
        v_credit_action := 'adjust';
      end if;
    elsif v_new_excess > 0 then
      v_credit_id := 'rental_credit_' || gen_random_uuid()::text;
      insert into rental_tenant_credits (owner_id, id, tenant_id, lease_id, amount_cents,
        remaining_cents, source, source_payment_id, status, notes, created_at, updated_at)
      values (effective_owner_id, v_credit_id, v_payment.tenant_id, v_payment.lease_id,
        v_new_excess, v_new_excess, 'overpayment', v_payment.id, 'open',
        'Overpayment excess from corrected payment ' || v_payment.id, now(), now());
      v_credit_action := 'create';
    end if;
    v_balance_delta := v_new_applied - v_old_applied;
    update rent_charges
       set paid_amount_cents = v_charge.paid_amount_cents - v_old_applied,
           status = case
             when v_charge.paid_amount_cents - v_old_applied >= v_charge.amount_cents then 'paid'
             when v_charge.paid_amount_cents - v_old_applied > 0 then 'partially_paid'
             when v_charge.due_date <= CURRENT_DATE then 'due'
             else 'scheduled' end,
           updated_at = now()
     where owner_id = effective_owner_id and id = v_charge.id;
    update rent_charges
       set paid_amount_cents = v_new_charge.paid_amount_cents + v_new_applied,
           status = case
             when v_new_charge.paid_amount_cents + v_new_applied >= v_new_charge.amount_cents then 'paid'
             else 'partially_paid' end,
           updated_at = now()
     where owner_id = effective_owner_id and id = v_new_charge.id;
    if v_changes ? 'amountCents' and v_amount_cents <> v_payment.amount_cents then
      v_audit_changes := v_audit_changes || jsonb_build_object(
        'amount_cents', jsonb_build_object('from', v_payment.amount_cents, 'to', v_amount_cents));
      v_field_count := v_field_count + 1;
    end if;
    v_audit_changes := v_audit_changes || jsonb_build_object(
      'charge_id', jsonb_build_object('from', v_payment.charge_id, 'to', v_charge_id));
    v_field_count := v_field_count + 1;
    v_credit_result := jsonb_build_object(
      'appliedOldCents', v_old_applied,
      'appliedNewCents', v_new_applied,
      'oldExcessCents', coalesce(v_credit_amount, 0),
      'newExcessCents', v_new_excess,
      'appliedCreditCents', v_credit_applied,
      'creditId', v_credit_id,
      'creditAction', v_credit_action
    );
  end if;

  -- Charge balance rolls with the CREDIT-AWARE amount delta (row-locked).
  -- The payment row holds the FULL received amount, but the charge only ever
  -- held this payment's APPLIED portion — any overpayment excess lives in
  -- rental_tenant_credits sourced from this payment. The helper below
  -- re-splits the corrected amount between charge and credit inside this
  -- same transaction (void/adjust/create the credit, or raise a 409 when
  -- already-applied credit cannot be covered). The delta must keep the
  -- charge's paid total inside [0, amount]; the status follows the new paid
  -- total. Mirrors the pure computeCreditAwareCorrection() domain helper.
  -- Skipped when a charge move is in flight (the move branch above already
  -- re-split the amount across both charges).
  if not v_charge_move and v_changes ? 'amountCents' and v_amount_cents <> v_payment.amount_cents then
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

  if v_deposit_state_changed then
    v_audit_changes := v_audit_changes || jsonb_build_object(
      'deposit_state', jsonb_build_object('from', v_payment.deposit_state, 'to', v_deposit_state));
    v_field_count := v_field_count + 1;
  end if;

  -- Deposit amount: an allocation note on the payment row. It deliberately
  -- touches NO charge or credit row — charge paid and overpayment credit
  -- are derived from amount_cents only — so a deposit-amount change can
  -- never strand a balance. It is still audit-trailed like every field.
  if v_changes ? 'depositAmountCents' and v_deposit_amount_cents <> coalesce(v_payment.deposit_amount_cents, 0) then
    v_audit_changes := v_audit_changes || jsonb_build_object(
      'deposit_amount_cents', jsonb_build_object('from', coalesce(v_payment.deposit_amount_cents, 0), 'to', v_deposit_amount_cents));
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
         deposit_amount_cents = coalesce(v_deposit_amount_cents, deposit_amount_cents),
         deposit_state = case when v_deposit_state_changed then v_deposit_state else deposit_state end,
         deposited_at = case when v_deposit_state_changed then (case when v_deposit_state = 'deposited' then now() else null end) else deposited_at end,
         deposit_state_manual_at = case when v_deposit_state_changed then now() else deposit_state_manual_at end,
         charge_id = case when v_charge_move then v_charge_id else charge_id end,
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
