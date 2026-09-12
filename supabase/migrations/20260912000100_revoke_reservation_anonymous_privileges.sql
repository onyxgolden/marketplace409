-- RV-A: close the anonymous reservation-database privilege gap found by the RV/cabin
-- production-readiness audit.
--
-- Root cause: this Supabase project's ALTER DEFAULT PRIVILEGES configuration grants full table
-- privileges (arwdDxtm) to anon on every newly created table, and EXECUTE to anon on every newly
-- created function -- both confirmed live via pg_default_acl. Every reservation-domain migration
-- to date only ever addressed `authenticated` (20260910000200_revoke_reservation_direct_write_
-- grants.sql) or the bare `public` pseudo-role (the `revoke all ... from public` lines inside
-- 20260901000200/300's own RPC definitions) -- neither of those statements touches a privilege
-- separately recorded for the real `anon` role via that default-ACL mechanism. `anon` was never
-- addressed at all, on any reservation table or function, until now.
--
-- This is not currently exploitable: every reservation table has relforcerowsecurity = true, and
-- every RLS policy on them is scoped to {authenticated} only, so `anon` matches zero policies and
-- Postgres denies it categorically regardless of the grant (confirmed live: an anonymous REST GET
-- against /rest/v1/reservations and /rest/v1/reservation_guests both return 200 with an empty
-- array). This migration is defense-in-depth, matching the belt-and-suspenders pattern the
-- authenticated-role table revoke already established -- extended one role further, nothing else.
--
-- No public inventory/search/booking experience exists anywhere in this codebase today (every
-- reservation route requires createAuthenticatedRentalManagerApplication()), so anonymous SELECT
-- is revoked here too, not preserved as speculative access. A future public booking API should
-- expose a narrow, server-controlled projection through its own route -- never raw table grants.
--
-- Function grants are made as explicit, redundant `grant ... to authenticated, service_role`
-- statements rather than left to survive on whatever ambient default-privilege grant happens to
-- exist, because that ambient state is NOT the same on every environment: this project's local
-- Supabase CLI stack runs migrations as `postgres`, which carries no custom per-role default ACL
-- for functions at all (confirmed via pg_default_acl), so `authenticated`/`service_role` access to
-- these functions locally exists only through Postgres's implicit "PUBLIC gets EXECUTE by default"
-- behavior -- the same implicit channel `anon` was piggybacking on. Revoking from `public` without
-- an explicit re-grant would silently break `authenticated`'s and `service_role`'s access on any
-- environment relying on that implicit channel, even though production's own `supabase_admin`-
-- owned default ACL happens to record their privilege independently. Making the grant explicit
-- here removes that fragility rather than depending on it.
--
-- All statements below are idempotent: revoking a privilege the role no longer holds, or granting
-- one it already holds, is a no-op, not an error. This migration changes no reservation row and no
-- production data.

-- Tables: revoke every privilege anon holds via the default-ACL grant. authenticated's and
-- service_role's existing grants are untouched -- this statement only ever names anon.
revoke all privileges on reservation_inventory_settings from anon;
revoke all privileges on reservation_rate_plans from anon;
revoke all privileges on reservation_calendar_blocks from anon;
revoke all privileges on reservation_guests from anon;
revoke all privileges on reservations from anon;
revoke all privileges on reservation_events from anon;
revoke all privileges on reservation_inventory_imports from anon;

-- Sequences: inspection (both live production and this freshly-reset local database) confirms
-- zero sequences exist for any reservation table -- every primary key is a client- or
-- database-generated text/uuid value, never a serial/identity column. Kept as a defensive,
-- idempotent no-op rather than a hardcoded (and therefore fragile) list, so this migration stays
-- correct if that ever changes without needing a follow-up migration to catch up.
do $$
declare
  reservation_sequence record;
begin
  for reservation_sequence in
    select sequence_schema, sequence_name
    from information_schema.sequences
    where sequence_schema = 'public' and sequence_name like 'reservation%'
  loop
    execute format(
      'revoke all privileges on sequence %I.%I from anon',
      reservation_sequence.sequence_schema,
      reservation_sequence.sequence_name
    );
  end loop;
end;
$$;

-- Owner/operator mutation RPCs and their supporting trigger functions: revoke from public and
-- anon, then explicitly (re-)affirm authenticated and service_role rather than relying on ambient
-- defaults surviving -- see header comment. `enforce_reservation_inventory_settings_actor`,
-- `enforce_reservation_rate_plan_actor`, and `prevent_reservation_event_mutation` are SECURITY
-- INVOKER trigger functions (no `security definer` clause), so `authenticated` genuinely needs its
-- own EXECUTE grant for its own inserts/updates to fire the trigger -- this preserves that
-- unconditionally rather than leaving it dependent on an implicit public-wide grant.
revoke all on function confirm_owner_reservation(
  text, text, text, text, text, text, text, date, date, integer,
  bigint, bigint, bigint, bigint, bigint, text, text, text
) from public, anon;
grant execute on function confirm_owner_reservation(
  text, text, text, text, text, text, text, date, date, integer,
  bigint, bigint, bigint, bigint, bigint, text, text, text
) to authenticated, service_role;

revoke all on function import_reservation_inventory_bulk(
  text, text, text, jsonb
) from public, anon;
grant execute on function import_reservation_inventory_bulk(
  text, text, text, jsonb
) to authenticated, service_role;

revoke all on function enforce_reservation_inventory_settings_actor() from public, anon;
grant execute on function enforce_reservation_inventory_settings_actor() to authenticated, service_role;

revoke all on function enforce_reservation_rate_plan_actor() from public, anon;
grant execute on function enforce_reservation_rate_plan_actor() to authenticated, service_role;

revoke all on function prevent_reservation_event_mutation() from public, anon;
grant execute on function prevent_reservation_event_mutation() to authenticated, service_role;
