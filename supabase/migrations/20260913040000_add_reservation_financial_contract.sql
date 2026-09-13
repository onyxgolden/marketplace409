-- RV-E2A: reservation-native financial contract foundation.
-- This migration records no payment and makes no provider call.
-- Settlement persistence remains deferred until RV-E2B/RV-E2D has a real caller.

create table if not exists public.reservation_financial_contracts (
  owner_id text not null,
  reservation_id text not null,
  guest_id text not null,
  lodging_amount_cents bigint not null check (lodging_amount_cents >= 0),
  cleaning_fee_cents bigint not null check (cleaning_fee_cents >= 0),
  lodging_tax_cents bigint not null check (lodging_tax_cents >= 0),
  booking_balance_cents bigint not null check (booking_balance_cents >= 0),
  security_deposit_cents bigint not null check (security_deposit_cents >= 0),
  total_due_cents bigint not null check (total_due_cents >= 0),
  currency_code text not null check (currency_code = upper(currency_code) and char_length(currency_code) = 3),
  created_at timestamptz not null default now(),
  primary key (owner_id, reservation_id),
  foreign key (owner_id, reservation_id) references public.reservations(owner_id, id) on delete restrict,
  foreign key (owner_id, guest_id) references public.reservation_guests(owner_id, id) on delete restrict,
  check (booking_balance_cents = lodging_amount_cents + cleaning_fee_cents + lodging_tax_cents),
  check (total_due_cents = booking_balance_cents + security_deposit_cents)
);

create table if not exists public.reservation_payment_attempts (
  owner_id text not null,
  id text not null,
  reservation_id text not null,
  guest_id text,
  purpose text not null check (purpose in ('booking_balance','security_deposit')),
  provider text not null,
  provider_mode text not null check (provider_mode in ('test','live')),
  provider_reference text,
  idempotency_key text not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency_code text not null check (currency_code = upper(currency_code) and char_length(currency_code) = 3),
  payment_status text not null default 'created'
    check (payment_status in ('created','pending','processing','succeeded','failed','cancelled','partially_refunded','refunded','disputed')),
  applied_amount_cents bigint not null default 0 check (applied_amount_cents >= 0),
  refunded_amount_cents bigint not null default 0 check (refunded_amount_cents >= 0),
  disputed_amount_cents bigint not null default 0 check (disputed_amount_cents >= 0),
  settlement_status text not null default 'not_applicable'
    check (settlement_status in ('not_applicable','pending','available','paid_out')),
  settled_amount_cents bigint not null default 0 check (settled_amount_cents >= 0),
  paid_out_amount_cents bigint not null default 0 check (paid_out_amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, idempotency_key),
  foreign key (owner_id, reservation_id) references public.reservation_financial_contracts(owner_id, reservation_id) on delete restrict,
  foreign key (owner_id, guest_id) references public.reservation_guests(owner_id, id) on delete restrict,
  check (applied_amount_cents <= amount_cents),
  check (refunded_amount_cents <= applied_amount_cents),
  check (disputed_amount_cents <= applied_amount_cents),
  check (settled_amount_cents <= applied_amount_cents - refunded_amount_cents),
  check (paid_out_amount_cents <= settled_amount_cents)
);

