-- Slice D — received-vs-deposited money states.
--
-- Money that has been collected but not yet deposited must be an explicit, visible
-- state, never conflated with settled money. rental_payments.status describes the
-- provider payment lifecycle (succeeded / failed / refunded / ...); an offline
-- payment recorded with status='succeeded' therefore used to claim "in the bank"
-- the moment the cash was handed over. The new deposit_state column tracks the
-- separate, honest question: is this money in the bank yet?
--
--   received  — collected (cash in hand, cashier's check received, Stripe payout
--               still pending). Explicit and visible; never shown as settled money.
--   deposited — the money has reached the bank / the Stripe payout landed.
--
-- Transitions are non-destructive and reversible (received <-> deposited); nothing
-- here deletes or rewrites existing rows. The Stripe payout hook marks linked
-- payments deposited automatically, but never overwrites a manual decision the
-- owner made after the payout landed. Apply with owner approval only — the
-- route code calling the new RPC parameters ships in the same branch and assumes
-- these columns exist.
--
-- Backfill decision (owner-visible): every historical completed payment predates
-- deposit tracking, so completed rows are marked 'deposited' to keep the new
-- "awaiting deposit" queue actionable going forward. If you would rather review
-- history through the queue instead, change the backfill UPDATE below to set
-- 'received' before applying.

alter table rental_payments
  add column if not exists deposit_state text not null default 'received'
    check (deposit_state in ('received', 'deposited'));
alter table rental_payments
  add column if not exists deposited_at timestamptz;
-- When the owner last explicitly set the deposit state by hand (via the
-- transition RPC below). The Stripe payout hook consults this so a duplicate or
-- follow-up payout event can never silently overwrite a newer manual decision.
alter table rental_payments
  add column if not exists deposit_state_manual_at timestamptz;

create index if not exists idx_rental_payments_deposit_state
  on rental_payments (owner_id, deposit_state)
  where status in ('succeeded', 'paid', 'settled', 'refunded', 'partially_refunded');

-- Historical completed payments predate deposit tracking: treat them as settled so
-- the awaiting-deposit queue starts empty and actionable. Unfinished payments
-- (failed / processing / ...) carry no money and keep the 'received' default.
update rental_payments
set deposit_state = 'deposited',
    deposited_at = coalesce(succeeded_at, received_at, created_at)
where deposit_state = 'received'
  and status in ('succeeded', 'paid', 'settled', 'refunded', 'partially_refunded');

-- record_offline_rental_payment: 11-argument canonical version. The old 10-argument
-- signature is dropped (its only caller, POST /api/rental, moves to 11 arguments in
-- the same branch) and recreated with the additive, defaulted p_deposit_state
-- parameter — the same backward-compatible discipline as the 20260925 credit
-- extension. The historical 7-argument wrapper below keeps resolving (defaults fill
-- the new parameter) and keeps the 20260912 explicit-grant contract intact.
drop function if exists record_offline_rental_payment(text, text, text, bigint, timestamptz, text, text, boolean, text, text);

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
  if p_payment_method not in ('cash', 'cashiers_check') then
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

