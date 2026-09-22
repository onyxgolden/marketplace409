-- LOGIN SAFETY (slice 1): known_login_locations.
--
-- The "expected locations" baseline for new-location alerting. One row per
-- (user, country, city); NULL country/city is a real row meaning "unknown
-- location" (geo headers absent on that sign-in).
--
-- status lifecycle: 'discovered' (first seen, alert sent) -> 'approved' (the
-- owner clicked "Yes, this was me") or 'denied' (the owner clicked "Wasn't
-- me"). Alert-only slice: status never gates anything.

create table if not exists known_login_locations (
  id uuid not null default gen_random_uuid() primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  country text,
  city text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'discovered' check (status in ('discovered', 'approved', 'denied')),
  approved_at timestamptz,
  unique (user_id, country, city)
);

create index if not exists idx_known_login_locations_user
  on known_login_locations (user_id, last_seen_at desc);

alter table known_login_locations enable row level security;

alter table known_login_locations force row level security;

create policy "known_login_locations_select_own"
on known_login_locations
for select
to authenticated
using (user_id = auth.uid());

create policy "known_login_locations_insert_own"
on known_login_locations
for insert
to authenticated
with check (user_id = auth.uid());

create policy "known_login_locations_update_own"
on known_login_locations
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Atomic upsert for the record-login route: refreshes last_seen_at for a
-- known location, inserts a 'discovered' row for a new one. user_id is bound
-- to auth.uid() inside the function. Returns the row id and whether this
-- (country, city) was seen for the first time.
create or replace function upsert_known_login_location(
  p_country text,
  p_city text
)
returns table (location_id uuid, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_location_id uuid;
  v_is_new boolean := false;
begin
  if v_user_id is null then
    raise exception 'upsert_known_login_location requires an authenticated user';
  end if;

  insert into known_login_locations (user_id, country, city)
  values (v_user_id, p_country, p_city)
  on conflict (user_id, country, city)
  do update set last_seen_at = now()
  returning known_login_locations.id, (xmax = 0) into v_location_id, v_is_new;

  return query select v_location_id, v_is_new;
end;
$$;

revoke all on function upsert_known_login_location(text, text) from public;
grant execute on function upsert_known_login_location(text, text) to authenticated;
