-- RV-E2C: authenticated Stripe test-mode webhook application for reservation booking balances.
-- Security deposits, live mode, settlement availability, payout, reconciliation, refunds and disputes remain deferred.

create or replace function public.process_stripe_reservation_payment_event(
  p_provider_event_id text,
  p_connected_account_id text,
  p_event_type text,
  p_payment_id text,
  p_payment_intent_id text,
  p_amount_cents bigint,
  p_currency_code text,
  p_failure_code text,
  p_occurred_at timestamptz,
  p_provider_mode text
) returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_owner_id text;
  v_attempt public.reservation_payment_attempts;
  v_to_status text;
  v_applied bigint;
  v_existing public.reservation_payment_events;
begin
  if p_provider_mode <> 'test' then
    raise exception 'Reservation payment application is limited to Stripe test mode.';
  end if;
  if p_event_type not in ('payment_intent.processing','payment_intent.payment_failed','payment_intent.succeeded') then
    return jsonb_build_object('ignored', true, 'reason', 'unsupported_event');
  end if;
  if nullif(btrim(p_provider_event_id), '') is null
     or nullif(btrim(p_connected_account_id), '') is null
     or nullif(btrim(p_payment_id), '') is null
     or nullif(btrim(p_payment_intent_id), '') is null then
    raise exception 'Canonical Stripe reservation payment identity is required.';
  end if;

  select owner_id into v_owner_id
  from public.landlord_payment_accounts
  where provider = 'stripe'
    and provider_mode = p_provider_mode
    and provider_account_id = btrim(p_connected_account_id)
    and status = 'enabled';
  if not found then raise exception 'Stripe connected account was not found.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner_id || ':' || btrim(p_payment_id), 0));

  select * into v_existing
  from public.reservation_payment_events
  where owner_id = v_owner_id and provider_event_id = btrim(p_provider_event_id);
  if found then
    return jsonb_build_object('duplicate', true, 'paymentAttemptId', v_existing.payment_attempt_id);
  end if;

  select * into v_attempt
  from public.reservation_payment_attempts
  where owner_id = v_owner_id
    and id = btrim(p_payment_id)
    and purpose = 'booking_balance'
    and provider = 'stripe'
    and provider_mode = 'test'
    and provider_reference = btrim(p_payment_intent_id);
  if not found then raise exception 'Reservation payment attempt was not found.'; end if;

  if p_event_type = 'payment_intent.succeeded' then
    if p_amount_cents is distinct from v_attempt.amount_cents
       or upper(coalesce(p_currency_code, '')) is distinct from v_attempt.currency_code then
      raise exception 'Stripe reservation payment amount or currency does not match.';
    end if;
    v_to_status := 'succeeded';
    v_applied := v_attempt.amount_cents;
  elsif p_event_type = 'payment_intent.processing' then
    v_to_status := 'processing';
    v_applied := v_attempt.applied_amount_cents;
  else
    v_to_status := 'failed';
    v_applied := v_attempt.applied_amount_cents;
  end if;

  if v_attempt.payment_status in ('succeeded','partially_refunded','refunded','disputed','cancelled','failed')
     or (v_attempt.payment_status = 'processing' and v_to_status = 'processing') then
    insert into public.reservation_payment_events (
      owner_id,id,reservation_id,payment_attempt_id,event_type,provider_event_id,
      from_status,to_status,amount_cents,event_payload,actor_kind,occurred_at
    ) values (
      v_owner_id,'reservation_payment_event_' || gen_random_uuid()::text,v_attempt.reservation_id,v_attempt.id,
      'provider_event_ignored',btrim(p_provider_event_id),v_attempt.payment_status,v_attempt.payment_status,
      coalesce(p_amount_cents,0),jsonb_build_object('providerEventType',p_event_type,'reason','non_monotonic_or_duplicate_state'),
      'system',coalesce(p_occurred_at,now())
    );
    update public.payment_webhook_events set status='processed',processed_at=now(),failure_message=null
      where provider='stripe' and provider_mode=p_provider_mode and provider_event_id=btrim(p_provider_event_id);
    return jsonb_build_object('ignored',true,'paymentAttemptId',v_attempt.id,'paymentStatus',v_attempt.payment_status);
  end if;

  update public.reservation_payment_attempts
  set payment_status = v_to_status,
      applied_amount_cents = case when v_to_status='succeeded' then v_applied else applied_amount_cents end,
      settlement_status = case when v_to_status='succeeded' then 'pending' else settlement_status end
  where owner_id=v_owner_id and id=v_attempt.id;

  insert into public.reservation_payment_events (
    owner_id,id,reservation_id,payment_attempt_id,event_type,provider_event_id,
    from_status,to_status,amount_cents,event_payload,actor_kind,occurred_at
  ) values (
    v_owner_id,'reservation_payment_event_' || gen_random_uuid()::text,v_attempt.reservation_id,v_attempt.id,
    p_event_type,btrim(p_provider_event_id),v_attempt.payment_status,v_to_status,
    case when v_to_status='succeeded' then v_applied else 0 end,
    jsonb_strip_nulls(jsonb_build_object('failureCode',nullif(btrim(coalesce(p_failure_code,'')),''))),
    'system',coalesce(p_occurred_at,now())
  );

  update public.payment_webhook_events set status='processed',processed_at=now(),failure_message=null
    where provider='stripe' and provider_mode=p_provider_mode and provider_event_id=btrim(p_provider_event_id);

  return jsonb_build_object(
    'paymentAttemptId',v_attempt.id,'reservationId',v_attempt.reservation_id,
    'paymentStatus',v_to_status,'appliedAmountCents',v_applied,
    'settlementStatus',case when v_to_status='succeeded' then 'pending' else v_attempt.settlement_status end
  );
end
$$;

revoke all on function public.process_stripe_reservation_payment_event(text,text,text,text,text,bigint,text,text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.process_stripe_reservation_payment_event(text,text,text,text,text,bigint,text,text,timestamptz,text)
  to service_role;
