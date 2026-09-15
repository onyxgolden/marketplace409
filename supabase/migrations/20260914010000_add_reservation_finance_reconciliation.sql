-- RV-E2D. No existing history, contract, payment application, or deposit is rewritten.
-- Receipt evidence is immutable even when identity cannot safely be attributed.
create table if not exists public.reservation_finance_receipts (
  provider_event_id text primary key,
  connected_account_id text,
  provider_mode text not null,
  event_type text not null,
  provider_object_id text,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  outcome text not null check (outcome in ('accepted','unknown')),
  reason text not null,
  received_at timestamptz not null default now(),
  owner_id text
);

create table if not exists public.reservation_finance_objects (
  owner_id text not null,
  reservation_id text not null,
  payment_attempt_id text not null,
  connected_account_id text not null,
  provider_mode text not null check (provider_mode = 'test'),
  payment_intent_id text not null,
  object_id text not null,
  kind text not null check (kind in ('refund','reversal','dispute','settlement')),
  amount_cents bigint not null check (amount_cents > 0),
  currency_code text not null,
  status text not null,
  fee_cents bigint,
  net_cents bigint,
  payout_id text,
  payout_status text,
  observed_at timestamptz not null,
  primary key (connected_account_id, provider_mode, object_id),
  foreign key (owner_id, reservation_id) references public.reservation_financial_contracts(owner_id,reservation_id) on delete restrict,
  foreign key (owner_id, payment_attempt_id) references public.reservation_payment_attempts(owner_id,id) on delete restrict,
  check (currency_code ~ '^[A-Z]{3}$'),
  check ((kind = 'settlement' and fee_cents is not null and net_cents is not null
    and fee_cents >= 0 and net_cents = amount_cents - fee_cents and status in ('pending','available'))
    or (kind in ('refund','reversal') and status in ('pending','requires_action','succeeded','failed','canceled'))
    or (kind = 'dispute' and status in ('needs_response','under_review','won','lost','warning_needs_response','warning_under_review','warning_closed'))),
  check (payout_status is null or (kind = 'settlement' and payout_id is not null
    and payout_status in ('pending','in_transit','paid','failed','canceled')))
);

create table if not exists public.reservation_finance_evidence (
  provider_event_id text not null references public.reservation_finance_receipts(provider_event_id) on delete restrict,
  owner_id text not null,
  reservation_id text not null,
  payment_attempt_id text not null,
  connected_account_id text not null,
  provider_mode text not null check (provider_mode = 'test'),
  payment_intent_id text not null,
  object_id text not null,
  kind text not null,
  amount_cents bigint not null,
  currency_code text not null,
  observation jsonb not null,
  occurred_at timestamptz not null,
  primary key (provider_event_id, object_id),
  foreign key (owner_id, reservation_id) references public.reservation_financial_contracts(owner_id,reservation_id) on delete restrict,
  foreign key (owner_id, payment_attempt_id) references public.reservation_payment_attempts(owner_id,id) on delete restrict
);

alter table public.reservation_finance_receipts enable row level security;
alter table public.reservation_finance_receipts force row level security;
alter table public.reservation_finance_objects enable row level security;
alter table public.reservation_finance_objects force row level security;
alter table public.reservation_finance_evidence enable row level security;
alter table public.reservation_finance_evidence force row level security;
revoke all on public.reservation_finance_receipts, public.reservation_finance_objects,
  public.reservation_finance_evidence from public, anon, authenticated, service_role;
grant select on public.reservation_finance_objects, public.reservation_finance_evidence to authenticated;
grant select on public.reservation_finance_receipts to authenticated;
drop policy if exists reservation_finance_receipts_read on public.reservation_finance_receipts;
create policy reservation_finance_receipts_read on public.reservation_finance_receipts
  for select to authenticated using (public.has_workspace_access(owner_id));
drop policy if exists reservation_finance_objects_read on public.reservation_finance_objects;
create policy reservation_finance_objects_read on public.reservation_finance_objects
  for select to authenticated using (public.has_workspace_access(owner_id));
drop policy if exists reservation_finance_evidence_read on public.reservation_finance_evidence;
create policy reservation_finance_evidence_read on public.reservation_finance_evidence
  for select to authenticated using (public.has_workspace_access(owner_id));
drop trigger if exists reservation_finance_receipts_immutable on public.reservation_finance_receipts;
create trigger reservation_finance_receipts_immutable before update or delete on public.reservation_finance_receipts
  for each row execute function public.prevent_reservation_payment_event_mutation();
