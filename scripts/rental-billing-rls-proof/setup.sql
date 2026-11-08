-- Scratch verification v2 for 20261108000000_rental_billing_audit_insert_policies.sql
-- (fix round 1: same-workspace role matrix + RPC paths).
-- NOT part of the migration: throwaway local PostgreSQL 16 proof. Run with run.sh
-- in this directory against a scratch cluster (see README.md). Never point it at
-- production: it drops and recreates the rlsproof database.
--
-- What this mirrors from LIVE (read from production 2026-11-08, read-only):
--   * has_workspace_access(text) VERBATIM: owner, or an ACTIVE co_owner member.
--     Manager / bookkeeper / read_only rows can exist (the live CHECK constraint
--     permits those role values) but can never satisfy the predicate — it hard-codes
--     role = 'co_owner' AND status = 'active'.
--   * workspace_members columns + live CHECK constraints (role enum, status enum,
--     invited/active/suspended timestamp consistency). The live invite RPC rejects
--     any role other than co_owner, so the app can only create co_owner rows.
--   * The five billing RPCs VERBATIM from live pg_get_functiondef output. All five
--     are SECURITY INVOKER and gate on has_workspace_access(p_owner_id) — the exact
--     same predicate the new RLS policies use. The RPC gate and the policy gate
--     admit exactly the same set of callers, so a direct table write cannot reach
--     anyone the RPCs exclude.
--   * The six tables with RLS + FORCE RLS and SELECT policies only (pre-fix live
--     state), plus rent_schedules with an owner-all policy (live has *_owner_all
--     policies there; the activation RPC selects/updates the schedule as the caller).
--   * Supabase default table grants (authenticated has INSERT/UPDATE at the ACL
--     layer), so RLS is the sole gate — exactly as in production.
\pset pager off
drop role if exists authenticated;
drop role if exists anon;
drop role if exists service_role;
create role authenticated nologin;
create role anon nologin;
create role service_role nologin;

create schema auth;
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

create table public.rent_schedules (
    owner_id text not null,
    id text not null,
    lease_id text not null,
    collection_mode text not null default 'external',
    forge_cutover_date date,
    forge_cutover_activated_at timestamptz,
    forge_cutover_activated_by text,
    updated_at timestamptz not null default now(),
    primary key (owner_id, id)
);
create table public.rent_schedule_collection_cutover_audit (
    id text primary key default ('rental_cutover_audit_' || gen_random_uuid()::text),
    owner_id text not null, schedule_id text not null, lease_id text not null,
    from_collection_mode text not null, to_collection_mode text not null,
    cutover_date date, reconciliation_summary jsonb not null default '{}'::jsonb,
    performed_by text not null, performed_at timestamptz not null default now(),
    foreign key (owner_id, schedule_id) references rent_schedules (owner_id, id) on delete restrict);
create table public.rental_billing_settings (
    owner_id text primary key, billing_enabled boolean not null default false,
    card_convenience_fee_bps integer, payment_policy text,
    late_fee_auto_post boolean, late_fee_grace_days smallint,
    late_fee_calculation_type text, late_fee_fixed_amount_cents bigint,
    late_fee_percentage_basis_points integer, late_fee_maximum_amount_cents bigint,
    updated_at timestamptz not null default now(), updated_by text);
create table public.rental_billing_settings_audit (
    id text primary key default ('rental_billing_settings_audit_' || gen_random_uuid()::text),
    owner_id text not null, from_enabled boolean not null, to_enabled boolean not null,
    performed_by text not null, performed_at timestamptz not null default now());
create table public.rental_late_fee_settings_audit (
    id text primary key default ('x' || gen_random_uuid()::text),
    owner_id text not null, change jsonb not null default '{}'::jsonb,
    performed_by text not null, performed_at timestamptz not null default now());
create table public.rental_payment_policy_audit (
    id text primary key default ('x' || gen_random_uuid()::text),
    owner_id text not null, change jsonb not null default '{}'::jsonb,
    performed_by text not null, performed_at timestamptz not null default now());
