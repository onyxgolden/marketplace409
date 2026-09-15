-- Forward-fix for a live production defect in modify_owner_reservation, originally introduced by
-- 20260913010000_add_reservation_lifecycle.sql and already applied to production under that
-- version. That migration file was corrected in place on `main` (PR #183) before its own fix could
-- reach production, because Supabase tracks applied migrations by version number: once
-- 20260913010000 was recorded as applied, editing its on-disk content had no effect on the already-
-- live function. This migration re-applies the exact same, already-tested fix as a new version so
-- it actually reaches production. No data is modified; this is a function-definition change only.
--
-- The defect: every reservation gets an immutable financial-contract snapshot immediately on
-- insert (20260913040000_add_reservation_financial_contract.sql), and
-- prevent_reservation_financial_snapshot_rewrite blocks any UPDATE that changes the reservation's
-- price/currency columns once that snapshot exists. modify_owner_reservation's own signature still
-- accepted those columns as freely-editable parameters and attempted the UPDATE unconditionally,
-- so any real call that recomputed a new price (the normal case -- the app's own modification flow
-- always recomputes price alongside date/guest-count changes) hit that trigger's own low-level
-- error instead of an honest, actionable one from the RPC itself.
--
-- The fix: detect an attempted price/currency change explicitly, before any other validation, and
-- reject it with a clear message. Non-financial fields (dates, guest count, unit, notes) remain
-- freely modifiable exactly as before. transition_owner_reservation is unaffected by this defect
-- and is not touched here.

create or replace function public.modify_owner_reservation(
  p_owner_id text,
  p_reservation_id text,
  p_unit_id text,
  p_check_in_date date,
  p_check_out_date date,
  p_guest_count integer,
  p_lodging_amount_cents bigint,
  p_cleaning_fee_cents bigint,
  p_lodging_tax_cents bigint,
  p_security_deposit_cents bigint,
  p_total_due_cents bigint,
  p_currency_code text,
  p_owner_notes text
) returns public.reservations
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_current public.reservations;
  v_settings public.reservation_inventory_settings;
  v_result public.reservations;
  v_buffer_days integer;
begin
  if v_actor is null or not public.has_workspace_access(p_owner_id) then
    raise exception 'Workspace access is required.';
  end if;

  select * into v_current
  from public.reservations
  where owner_id = p_owner_id and id = p_reservation_id
  for update;

  if not found then raise exception 'Reservation was not found.'; end if;
  if v_current.status <> 'confirmed' then
    raise exception 'Only a confirmed reservation can be modified.';
  end if;
  if p_check_out_date <= p_check_in_date then
    raise exception 'Check-out must follow check-in.';
  end if;
  -- Once a reservation has a financial-contract snapshot (every reservation gets one immediately on
  -- insert, per 20260913040000_add_reservation_financial_contract.sql), that snapshot is deliberately
  -- immutable -- prevent_reservation_financial_snapshot_rewrite blocks any UPDATE that changes these
  -- exact columns. Detect an attempted price change explicitly and reject it here, honestly and early,
  -- instead of letting the caller hit that trigger's own lower-level error deep inside this function's
  -- own UPDATE. Non-financial fields (dates, guest count, unit, notes) remain freely modifiable below.
  if p_lodging_amount_cents <> v_current.lodging_amount_cents
     or p_cleaning_fee_cents <> v_current.cleaning_fee_cents
     or p_lodging_tax_cents <> v_current.lodging_tax_cents
     or p_security_deposit_cents <> v_current.security_deposit_cents
     or p_total_due_cents <> v_current.total_due_cents
     or upper(p_currency_code) <> v_current.currency_code then
    raise exception 'Reservation pricing is immutable once a financial contract exists; modify_owner_reservation cannot change price. Pass the reservation''s existing amounts unchanged.';
  end if;

  select * into v_settings
  from public.reservation_inventory_settings
  where owner_id = p_owner_id and unit_id = p_unit_id
  for update;

  if not found or v_settings.booking_status not in ('draft','active') then
    raise exception 'Reservable inventory is unavailable.';
  end if;
  if p_guest_count < 1 or p_guest_count > v_settings.maximum_guests then
    raise exception 'Guest count is outside the inventory limit.';
  end if;
  if (p_check_out_date - p_check_in_date) < v_settings.minimum_nights
     or (v_settings.maximum_nights is not null and (p_check_out_date - p_check_in_date) > v_settings.maximum_nights) then
    raise exception 'Stay length is outside the inventory rules.';
  end if;
  if p_total_due_cents <> p_lodging_amount_cents + p_cleaning_fee_cents + p_lodging_tax_cents + p_security_deposit_cents then
    raise exception 'Reservation quote total is invalid.';
  end if;

  v_buffer_days := ceil(v_settings.turnover_buffer_hours / 24.0)::integer;
  if exists (
    select 1 from public.reservations
    where owner_id = p_owner_id and unit_id = p_unit_id
      and id <> p_reservation_id
      and status in ('held','confirmed','checked_in')
      and check_in_date < p_check_out_date
      and check_out_date + v_buffer_days > p_check_in_date
  ) then raise exception 'Reservation dates are no longer available.'; end if;
  if exists (
    select 1 from public.reservation_calendar_blocks
    where owner_id = p_owner_id and unit_id = p_unit_id
      and not (source_system = 'forge' and source_reference = p_reservation_id)
      and start_date < p_check_out_date
      and end_date + v_buffer_days > p_check_in_date
  ) then raise exception 'Reservation dates are blocked.'; end if;

  update public.reservations set
    unit_id = p_unit_id,
    check_in_date = p_check_in_date,
    check_out_date = p_check_out_date,
    guest_count = p_guest_count,
    lodging_amount_cents = p_lodging_amount_cents,
    cleaning_fee_cents = p_cleaning_fee_cents,
    lodging_tax_cents = p_lodging_tax_cents,
    security_deposit_cents = p_security_deposit_cents,
    total_due_cents = p_total_due_cents,
    currency_code = upper(p_currency_code),
    owner_notes = nullif(btrim(p_owner_notes), ''),
    updated_at = now()
  where owner_id = p_owner_id and id = p_reservation_id
  returning * into v_result;

  update public.reservation_calendar_blocks set
    unit_id = p_unit_id,
    start_date = p_check_in_date,
    end_date = p_check_out_date
  where owner_id = p_owner_id
    and source_system = 'forge'
    and source_reference = p_reservation_id;

  if not found then raise exception 'Reservation calendar block was not found.'; end if;

  insert into public.reservation_events(owner_id,id,reservation_id,event_type,event_payload,acting_user_id)
  values (p_owner_id, 'reservation_event_' || gen_random_uuid()::text, p_reservation_id, 'modified',
    jsonb_build_object(
      'before', jsonb_build_object('unitId',v_current.unit_id,'checkInDate',v_current.check_in_date,'checkOutDate',v_current.check_out_date,'guestCount',v_current.guest_count,'totalDueCents',v_current.total_due_cents),
      'after', jsonb_build_object('unitId',p_unit_id,'checkInDate',p_check_in_date,'checkOutDate',p_check_out_date,'guestCount',p_guest_count,'totalDueCents',p_total_due_cents)
    ), v_actor);

  return v_result;
end $$;

-- create or replace function never resets previously-granted privileges, but restated idempotently
-- here anyway so this migration is a complete, self-contained statement of its own effect.
revoke all on function public.modify_owner_reservation(text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text,text) from public, anon, service_role;
grant execute on function public.modify_owner_reservation(text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text,text) to authenticated;