drop trigger if exists reservation_finance_evidence_immutable on public.reservation_finance_evidence;
create trigger reservation_finance_evidence_immutable before update or delete on public.reservation_finance_evidence
  for each row execute function public.prevent_reservation_payment_event_mutation();

-- Read-only server boundary; metadata is deliberately absent. Account + stored PI authorize.
create or replace function public.resolve_reservation_finance_attempts(p_connected_account_id text, p_payment_intent_id text default null)
returns jsonb language sql security definer set search_path = public set row_security = off as $$
  select coalesce(jsonb_agg(jsonb_build_object('ownerId',a.owner_id,'reservationId',a.reservation_id,
    'paymentAttemptId',a.id,'paymentIntentId',a.provider_reference,'amountCents',a.amount_cents,
    'currencyCode',a.currency_code,'paymentStatus',a.payment_status)), '[]'::jsonb)
  from public.reservation_payment_attempts a
  join public.landlord_payment_accounts l on l.owner_id=a.owner_id and l.provider='stripe'
    and l.provider_mode='test' and l.provider_account_id=p_connected_account_id and l.status='enabled'
  where a.provider='stripe' and a.provider_mode='test' and a.purpose='booking_balance'
    and a.provider_reference is not null
    and (p_payment_intent_id is null or a.provider_reference=p_payment_intent_id)
$$;

-- One transaction accepts the entire verified batch or retains only safe unknown evidence.
-- Object projections deduplicate distinct event IDs reporting the same refund/dispute/BT.
create or replace function public.record_reservation_finance_event(
  p_provider_event_id text, p_connected_account_id text, p_provider_mode text,
  p_event_type text, p_provider_object_id text, p_payload_hash text,
  p_occurred_at timestamptz, p_observations jsonb, p_unknown_reason text default null
) returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner text;
  v_reason text := 'verified';
  v_item jsonb;
  v_attempt public.reservation_payment_attempts;
  v_old public.reservation_finance_objects;
  v_object public.reservation_finance_objects;
  v_total bigint;
  v_receipt public.reservation_finance_receipts;
