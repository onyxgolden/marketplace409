alter table public.reservation_inventory_settings
  add column if not exists public_booking_slug text,
  add column if not exists public_cancellation_policy text not null default 'Contact the property before arrival to request a cancellation. Any refund or fee decision is handled separately from this reservation.',
  add column if not exists public_arrival_instructions text;

update public.reservation_inventory_settings
set public_booking_slug = 'stay-' || replace(gen_random_uuid()::text, '-', '')
where public_booking_slug is null;

alter table public.reservation_inventory_settings
  alter column public_booking_slug set not null,
  alter column public_booking_slug set default ('stay-' || replace(gen_random_uuid()::text, '-', ''));

create unique index if not exists reservation_inventory_public_booking_slug_key
  on public.reservation_inventory_settings(public_booking_slug);

-- A public guest is not an authenticated staff actor. Preserve that distinction instead of
-- falsely attributing the booking to the workspace owner.
alter table public.reservation_guests alter column created_by drop not null;
alter table public.reservations alter column created_by drop not null;
alter table public.reservation_calendar_blocks alter column created_by drop not null;
alter table public.reservation_events alter column acting_user_id drop not null;
alter table public.reservation_events
  add column if not exists actor_kind text not null default 'workspace_user'
  check (actor_kind in ('workspace_user', 'public_guest', 'system'));

create table if not exists public.reservation_confirmation_outbox (
  owner_id text not null,
  id text not null,
  reservation_id text not null,
  recipient text not null check (btrim(recipient) <> ''),
  subject text not null check (btrim(subject) <> ''),
  body_text text not null check (btrim(body_text) <> ''),
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 5),
  provider_message_id text,
  failure_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (owner_id, id),
  unique (owner_id, reservation_id),
  foreign key (owner_id, reservation_id) references public.reservations(owner_id, id) on delete restrict
);

alter table public.reservation_confirmation_outbox enable row level security;
alter table public.reservation_confirmation_outbox force row level security;
drop policy if exists reservation_confirmation_workspace_read on public.reservation_confirmation_outbox;
create policy reservation_confirmation_workspace_read on public.reservation_confirmation_outbox
  for select to authenticated using (public.has_workspace_access(owner_id));
revoke all on table public.reservation_confirmation_outbox from public, anon, authenticated;
grant select on table public.reservation_confirmation_outbox to authenticated;

create or replace function public.confirm_public_reservation(
  p_booking_slug text, p_reservation_id text, p_guest_id text,
  p_guest_name text, p_guest_email text, p_guest_phone text,
  p_check_in_date date, p_check_out_date date, p_guest_count integer,
  p_lodging_amount_cents bigint, p_cleaning_fee_cents bigint, p_lodging_tax_cents bigint,
  p_security_deposit_cents bigint, p_total_due_cents bigint, p_currency_code text
) returns jsonb
language plpgsql security definer set search_path = public set row_security = off
as $$
declare
  v_settings public.reservation_inventory_settings;
  v_result public.reservations;
  v_buffer_days integer;
  v_guest_id text := p_guest_id;