create table public.rental_convenience_fee_audit (
    id text primary key default ('x' || gen_random_uuid()::text),
    owner_id text not null, change jsonb not null default '{}'::jsonb,
    performed_by text not null, performed_at timestamptz not null default now());

alter table public.rent_schedules enable row level security;
alter table public.rent_schedules force row level security;
alter table public.rent_schedule_collection_cutover_audit enable row level security;
alter table public.rent_schedule_collection_cutover_audit force row level security;
alter table public.rental_billing_settings enable row level security;
alter table public.rental_billing_settings force row level security;
alter table public.rental_billing_settings_audit enable row level security;
alter table public.rental_billing_settings_audit force row level security;
alter table public.rental_late_fee_settings_audit enable row level security;
alter table public.rental_late_fee_settings_audit force row level security;
alter table public.rental_payment_policy_audit enable row level security;
alter table public.rental_payment_policy_audit force row level security;
alter table public.rental_convenience_fee_audit enable row level security;
alter table public.rental_convenience_fee_audit force row level security;

-- Pre-fix live state: SELECT policies only (mirrors pg_policies on production 2026-11-08).
-- rent_schedules owner-all mirrors the live *_owner_all policies there.
create policy "rent_schedules_owner_all" on public.rent_schedules
  for all to authenticated using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
create policy "rent_schedule_cutover_audit_owner_select" on public.rent_schedule_collection_cutover_audit
  for select to authenticated using (has_workspace_access(owner_id));
create policy "rental_billing_settings_owner_select" on public.rental_billing_settings
  for select to authenticated using (has_workspace_access(owner_id));
create policy "rental_billing_settings_audit_owner_select" on public.rental_billing_settings_audit
  for select to authenticated using (has_workspace_access(owner_id));
create policy "late_fee_settings_audit_owner_select" on public.rental_late_fee_settings_audit
  for select to authenticated using (has_workspace_access(owner_id));
create policy "payment_policy_audit_owner_select" on public.rental_payment_policy_audit
  for select to authenticated using (has_workspace_access(owner_id));
create policy "convenience_fee_audit_owner_select" on public.rental_convenience_fee_audit
  for select to authenticated using (has_workspace_access(owner_id));

-- Table-level grants as Supabase default privileges provide them: live relacl is
-- arwdDxtm for anon, authenticated, and service_role on all six tables, so RLS
-- (not the ACL) is the sole gate — including for anon, which must fail the RLS
-- check rather than a permission check.
grant select, insert, update, delete on all tables in schema public to authenticated, anon, service_role;
-- The stub auth functions must be callable by the authenticated role, as the real
-- Supabase auth schema is.
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function public.has_workspace_access(text) to authenticated;
grant execute on function public.has_workspace_access(uuid) to authenticated;