begin
  if p_provider_event_id is null or p_provider_event_id !~ '^evt_[A-Za-z0-9_]+$'
    or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Safe provider event identity and payload hash are required.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reservation-finance:event:' || p_provider_event_id,0));
  select * into v_receipt from public.reservation_finance_receipts where provider_event_id=p_provider_event_id;
  if found then return jsonb_build_object('duplicate',true,'outcome',v_receipt.outcome); end if;
  select owner_id into v_owner from public.landlord_payment_accounts
    where provider='stripe' and provider_mode='test' and provider_account_id=p_connected_account_id and status='enabled';
  if v_owner is not null then
    perform pg_advisory_xact_lock(hashtextextended('reservation-finance:owner:' || v_owner,0));
  end if;

  -- The inner subtransaction rolls back every object/evidence change on invalid evidence.
  begin
    if p_provider_mode is distinct from 'test' then v_reason := 'mode_mismatch'; raise exception 'reject'; end if;
    if v_owner is null then v_reason := 'unknown_account'; raise exception 'reject'; end if;
    if p_unknown_reason is not null then v_reason := 'unknown_provider_outcome'; raise exception 'reject'; end if;
    if p_occurred_at is null or p_event_type not in ('refund.created','refund.updated','refund.failed','charge.refunded',
      'charge.succeeded','charge.updated','charge.dispute.created','charge.dispute.updated','charge.dispute.closed',
      'balance.available','payout.created','payout.updated','payout.paid','payout.failed')
      or jsonb_typeof(p_observations) is distinct from 'array' or jsonb_array_length(p_observations)=0 then
      v_reason := 'unsupported_shape'; raise exception 'reject';
    end if;
    insert into public.reservation_finance_receipts values
      (p_provider_event_id,p_connected_account_id,p_provider_mode,p_event_type,p_provider_object_id,p_payload_hash,'accepted','verified',now(),v_owner);
    for v_item in select value from jsonb_array_elements(p_observations) loop
      v_reason := 'invalid_observation';
      select * into v_attempt from public.reservation_payment_attempts
        where owner_id=v_owner and provider='stripe' and provider_mode='test' and purpose='booking_balance'
          and provider_reference=v_item->>'paymentIntentId' for update;
      if not found then v_reason := 'unknown_payment_intent'; raise exception 'reject'; end if;
      if v_attempt.payment_status <> 'succeeded' or v_attempt.applied_amount_cents <> v_attempt.amount_cents then
        v_reason := 'payment_not_applied'; raise exception 'reject';
      end if;
      v_object := null;
      v_object.owner_id := v_owner; v_object.reservation_id := v_attempt.reservation_id;
      v_object.payment_attempt_id := v_attempt.id; v_object.connected_account_id := p_connected_account_id;
      v_object.provider_mode := 'test'; v_object.payment_intent_id := v_attempt.provider_reference;
      v_object.object_id := v_item->>'objectId'; v_object.kind := v_item->>'kind';
      v_object.amount_cents := (v_item->>'amountCents')::bigint; v_object.currency_code := v_item->>'currencyCode';
      v_object.status := v_item->>'status'; v_object.fee_cents := (v_item->>'feeCents')::bigint;
      v_object.net_cents := (v_item->>'netCents')::bigint; v_object.payout_id := v_item->>'payoutId';
      v_object.payout_status := v_item->>'payoutStatus'; v_object.observed_at := p_occurred_at;
      if v_object.currency_code is distinct from v_attempt.currency_code then
        v_reason := 'currency_mismatch'; raise exception 'reject'; end if;
      if v_object.amount_cents is null or v_object.amount_cents <= 0 or v_object.amount_cents > v_attempt.amount_cents
        or (v_object.kind='settlement' and v_object.amount_cents <> v_attempt.amount_cents) then
        v_reason := 'amount_mismatch'; raise exception 'reject'; end if;
      if v_object.object_id is null or v_object.object_id !~ '^[a-z]+_[A-Za-z0-9_]+$' then raise exception 'reject'; end if;
      select * into v_old from public.reservation_finance_objects
        where connected_account_id=p_connected_account_id and provider_mode='test' and object_id=v_object.object_id;
      if found then
        if (v_old.owner_id,v_old.payment_attempt_id,v_old.amount_cents,v_old.currency_code,v_old.fee_cents,v_old.net_cents)
          is distinct from (v_object.owner_id,v_object.payment_attempt_id,v_object.amount_cents,v_object.currency_code,v_object.fee_cents,v_object.net_cents)
          or (v_old.kind is distinct from v_object.kind and not
            (v_old.kind in ('refund','reversal') and v_object.kind in ('refund','reversal'))) then
          v_reason := 'provider_identity_or_amount_changed'; raise exception 'reject'; end if;
        -- Explicit reversal classification can arrive later for the same refund.
        -- Its original amount and immutable observations are retained exactly once.
        if v_old.kind='reversal' then v_object.kind := 'reversal'; end if;
        if v_old.payout_id is not null and v_object.payout_id is not null and v_old.payout_id <> v_object.payout_id then
          v_reason := 'payout_association_changed'; raise exception 'reject'; end if;
        if v_object.observed_at < v_old.observed_at then
          v_object.status := v_old.status;
          v_object.observed_at := v_old.observed_at;
        end if;
          -- Terminal evidence is never undone by a later notification of an earlier state.
          if v_old.status in ('succeeded','failed','canceled','won','lost','warning_closed','available') then
            if (v_old.status in ('won','lost') and v_object.status in ('won','lost') and v_old.status<>v_object.status)
              or (v_old.status='succeeded' and v_object.status in ('failed','canceled')) then
              v_reason := 'conflicting_terminal_outcome'; raise exception 'reject'; end if;
            v_object.status := v_old.status;
          end if;
          v_object.payout_id := coalesce(v_old.payout_id,v_object.payout_id);
          if v_old.payout_status in ('paid','failed','canceled') then
            if v_object.payout_status in ('paid','failed','canceled') and v_old.payout_status<>v_object.payout_status then
              v_reason := 'conflicting_payout_outcome'; raise exception 'reject'; end if;
            v_object.payout_status := v_old.payout_status;
          else v_object.payout_status := coalesce(v_object.payout_status,v_old.payout_status); end if;
      end if;
      insert into public.reservation_finance_objects select (v_object).*
        on conflict (connected_account_id,provider_mode,object_id) do update set
          kind=excluded.kind,status=excluded.status,payout_id=excluded.payout_id,payout_status=excluded.payout_status,observed_at=excluded.observed_at;
      select coalesce(sum(amount_cents),0) into v_total from public.reservation_finance_objects
        where owner_id=v_owner and payment_attempt_id=v_attempt.id and kind in ('refund','reversal') and status='succeeded';
      if v_total > v_attempt.applied_amount_cents then v_reason := 'refund_total_mismatch'; raise exception 'reject'; end if;
      select coalesce(sum(amount_cents),0) into v_total from public.reservation_finance_objects
        where owner_id=v_owner and payment_attempt_id=v_attempt.id and kind='dispute'
          and status not in ('won','warning_closed');
      if v_total > v_attempt.applied_amount_cents then v_reason := 'dispute_total_mismatch'; raise exception 'reject'; end if;
      if (select count(*) from public.reservation_finance_objects where owner_id=v_owner
        and payment_attempt_id=v_attempt.id and kind='settlement') > 1 then
        v_reason := 'ambiguous_balance_transaction'; raise exception 'reject'; end if;
      insert into public.reservation_finance_evidence values
        (p_provider_event_id,v_owner,v_attempt.reservation_id,v_attempt.id,p_connected_account_id,'test',
          v_attempt.provider_reference,v_item->>'objectId',v_item->>'kind',(v_item->>'amountCents')::bigint,
          v_item->>'currencyCode',v_item,p_occurred_at);
    end loop;
    return jsonb_build_object('outcome','accepted');
  exception when others then
    -- Never retain SQL error text, provider payloads, metadata, or guest information.
    insert into public.reservation_finance_receipts values
      (p_provider_event_id,p_connected_account_id,coalesce(p_provider_mode,'unknown'),coalesce(p_event_type,'unknown'),
       p_provider_object_id,p_payload_hash,'unknown',v_reason,now(),v_owner);
    return jsonb_build_object('outcome','unknown','reason',v_reason);
  end;
