-- RV-E2B: test-mode reservation booking-balance PaymentIntent initiation only.
-- No deposit authorization, webhook application, settlement, payout, or live-mode initiation.

create or replace function public.enforce_reservation_payment_state_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id
     or new.id is distinct from old.id
     or new.reservation_id is distinct from old.reservation_id
     or new.guest_id is distinct from old.guest_id
     or new.purpose is distinct from old.purpose
     or new.provider is distinct from old.provider
     or new.provider_mode is distinct from old.provider_mode
     or new.idempotency_key is distinct from old.idempotency_key
     or new.amount_cents is distinct from old.amount_cents
     or new.currency_code is distinct from old.currency_code then
    raise exception 'Reservation payment identity is immutable.';
  end if;

  if new.provider_reference is distinct from old.provider_reference
     and not (
       old.provider_reference is null
       and new.provider_reference is not null
       and old.payment_status = 'created'
       and new.payment_status = 'pending'
     ) then
    raise exception 'Reservation provider payment identity is immutable.';
  end if;

  if new.payment_status is distinct from old.payment_status and not (
    (old.payment_status = 'created' and new.payment_status in ('pending','processing','succeeded','failed','cancelled'))
    or (old.payment_status = 'pending' and new.payment_status in ('processing','succeeded','failed','cancelled'))
    or (old.payment_status = 'processing' and new.payment_status in ('succeeded','failed','cancelled'))
    or (old.payment_status = 'succeeded' and new.payment_status in ('partially_refunded','refunded','disputed'))
    or (old.payment_status = 'partially_refunded' and new.payment_status in ('refunded','disputed'))
  ) then
    raise exception 'Reservation payment status transition is not monotonic.';
  end if;

  if new.applied_amount_cents < old.applied_amount_cents
     or new.refunded_amount_cents < old.refunded_amount_cents
     or new.disputed_amount_cents < old.disputed_amount_cents
     or new.settled_amount_cents < old.settled_amount_cents
     or new.paid_out_amount_cents < old.paid_out_amount_cents then
    raise exception 'Reservation payment cumulative amounts cannot decrease.';
  end if;

  if new.settlement_status is distinct from old.settlement_status and not (
    (old.settlement_status = 'not_applicable' and new.settlement_status = 'pending')
    or (old.settlement_status = 'pending' and new.settlement_status = 'available')
    or (old.settlement_status = 'available' and new.settlement_status = 'paid_out')
  ) then
    raise exception 'Reservation settlement status transition is not monotonic.';
  end if;

  new.updated_at := now();
  return new;
end
$$;