-- Five billing RPCs, verbatim from live pg_get_functiondef output (SECURITY INVOKER
-- by default; each gates on has_workspace_access(p_owner_id)).
create or replace function public.activate_forge_billing_collection(p_owner_id text, p_schedule_id text, p_cutover_date date, p_reconciliation_summary jsonb default '{}'::jsonb)
 returns rent_schedules
 language plpgsql
 set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    schedule rent_schedules%rowtype;
    previous_mode text;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Rent schedule owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if p_cutover_date is null then
        raise exception 'A reviewed FORGE cutover date is required.' using errcode = '22023';
    end if;

    select * into schedule from rent_schedules where owner_id = p_owner_id and id = p_schedule_id for update;
    if not found then raise exception 'Rent schedule was not found.' using errcode = 'P0002'; end if;
    if schedule.collection_mode = 'forge' and schedule.forge_cutover_date = p_cutover_date then
        -- Idempotent no-op: identical retry of an already-completed activation.
        insert into rent_schedule_collection_cutover_audit
          (owner_id, schedule_id, lease_id, from_collection_mode, to_collection_mode, cutover_date, reconciliation_summary, performed_by)
        values (p_owner_id, schedule.id, schedule.lease_id, 'forge', 'forge', p_cutover_date, coalesce(p_reconciliation_summary, '{}'::jsonb) || jsonb_build_object('noop', true), authenticated_owner_id);
        return schedule;
    end if;
    if schedule.collection_mode = 'forge' then
        raise exception 'This schedule is already FORGE-collectible under a different cutover date; correct it explicitly rather than re-activating.' using errcode = '22023';
    end if;

    previous_mode := schedule.collection_mode;
    update rent_schedules
       set collection_mode = 'forge',
           forge_cutover_date = p_cutover_date,
           forge_cutover_activated_at = now(),
           forge_cutover_activated_by = authenticated_owner_id,
           updated_at = now()
     where owner_id = p_owner_id and id = schedule.id
     returning * into schedule;

    insert into rent_schedule_collection_cutover_audit
      (owner_id, schedule_id, lease_id, from_collection_mode, to_collection_mode, cutover_date, reconciliation_summary, performed_by)
    values (p_owner_id, schedule.id, schedule.lease_id, previous_mode, 'forge', p_cutover_date, coalesce(p_reconciliation_summary, '{}'::jsonb), authenticated_owner_id);

    return schedule;
end;
$function$;

create or replace function public.set_rental_billing_enabled(p_owner_id text, p_enabled boolean)
 returns rental_billing_settings
 language plpgsql
 set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    previous_enabled boolean;
    result rental_billing_settings;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Rental billing settings owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if p_enabled is null then
        raise exception 'An explicit billing_enabled value is required.' using errcode = '22023';
    end if;

    select coalesce(billing_enabled, false) into previous_enabled
      from rental_billing_settings where owner_id = p_owner_id;
    previous_enabled := coalesce(previous_enabled, false);

    insert into rental_billing_settings (owner_id, billing_enabled, updated_at, updated_by)
    values (p_owner_id, p_enabled, now(), authenticated_owner_id)
    on conflict (owner_id) do update
      set billing_enabled = excluded.billing_enabled, updated_at = now(), updated_by = excluded.updated_by
    returning * into result;

    insert into rental_billing_settings_audit (owner_id, from_enabled, to_enabled, performed_by)
    values (p_owner_id, previous_enabled, p_enabled, authenticated_owner_id);

    return result;
end;
$function$;

create or replace function public.set_rental_card_convenience_fee(p_owner_id text, p_fee_bps integer)
 returns rental_billing_settings
 language plpgsql
 set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    previous jsonb;
    result rental_billing_settings;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Convenience fee owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if p_fee_bps is null or p_fee_bps < 0 or p_fee_bps > 10000 then
        raise exception 'Convenience fee must be between 0 and 10000 basis points.' using errcode = '22023';
    end if;

    select to_jsonb(r) into previous
      from rental_billing_settings r where r.owner_id = p_owner_id;

    insert into rental_billing_settings (owner_id, card_convenience_fee_bps, updated_at)
    values (p_owner_id, p_fee_bps, now())
    on conflict (owner_id) do update
      set card_convenience_fee_bps = excluded.card_convenience_fee_bps,
          updated_at = excluded.updated_at;

    select * into result from rental_billing_settings where owner_id = p_owner_id;

    insert into rental_convenience_fee_audit (owner_id, change, performed_by)
    values (p_owner_id,
            jsonb_build_object('previous', coalesce(previous -> 'card_convenience_fee_bps', 'null'::jsonb),
                               'new', p_fee_bps),
            authenticated_owner_id);

    return result;
end;
$function$;

