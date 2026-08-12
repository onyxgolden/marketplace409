create or replace function process_stripe_rental_payment_event(
  p_provider_event_id text, p_connected_account_id text, p_event_type text,
  p_object_id text, p_payment_id text, p_failure_code text default null,
  p_failure_message text default null, p_occurred_at timestamptz default now()
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_owner_id text;
  v_event payment_webhook_events%rowtype;
  v_payment rental_payments%rowtype;
  v_new_paid bigint;
begin
  select owner_id into v_owner_id from landlord_payment_accounts
    where provider = 'stripe' and provider_account_id = p_connected_account_id;
  if v_owner_id is null then raise exception 'Unknown Stripe connected account.'; end if;
  select * into v_event from payment_webhook_events
    where provider = 'stripe' and provider_event_id = p_provider_event_id for update;
  if not found then raise exception 'Stripe webhook event was not recorded.'; end if;
  if v_event.status in ('processed', 'ignored') then
    return jsonb_build_object('status', v_event.status, 'duplicate', true);
  end if;
  if p_event_type not in ('payment_intent.processing','payment_intent.succeeded','payment_intent.payment_failed',
      'charge.dispute.created','charge.dispute.updated','charge.dispute.closed') or p_payment_id is null then
    update payment_webhook_events set status = 'ignored', processed_at = now() where id = v_event.id;
    return jsonb_build_object('status', 'ignored');
  end if;
  select * into v_payment from rental_payments where owner_id = v_owner_id and id = p_payment_id for update;
  if not found then raise exception 'Stripe event payment mapping was not found.'; end if;
  if v_payment.provider_payment_id is distinct from p_object_id and p_event_type like 'payment_intent.%' then
    raise exception 'Stripe PaymentIntent does not match the FORGE payment.';
  end if;
  if p_event_type = 'payment_intent.processing' and v_payment.status not in ('succeeded','refunded','disputed') then
    update rental_payments set status = 'processing', updated_at = p_occurred_at where owner_id = v_owner_id and id = v_payment.id;
  elsif p_event_type = 'payment_intent.succeeded' and v_payment.status <> 'succeeded' then
    update rental_payments set status = 'succeeded', succeeded_at = p_occurred_at,
      failure_code = null, failure_message = null, updated_at = p_occurred_at
      where owner_id = v_owner_id and id = v_payment.id;
    select least(amount_cents, paid_amount_cents + v_payment.amount_cents) into v_new_paid
      from rent_charges where owner_id = v_owner_id and id = v_payment.charge_id for update;
    update rent_charges set paid_amount_cents = v_new_paid,
      status = case when v_new_paid = amount_cents then 'paid' else 'partially_paid' end,
      updated_at = p_occurred_at where owner_id = v_owner_id and id = v_payment.charge_id;
  elsif p_event_type = 'payment_intent.payment_failed' and v_payment.status <> 'succeeded' then
    update rental_payments set status = 'failed', failure_code = nullif(p_failure_code, ''),
      failure_message = nullif(p_failure_message, ''), updated_at = p_occurred_at
      where owner_id = v_owner_id and id = v_payment.id;
  elsif p_event_type like 'charge.dispute.%' then
    update rental_payments set status = 'disputed', updated_at = p_occurred_at
      where owner_id = v_owner_id and id = v_payment.id;
  end if;
  update payment_webhook_events set status = 'processed', processed_at = now(), failure_message = null where id = v_event.id;
  return jsonb_build_object('status', 'processed', 'payment_id', v_payment.id, 'owner_id', v_owner_id);
end;
$$;
revoke all on function process_stripe_rental_payment_event(text,text,text,text,text,text,text,timestamptz) from public;
revoke all on function process_stripe_rental_payment_event(text,text,text,text,text,text,text,timestamptz) from anon;
revoke all on function process_stripe_rental_payment_event(text,text,text,text,text,text,text,timestamptz) from authenticated;
grant execute on function process_stripe_rental_payment_event(text,text,text,text,text,text,text,timestamptz) to service_role;