begin
  select * into v_settings from public.reservation_inventory_settings
  where public_booking_slug = p_booking_slug and booking_status = 'active' for update;
  if not found then raise exception 'Bookable stay was not found.'; end if;
  if p_check_out_date <= p_check_in_date then raise exception 'Check-out must follow check-in.'; end if;

  select * into v_result from public.reservations
  where owner_id = v_settings.owner_id and id = p_reservation_id;
  if found then
    return jsonb_build_object('id',v_result.id,'status',v_result.status,'publicName',v_settings.public_name,
      'checkIn',v_result.check_in_date,'checkOut',v_result.check_out_date,'totalDueCents',v_result.total_due_cents,
      'currencyCode',v_result.currency_code,'arrivalInstructions',v_settings.public_arrival_instructions);
  end if;

  if p_guest_count < 1 or p_guest_count > v_settings.maximum_guests then raise exception 'Guest count is outside the inventory limit.'; end if;
  if (p_check_out_date-p_check_in_date) < v_settings.minimum_nights
     or (v_settings.maximum_nights is not null and (p_check_out_date-p_check_in_date) > v_settings.maximum_nights)
  then raise exception 'Stay length is outside the inventory rules.'; end if;
  if p_total_due_cents <> p_lodging_amount_cents+p_cleaning_fee_cents+p_lodging_tax_cents+p_security_deposit_cents
  then raise exception 'Reservation quote total is invalid.'; end if;

  v_buffer_days := ceil(v_settings.turnover_buffer_hours / 24.0)::integer;
  if exists(select 1 from public.reservations where owner_id=v_settings.owner_id and unit_id=v_settings.unit_id
    and status in('held','confirmed','checked_in') and check_in_date < p_check_out_date and check_out_date + v_buffer_days > p_check_in_date)
  then raise exception 'Reservation dates are no longer available.'; end if;
  if exists(select 1 from public.reservation_calendar_blocks where owner_id=v_settings.owner_id and unit_id=v_settings.unit_id
    and start_date < p_check_out_date and end_date + v_buffer_days > p_check_in_date)
  then raise exception 'Reservation dates are blocked.'; end if;

  insert into public.reservation_guests(owner_id,id,display_name,email,phone,created_by)
  values(v_settings.owner_id,v_guest_id,btrim(p_guest_name),lower(btrim(p_guest_email)),nullif(btrim(p_guest_phone),''),null)
  on conflict(owner_id,email) do update set display_name=excluded.display_name,
    phone=coalesce(excluded.phone,public.reservation_guests.phone),updated_at=now()
  returning id into v_guest_id;

  insert into public.reservations(owner_id,id,unit_id,guest_id,status,check_in_date,check_out_date,guest_count,
    lodging_amount_cents,cleaning_fee_cents,lodging_tax_cents,security_deposit_cents,total_due_cents,currency_code,
    source_system,source_reference,confirmed_at,created_by)
  values(v_settings.owner_id,p_reservation_id,v_settings.unit_id,v_guest_id,'confirmed',p_check_in_date,p_check_out_date,p_guest_count,
    p_lodging_amount_cents,p_cleaning_fee_cents,p_lodging_tax_cents,p_security_deposit_cents,p_total_due_cents,upper(p_currency_code),
    'forge_direct',p_reservation_id,now(),null) returning * into v_result;

  insert into public.reservation_events(owner_id,id,reservation_id,event_type,event_payload,acting_user_id,actor_kind)
  values(v_settings.owner_id,'reservation_event_'||gen_random_uuid()::text,p_reservation_id,'confirmed',
    jsonb_build_object('checkInDate',p_check_in_date,'checkOutDate',p_check_out_date,'totalDueCents',p_total_due_cents,'source','public_booking'),null,'public_guest');
  insert into public.reservation_calendar_blocks(owner_id,id,unit_id,start_date,end_date,block_type,reason,source_system,source_reference,created_by)
  values(v_settings.owner_id,'reservation_block_'||gen_random_uuid()::text,v_settings.unit_id,p_check_in_date,p_check_out_date,
    'other','Confirmed FORGE reservation','forge',p_reservation_id,null);
  insert into public.reservation_confirmation_outbox(owner_id,id,reservation_id,recipient,subject,body_text)
  values(v_settings.owner_id,'reservation_confirmation_'||p_reservation_id,p_reservation_id,lower(btrim(p_guest_email)),
    'Reservation confirmed: '||v_settings.public_name,
    'Your reservation at '||v_settings.public_name||' is confirmed for '||p_check_in_date||' through '||p_check_out_date||'. Total due: $'||to_char(p_total_due_cents/100.0,'FM999999990.00')||'. No payment was collected during booking.'||case when v_settings.public_arrival_instructions is null then '' else ' Arrival instructions: '||v_settings.public_arrival_instructions end)
  on conflict(owner_id,reservation_id) do nothing;

  return jsonb_build_object('id',v_result.id,'status',v_result.status,'publicName',v_settings.public_name,
    'checkIn',v_result.check_in_date,'checkOut',v_result.check_out_date,'totalDueCents',v_result.total_due_cents,
    'currencyCode',v_result.currency_code,'arrivalInstructions',v_settings.public_arrival_instructions);
end $$;

revoke all on function public.confirm_public_reservation(text,text,text,text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text) from public, anon, authenticated;
grant execute on function public.confirm_public_reservation(text,text,text,text,text,text,date,date,integer,bigint,bigint,bigint,bigint,bigint,text) to service_role;

create or replace function public.claim_reservation_confirmation() returns public.reservation_confirmation_outbox
language plpgsql security definer set search_path = public set row_security = off as $$
declare v_result public.reservation_confirmation_outbox;
begin
  select * into v_result from public.reservation_confirmation_outbox
  where status in ('queued','failed') and attempt_count < 5 order by created_at for update skip locked limit 1;
  if v_result.id is not null then
    update public.reservation_confirmation_outbox set status='sending',attempt_count=attempt_count+1,failure_message=null
    where owner_id=v_result.owner_id and id=v_result.id returning * into v_result;
  end if;
  return v_result;
end $$;

create or replace function public.complete_reservation_confirmation(p_owner_id text,p_id text,p_succeeded boolean,p_provider_message_id text,p_failure_message text) returns void
language plpgsql security definer set search_path = public set row_security = off as $$
begin
  update public.reservation_confirmation_outbox set status=case when p_succeeded then 'sent' else 'failed' end,
    provider_message_id=case when p_succeeded then p_provider_message_id else null end,
    failure_message=case when p_succeeded then null else left(coalesce(p_failure_message,'Delivery failed.'),500) end,
    sent_at=case when p_succeeded then now() else null end
  where owner_id=p_owner_id and id=p_id and status='sending';
end $$;

revoke all on function public.claim_reservation_confirmation() from public, anon, authenticated;
revoke all on function public.complete_reservation_confirmation(text,text,boolean,text,text) from public, anon, authenticated;
grant execute on function public.claim_reservation_confirmation() to service_role;
grant execute on function public.complete_reservation_confirmation(text,text,boolean,text,text) to service_role;
