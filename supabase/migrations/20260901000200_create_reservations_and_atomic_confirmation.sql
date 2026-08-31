alter table reservation_inventory_settings
  add column if not exists cleaning_fee_cents bigint not null default 0 check (cleaning_fee_cents >= 0),
  add column if not exists security_deposit_cents bigint not null default 0 check (security_deposit_cents >= 0),
  add column if not exists lodging_tax_basis_points integer not null default 0 check (lodging_tax_basis_points between 0 and 10000);

create table if not exists reservation_guests (
  owner_id text not null,
  id text not null,
  display_name text not null check (btrim(display_name) <> ''),
  email text not null check (btrim(email) <> ''),
  phone text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, email)
);

create table if not exists reservations (
  owner_id text not null,
  id text not null,
  unit_id text not null,
  guest_id text not null,
  status text not null check (status in ('held','confirmed','checked_in','checked_out','cancelled','expired')),
  check_in_date date not null,
  check_out_date date not null,
  guest_count integer not null check (guest_count > 0),
  lodging_amount_cents bigint not null check (lodging_amount_cents >= 0),
  cleaning_fee_cents bigint not null default 0 check (cleaning_fee_cents >= 0),
  lodging_tax_cents bigint not null default 0 check (lodging_tax_cents >= 0),
  security_deposit_cents bigint not null default 0 check (security_deposit_cents >= 0),
  total_due_cents bigint not null check (total_due_cents >= 0),
  currency_code text not null default 'USD' check (currency_code = upper(currency_code) and char_length(currency_code) = 3),
  source_system text not null default 'forge_direct' check (source_system in ('forge_direct','airbnb','vrbo','booking_com','ical','other')),
  source_reference text,
  owner_notes text,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, unit_id) references reservation_inventory_settings(owner_id, unit_id) on delete restrict,
  foreign key (owner_id, guest_id) references reservation_guests(owner_id, id) on delete restrict,
  check (check_out_date > check_in_date),
  check (total_due_cents = lodging_amount_cents + cleaning_fee_cents + lodging_tax_cents + security_deposit_cents),
  unique nulls not distinct (owner_id, source_system, source_reference)
);

create table if not exists reservation_events (
  owner_id text not null,
  id text not null,
  reservation_id text not null,
  event_type text not null check (event_type in ('created','confirmed','checked_in','checked_out','cancelled','expired','note_added')),
  event_payload jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  acting_user_id uuid not null references auth.users(id) on delete restrict,
  primary key (owner_id, id),
  foreign key (owner_id, reservation_id) references reservations(owner_id, id) on delete restrict
);

create index if not exists idx_reservations_owner_unit_dates on reservations(owner_id, unit_id, check_in_date, check_out_date);
create index if not exists idx_reservations_owner_status on reservations(owner_id, status, check_in_date);
create index if not exists idx_reservation_events_owner_reservation on reservation_events(owner_id, reservation_id, occurred_at);

alter table reservation_guests enable row level security; alter table reservation_guests force row level security;
alter table reservations enable row level security; alter table reservations force row level security;
alter table reservation_events enable row level security; alter table reservation_events force row level security;

create policy "reservation_guests_workspace_read" on reservation_guests for select to authenticated using (has_workspace_access(owner_id));
create policy "reservations_workspace_read" on reservations for select to authenticated using (has_workspace_access(owner_id));
create policy "reservation_events_workspace_read" on reservation_events for select to authenticated using (has_workspace_access(owner_id));

grant select on reservation_guests, reservations, reservation_events to authenticated;
revoke insert, update, delete on reservation_calendar_blocks from authenticated;

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
  if exists(select 1 from reservations where owner_id=p_owner_id and unit_id=p_unit_id and status in('held','confirmed','checked_in') and check_in_date < p_check_out_date and check_out_date + v_buffer_days > p_check_in_date) then raise exception 'Reservation dates are no longer available.'; end if;
  if exists(select 1 from reservation_calendar_blocks where owner_id=p_owner_id and unit_id=p_unit_id and start_date < p_check_out_date and end_date + v_buffer_days > p_check_in_date) then raise exception 'Reservation dates are blocked.'; end if;
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

create or replace function prevent_reservation_event_mutation() returns trigger language plpgsql as $$ begin raise exception 'Reservation events are immutable.'; end $$;
create trigger reservation_events_immutable before update or delete on reservation_events for each row execute function prevent_reservation_event_mutation();