create table if not exists public.reservation_payment_events (
  owner_id text not null,
  id text not null,
  reservation_id text not null,
  payment_attempt_id text not null,
  event_type text not null check (btrim(event_type) <> ''),
  provider_event_id text,
  from_status text,
  to_status text,
  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  event_payload jsonb not null default '{}',
  actor_kind text not null default 'system' check (actor_kind in ('workspace_user','public_guest','system')),
  acting_user_id uuid references auth.users(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique nulls not distinct (owner_id, provider_event_id),
  foreign key (owner_id, reservation_id) references public.reservation_financial_contracts(owner_id, reservation_id) on delete restrict,
  foreign key (owner_id, payment_attempt_id) references public.reservation_payment_attempts(owner_id, id) on delete restrict,
  check ((actor_kind = 'workspace_user' and acting_user_id is not null) or actor_kind <> 'workspace_user')
);

create index if not exists reservation_payment_attempts_reservation_idx
  on public.reservation_payment_attempts(owner_id, reservation_id, created_at);
create unique index if not exists reservation_payment_attempt_provider_reference_key
  on public.reservation_payment_attempts(owner_id, provider, provider_mode, provider_reference)
  where provider_reference is not null;
create index if not exists reservation_payment_events_attempt_idx
  on public.reservation_payment_events(owner_id, payment_attempt_id, occurred_at);

alter table public.reservation_financial_contracts enable row level security;
alter table public.reservation_financial_contracts force row level security;
alter table public.reservation_payment_attempts enable row level security;
alter table public.reservation_payment_attempts force row level security;
alter table public.reservation_payment_events enable row level security;
alter table public.reservation_payment_events force row level security;

drop policy if exists reservation_financial_contract_workspace_read on public.reservation_financial_contracts;
create policy reservation_financial_contract_workspace_read
  on public.reservation_financial_contracts for select to authenticated
  using (public.has_workspace_access(owner_id));

drop policy if exists reservation_payment_attempt_workspace_read on public.reservation_payment_attempts;
create policy reservation_payment_attempt_workspace_read
  on public.reservation_payment_attempts for select to authenticated
  using (public.has_workspace_access(owner_id));

drop policy if exists reservation_payment_event_workspace_read on public.reservation_payment_events;
create policy reservation_payment_event_workspace_read
  on public.reservation_payment_events for select to authenticated
  using (public.has_workspace_access(owner_id));

revoke all on table public.reservation_financial_contracts from public, anon, authenticated, service_role;
revoke all on table public.reservation_payment_attempts from public, anon, authenticated, service_role;
revoke all on table public.reservation_payment_events from public, anon, authenticated, service_role;
grant select on table public.reservation_financial_contracts to authenticated;
grant select on table public.reservation_payment_attempts to authenticated;
grant select on table public.reservation_payment_events to authenticated;

create or replace function public.initialize_reservation_financial_contract()
returns trigger
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  insert into public.reservation_financial_contracts (
    owner_id, reservation_id, guest_id,
    lodging_amount_cents, cleaning_fee_cents, lodging_tax_cents,
    booking_balance_cents, security_deposit_cents, total_due_cents, currency_code
  ) values (
    new.owner_id, new.id, new.guest_id,
    new.lodging_amount_cents, new.cleaning_fee_cents, new.lodging_tax_cents,
    new.lodging_amount_cents + new.cleaning_fee_cents + new.lodging_tax_cents,
    new.security_deposit_cents, new.total_due_cents, new.currency_code
  )
  on conflict (owner_id, reservation_id) do nothing;
  return new;
end
$$;

drop trigger if exists initialize_reservation_financial_contract on public.reservations;
create trigger initialize_reservation_financial_contract
  after insert on public.reservations
  for each row execute function public.initialize_reservation_financial_contract();

insert into public.reservation_financial_contracts (
  owner_id, reservation_id, guest_id,
  lodging_amount_cents, cleaning_fee_cents, lodging_tax_cents,
  booking_balance_cents, security_deposit_cents, total_due_cents, currency_code
)
select
  owner_id, id, guest_id,
  lodging_amount_cents, cleaning_fee_cents, lodging_tax_cents,
  lodging_amount_cents + cleaning_fee_cents + lodging_tax_cents,
  security_deposit_cents, total_due_cents, currency_code
from public.reservations
on conflict (owner_id, reservation_id) do nothing;

create or replace function public.prevent_reservation_financial_snapshot_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from public.reservation_financial_contracts contract
    where contract.owner_id = old.owner_id
      and contract.reservation_id = old.id
  ) and (
    new.owner_id is distinct from old.owner_id
    or new.id is distinct from old.id
    or new.guest_id is distinct from old.guest_id
    or new.lodging_amount_cents is distinct from old.lodging_amount_cents
    or new.cleaning_fee_cents is distinct from old.cleaning_fee_cents
    or new.lodging_tax_cents is distinct from old.lodging_tax_cents
    or new.security_deposit_cents is distinct from old.security_deposit_cents
    or new.total_due_cents is distinct from old.total_due_cents
    or new.currency_code is distinct from old.currency_code
  ) then
    raise exception 'Reservation financial snapshot is immutable; use an explicit financial adjustment.';
  end if;
  return new;
end
$$;

drop trigger if exists prevent_reservation_financial_snapshot_rewrite on public.reservations;
create trigger prevent_reservation_financial_snapshot_rewrite
  before update on public.reservations
  for each row execute function public.prevent_reservation_financial_snapshot_rewrite();

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
     or new.provider_reference is distinct from old.provider_reference
     or new.idempotency_key is distinct from old.idempotency_key
     or new.amount_cents is distinct from old.amount_cents
     or new.currency_code is distinct from old.currency_code then
    raise exception 'Reservation payment identity is immutable.';
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

drop trigger if exists enforce_reservation_payment_state_transition on public.reservation_payment_attempts;
create trigger enforce_reservation_payment_state_transition
  before update on public.reservation_payment_attempts
  for each row execute function public.enforce_reservation_payment_state_transition();

create or replace function public.prevent_reservation_payment_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Reservation payment events are immutable.';
end
$$;

drop trigger if exists reservation_payment_events_immutable on public.reservation_payment_events;
create trigger reservation_payment_events_immutable
  before update or delete on public.reservation_payment_events
  for each row execute function public.prevent_reservation_payment_event_mutation();

