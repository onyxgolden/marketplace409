alter table public.reservation_events
  drop constraint if exists reservation_events_event_type_check;

alter table public.reservation_events
  add constraint reservation_events_event_type_check
  check (event_type in ('created','confirmed','modified','checked_in','checked_out','cancelled','expired','note_added'));

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

create or replace function public.transition_owner_reservation(
  p_owner_id text,
  p_reservation_id text,
  p_action text,
  p_reason text default null
) returns public.reservations
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_current public.reservations;
  v_target text;
  v_result public.reservations;
begin
  if v_actor is null or not public.has_workspace_access(p_owner_id) then
    raise exception 'Workspace access is required.';
  end if;
  if p_action not in ('cancel','check_in','check_out') then
    raise exception 'Reservation action is invalid.';
  end if;

  select * into v_current from public.reservations
  where owner_id = p_owner_id and id = p_reservation_id for update;
  if not found then raise exception 'Reservation was not found.'; end if;

  v_target := case p_action when 'cancel' then 'cancelled' when 'check_in' then 'checked_in' else 'checked_out' end;
  if v_current.status = v_target then return v_current; end if;
  if (p_action = 'cancel' and v_current.status not in ('held','confirmed'))
     or (p_action = 'check_in' and v_current.status <> 'confirmed')
     or (p_action = 'check_out' and v_current.status <> 'checked_in') then
    raise exception 'Reservation cannot transition from % using %.', v_current.status, p_action;
  end if;

  update public.reservations set
    status = v_target,
    cancelled_at = case when v_target = 'cancelled' then now() else cancelled_at end,
    updated_at = now()
  where owner_id = p_owner_id and id = p_reservation_id
  returning * into v_result;

  if v_target in ('cancelled','checked_out') then
    delete from public.reservation_calendar_blocks
    where owner_id = p_owner_id and source_system = 'forge' and source_reference = p_reservation_id;
  end if;

  insert into public.reservation_events(owner_id,id,reservation_id,event_type,event_payload,acting_user_id)
  values (p_owner_id, 'reservation_event_' || gen_random_uuid()::text, p_reservation_id, v_target,
    jsonb_build_object('previousStatus',v_current.status,'reason',nullif(btrim(p_reason),'')), v_actor);
  return v_result;
end $$;

revoke all on function public.modify_owner_reservation(text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text,text) from public, anon, service_role;
grant execute on function public.modify_owner_reservation(text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text,text) to authenticated;
revoke all on function public.transition_owner_reservation(text,text,text,text) from public, anon, service_role;
grant execute on function public.transition_owner_reservation(text,text,text,text) to authenticated;
