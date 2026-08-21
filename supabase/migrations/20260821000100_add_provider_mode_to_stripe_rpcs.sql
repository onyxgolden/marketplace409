-- Threads an authoritative provider_mode through every Stripe-backed RPC. This does NOT rely on
-- Stripe's auto-generated object ids being globally unique across test/live modes — that
-- behavior is only documented informally (Stripe community/support answers), not published as a
-- formal API contract, so every record-selection predicate and conflict target below includes
-- provider_mode explicitly rather than trusting id uniqueness alone. Callers (application code)
-- pass the server's own resolved provider_mode — never a value read from the event payload itself
-- — and are responsible for having already rejected any event whose own livemode disagrees with
-- that resolved mode before invoking any of these functions.
--
-- NOT applied remotely by this change — local migration file only.

drop function if exists process_stripe_rental_payment_event(text,text,text,text,text,text,text,timestamptz);
create function process_stripe_rental_payment_event(
  p_provider_event_id text, p_connected_account_id text, p_event_type text,
  p_object_id text, p_payment_id text, p_failure_code text default null,
  p_failure_message text default null, p_occurred_at timestamptz default now(),
  p_provider_mode text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_owner_id text;
  v_event payment_webhook_events%rowtype;
  v_payment rental_payments%rowtype;
  v_new_paid bigint;
begin
  if p_provider_mode is null or p_provider_mode not in ('test','live') then raise exception 'A valid provider mode is required.'; end if;
  select owner_id into v_owner_id from landlord_payment_accounts
    where provider = 'stripe' and provider_mode = p_provider_mode and provider_account_id = p_connected_account_id;
  if v_owner_id is null then raise exception 'Unknown Stripe connected account.'; end if;
  select * into v_event from payment_webhook_events
    where provider = 'stripe' and provider_mode = p_provider_mode and provider_event_id = p_provider_event_id for update;
  if not found then raise exception 'Stripe webhook event was not recorded.'; end if;
  if v_event.status in ('processed', 'ignored') then
    return jsonb_build_object('status', v_event.status, 'duplicate', true);
  end if;
  if p_event_type not in ('payment_intent.processing','payment_intent.succeeded','payment_intent.payment_failed',
      'charge.dispute.created','charge.dispute.updated','charge.dispute.closed') or p_payment_id is null then
    update payment_webhook_events set status = 'ignored', processed_at = now() where id = v_event.id;
    return jsonb_build_object('status', 'ignored');
  end if;
  -- Scoped by provider_mode even though p_payment_id is FORGE's own globally-unique id, not a
  -- Stripe id: this makes it structurally impossible for a live event to touch a test-tagged
  -- payment row (or vice versa) even under a caller bug, rather than merely "not expected to".
  select * into v_payment from rental_payments where owner_id = v_owner_id and id = p_payment_id and provider_mode = p_provider_mode for update;
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
revoke all on function process_stripe_rental_payment_event(text,text,text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function process_stripe_rental_payment_event(text,text,text,text,text,text,text,timestamptz,text) to service_role;

drop function if exists process_stripe_rental_refund_event(text,text,text,bigint,timestamptz);
create function process_stripe_rental_refund_event(
  p_provider_event_id text, p_connected_account_id text, p_payment_id text,
  p_refunded_amount_cents bigint, p_occurred_at timestamptz, p_provider_mode text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_owner_id text; v_event payment_webhook_events; v_payment rental_payments;
begin
  if p_provider_mode is null or p_provider_mode not in ('test','live') then raise exception 'A valid provider mode is required.'; end if;
  select owner_id into v_owner_id from landlord_payment_accounts where provider='stripe' and provider_mode=p_provider_mode and provider_account_id=p_connected_account_id;
  if v_owner_id is null then raise exception 'Unknown Stripe connected account.'; end if;
  select * into v_event from payment_webhook_events where provider='stripe' and provider_mode=p_provider_mode and provider_event_id=p_provider_event_id for update;
  if v_event.status in('processed','ignored') then return jsonb_build_object('status',v_event.status,'duplicate',true); end if;
  if p_payment_id is null or p_refunded_amount_cents is null then raise exception 'Mapped Stripe refund evidence is required.'; end if;
  -- Scoped by provider_mode: a live refund event can never mutate a test-tagged payment row.
  select * into v_payment from rental_payments where owner_id=v_owner_id and id=p_payment_id and provider_mode=p_provider_mode for update;
  if v_payment.id is null then raise exception 'Stripe refund payment mapping was not found.'; end if;
  if p_refunded_amount_cents<0 or p_refunded_amount_cents>v_payment.amount_cents then raise exception 'Stripe refund amount is invalid.'; end if;
  update rental_payments set refunded_amount_cents=p_refunded_amount_cents,status=case when p_refunded_amount_cents=amount_cents then 'refunded' else 'partially_refunded' end,updated_at=p_occurred_at where owner_id=v_owner_id and id=v_payment.id;
  update payment_webhook_events set status='processed',processed_at=now(),failure_message=null where id=v_event.id;
  return jsonb_build_object('status','processed','payment_id',v_payment.id,'owner_id',v_owner_id);
end$$;
revoke all on function process_stripe_rental_refund_event(text,text,text,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function process_stripe_rental_refund_event(text,text,text,bigint,timestamptz,text) to service_role;

drop function if exists mark_stripe_rental_settlements_paid_out(text,text,text,text[],timestamptz);
create function mark_stripe_rental_settlements_paid_out(
  p_provider_event_id text, p_connected_account_id text, p_payout_id text,
  p_balance_transaction_ids text[], p_paid_out_at timestamptz, p_provider_mode text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_owner text; v_count integer;
begin
  if p_provider_mode is null or p_provider_mode not in ('test','live') then raise exception 'A valid provider mode is required.'; end if;
  select owner_id into v_owner from landlord_payment_accounts where provider='stripe' and provider_mode=p_provider_mode and provider_account_id=p_connected_account_id;
  -- Scoped by provider_mode: a live payout event can never mark a test-tagged settlement paid out.
  update rental_settlements set provider_payout_id=p_payout_id,status='paid_out',paid_out_at=p_paid_out_at,updated_at=now()
    where owner_id=v_owner and provider='stripe' and provider_mode=p_provider_mode and provider_balance_transaction_id=any(p_balance_transaction_ids);
  get diagnostics v_count=row_count;
  update payment_webhook_events set status='processed',processed_at=now() where provider='stripe' and provider_mode=p_provider_mode and provider_event_id=p_provider_event_id;
  return jsonb_build_object('status','processed','matched_settlements',v_count);
end$$;
revoke all on function mark_stripe_rental_settlements_paid_out(text,text,text,text[],timestamptz,text) from public,anon,authenticated;
grant execute on function mark_stripe_rental_settlements_paid_out(text,text,text,text[],timestamptz,text) to service_role;

drop function if exists record_stripe_rental_settlement(text,text,text,text,bigint,bigint,bigint,text,text,timestamptz);
drop function if exists record_stripe_rental_settlement(text,text,text,text,bigint,bigint,bigint,text,text,timestamptz,text);
create function record_stripe_rental_settlement(
  p_provider_event_id text, p_connected_account_id text, p_payment_intent_id text, p_balance_transaction_id text,
  p_gross_amount_cents bigint, p_fee_amount_cents bigint, p_net_amount_cents bigint, p_currency_code text,
  p_status text, p_available_at timestamptz, p_provider_mode text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_owner text; v_payment rental_payments;
begin
  if p_provider_mode is null or p_provider_mode not in ('test','live') then raise exception 'A valid provider mode is required.'; end if;
  select owner_id into v_owner from landlord_payment_accounts where provider='stripe' and provider_mode=p_provider_mode and provider_account_id=p_connected_account_id;
  -- Scoped by provider_mode even though provider_payment_id is a Stripe id: makes it structurally
  -- impossible for a live settlement event to attach to a test-tagged payment, or vice versa.
  select * into v_payment from rental_payments where owner_id=v_owner and provider='stripe' and provider_mode=p_provider_mode and provider_payment_id=p_payment_intent_id;
  if v_payment.id is null then raise exception 'Settlement payment mapping was not found.'; end if;
  if p_gross_amount_cents-p_fee_amount_cents<>p_net_amount_cents then raise exception 'Settlement arithmetic is invalid.'; end if;
  insert into rental_settlements(owner_id,id,payment_id,provider,provider_mode,provider_balance_transaction_id,gross_amount_cents,fee_amount_cents,net_amount_cents,currency_code,status,available_at)
  values(v_owner,'rental_settlement_'||gen_random_uuid()::text,v_payment.id,'stripe',p_provider_mode,p_balance_transaction_id,p_gross_amount_cents,p_fee_amount_cents,p_net_amount_cents,upper(p_currency_code),case when p_status='available' then 'available' else 'pending' end,p_available_at)
  on conflict(provider,provider_mode,provider_balance_transaction_id) do update set fee_amount_cents=excluded.fee_amount_cents,net_amount_cents=excluded.net_amount_cents,status=excluded.status,available_at=excluded.available_at,updated_at=now();
  update payment_webhook_events set status='processed',processed_at=now() where provider='stripe' and provider_mode=p_provider_mode and provider_event_id=p_provider_event_id;
  return jsonb_build_object('status','processed','payment_id',v_payment.id);
end$$;
revoke all on function record_stripe_rental_settlement(text,text,text,text,bigint,bigint,bigint,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function record_stripe_rental_settlement(text,text,text,text,bigint,bigint,bigint,text,text,timestamptz,text) to service_role;

drop function if exists activate_rental_autopay_from_payment(text,text,text,text);
drop function if exists activate_rental_autopay_from_payment(text,text,text,text,text);
create function activate_rental_autopay_from_payment(
  p_connected_account_id text, p_payment_id text, p_payment_method_id text, p_mandate_id text, p_provider_mode text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare p_owner_id text; p rental_payments; e rental_autopay_enrollments;
begin
  if p_provider_mode is null or p_provider_mode not in ('test','live') then raise exception 'A valid provider mode is required.'; end if;
  select owner_id into p_owner_id from landlord_payment_accounts where provider='stripe' and provider_mode=p_provider_mode and provider_account_id=p_connected_account_id;
  if p_owner_id is null then raise exception 'Unknown Stripe connected account.'; end if;
  select * into p from rental_payments where owner_id=p_owner_id and id=p_payment_id and provider_mode=p_provider_mode;
  if p.status<>'succeeded' or p_payment_method_id is null then return jsonb_build_object('activated',false); end if;
  -- Scoped by provider_mode: a live payment must never activate a preserved sandbox
  -- 'setup_required' enrollment (or vice versa) now that one of each can coexist per lease/tenant.
  select * into e from rental_autopay_enrollments where owner_id=p_owner_id and tenant_id=p.tenant_id and lease_id=p.lease_id and status='setup_required' and provider_mode=p_provider_mode order by consented_at desc limit 1;
  if e.id is null then return jsonb_build_object('activated',false); end if;
  update rental_autopay_enrollments set status='active',provider_customer_id=p.provider_customer_id,provider_payment_method_id=p_payment_method_id,provider_mandate_id=p_mandate_id,activated_at=now(),updated_at=now() where owner_id=p_owner_id and id=e.id;
  return jsonb_build_object('activated',true,'enrollment_id',e.id);
end$$;
revoke all on function activate_rental_autopay_from_payment(text,text,text,text,text) from public,anon,authenticated;
grant execute on function activate_rental_autopay_from_payment(text,text,text,text,text) to service_role;