create or replace function public.set_rental_late_fee_auto_settings(p_owner_id text, p_settings jsonb)
 returns rental_billing_settings
 language plpgsql
 set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    v_enabled boolean := nullif(p_settings ->> 'enabled', '')::boolean;
    v_grace_days smallint := nullif(p_settings ->> 'graceDays', '')::smallint;
    v_calc text := nullif(btrim(p_settings ->> 'calculationType'), '');
    v_fixed bigint := nullif(p_settings ->> 'fixedAmountCents', '')::bigint;
    v_pct integer := nullif(p_settings ->> 'percentageBasisPoints', '')::integer;
    v_max bigint := nullif(p_settings ->> 'maximumAmountCents', '')::bigint;
    previous jsonb;
    result rental_billing_settings;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Late-fee settings owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if v_enabled is null then
        raise exception 'An explicit enabled value is required.' using errcode = '22023';
    end if;
    if v_enabled then
        if v_grace_days is null or v_grace_days < 0 or v_grace_days > 31 then
            raise exception 'Grace days must be between 0 and 31.' using errcode = '22023';
        end if;
        if v_calc not in ('fixed', 'percentage') then
            raise exception 'Calculation type must be fixed or percentage.' using errcode = '22023';
        end if;
        if v_calc = 'fixed' and (v_fixed is null or v_fixed <= 0) then
            raise exception 'A positive fixed amount is required.' using errcode = '22023';
        end if;
        if v_calc = 'percentage' and (v_pct is null or v_pct <= 0) then
            raise exception 'A positive percentage is required.' using errcode = '22023';
        end if;
        if v_max is not null and v_max <= 0 then
            raise exception 'Maximum amount must be positive.' using errcode = '22023';
        end if;
    end if;

    select jsonb_build_object('enabled', coalesce(late_fee_auto_post, false), 'graceDays', late_fee_grace_days,
        'calculationType', late_fee_calculation_type, 'fixedAmountCents', late_fee_fixed_amount_cents,
        'percentageBasisPoints', late_fee_percentage_basis_points, 'maximumAmountCents', late_fee_maximum_amount_cents)
      into previous from rental_billing_settings where owner_id = p_owner_id;
    previous := coalesce(previous, '{"enabled": false}'::jsonb);

    insert into rental_billing_settings (owner_id, late_fee_auto_post, late_fee_grace_days,
        late_fee_calculation_type, late_fee_fixed_amount_cents, late_fee_percentage_basis_points,
        late_fee_maximum_amount_cents, updated_at, updated_by)
    values (p_owner_id, v_enabled, v_grace_days, v_calc,
        case when v_calc = 'fixed' then v_fixed end,
        case when v_calc = 'percentage' then v_pct end,
        v_max, now(), authenticated_owner_id)
    on conflict (owner_id) do update
      set late_fee_auto_post = excluded.late_fee_auto_post,
          late_fee_grace_days = case when excluded.late_fee_auto_post then excluded.late_fee_grace_days else rental_billing_settings.late_fee_grace_days end,
          late_fee_calculation_type = case when excluded.late_fee_auto_post then excluded.late_fee_calculation_type else rental_billing_settings.late_fee_calculation_type end,
          late_fee_fixed_amount_cents = case when excluded.late_fee_auto_post then excluded.late_fee_fixed_amount_cents else rental_billing_settings.late_fee_fixed_amount_cents end,
          late_fee_percentage_basis_points = case when excluded.late_fee_auto_post then excluded.late_fee_percentage_basis_points else rental_billing_settings.late_fee_percentage_basis_points end,
          late_fee_maximum_amount_cents = case when excluded.late_fee_auto_post then excluded.late_fee_maximum_amount_cents else rental_billing_settings.late_fee_maximum_amount_cents end,
          updated_at = now(), updated_by = excluded.updated_by
    returning * into result;

    insert into rental_late_fee_settings_audit (owner_id, change, performed_by)
    values (p_owner_id, jsonb_build_object('from', previous, 'to', p_settings), authenticated_owner_id);

    return result;
end;
$function$;

