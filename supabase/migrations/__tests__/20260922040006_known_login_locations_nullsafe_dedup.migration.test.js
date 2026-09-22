// Rollback-based validation for the login-safety fix migrations:
//   20260922040005_login_history_security_flag.sql
//   20260922040006_known_login_locations_nullsafe_dedup.sql
//
// Runs the ACTUAL migration SQL (read from disk, never hand-copied) against
// the real local Supabase stack inside BEGIN...ROLLBACK, so nothing persists
// no matter how many times this runs. Assertions are encoded as plpgsql
// RAISE EXCEPTION guards: a passing test is silence, a failure is an error.
//
// What this proves against real Postgres semantics (the core of the bug):
//  1. The old plain unique(user_id, country, city) constraint is gone and the
//     NULL-safe expression index exists.
//  2. The fixed ON CONFLICT arbiter actually infers that index -- Postgres
//     raises "no unique or exclusion constraint matching the ON CONFLICT
//     specification" if it does not.
//  3. Two upserts with NULL country/city (the "unknown location" case) yield
//     exactly one baseline row and is_new=false on the second call. Under the
//     original migration this duplicated and fired an alert on every sign-in.
//  4. login_history.flagged_suspicious exists as boolean NOT NULL DEFAULT
//     false and round-trips through an update (the "Wasn't me" flag path).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isLocalStackReachable, psql } from "../../../src/test-helpers/stripeWebhookIntegrationTestHelpers.js";

const localStackReachable = await isLocalStackReachable();

const MIGRATION_01 = readFileSync(resolve(process.cwd(), "supabase/migrations/20260922040001_login_history.sql"), "utf8");
const MIGRATION_02 = readFileSync(resolve(process.cwd(), "supabase/migrations/20260922040002_known_login_locations.sql"), "utf8");
const MIGRATION_05 = readFileSync(resolve(process.cwd(), "supabase/migrations/20260922040005_login_history_security_flag.sql"), "utf8");
const MIGRATION_06 = readFileSync(resolve(process.cwd(), "supabase/migrations/20260922040006_known_login_locations_nullsafe_dedup.sql"), "utf8");

function fixtureUserSql(uid) {
  return `insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values ('00000000-0000-0000-0000-000000000000','${uid}','authenticated','authenticated','login-safety-${uid.slice(0, 8)}@example.test','',now(),'{}','{}',now(),now());`;
}

describe.skipIf(!localStackReachable)("login-safety fix migrations (real local Supabase)", () => {
  it("replaces the plain unique with a NULL-safe index and dedups unknown geo", () => {
    const uid = randomUUID();
    // The upsert statement below is the fixed RPC's arbiter verbatim -- this
    // is what must infer uq_known_login_locations_user_geo.
    psql(`
begin;
${MIGRATION_02}
${MIGRATION_06}
${fixtureUserSql(uid)}
do $$
declare
  v1 uuid; v2 uuid; n1 boolean; n2 boolean; row_count int;
begin
  if exists (select 1 from pg_constraint where conname = 'known_login_locations_user_id_country_city_key') then
    raise exception 'old plain unique constraint still present';
  end if;
  if not exists (select 1 from pg_indexes where indexname = 'uq_known_login_locations_user_geo') then
    raise exception 'null-safe unique index missing';
  end if;

  -- Unknown location (NULL country/city) upserted twice must not duplicate.
  insert into known_login_locations (user_id, country, city)
  values ('${uid}', null, null)
  on conflict (user_id, (coalesce(country, '')), (coalesce(city, '')))
  do update set last_seen_at = now()
  returning id, (xmax = 0) into v1, n1;

  insert into known_login_locations (user_id, country, city)
  values ('${uid}', null, null)
  on conflict (user_id, (coalesce(country, '')), (coalesce(city, '')))
  do update set last_seen_at = now()
  returning id, (xmax = 0) into v2, n2;

  if not n1 then raise exception 'first upsert should report is_new=true'; end if;
  if n2 then raise exception 'second NULL-geo upsert reported is_new=true (dedup broken)'; end if;
  if v1 <> v2 then raise exception 'second upsert created a different row (dedup broken)'; end if;

  -- Partial geo (country known, city NULL) must dedup too.
  insert into known_login_locations (user_id, country, city)
  values ('${uid}', 'US', null)
  on conflict (user_id, (coalesce(country, '')), (coalesce(city, '')))
  do update set last_seen_at = now()
  returning id, (xmax = 0) into v1, n1;

  insert into known_login_locations (user_id, country, city)
  values ('${uid}', 'US', null)
  on conflict (user_id, (coalesce(country, '')), (coalesce(city, '')))
  do update set last_seen_at = now()
  returning id, (xmax = 0) into v2, n2;

  if v1 <> v2 then raise exception 'partial-geo upsert duplicated the row'; end if;

  select count(*) into row_count from known_login_locations where user_id = '${uid}';
  if row_count <> 2 then raise exception 'expected exactly 2 baseline rows, got %', row_count; end if;
end $$;
rollback;
`);
  });

  it("adds login_history.flagged_suspicious and it round-trips", () => {
    const uid = randomUUID();
    psql(`
begin;
${MIGRATION_01}
${MIGRATION_05}
${fixtureUserSql(uid)}
do $$
declare
  v_login_id uuid; v_flag boolean;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'login_history'
      and column_name = 'flagged_suspicious'
      and data_type = 'boolean'
      and is_nullable = 'NO'
      and column_default = 'false'
  ) then
    raise exception 'flagged_suspicious missing or wrong definition';
  end if;

  insert into login_history (user_id, result)
  values ('${uid}', 'success')
  returning id into v_login_id;

  select flagged_suspicious into v_flag from login_history where id = v_login_id;
  if v_flag then raise exception 'flagged_suspicious should default to false'; end if;

  -- The exact update the verify-location route performs on "Wasn't me".
  update login_history set flagged_suspicious = true where id = v_login_id;
  select flagged_suspicious into v_flag from login_history where id = v_login_id;
  if not v_flag then raise exception 'flagged_suspicious update did not persist'; end if;
end $$;
rollback;
`);
  });

  it("sanity: local stack ran the assertions (not silently skipped)", () => {
    expect(localStackReachable).toBe(true);
  });
});
