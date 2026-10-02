-- Durable initiation evidence for Brandy's "autopay debit started" email.
--
-- Problem (ChatGPT NO-GO on PR #535): the payment_intent.processing webhook
-- queues its owner notification in app code AFTER the payment projection RPC
-- succeeds. If that queue write — or the autopay-attempt lookup feeding it —
-- fails transiently, the webhook still returns 200, a Stripe redelivery is
-- skipped as a settled duplicate, and the recovery cron only scans
-- succeeded/failed payments. The initiated notice is then lost permanently,
-- even after the payment later settles: Brandy gets one notice instead of
-- the initiated + completion pair.
--
-- Fix: stamp initiated_at on the payment row inside the projection RPC's own
-- transaction, on the first processing event. The marker is written if and
-- only if the projection succeeds, so "projection ok but evidence lost" is
-- impossible. It is independent of the mutable status column, so the
-- recovery cron can still find a payment that has already advanced to
-- succeeded or failed — scanning current processing rows alone would miss
-- that case. First processing event wins (coalesce keeps the earliest
-- detection time); redeliveries and retries cannot move it.
--
-- CORRECTION (ChatGPT re-review NO-GO): the first revision of this migration
-- recreated the EIGHT-argument overload of process_stripe_rental_payment_event
-- (ending in p_occurred_at, no p_provider_mode). Migration
-- 20260821000100_add_provider_mode_to_stripe_rpcs.sql had explicitly dropped
-- that overload and installed the NINE-argument version (ending in
-- p_provider_mode text), which is what the webhook route calls. CREATE OR
-- REPLACE with a different argument list creates another overload — it does
-- NOT replace the live function — so the active RPC never stamped the marker,
-- and the recreated overload lacked the provider-mode predicates. This
-- revision amends the CURRENT nine-argument function instead (preserving its
-- provider-mode validation, scoped account/event/payment lookups, signature,
-- and service-role grant contract) and drops the mistakenly reintroduced
-- eight-argument overload. The marker stamp is also independent of status
-- downgrade: a late processing event arriving after succeeded/refunded/
-- disputed preserves initiation evidence WITHOUT moving the terminal status
-- backwards (and without touching updated_at, which drives the terminal
-- reconciler's transition-time filter).
--
-- The marker is NOT the notification: the cron still applies the
-- owner/tenant allow-lists, provider mode, activation cutoff, and
-- detection-time disabled disposition before queueing, using the stable
-- event-specific notification id (opn_{owner}_payment_initiated_{payment}).
-- Safe to re-run: the column/index are IF NOT EXISTS, the overload drop is
-- IF EXISTS, and CREATE OR REPLACE on the nine-argument function is
-- idempotent.

alter table rental_payments add column if not exists initiated_at timestamptz;

create index if not exists rental_payments_initiated_at_idx
  on rental_payments (initiated_at) where initiated_at is not null;

-- Remove the mistakenly reintroduced eight-argument overload. On a correct
-- history this is a no-op (20260821000100 already dropped it); where the bad
-- revision of this migration was applied, it removes the obsolete unscoped
-- path that lacks the provider-mode predicates.
drop function if exists process_stripe_rental_payment_event(text,text,text,text,text,text,text,timestamptz);

-- Amend the CURRENT nine-argument function. Body is the 20260821000100
-- version verbatim except the payment_intent.processing branch, which now
-- stamps initiated_at. Provider-mode validation, scoped lookups, signature,
-- and all other branches are unchanged.
create or replace function process_stripe_rental_payment_event(
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
    update rental_payments set status = 'processing',
      initiated_at = coalesce(initiated_at, p_occurred_at),
      updated_at = p_occurred_at where owner_id = v_owner_id and id = v_payment.id;
  elsif p_event_type = 'payment_intent.processing' then
    -- Late processing event on a terminal-status payment: preserve initiation
    -- evidence WITHOUT moving the terminal status backwards and WITHOUT
    -- touching updated_at (updated_at drives the terminal reconciler's
    -- transition-time filter; bumping it here could resurrect stale failures
    -- into the healing window).
    update rental_payments set initiated_at = coalesce(initiated_at, p_occurred_at)
      where owner_id = v_owner_id and id = v_payment.id and initiated_at is null;
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

-- Service-role grant contract for the nine-argument signature, matching
-- 20260821000100 and the restated contract in 20260912020000. CREATE OR
-- REPLACE never resets previously granted privileges; restated idempotently.
revoke all on function process_stripe_rental_payment_event(text,text,text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function process_stripe_rental_payment_event(text,text,text,text,text,text,text,timestamptz,text) to service_role;