create or replace function public.set_rental_payment_policy(p_owner_id text, p_policy text)
 returns rental_billing_settings
 language plpgsql
 set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    v_policy text := btrim(p_policy);
    previous jsonb;
    result rental_billing_settings;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Payment policy owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if v_policy is null or v_policy = ''
       or v_policy not in ('allow_any_amount', 'require_rent', 'require_balance') then
        raise exception 'Payment policy must be allow_any_amount, require_rent, or require_balance.' using errcode = '22023';
    end if;

    select to_jsonb(r) into previous
      from rental_billing_settings r where r.owner_id = p_owner_id;

    insert into rental_billing_settings (owner_id, payment_policy, updated_at)
    values (p_owner_id, v_policy, now())
    on conflict (owner_id) do update
      set payment_policy = excluded.payment_policy,
          updated_at = excluded.updated_at;

    select * into result from rental_billing_settings where owner_id = p_owner_id;

    insert into rental_payment_policy_audit (owner_id, change, performed_by)
    values (p_owner_id,
            jsonb_build_object('previous', coalesce(previous -> 'payment_policy', 'null'::jsonb),
                               'new', v_policy),
            authenticated_owner_id);

    return result;
end;
$function$;

grant execute on function public.activate_forge_billing_collection(text, text, date, jsonb) to authenticated;
grant execute on function public.set_rental_billing_enabled(text, boolean) to authenticated;
grant execute on function public.set_rental_card_convenience_fee(text, integer) to authenticated;
grant execute on function public.set_rental_late_fee_auto_settings(text, jsonb) to authenticated;
grant execute on function public.set_rental_payment_policy(text, text) to authenticated;

-- Seed: workspace A owned by A with one member of every role/status the live model
-- permits; workspace B owned by B with no members. Member uids match run.sh.
-- (invited_by is a bare uuid here; live it FK-references auth.users, which this
-- scratch cluster does not model.)
insert into workspace_members (owner_id, id, member_user_id, role, status, invited_email, invited_by, activated_at, suspended_at) values
 ('11111111-1111-1111-1111-111111111111', 'wm-c', '33333333-3333-3333-3333-333333333333', 'co_owner',  'active',    'c@example.invalid', '11111111-1111-1111-1111-111111111111', now(), null),
 ('11111111-1111-1111-1111-111111111111', 'wm-i', '44444444-4444-4444-4444-444444444444', 'co_owner',  'invited',   'i@example.invalid', '11111111-1111-1111-1111-111111111111', null,  null),
 ('11111111-1111-1111-1111-111111111111', 'wm-s', '55555555-5555-5555-5555-555555555555', 'co_owner',  'suspended', 's@example.invalid', '11111111-1111-1111-1111-111111111111', now(), now()),
 ('11111111-1111-1111-1111-111111111111', 'wm-m', '66666666-6666-6666-6666-666666666666', 'manager',   'active',    'm@example.invalid', '11111111-1111-1111-1111-111111111111', now(), null),
 ('11111111-1111-1111-1111-111111111111', 'wm-k', '77777777-7777-7777-7777-777777777777', 'bookkeeper','active',    'k@example.invalid', '11111111-1111-1111-1111-111111111111', now(), null),
 ('11111111-1111-1111-1111-111111111111', 'wm-r', '88888888-8888-8888-8888-888888888888', 'read_only', 'active',    'r@example.invalid', '11111111-1111-1111-1111-111111111111', now(), null);

insert into rent_schedules (owner_id, id, lease_id, collection_mode) values
 ('11111111-1111-1111-1111-111111111111', 's1', 'l1', 'external'),
 ('11111111-1111-1111-1111-111111111111', 's2', 'l2', 'external'),
 ('11111111-1111-1111-1111-111111111111', 's3', 'l3', 'external'),
 ('11111111-1111-1111-1111-111111111111', 's4', 'l4', 'external'),
 ('11111111-1111-1111-1111-111111111111', 's5', 'l5', 'external'),
 ('22222222-2222-2222-2222-222222222222', 's9', 'l9', 'external');
