-- Review defect: confirm_owner_reservation's turnover-buffer overlap checks only extended the
-- buffer window after an existing reservation/block's end, never before its start. A new stay
-- ending the instant an existing one began could therefore be confirmed with zero turnover gap.
-- Redefines the function with a symmetric interval-overlap test: a new stay conflicts with an
-- existing reservation/block if either side is within `turnover_buffer_hours` of the other,
-- regardless of which one comes first.
create or replace function confirm_owner_reservation(
  p_owner_id text, p_reservation_id text, p_guest_id text, p_unit_id text,
  p_guest_name text, p_guest_email text, p_guest_phone text,
  p_check_in_date date, p_check_out_date date, p_guest_count integer,
  p_lodging_amount_cents bigint, p_cleaning_fee_cents bigint, p_lodging_tax_cents bigint,
  p_security_deposit_cents bigint, p_total_due_cents bigint, p_currency_code text,
  p_source_reference text, p_owner_notes text
) returns reservations
language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_settings reservation_inventory_settings; v_result reservations; v_buffer_days integer;
begin
  if v_actor is null or not has_workspace_access(p_owner_id) then raise exception 'Workspace access is required.'; end if;
  if p_check_out_date <= p_check_in_date then raise exception 'Check-out must follow check-in.'; end if;
  select * into v_settings from reservation_inventory_settings where owner_id=p_owner_id and unit_id=p_unit_id for update;
  if not found or v_settings.booking_status not in ('draft','active') then raise exception 'Reservable inventory is unavailable.'; end if;
  select * into v_result from reservations where owner_id=p_owner_id and id=p_reservation_id;
  if found then return v_result; end if;
  if p_guest_count < 1 or p_guest_count > v_settings.maximum_guests then raise exception 'Guest count is outside the inventory limit.'; end if;
  if (p_check_out_date-p_check_in_date) < v_settings.minimum_nights or (v_settings.maximum_nights is not null and (p_check_out_date-p_check_in_date) > v_settings.maximum_nights) then raise exception 'Stay length is outside the inventory rules.'; end if;
  if p_total_due_cents <> p_lodging_amount_cents+p_cleaning_fee_cents+p_lodging_tax_cents+p_security_deposit_cents then raise exception 'Reservation quote total is invalid.'; end if;
  v_buffer_days := ceil(v_settings.turnover_buffer_hours / 24.0)::integer;
  if exists(select 1 from reservations where owner_id=p_owner_id and unit_id=p_unit_id and status in('held','confirmed','checked_in') and check_in_date < p_check_out_date + v_buffer_days and check_out_date + v_buffer_days > p_check_in_date) then raise exception 'Reservation dates are no longer available.'; end if;
  if exists(select 1 from reservation_calendar_blocks where owner_id=p_owner_id and unit_id=p_unit_id and start_date < p_check_out_date + v_buffer_days and end_date + v_buffer_days > p_check_in_date) then raise exception 'Reservation dates are blocked.'; end if;
  insert into reservation_guests(owner_id,id,display_name,email,phone,created_by) values(p_owner_id,p_guest_id,btrim(p_guest_name),lower(btrim(p_guest_email)),nullif(btrim(p_guest_phone),''),v_actor)
    on conflict(owner_id,email) do update set display_name=excluded.display_name,phone=coalesce(excluded.phone,reservation_guests.phone),updated_at=now() returning id into p_guest_id;
  insert into reservations(owner_id,id,unit_id,guest_id,status,check_in_date,check_out_date,guest_count,lodging_amount_cents,cleaning_fee_cents,lodging_tax_cents,security_deposit_cents,total_due_cents,currency_code,source_system,source_reference,owner_notes,confirmed_at,created_by)
    values(p_owner_id,p_reservation_id,p_unit_id,p_guest_id,'confirmed',p_check_in_date,p_check_out_date,p_guest_count,p_lodging_amount_cents,p_cleaning_fee_cents,p_lodging_tax_cents,p_security_deposit_cents,p_total_due_cents,upper(p_currency_code),'forge_direct',nullif(btrim(p_source_reference),''),nullif(btrim(p_owner_notes),''),now(),v_actor) returning * into v_result;
  insert into reservation_events(owner_id,id,reservation_id,event_type,event_payload,acting_user_id) values(p_owner_id,'reservation_event_'||gen_random_uuid()::text,p_reservation_id,'confirmed',jsonb_build_object('checkInDate',p_check_in_date,'checkOutDate',p_check_out_date,'totalDueCents',p_total_due_cents),v_actor);
  insert into reservation_calendar_blocks(owner_id,id,unit_id,start_date,end_date,block_type,reason,source_system,source_reference,created_by)
    values(p_owner_id,'reservation_block_'||gen_random_uuid()::text,p_unit_id,p_check_in_date,p_check_out_date,'other','Confirmed FORGE reservation','forge',p_reservation_id,v_actor);
  return v_result;
end $$;

revoke all on function confirm_owner_reservation(text,text,text,text,text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text,text,text) from public;
grant execute on function confirm_owner_reservation(text,text,text,text,text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text,text,text) to authenticated;
