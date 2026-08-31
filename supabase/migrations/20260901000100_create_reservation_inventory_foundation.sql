-- Reservation inventory extends Rental Manager units without changing long-term lease behavior.
-- A rental_unit remains the physical record; these optional rows describe units offered by date range.

create table if not exists reservation_inventory_settings (
  owner_id text not null,
  unit_id text not null,
  inventory_type text not null check (inventory_type in (
    'rv_site','cabin','furnished_home','vacation_unit','glamping_site','tent_site',
    'parking_space','storage_space','other'
  )),
  booking_status text not null default 'draft' check (booking_status in ('draft','active','paused','inactive')),
  public_name text not null check (btrim(public_name) <> ''),
  public_description text,
  timezone text not null default 'America/Chicago' check (btrim(timezone) <> ''),
  maximum_guests integer not null default 1 check (maximum_guests > 0),
  minimum_nights integer not null default 1 check (minimum_nights > 0),
  maximum_nights integer check (maximum_nights is null or maximum_nights >= minimum_nights),
  turnover_buffer_hours integer not null default 0 check (turnover_buffer_hours between 0 and 168),
  check_in_time time not null default '15:00',
  check_out_time time not null default '11:00',
  amenities text[] not null default '{}',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (owner_id, unit_id),
  foreign key (owner_id, unit_id) references rental_units(owner_id, id) on delete restrict,
  check (check_out_time <> check_in_time)
);

create table if not exists reservation_rate_plans (
  owner_id text not null,
  id text not null,
  unit_id text not null,
  label text not null check (btrim(label) <> ''),
  cadence text not null check (cadence in ('nightly','weekly','monthly')),
  amount_cents bigint not null check (amount_cents > 0),
  currency_code text not null default 'USD' check (currency_code = upper(currency_code) and char_length(currency_code) = 3),
  effective_start_date date not null,
  effective_end_date date,
  day_of_week smallint check (day_of_week is null or day_of_week between 0 and 6),
  minimum_nights_override integer check (minimum_nights_override is null or minimum_nights_override > 0),
  status text not null default 'active' check (status in ('active','inactive')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, unit_id) references reservation_inventory_settings(owner_id, unit_id) on delete cascade,
  check (effective_end_date is null or effective_end_date >= effective_start_date)
);

create table if not exists reservation_calendar_blocks (
  owner_id text not null,
  id text not null,
  unit_id text not null,
  start_date date not null,
  end_date date not null,
  block_type text not null check (block_type in ('owner_hold','maintenance','turnover','external_booking','other')),
  reason text,
  source_system text not null default 'forge' check (source_system in ('forge','ical','airbnb','vrbo','booking_com','other')),
  source_reference text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, unit_id) references reservation_inventory_settings(owner_id, unit_id) on delete cascade,
  check (end_date > start_date),
  unique nulls not distinct (owner_id, unit_id, source_system, source_reference)
);

create index if not exists idx_reservation_inventory_owner_status
  on reservation_inventory_settings(owner_id, booking_status, inventory_type);
create index if not exists idx_reservation_rates_owner_unit_dates
  on reservation_rate_plans(owner_id, unit_id, effective_start_date, effective_end_date);
create index if not exists idx_reservation_blocks_owner_unit_dates
  on reservation_calendar_blocks(owner_id, unit_id, start_date, end_date);

alter table reservation_inventory_settings enable row level security;
alter table reservation_inventory_settings force row level security;
alter table reservation_rate_plans enable row level security;
alter table reservation_rate_plans force row level security;
alter table reservation_calendar_blocks enable row level security;
alter table reservation_calendar_blocks force row level security;

create policy "reservation_inventory_workspace_all" on reservation_inventory_settings
  for all to authenticated using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
create policy "reservation_rates_workspace_all" on reservation_rate_plans
  for all to authenticated using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
create policy "reservation_blocks_workspace_all" on reservation_calendar_blocks
  for all to authenticated using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

grant select, insert, update on reservation_inventory_settings to authenticated;
grant select, insert, update on reservation_rate_plans to authenticated;
grant select, insert, update, delete on reservation_calendar_blocks to authenticated;

-- Guests and the public receive no table grants. A later reservation phase will expose only a
-- deliberately shaped availability RPC/API and will never grant anonymous access to owner records.
