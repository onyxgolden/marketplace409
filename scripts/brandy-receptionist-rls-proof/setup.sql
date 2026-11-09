-- Brandy receptionist RLS proof setup (scratch PostgreSQL only).
-- Mirrors scripts/rental-billing-rls-proof/setup.sql: creates the roles and
-- the authenticated owner/co-owner predicate the migration depends on,
-- with the same stubbed auth.uid() pattern used by the #753 proof.
-- Never point it at production: run.sh drops and recreates the rlsproof
-- database on the local scratch cluster.
--
-- What this mirrors from LIVE (read from production 2026-11-08, read-only,
-- via the #753 proof's verbatim capture):
--   * has_workspace_access(text) VERBATIM: owner, or an ACTIVE co_owner
--     member. Manager / bookkeeper / read_only rows can exist but can never
--     satisfy the predicate — it hard-codes role = 'co_owner' AND
--     status = 'active'.
--   * workspace_members columns + live CHECK constraints.
--   * Supabase default table grants (authenticated has INSERT/UPDATE at the
--     ACL layer), so RLS is the sole gate — exactly as in production.
-- The 20260829 migration's older workspace_id/is_active spelling is NOT
-- what production runs today; this file follows the live function.
\pset pager off
drop role if exists authenticated;
drop role if exists anon;
drop role if exists service_role;
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;
-- no role may own objects in this schema except postgres, but the
-- application roles still need USAGE to resolve unqualified names
-- (Supabase grants USAGE on public by default; the migration only
-- tightens table/function grants, never schema usage).
revoke all on schema public from public;
grant all on schema public to postgres;
grant usage on schema public to authenticated, anon, service_role;

create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select current_setting('app.test_uid', true)::uuid $$;

create table public.workspace_members (
    owner_id text not null,
    id text not null,
    member_user_id uuid not null,
    role text not null,
    status text not null,
    invited_email text not null,
    invited_by uuid,
    invited_at timestamptz not null default now(),
    activated_at timestamptz,
    suspended_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, member_user_id),
    check (role = any (array['primary_owner'::text, 'co_owner'::text, 'manager'::text, 'bookkeeper'::text, 'read_only'::text])),
    check (role <> 'primary_owner'::text),
    check (status = any (array['invited'::text, 'active'::text, 'suspended'::text])),
    check ((status <> 'invited'::text) or ((activated_at is null) and (suspended_at is null))),
    check ((status <> 'active'::text) or (activated_at is not null)),
    check ((status <> 'suspended'::text) or ((activated_at is not null) and (suspended_at is not null)))
);

-- REAL has_workspace_access, verbatim from production (SECURITY DEFINER, RLS off).
create or replace function public.has_workspace_access(p_owner_id text) returns boolean
  language sql stable security definer set search_path to 'public' set row_security to 'off'
as $function$
    select p_owner_id = auth.uid()::text
        or exists (
            select 1 from workspace_members
            where owner_id = p_owner_id
              and member_user_id = auth.uid()
              and status = 'active'
              and role = 'co_owner'
        );
$function$;
create or replace function public.has_workspace_access(p_owner_id uuid) returns boolean
  language sql stable security definer set search_path to 'public' set row_security to 'off'
as $function$ select public.has_workspace_access(p_owner_id::text); $function$;

-- Seed: workspace A owned by A with one member of every role/status the live model
-- permits; workspace B owned by B with no members. Member uids match run.sh.
-- (invited_by is a bare uuid here; live it FK-references auth.users, which this
-- scratch cluster does not model.)
insert into workspace_members (owner_id, id, member_user_id, role, status, invited_email, invited_by, activated_at, suspended_at) values
 ('11111111-1111-1111-1111-111111111111', 'wm-c', '33333333-3333-3333-3333-333333333333', 'co_owner',  'active',    'c@example.invalid', '11111111-1111-1111-1111-111111111111', now(), null),
 ('11111111-1111-1111-1111-111111111111', 'wm-i', '44444444-4444-4444-4444-444444444444', 'co_owner',  'invited',   'i@example.invalid', '11111111-1111-1111-1111-111111111111', null,  null),
 ('11111111-1111-1111-1111-111111111111', 'wm-s', '55555555-5555-5555-5555-555555555555', 'co_owner',  'suspended', 's@example.invalid', '11111111-1111-1111-1111-111111111111', now(), now()),
 ('11111111-1111-1111-1111-1111-111111111111', 'wm-m', '66666666-6666-6666-6666-666666666666', 'manager',   'active',    'm@example.invalid', '11111111-1111-1111-1111-111111111111', now(), null),
 ('11111111-1111-1111-1111-1111-111111111111', 'wm-k', '77777777-7777-7777-7777-777777777777', 'bookkeeper','active',    'k@example.invalid', '11111111-1111-1111-1111-111111111111', now(), null),
 ('11111111-1111-1111-1111-1111-111111111111', 'wm-r', '88888888-8888-8888-8888-888888888888', 'read_only', 'active',    'r@example.invalid', '11111111-1111-1111-1111-111111111111', now(), null);