-- Replay helper: same contract as the 20260925 version, with the payment's own
-- deposit state carried in the replayed payload so a retried POST returns the
-- original recording exactly (including whether it was marked deposited).
create or replace function _replay_offline_rental_payment(
  p_owner_id text, p_idempotency_key text, p_charge_id text, p_tenant_id text,
  p_amount_cents bigint, p_payment_method text, p_received_at timestamptz,
  p_receipt_reference text, p_notes text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_existing_payment rental_payments%rowtype;
  v_credit_id text;
  v_excess_cents bigint;
  v_credit_remaining bigint;
  v_applied_cents bigint;
begin
  select * into v_existing_payment from rental_payments
    where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
  if not found then return null; end if;

  if v_existing_payment.charge_id is distinct from p_charge_id
     or v_existing_payment.tenant_id is distinct from p_tenant_id
     or v_existing_payment.amount_cents is distinct from p_amount_cents
     or v_existing_payment.payment_method is distinct from p_payment_method
     or v_existing_payment.received_at is distinct from p_received_at
     or nullif(btrim(v_existing_payment.receipt_reference), '') is distinct from nullif(btrim(p_receipt_reference), '')
     or nullif(btrim(v_existing_payment.notes), '') is distinct from nullif(btrim(p_notes), '')
  then
    raise exception 'Idempotency key % was already used with different payment details.', p_idempotency_key;
  end if;

  select c.id, c.amount_cents, c.remaining_cents
    into v_credit_id, v_excess_cents, v_credit_remaining
    from rental_tenant_credits c
    where c.owner_id = p_owner_id and c.source_payment_id = v_existing_payment.id;
  -- The credit's amount IS the excess; what was applied is the rest.
  v_applied_cents := v_existing_payment.amount_cents - coalesce(v_excess_cents, 0);
  return jsonb_build_object('id', v_existing_payment.id, 'chargeId', v_existing_payment.charge_id,
    'amountCents', v_existing_payment.amount_cents, 'appliedCents', v_applied_cents,
    'paymentMethod', v_existing_payment.payment_method, 'status', v_existing_payment.status,
    'receivedAt', v_existing_payment.received_at, 'replayed', true,
    'depositState', v_existing_payment.deposit_state,
    'depositedAt', v_existing_payment.deposited_at,
    'credit', case when v_credit_id is null then null
      else jsonb_build_object('id', v_credit_id, 'amountCents', v_excess_cents,
        'remainingCents', v_credit_remaining, 'sourcePaymentId', v_existing_payment.id) end);
end;
$$;

revoke all on function _replay_offline_rental_payment(text, text, text, text, bigint, text, timestamptz, text, text) from public, anon;
-- No positive grant: private helper, reachable only from the definer RPCs above.

-- Mark a payment's deposit state — the reversible transition between "received /
-- awaiting deposit" and "deposited / settled". Idempotent (re-marking the current
-- state is a no-op that returns the row), and restricted to payments that actually
-- moved money: a failed or still-processing payment has no money to deposit.
create or replace function set_rental_payment_deposit_state(
  p_owner_id text, p_payment_id text, p_deposit_state text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_payment rental_payments%rowtype;
  v_state text;
begin
  if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
    raise exception 'Authenticated owner id is required.';
  end if;
  v_state := coalesce(nullif(btrim(p_deposit_state), ''), '');
  if v_state not in ('received', 'deposited') then
    raise exception 'Unsupported deposit state.';
  end if;
  select * into v_payment from rental_payments
    where owner_id = p_owner_id and id = p_payment_id for update;
  if not found then raise exception 'Rental payment was not found.'; end if;
  if v_payment.status not in ('succeeded', 'paid', 'settled', 'refunded', 'partially_refunded') then
    raise exception 'Only a payment that moved money can be marked deposited.';
  end if;
  if v_payment.deposit_state = v_state then
    return jsonb_build_object('id', v_payment.id, 'depositState', v_payment.deposit_state,
      'depositedAt', v_payment.deposited_at, 'changed', false);
  end if;
  update rental_payments
    set deposit_state = v_state,
        deposited_at = case when v_state = 'deposited' then now() else null end,
        deposit_state_manual_at = now(),
        updated_at = now()
    where owner_id = p_owner_id and id = p_payment_id;
  return jsonb_build_object('id', v_payment.id, 'depositState', v_state,
    'depositedAt', case when v_state = 'deposited' then now() else null end, 'changed', true);
end;
$$;

revoke all on function set_rental_payment_deposit_state(text, text, text) from public, anon;
grant execute on function set_rental_payment_deposit_state(text, text, text) to authenticated;

-- Stripe hook: when a payout lands (settlements marked paid_out), the linked payments
-- are deposited by definition — flip them automatically so the awaiting-deposit queue
-- clears itself for online payments without manual work. 6-argument signature with
-- provider_mode scoping, matching the 20260821 version this replaces.
create or replace function mark_stripe_rental_settlements_paid_out(
  p_provider_event_id text, p_connected_account_id text, p_payout_id text,
  p_balance_transaction_ids text[], p_paid_out_at timestamptz, p_provider_mode text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_owner text;v_count integer;
begin
  if p_provider_mode is null or p_provider_mode not in ('test','live') then raise exception 'A valid provider mode is required.'; end if;
  select owner_id into v_owner from landlord_payment_accounts where provider='stripe' and provider_mode=p_provider_mode and provider_account_id=p_connected_account_id;
  -- Scoped by provider_mode: a live payout event can never mark a test-tagged settlement paid out.
  update rental_settlements set provider_payout_id=p_payout_id,status='paid_out',paid_out_at=p_paid_out_at,updated_at=now()
    where owner_id=v_owner and provider='stripe' and provider_mode=p_provider_mode and provider_balance_transaction_id=any(p_balance_transaction_ids);
  get diagnostics v_count=row_count;
  -- Never overwrite a newer manual decision: if the owner moved a payment back to
  -- 'received' after this payout landed, a duplicate or follow-up payout event must
  -- not silently flip it to 'deposited' again. A genuinely newer payout
  -- (p_paid_out_at > deposit_state_manual_at) still wins — new money facts beat old
  -- manual calls.
  update rental_payments set deposit_state='deposited',deposited_at=coalesce(deposited_at,p_paid_out_at),updated_at=now()
    where owner_id=v_owner and (deposit_state_manual_at is null or deposit_state_manual_at < p_paid_out_at) and id in(select payment_id from rental_settlements where owner_id=v_owner and provider='stripe' and provider_mode=p_provider_mode and provider_payout_id=p_payout_id);
  update payment_webhook_events set status='processed',processed_at=now() where provider='stripe' and provider_mode=p_provider_mode and provider_event_id=p_provider_event_id;
  return jsonb_build_object('status','processed','matched_settlements',v_count);
end$$;
revoke all on function mark_stripe_rental_settlements_paid_out(text,text,text,text[],timestamptz,text)from public,anon,authenticated;grant execute on function mark_stripe_rental_settlements_paid_out(text,text,text,text[],timestamptz,text)to service_role;
