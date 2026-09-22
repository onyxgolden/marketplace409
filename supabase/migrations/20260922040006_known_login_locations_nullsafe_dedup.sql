-- LOGIN SAFETY (slice 1 fix): NULL-safe dedup for known_login_locations.
--
-- The original migration declared unique (user_id, country, city). Under
-- Postgres null semantics, NULLs are never equal, so the plain unique
-- constraint -- and the ON CONFLICT (user_id, country, city) arbiter in
-- upsert_known_login_location -- could never match an "unknown location"
-- row (NULL country/city). Every sign-in without geo headers inserted a new
-- baseline row, reported is_new = true, and fired a duplicate alert.
--
-- Fix: replace the plain constraint with a NULL-safe expression unique
-- index (NULL country/city coalesce to '') and point the upsert's ON
-- CONFLICT arbiter at the same expressions so it infers the index.

alter table known_login_locations
  drop constraint if exists known_login_locations_user_id_country_city_key;

create unique index if not exists uq_known_login_locations_user_geo
  on known_login_locations (user_id, (coalesce(country, '')), (coalesce(city, '')));

comment on index uq_known_login_locations_user_geo is
  'NULL-safe baseline key: unknown/partial geo dedups to a single row per user instead of alerting on every sign-in.';

-- Recreate the RPC with the corrected conflict arbiter. The arbiter
-- expressions must match the index expressions exactly for Postgres to
-- infer the index; the body is otherwise unchanged.
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
  on conflict (user_id, (coalesce(country, '')), (coalesce(city, '')))
  do update set last_seen_at = now()
  returning known_login_locations.id, (xmax = 0) into v_location_id, v_is_new;

  return query select v_location_id, v_is_new;
end;
$$;

revoke all on function upsert_known_login_location(text, text) from public;
grant execute on function upsert_known_login_location(text, text) to authenticated;