end
$$;

revoke all on function public.resolve_reservation_finance_attempts(text,text) from public,anon,authenticated;
grant execute on function public.resolve_reservation_finance_attempts(text,text) to service_role;
revoke all on function public.record_reservation_finance_event(text,text,text,text,text,text,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.record_reservation_finance_event(text,text,text,text,text,text,timestamptz,jsonb,text) to service_role;

-- Aggregates current object states, never subtracts from immutable payment application.
create or replace view public.reservation_finance_summary with (security_invoker = true) as
select summary.*,
  case when summary.booking_applied_cents >= summary.booking_balance_cents and summary.booking_applied_cents > 0 then 'paid'
    when summary.booking_applied_cents > 0 then 'partially_paid'
    when summary.booking_payment_status='processing' then 'processing'
    when exists(select 1 from public.reservation_payment_attempts a where a.owner_id=summary.owner_id
      and a.reservation_id=summary.reservation_id and a.purpose='booking_balance' and a.payment_status='failed') then 'failed'
    else summary.booking_payment_status end as finance_payment_status,
  greatest(coalesce(finance.refunded_cents,0),summary.booking_refunded_cents)::bigint as finance_refunded_cents,
  coalesce(finance.reversed_cents,0)::bigint as reversed_cents,
  case when greatest(coalesce(finance.refunded_cents,0),summary.booking_refunded_cents) >= summary.booking_applied_cents and summary.booking_applied_cents > 0 then 'refunded'
    when greatest(coalesce(finance.refunded_cents,0),summary.booking_refunded_cents) > 0 then 'partially_refunded'
    when finance.refund_pending then 'pending'
    when finance.refund_failed then 'failed' else 'none' end as refund_status,
  coalesce(finance.dispute_status,case when summary.booking_payment_status='disputed' then 'disputed' else 'none' end) as dispute_status,
  coalesce(finance.disputed_cents,0)::bigint as disputed_cents,
  coalesce(finance.settlement_status,case when summary.settlement_status='paid_out' then 'available' else summary.settlement_status end) as finance_settlement_status,
  finance.gross_cents, finance.fee_cents, finance.net_cents,
  coalesce(finance.payout_status,case when summary.paid_out_amount_cents>0 then 'paid_out' else 'not_paid_out' end) as payout_status,
  greatest(coalesce(finance.paid_out_cents,0),summary.paid_out_amount_cents)::bigint as historical_paid_out_cents,
  case when exists(select 1 from public.reservation_finance_receipts e where e.owner_id=summary.owner_id and e.outcome='unknown') then 'unknown'
    when finance.gross_cents is null and summary.booking_applied_cents > 0 then 'pending'
    when finance.gross_cents is not null then 'matched' else 'not_applicable' end as reconciliation_status
from public.reservation_financial_summary summary
left join lateral (
  select
    sum(amount_cents) filter (where kind in ('refund','reversal') and status='succeeded') as refunded_cents,
    sum(amount_cents) filter (where kind='reversal' and status='succeeded') as reversed_cents,
    bool_or(status in ('pending','requires_action')) filter (where kind in ('refund','reversal')) as refund_pending,
    bool_or(status in ('failed','canceled')) filter (where kind in ('refund','reversal')) as refund_failed,
    case when bool_or(status='lost') filter (where kind='dispute') then 'lost'
      when bool_or(status in ('needs_response','under_review','warning_needs_response','warning_under_review')) filter (where kind='dispute') then 'disputed'
      when bool_or(status='won') filter (where kind='dispute') then 'won'
      when bool_or(status='warning_closed') filter (where kind='dispute') then 'closed' end as dispute_status,
    sum(amount_cents) filter (where kind='dispute' and status not in ('won','warning_closed')) as disputed_cents,
    case when bool_and(status='available') filter (where kind='settlement') then 'available'
      when count(*) filter (where kind='settlement') > 0 then 'pending' end as settlement_status,
    sum(amount_cents) filter (where kind='settlement')::bigint as gross_cents,
    sum(fee_cents) filter (where kind='settlement')::bigint as fee_cents,
    sum(net_cents) filter (where kind='settlement')::bigint as net_cents,
    case when bool_or(payout_status='failed') then 'failed'
      when bool_or(payout_status='canceled') then 'canceled'
      when bool_and(payout_status='paid') filter (where kind='settlement')
        and count(payout_status)=count(*) filter (where kind='settlement') then 'paid_out'
      when bool_or(payout_status in ('pending','in_transit')) then 'pending' end as payout_status,
    sum(net_cents) filter (where kind='settlement' and payout_status='paid') as paid_out_cents
  from public.reservation_finance_objects o
  where o.owner_id=summary.owner_id and o.reservation_id=summary.reservation_id
) finance on true;
revoke all on public.reservation_finance_summary from public,anon,authenticated,service_role;
grant select on public.reservation_finance_summary to authenticated;

create or replace function public.get_public_reservation_financial_summary(p_booking_slug text,p_access_token text)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare v_original jsonb; v_finance record; v_unknown boolean;
begin
  -- Preserve the existing private credential boundary, including revoked access.
  if nullif(btrim(p_booking_slug),'') is null or nullif(btrim(p_access_token),'') is null then
    raise exception 'Reservation access was not found.';
  end if;
  select f.* into v_finance from public.reservation_finance_summary f
    join public.reservations r on r.owner_id=f.owner_id and r.id=f.reservation_id
    join public.reservation_inventory_settings s on s.owner_id=r.owner_id and s.unit_id=r.unit_id
    where s.public_booking_slug=p_booking_slug and r.guest_access_token=p_access_token
      and r.status in ('confirmed','checked_in');
  if not found then raise exception 'Reservation access was not found.'; end if;
  v_original := jsonb_build_object(
    'lodgingAmountCents',v_finance.lodging_amount_cents,'cleaningFeeCents',v_finance.cleaning_fee_cents,
    'lodgingTaxCents',v_finance.lodging_tax_cents,'bookingBalanceCents',v_finance.booking_balance_cents,
    'securityDepositCents',v_finance.security_deposit_cents,'totalDueCents',v_finance.total_due_cents,
    'currencyCode',v_finance.currency_code,'bookingAppliedCents',v_finance.booking_applied_cents,
    'bookingAmountDueCents',v_finance.booking_amount_due_cents,'bookingPaymentStatus',v_finance.finance_payment_status,
    'securityDepositStatus',v_finance.security_deposit_status,'paymentCollectionEnabled',false
  );
  select exists(select 1 from public.reservation_finance_receipts e
    join public.landlord_payment_accounts a on a.provider_account_id=e.connected_account_id
      and a.provider='stripe' and a.provider_mode='test'
    where a.owner_id=v_finance.owner_id and e.outcome='unknown') into v_unknown;
  return v_original || jsonb_build_object(
    'bookingRefundedCents',v_finance.finance_refunded_cents,'reversedCents',v_finance.reversed_cents,
    'refundStatus',v_finance.refund_status,'disputeStatus',v_finance.dispute_status,
    'disputedCents',v_finance.disputed_cents,'settlementStatus',v_finance.finance_settlement_status,
    'grossCents',v_finance.gross_cents,'feeCents',v_finance.fee_cents,'netCents',v_finance.net_cents,
    'payoutStatus',v_finance.payout_status,'paidOutAmountCents',v_finance.historical_paid_out_cents,
    'reconciliationStatus',case when v_unknown then 'unknown' else v_finance.reconciliation_status end
  );
end
$$;
revoke all on function public.get_public_reservation_financial_summary(text,text) from public,anon,authenticated;
grant execute on function public.get_public_reservation_financial_summary(text,text) to service_role;