create or replace function public.begin_public_reservation_payment_attempt(
  p_booking_slug text,
  p_access_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_reservation public.reservations;
  v_contract public.reservation_financial_contracts;
  v_account public.landlord_payment_accounts;
  v_attempt public.reservation_payment_attempts;
  v_amount_due bigint;
begin
  if nullif(btrim(p_booking_slug), '') is null
     or nullif(btrim(p_access_token), '') is null then
    raise exception 'Reservation access was not found.';
  end if;

  select reservation.* into v_reservation
  from public.reservations reservation
  join public.reservation_inventory_settings settings
    on settings.owner_id = reservation.owner_id
   and settings.unit_id = reservation.unit_id
  where settings.public_booking_slug = btrim(p_booking_slug)
    and reservation.guest_access_token = p_access_token
    and reservation.status in ('confirmed','checked_in');

  if not found then
    raise exception 'Reservation access was not found.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_reservation.owner_id || ':' || v_reservation.id || ':booking_balance', 0)
  );

  select * into strict v_contract
  from public.reservation_financial_contracts
  where owner_id = v_reservation.owner_id
    and reservation_id = v_reservation.id;

  select greatest(
    v_contract.booking_balance_cents
      - coalesce(sum(applied_amount_cents - refunded_amount_cents)
        filter (where purpose = 'booking_balance'), 0),
    0
  )::bigint
  into v_amount_due
  from public.reservation_payment_attempts
  where owner_id = v_reservation.owner_id
    and reservation_id = v_reservation.id;

  if v_amount_due <= 0 then
    raise exception 'The reservation booking balance is not payable.';
  end if;

  select * into v_attempt
  from public.reservation_payment_attempts
  where owner_id = v_reservation.owner_id
    and reservation_id = v_reservation.id
    and purpose = 'booking_balance'
    and provider = 'stripe'
    and provider_mode = 'test'
    and payment_status in ('created','pending','processing')
  order by created_at desc
  limit 1;

  select * into v_account
  from public.landlord_payment_accounts
  where owner_id = v_reservation.owner_id
    and provider = 'stripe'
    and provider_mode = 'test'
    and status = 'enabled'
    and charges_enabled
    and payouts_enabled
    and card_payments_enabled
  limit 1;

  if not found or v_account.provider_account_id is null then
    raise exception 'The reservation payment account is not ready.';
  end if;

  if v_attempt.id is null then
    insert into public.reservation_payment_attempts (
      owner_id, id, reservation_id, guest_id, purpose,
      provider, provider_mode, idempotency_key, amount_cents,
      currency_code, payment_status
    ) values (
      v_reservation.owner_id,
      'reservation_payment_' || gen_random_uuid()::text,
      v_reservation.id,
      v_reservation.guest_id,
      'booking_balance',
      'stripe',
      'test',
      'reservation:test:' || v_reservation.owner_id || ':' || v_reservation.id || ':' || gen_random_uuid()::text,
      v_amount_due,
      v_contract.currency_code,
      'created'
    )
    returning * into v_attempt;
  elsif v_attempt.amount_cents <> v_amount_due
     or v_attempt.currency_code <> v_contract.currency_code then
    raise exception 'The pending reservation payment no longer matches the financial contract.';
  end if;

  return jsonb_build_object(
    'ownerId', v_attempt.owner_id,
    'reservationId', v_attempt.reservation_id,
    'paymentAttemptId', v_attempt.id,
    'amountCents', v_attempt.amount_cents,
    'currencyCode', v_attempt.currency_code,
    'idempotencyKey', v_attempt.idempotency_key,
    'providerPaymentId', v_attempt.provider_reference,
    'paymentStatus', v_attempt.payment_status,
    'connectedAccountId', v_account.provider_account_id
  );
end
$$;

create or replace function public.record_public_reservation_payment_intent(
  p_payment_attempt_id text,
  p_provider_payment_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_attempt public.reservation_payment_attempts;
begin
  if nullif(btrim(p_payment_attempt_id), '') is null
     or nullif(btrim(p_provider_payment_id), '') is null then
    raise exception 'Payment attempt and provider payment are required.';
  end if;

  update public.reservation_payment_attempts
  set provider_reference = btrim(p_provider_payment_id),
      payment_status = 'pending'
  where id = btrim(p_payment_attempt_id)
    and provider = 'stripe'
    and provider_mode = 'test'
    and payment_status = 'created'
    and provider_reference is null
  returning * into v_attempt;

  if not found then
    select * into v_attempt
    from public.reservation_payment_attempts
    where id = btrim(p_payment_attempt_id)
      and provider = 'stripe'
      and provider_mode = 'test'
      and provider_reference = btrim(p_provider_payment_id)
      and payment_status in ('pending','processing');

    if not found then
      raise exception 'Reservation payment attempt could not be finalized.';
    end if;
  end if;

  return jsonb_build_object(
    'paymentAttemptId', v_attempt.id,
    'providerPaymentId', v_attempt.provider_reference,
    'paymentStatus', v_attempt.payment_status
  );
end
$$;

create or replace function public.fail_public_reservation_payment_attempt(
  p_payment_attempt_id text
) returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  update public.reservation_payment_attempts
  set payment_status = 'failed'
  where id = btrim(p_payment_attempt_id)
    and provider = 'stripe'
    and provider_mode = 'test'
    and payment_status = 'created'
    and provider_reference is null;
end
$$;

revoke all on function public.begin_public_reservation_payment_attempt(text,text)
  from public, anon, authenticated;
revoke all on function public.record_public_reservation_payment_intent(text,text)
  from public, anon, authenticated;
revoke all on function public.fail_public_reservation_payment_attempt(text)
  from public, anon, authenticated;

grant execute on function public.begin_public_reservation_payment_attempt(text,text)
  to service_role;
grant execute on function public.record_public_reservation_payment_intent(text,text)
  to service_role;
grant execute on function public.fail_public_reservation_payment_attempt(text)
  to service_role;