create or replace view public.reservation_financial_summary
with (security_invoker = true)
as
select
  contract.owner_id,
  contract.reservation_id,
  contract.guest_id,
  contract.lodging_amount_cents,
  contract.cleaning_fee_cents,
  contract.lodging_tax_cents,
  contract.booking_balance_cents,
  contract.security_deposit_cents,
  contract.total_due_cents,
  contract.currency_code,
  coalesce(sum(attempt.applied_amount_cents) filter (where attempt.purpose = 'booking_balance'), 0)::bigint as booking_applied_cents,
  coalesce(sum(attempt.refunded_amount_cents) filter (where attempt.purpose = 'booking_balance'), 0)::bigint as booking_refunded_cents,
  greatest(contract.booking_balance_cents - coalesce(sum(attempt.applied_amount_cents - attempt.refunded_amount_cents) filter (where attempt.purpose = 'booking_balance'), 0), 0)::bigint as booking_amount_due_cents,
  case
    when coalesce(sum(attempt.disputed_amount_cents) filter (where attempt.purpose = 'booking_balance'), 0) > 0 then 'disputed'
    when coalesce(sum(attempt.refunded_amount_cents) filter (where attempt.purpose = 'booking_balance'), 0) >= contract.booking_balance_cents
      and contract.booking_balance_cents > 0 then 'refunded'
    when coalesce(sum(attempt.refunded_amount_cents) filter (where attempt.purpose = 'booking_balance'), 0) > 0 then 'partially_refunded'
    when coalesce(sum(attempt.applied_amount_cents) filter (where attempt.purpose = 'booking_balance'), 0) >= contract.booking_balance_cents then 'paid'
    when bool_or(attempt.payment_status in ('pending','processing')) filter (where attempt.purpose = 'booking_balance') then 'processing'
    else 'unpaid'
  end as booking_payment_status,
  case
    when contract.security_deposit_cents = 0 then 'not_required'
    when bool_or(attempt.payment_status = 'disputed') filter (where attempt.purpose = 'security_deposit') then 'disputed'
    when bool_or(attempt.payment_status = 'refunded') filter (where attempt.purpose = 'security_deposit') then 'refunded'
    when bool_or(attempt.payment_status in ('pending','processing')) filter (where attempt.purpose = 'security_deposit') then 'processing'
    else 'required'
  end as security_deposit_status,
  case
    when bool_or(attempt.settlement_status = 'paid_out') then 'paid_out'
    when bool_or(attempt.settlement_status = 'available') then 'available'
    when bool_or(attempt.settlement_status = 'pending') then 'pending'
    else 'not_applicable'
  end as settlement_status,
  coalesce(sum(attempt.paid_out_amount_cents), 0)::bigint as paid_out_amount_cents
from public.reservation_financial_contracts contract
left join public.reservation_payment_attempts attempt
  on attempt.owner_id = contract.owner_id
 and attempt.reservation_id = contract.reservation_id
group by contract.owner_id, contract.reservation_id, contract.guest_id,
  contract.lodging_amount_cents, contract.cleaning_fee_cents,
  contract.lodging_tax_cents, contract.booking_balance_cents,
  contract.security_deposit_cents, contract.total_due_cents, contract.currency_code;

revoke all on public.reservation_financial_summary from public, anon, authenticated, service_role;
grant select on public.reservation_financial_summary to authenticated;

create or replace function public.get_public_reservation_financial_summary(
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
  v_summary record;
begin
  if nullif(btrim(p_booking_slug), '') is null or nullif(btrim(p_access_token), '') is null then
    raise exception 'Reservation access was not found.';
  end if;

  select reservation.* into v_reservation
  from public.reservations reservation
  join public.reservation_inventory_settings settings
    on settings.owner_id = reservation.owner_id and settings.unit_id = reservation.unit_id
  where settings.public_booking_slug = p_booking_slug
    and reservation.guest_access_token = p_access_token
    and reservation.status in ('confirmed','checked_in');

  if not found then raise exception 'Reservation access was not found.'; end if;

  select * into strict v_summary
  from public.reservation_financial_summary
  where owner_id = v_reservation.owner_id and reservation_id = v_reservation.id;

  return jsonb_build_object(
    'lodgingAmountCents', v_summary.lodging_amount_cents,
    'cleaningFeeCents', v_summary.cleaning_fee_cents,
    'lodgingTaxCents', v_summary.lodging_tax_cents,
    'bookingBalanceCents', v_summary.booking_balance_cents,
    'securityDepositCents', v_summary.security_deposit_cents,
    'totalDueCents', v_summary.total_due_cents,
    'currencyCode', v_summary.currency_code,
    'bookingAppliedCents', v_summary.booking_applied_cents,
    'bookingRefundedCents', v_summary.booking_refunded_cents,
    'bookingAmountDueCents', v_summary.booking_amount_due_cents,
    'bookingPaymentStatus', v_summary.booking_payment_status,
    'securityDepositStatus', v_summary.security_deposit_status,
    'settlementStatus', v_summary.settlement_status,
    'paidOutAmountCents', v_summary.paid_out_amount_cents,
    'paymentCollectionEnabled', false
  );
end
$$;

revoke all on function public.initialize_reservation_financial_contract() from public, anon, authenticated, service_role;
revoke all on function public.prevent_reservation_financial_snapshot_rewrite() from public, anon, authenticated, service_role;
revoke all on function public.enforce_reservation_payment_state_transition() from public, anon, authenticated, service_role;
revoke all on function public.prevent_reservation_payment_event_mutation() from public, anon, authenticated, service_role;
revoke all on function public.get_public_reservation_financial_summary(text, text) from public, anon, authenticated;
grant execute on function public.get_public_reservation_financial_summary(text, text) to service_role;
