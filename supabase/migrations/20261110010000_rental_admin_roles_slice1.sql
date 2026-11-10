-- Rental Manager administrator roles and permissions — slice 1 (2026-11-10).
--
-- SCOPE: results/chatgpt/rental-manager-admin-permissions-scope-2026-11-08.md
-- (ChatGPT brief, drop ce2f388d; build authorized by Jason 2026-11-10 01:02 CST.)
-- FILE-ONLY migration: applying to production needs Jason's separate word.
--
-- What this slice adds (additive; nothing existing is removed or widened):
--   1. A shared role framework scoped by (owner_id, app_key): rental_roles,
--      rental_role_capabilities, rental_user_roles (one active role per user
--      per workspace), and the append-only rental_role_audit table.
--   2. An extension of the existing has_rental_permission(owner_id, key):
--      keys in the new `rental.*` namespace resolve ONLY through the role
--      framework (assigned role's capabilities). The R17 legacy keys keep
--      their existing logic byte-for-byte. Owner/co-owner-only finance keys
--      (billing activation/settings, refunds, credits) are never effective
--      for staff, even if a role lists them.
--   3. Transactional RPCs (actor derived from auth.uid(), role change +
--      audit atomic, optimistic version CAS, request idempotency).
--   4. Additive RLS policies migrating the low-risk tenant and maintenance
--      surfaces to the new keys. Existing policies are untouched.
--
-- VERIFIED BEFORE WRITING (see the build result file):
--   * Live has_workspace_access(owner_id) admits ONLY the primary owner or an
--     active co_owner (role = 'co_owner'). The R17 migration file widened it
--     to any active member, but the NO-GO security fix (20261001070500)
--     reverted it, and the live function matches the reverted definition.
--     The brief's claim is correct; the later "any active member" reading
--     was wrong (it read the R17 file without the revert). This migration
--     does NOT touch has_workspace_access.
--   * has_rental_permission(text, text) ALREADY EXISTS (NO-GO fix). This
--     migration extends it with the new-key branch; the legacy branch is
--     reproduced verbatim.
--   * The seven PR #753 billing gates (cutover audit INSERT +
--     billing-settings / late-fee / payment-policy / convenience-fee audit
--     INSERTs + rental_billing_settings INSERT + UPDATE, all gated on
--     has_workspace_access) are untouched by this migration: no table,
--     policy, or function they use is modified.
--   * No user gains permissions from this migration alone: the role tables
--     start empty, starter roles are materialized only by the
--     rental_ensure_starter_roles RPC (owner/co-owner only), and the new
--     policies grant nothing until an admin assigns a role.
--
-- Supabase default-privileges note (the Nov 4 lesson, sharpened Nov 10 by
-- the PR #766 P1): new public tables land with ALL granted to
-- anon/authenticated/service_role and new functions land with EXECUTE to
-- anon, authenticated, service_role — via NAMED-ROLE default privileges
-- (pg_default_acl has no PUBLIC entry), so REVOKE ... FROM public alone
-- removes nothing. Every object below therefore gets an explicit REVOKE ALL
-- from public, anon, authenticated, service_role followed by the minimal
-- GRANT, and the migration test + real-PostgreSQL proof assert the effective
-- ACLs under Supabase-like defaults. No sequences are created (text ids /
-- gen_random_uuid()).

-- ============================================================================
-- 1. Role framework tables.
-- ============================================================================

create table if not exists public.rental_roles (
    id text not null primary key,
    owner_id text not null,
    app_key text not null default 'rental',
    name text not null,
    display_name text not null,
    is_system boolean not null default false,
    version integer not null default 1,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    retired_at timestamptz,
    constraint rental_roles_name_not_blank check (btrim(name) <> ''),
    constraint rental_roles_display_name_not_blank check (btrim(display_name) <> ''),
    constraint rental_roles_version_positive check (version >= 1),
    constraint rental_roles_app_key_rental check (app_key = 'rental'),
    unique (owner_id, app_key, name)
);
comment on table public.rental_roles is
'Admin role definitions (slice 1). One named role per workspace; the role carries an editable set of capability keys. Owner/co-owner are implicit and never rows. Stable ids; version is the optimistic-concurrency token.';

create table if not exists public.rental_role_capabilities (
    role_id text not null references public.rental_roles (id) on delete cascade,
    capability_key text not null,
    constraint rental_role_capabilities_key_not_blank check (btrim(capability_key) <> ''),
    primary key (role_id, capability_key)
);
comment on table public.rental_role_capabilities is
'Capability keys granted by a role. Read live by has_rental_permission() for rental.* keys, so a role edit affects all assignees immediately.';

create table if not exists public.rental_user_roles (
    id text not null primary key,
    owner_id text not null,
    app_key text not null default 'rental',
    user_id uuid not null,
    role_id text not null references public.rental_roles (id) on delete restrict,
    status text not null default 'active' check (status in ('active', 'revoked')),
    request_id text not null,
    assigned_by uuid not null,
    assigned_at timestamptz not null default now(),
    revoked_at timestamptz,
    revoked_by uuid,
    constraint rental_user_roles_app_key_rental check (app_key = 'rental'),
    unique (owner_id, app_key, user_id, request_id)
);
-- One ACTIVE role per user per workspace (slice 1: no multiple roles).
create unique index if not exists rental_user_roles_one_active_idx
    on public.rental_user_roles (owner_id, app_key, user_id)
    where status = 'active';
create index if not exists rental_user_roles_role_idx
    on public.rental_user_roles (role_id, status);
comment on table public.rental_user_roles is
'Role assignments. One active assignment per user per workspace. request_id makes assignment/revocation idempotent: replaying a request returns the existing assignment instead of creating a second one.';

create table if not exists public.rental_role_audit (
    id uuid not null default gen_random_uuid() primary key,
    owner_id text not null,
    app_key text not null default 'rental',
    actor_user_id uuid not null,
    action text not null,
    target_role_id text,
    target_user_id uuid,
    detail jsonb not null default '{}',
    created_at timestamptz not null default now(),
    constraint rental_role_audit_action_not_blank check (btrim(action) <> ''),
    constraint rental_role_audit_app_key_rental check (app_key = 'rental')
);
create index if not exists rental_role_audit_owner_created_idx
    on public.rental_role_audit (owner_id, created_at desc);
comment on table public.rental_role_audit is
'Append-only audit for role grants and changes. No UPDATE/DELETE is ever granted; rows are written only by the role RPCs in the same transaction as the change.';

-- ============================================================================
-- 2. RLS + explicit minimal grants (REVOKE the Supabase defaults first).
--    No direct client writes to any of these tables: INSERT/UPDATE/DELETE are
--    performed only by the SECURITY DEFINER RPCs below (row_security = off).
--    Direct SELECT is owner/co-owner only (has_workspace_access); staff read
--    roles/audit through the RPCs, which enforce rental.roles.read /
--    rental.audit.read.
-- ============================================================================

alter table public.rental_roles enable row level security;
alter table public.rental_roles force row level security;
alter table public.rental_role_capabilities enable row level security;
alter table public.rental_role_capabilities force row level security;
alter table public.rental_user_roles enable row level security;
alter table public.rental_user_roles force row level security;
alter table public.rental_role_audit enable row level security;
alter table public.rental_role_audit force row level security;

revoke all on table public.rental_roles from public;
revoke all on table public.rental_role_capabilities from public;
revoke all on table public.rental_user_roles from public;
revoke all on table public.rental_role_audit from public;
revoke all on table public.rental_roles from anon, authenticated, service_role;
revoke all on table public.rental_role_capabilities from anon, authenticated, service_role;
revoke all on table public.rental_user_roles from anon, authenticated, service_role;
revoke all on table public.rental_role_audit from anon, authenticated, service_role;

grant select on table public.rental_roles to authenticated;
grant select on table public.rental_role_capabilities to authenticated;
grant select on table public.rental_user_roles to authenticated;
grant select on table public.rental_role_audit to authenticated;

drop policy if exists "rental_roles_owner_select" on public.rental_roles;
create policy "rental_roles_owner_select" on public.rental_roles
    for select to authenticated using (has_workspace_access(owner_id));

drop policy if exists "rental_role_capabilities_owner_select" on public.rental_role_capabilities;
create policy "rental_role_capabilities_owner_select" on public.rental_role_capabilities
    for select to authenticated using (
        exists (select 1 from public.rental_roles r
                where r.id = rental_role_capabilities.role_id
                  and has_workspace_access(r.owner_id))
    );

drop policy if exists "rental_user_roles_owner_select" on public.rental_user_roles;
create policy "rental_user_roles_owner_select" on public.rental_user_roles
    for select to authenticated using (has_workspace_access(owner_id));

drop policy if exists "rental_role_audit_owner_select" on public.rental_role_audit;
create policy "rental_role_audit_owner_select" on public.rental_role_audit
    for select to authenticated using (has_workspace_access(owner_id));

-- ============================================================================
-- 3. Extend has_rental_permission(text, text) with the new `rental.*` keys.
--
-- The legacy R17 branch below is reproduced VERBATIM from
-- 20261001070500_r17_no_go_security_fix.sql (same role defaults, same
-- override semantics, same team.manage rule). The only change is the new
-- branch inserted after the co-owner short-circuit and before the legacy
-- override check:
--   * Keys in the `rental.*` namespace resolve ONLY through the role
--     framework tables above: the caller must hold an ACTIVE assignment
--     whose role lists the key. No R17 role default ever grants a new key,
--     and per-user R17 overrides never apply to new keys.
--   * Owner/co-owner-only finance keys (billing activation/settings,
--     refunds, credits) are never effective for staff, even if a role
--     lists them — defense in depth behind the RPC validation that refuses
--     to put them on a role at all.
--   * Unknown `rental.*` keys fail closed (no assignment can list a key
--     the catalog does not know, and the RPC rejects unknown keys).
-- ============================================================================

create or replace function public.has_rental_permission(p_owner_id text, p_permission_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_role text;
  v_overrides jsonb;
  v_has_capability boolean;
begin
  -- Primary owner: implicit full access (never a workspace_members row).
  if p_owner_id = auth.uid()::text then
    return true;
  end if;

  select wm.role, coalesce(wm.permission_overrides, '{}'::jsonb)
    into v_role, v_overrides
    from workspace_members wm
   where wm.owner_id = p_owner_id
     and wm.member_user_id = auth.uid()
     and coalesce(wm.status, 'active') = 'active';

  if v_role is null then
    return false;
  end if;

  -- Co-owner: full access, unchanged by R17.
  if v_role = 'co_owner' then
    return true;
  end if;

  -- Slice 1 (admin roles): `rental.*` keys resolve ONLY through the role
  -- framework. No R17 role default and no per-user override applies here.
  if p_permission_key like 'rental.%' then
    -- Owner/co-owner-only finance keys are never effective for staff, even
    -- if a role lists them (the RPCs refuse to put them on a role; this is
    -- the defense-in-depth half).
    if p_permission_key in (
      'rental.billing.activate',
      'rental.billing.settings.edit',
      'rental.payments.refund',
      'rental.credits.issue',
      'rental.credits.apply',
      'rental.credits.void'
    ) then
      return false;
    end if;

    select exists (
      select 1
        from public.rental_user_roles ur
        join public.rental_role_capabilities rc on rc.role_id = ur.role_id
       where ur.owner_id = p_owner_id
         and ur.app_key = 'rental'
         and ur.user_id = auth.uid()
         and ur.status = 'active'
         and rc.capability_key = p_permission_key
    ) into v_has_capability;
    return coalesce(v_has_capability, false);
  end if;

  -- Legacy R17 branch, verbatim (20261001070500): explicit override wins in
  -- both directions (mirrors normalizeOverrides + grant/delete).
  if v_overrides ? p_permission_key then
    return (v_overrides ->> p_permission_key) = 'true';
  end if;

  -- Finding 2: team.manage is never granted to staff by this predicate.
  if p_permission_key = 'team.manage' then
    return false;
  end if;

  -- Role defaults (mirror of ROLE_DEFAULT_PERMISSIONS in src/lib/rental/permissions.js).
  -- property_manager/manager: everything except team.manage (rejected above).
  case v_role
    when 'property_manager', 'manager' then
      return true;
    when 'bookkeeper' then
      return p_permission_key in (
        'payments.record', 'vendor_bills.manage', 'vendor_payments.record',
        'transfers.record', 'reports.view'
      );
    when 'maintenance' then
      return p_permission_key in ('maintenance.manage', 'messages.send');
    when 'marketing' then
      return p_permission_key in ('properties.manage', 'messages.send');
    else
      -- read_only and unknown roles: deny by default.
      return false;
  end case;
end;
$$;

comment on function public.has_rental_permission(text, text) is
'DB-enforced rental permission predicate. R17 legacy keys keep their NO-GO-fix semantics. Keys in the rental.* namespace resolve only through the admin role framework (rental_user_roles + rental_role_capabilities); owner/co-owner-only finance keys are never effective for staff. Deny-by-default.';

-- ============================================================================
-- 4. Role framework RPCs. All SECURITY DEFINER, search_path = '' (every
--    reference schema-qualified), row_security = off (the RPCs are the only
--    writers; they enforce the actor checks themselves). EXECUTE is granted
--    to authenticated only; PUBLIC/anon are revoked explicitly.
--
-- Actor model (all RPCs derive the actor from auth.uid()):
--   * Privileged = the workspace owner (p_owner_id = auth.uid()) or an
--     active co_owner row. Privileged actors hold every catalog key.
--   * Staff admin = a user holding an ACTIVE rental_user_roles assignment
--     whose role lists 'rental.roles.manage'. Staff admins are bound by a
--     fixed server-enforced ceiling: they may only grant keys they
--     themselves hold, they may never grant 'rental.roles.manage', they may
--     never put an owner-only finance key on a role, they may not edit their
--     own assignment, owner/co-owner assignments (which do not exist — owner
--     and co-owner are implicit), or other admin roles (any role listing
--     'rental.roles.manage').
--   * Every other caller is denied.
-- ============================================================================

-- The slice-1 capability catalog (must match src/lib/rental/adminPermissions.js
-- RENTAL_ADMIN_CAPABILITIES). Single source of truth for RPC validation.
create or replace function public.rental_admin_catalog_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'rental.dashboard.read', 'rental.properties.read', 'rental.properties.create',
    'rental.properties.edit', 'rental.properties.archive',
    'rental.billing.read', 'rental.billing.activate', 'rental.billing.settings.edit',
    'rental.payments.read', 'rental.payments.record_offline', 'rental.payments.refund',
    'rental.credits.issue', 'rental.credits.apply', 'rental.credits.void',
    'rental.tenants.read', 'rental.tenants.create', 'rental.tenants.edit',
    'rental.tenants.remove', 'rental.tenants.invite',
    'rental.leases.read', 'rental.leases.create', 'rental.leases.terms.edit', 'rental.leases.end',
    'rental.charges.read', 'rental.schedules.read', 'rental.charges.generate',
    'rental.charges.adjust', 'rental.charges.void', 'rental.schedules.edit',
    'rental.deposits.read', 'rental.deposits.record', 'rental.deposits.adjust', 'rental.deposits.refund',
    'rental.maintenance.read', 'rental.maintenance.create', 'rental.maintenance.edit',
    'rental.maintenance.assign', 'rental.maintenance.close',
    'rental.documents.read', 'rental.documents.upload', 'rental.documents.edit', 'rental.documents.delete',
    'rental.reports.read', 'rental.settings.read', 'rental.reports.export', 'rental.settings.edit',
    'rental.staff.read', 'rental.roles.read', 'rental.audit.read',
    'rental.staff.invite', 'rental.roles.manage'
  ];
$$;

-- Owner/co-owner-only finance keys: never effective for staff (see
-- has_rental_permission), and the RPCs refuse to put them on a role.
create or replace function public.rental_admin_owner_only_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'rental.billing.activate', 'rental.billing.settings.edit',
    'rental.payments.refund', 'rental.deposits.refund',
    'rental.credits.issue', 'rental.credits.apply', 'rental.credits.void'
  ];
$$;

-- Starter role defaults (must match src/lib/rental/adminPermissions.js
-- RENTAL_ADMIN_STARTER_ROLES). Owner/co-owner are implicit, not rows.
create or replace function public.rental_admin_starter_role_keys(p_role_name text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role_name
    when 'rental_admin' then array[
      'rental.dashboard.read', 'rental.properties.read', 'rental.properties.create',
      'rental.properties.edit', 'rental.properties.archive',
      'rental.billing.read', 'rental.payments.read', 'rental.payments.record_offline',
      'rental.tenants.read', 'rental.tenants.create', 'rental.tenants.edit',
      'rental.tenants.remove', 'rental.tenants.invite',
      'rental.leases.read', 'rental.leases.create', 'rental.leases.terms.edit', 'rental.leases.end',
      'rental.charges.read', 'rental.schedules.read', 'rental.charges.generate',
      'rental.charges.adjust', 'rental.charges.void', 'rental.schedules.edit',
      'rental.deposits.read', 'rental.deposits.record', 'rental.deposits.adjust',
      'rental.maintenance.read', 'rental.maintenance.create', 'rental.maintenance.edit',
      'rental.maintenance.assign', 'rental.maintenance.close',
      'rental.documents.read', 'rental.documents.upload', 'rental.documents.edit', 'rental.documents.delete',
      'rental.reports.read', 'rental.settings.read', 'rental.reports.export', 'rental.settings.edit',
      'rental.staff.read', 'rental.roles.read', 'rental.audit.read'
    ]
    when 'manager' then array[
      'rental.dashboard.read', 'rental.properties.read', 'rental.properties.create', 'rental.properties.edit',
      'rental.tenants.read', 'rental.tenants.create', 'rental.tenants.edit',
      'rental.leases.read', 'rental.leases.create', 'rental.leases.terms.edit',
      'rental.charges.read', 'rental.schedules.read', 'rental.charges.generate',
      'rental.charges.adjust', 'rental.schedules.edit',
      'rental.maintenance.read', 'rental.maintenance.create', 'rental.maintenance.edit', 'rental.maintenance.assign',
      'rental.documents.read', 'rental.documents.upload', 'rental.documents.edit',
      'rental.reports.read'
    ]
    when 'bookkeeper' then array[
      'rental.dashboard.read', 'rental.properties.read', 'rental.tenants.read', 'rental.leases.read',
      'rental.billing.read', 'rental.payments.read', 'rental.charges.read', 'rental.schedules.read',
      'rental.deposits.read', 'rental.reports.read', 'rental.settings.read',
      'rental.payments.record_offline', 'rental.deposits.record'
    ]
    when 'read_only' then array[
      'rental.dashboard.read', 'rental.properties.read', 'rental.tenants.read',
      'rental.leases.read', 'rental.maintenance.read', 'rental.reports.read'
    ]
    else array[]::text[]
  end;
$$;

-- Is the caller privileged (owner or active co-owner) for this workspace?
create or replace function public.rental_admin_is_privileged(p_owner_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_workspace_access(p_owner_id);
$$;

-- The caller's effective new-framework keys for this workspace. Privileged
-- callers hold the whole catalog; staff hold their assigned role's keys;
-- everyone else holds nothing. Fail-closed on every path.
create or replace function public.rental_get_my_effective_permissions(p_owner_id text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_keys text[];
begin
  if auth.uid() is null then
    return array[]::text[];
  end if;
  if public.rental_admin_is_privileged(p_owner_id) then
    return public.rental_admin_catalog_keys();
  end if;
  select coalesce(array_agg(rc.capability_key order by rc.capability_key), array[]::text[])
    into v_keys
    from public.rental_user_roles ur
    join public.rental_role_capabilities rc on rc.role_id = ur.role_id
   where ur.owner_id = p_owner_id
     and ur.app_key = 'rental'
     and ur.user_id = auth.uid()
     and ur.status = 'active';
  return coalesce(v_keys, array[]::text[]);
end;
$$;

-- Internal: does the caller hold this new-framework key (privileged counts)?
create or replace function public.rental_admin_caller_has_key(p_owner_id text, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_key = any (public.rental_get_my_effective_permissions(p_owner_id));
$$;

-- Internal: validate a key list for a role write. Raises on unknown keys and
-- on owner-only finance keys (they can never be on a role). Staff actors are
-- additionally ceiling-checked by the caller (see rental_admin_ceiling_ok).
create or replace function public.rental_admin_validate_keys(p_keys text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_catalog text[] := public.rental_admin_catalog_keys();
  v_owner_only text[] := public.rental_admin_owner_only_keys();
begin
  if p_keys is null then
    return;
  end if;
  foreach v_key in array p_keys loop
    if not (v_key = any (v_catalog)) then
      raise exception 'Unknown permission key: %.', v_key using errcode = '22023';
    end if;
    if v_key = any (v_owner_only) then
      raise exception 'Permission % is owner/co-owner only and cannot be added to a role.', v_key using errcode = '42501';
    end if;
  end loop;
end;
$$;

-- Internal: the fixed server-enforced ceiling for staff admins. True when the
-- caller is privileged, or when every key in p_keys is one the caller already
-- holds AND the list contains neither rental.roles.manage nor an owner-only
-- finance key. A staff admin can never grant a permission they lack.
create or replace function public.rental_admin_ceiling_ok(p_owner_id text, p_keys text[])
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mine text[];
  v_key text;
begin
  if public.rental_admin_is_privileged(p_owner_id) then
    return true;
  end if;
  if p_keys is null then
    return true;
  end if;
  v_mine := public.rental_get_my_effective_permissions(p_owner_id);
  foreach v_key in array p_keys loop
    if v_key = 'rental.roles.manage' then
      return false;
    end if;
    if not (v_key = any (v_mine)) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Internal: require the caller to be a role manager (privileged, or staff
-- holding rental.roles.manage). Raises 42501 otherwise.
create or replace function public.rental_admin_require_manager(p_owner_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;
  if public.rental_admin_is_privileged(p_owner_id) then
    return;
  end if;
  if public.rental_admin_caller_has_key(p_owner_id, 'rental.roles.manage') then
    return;
  end if;
  raise exception 'Only the owner, co-owner, or a designated admin can manage roles.' using errcode = '42501';
end;
$$;

-- Internal: require the caller to hold a read key (privileged, or staff
-- holding the key). Raises 42501 otherwise.
create or replace function public.rental_admin_require_key(p_owner_id text, p_key text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;
  if public.rental_admin_caller_has_key(p_owner_id, p_key) then
    return;
  end if;
  raise exception 'Your role does not allow this. Missing permission: %.', p_key using errcode = '42501';
end;
$$;

-- Materialize the four starter roles for a workspace (idempotent). Privileged
-- only. Creates role definitions, never assignments: no user gains
-- permissions from this call alone.
create or replace function public.rental_ensure_starter_roles(p_owner_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_role_name text;
  v_display text;
  v_role_id text;
  v_keys text[];
  v_key text;
  v_created boolean;
begin
  if auth.uid() is null then
    raise exception 'An authenticated user is required.' using errcode = '42501';
  end if;
  if not public.rental_admin_is_privileged(p_owner_id) then
    raise exception 'Only the owner or co-owner can set up roles.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_owner_id, '')) = '' then
    raise exception 'A workspace owner id is required.' using errcode = '22023';
  end if;

  foreach v_role_name in array array['rental_admin', 'manager', 'bookkeeper', 'read_only'] loop
    v_display := case v_role_name
      when 'rental_admin' then 'Rental Admin'
      when 'manager' then 'Manager'
      when 'bookkeeper' then 'Bookkeeper'
      when 'read_only' then 'Read-only'
    end;
    v_role_id := 'rental_role_' || gen_random_uuid()::text;
    v_keys := public.rental_admin_starter_role_keys(v_role_name);
    insert into public.rental_roles (id, owner_id, app_key, name, display_name, is_system, version)
      values (v_role_id, p_owner_id, 'rental', v_role_name, v_display, true, 1)
      on conflict (owner_id, app_key, name) do nothing
      returning id into v_role_id;
    v_created := found;
    if not v_created then
      select id into v_role_id from public.rental_roles
       where owner_id = p_owner_id and app_key = 'rental' and name = v_role_name;
    end if;
    foreach v_key in array v_keys loop
      insert into public.rental_role_capabilities (role_id, capability_key)
        values (v_role_id, v_key)
        on conflict (role_id, capability_key) do nothing;
    end loop;
    if v_created then
      insert into public.rental_role_audit (owner_id, app_key, actor_user_id, action, target_role_id, detail)
        values (p_owner_id, 'rental', auth.uid(), 'role.seeded', v_role_id,
                jsonb_build_object('name', v_role_name, 'display_name', v_display));
    end if;
  end loop;

  return public.rental_list_roles(p_owner_id);
end;
$$;

-- List roles for a workspace with capabilities and active assignee counts.
-- Requires rental.roles.read (privileged callers hold every key).
create or replace function public.rental_list_roles(p_owner_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_result jsonb;
begin
  perform public.rental_admin_require_key(p_owner_id, 'rental.roles.read');
  select coalesce(jsonb_agg(role_json order by role_json ->> 'display_name'), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'display_name', r.display_name,
        'is_system', r.is_system,
        'version', r.version,
        'retired_at', r.retired_at,
        'capabilities', coalesce((
          select jsonb_agg(rc.capability_key order by rc.capability_key)
            from public.rental_role_capabilities rc where rc.role_id = r.id
        ), '[]'::jsonb),
        'active_assignee_count', (
          select count(*) from public.rental_user_roles ur
           where ur.role_id = r.id and ur.status = 'active'
        )
      ) as role_json
      from public.rental_roles r
     where r.owner_id = p_owner_id and r.app_key = 'rental'
    ) roles;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- Look up one user by exact user id or verified email. No enumeration: the
-- search must match exactly, and the caller must hold rental.roles.read.
-- Returns the R17 membership (if any) plus the current framework role.
create or replace function public.rental_lookup_user(p_owner_id text, p_search text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_user_id uuid;
  v_email text;
  v_membership record;
  v_assignment record;
  v_has_assignment boolean;
  v_keys text[];
begin
  perform public.rental_admin_require_key(p_owner_id, 'rental.roles.read');
  if btrim(coalesce(p_search, '')) = '' then
    raise exception 'Enter an exact user ID or email address.' using errcode = '22023';
  end if;

  -- Exact match only: a uuid looks the user up by id; anything else must be
  -- an exact (case-insensitive) verified email.
  begin
    v_user_id := btrim(p_search)::uuid;
  exception when others then
    v_user_id := null;
  end;
  if v_user_id is not null then
    select id, lower(nullif(btrim(email), '')) as email
      into v_user_id, v_email
      from auth.users where id = v_user_id;
  else
    select id, lower(nullif(btrim(email), '')) as email
      into v_user_id, v_email
      from auth.users
     where lower(nullif(btrim(email), '')) = lower(btrim(p_search))
       and email_confirmed_at is not null;
  end if;
  if v_user_id is null then
    raise exception 'No account was found for that exact user ID or verified email.' using errcode = '22023';
  end if;

  select role, status, invited_email
    into v_membership
    from public.workspace_members
   where owner_id = p_owner_id and member_user_id = v_user_id;

  select ur.role_id, r.name, r.display_name
    into v_assignment
    from public.rental_user_roles ur
    join public.rental_roles r on r.id = ur.role_id
   where ur.owner_id = p_owner_id and ur.app_key = 'rental'
     and ur.user_id = v_user_id and ur.status = 'active';
  -- NB: never test a record with IS NULL after SELECT INTO: a row that
  -- contains ANY null field makes both IS NULL and IS NOT NULL false
  -- (three-valued row logic). FOUND is the reliable existence test.
  v_has_assignment := found;

  if not v_has_assignment then
    v_keys := array[]::text[];
  else
    select coalesce(array_agg(capability_key order by capability_key), array[]::text[])
      into v_keys
      from public.rental_role_capabilities where role_id = v_assignment.role_id;
  end if;

  return jsonb_build_object(
    'user_id', v_user_id,
    'email', coalesce(v_email, v_membership.invited_email),
    'r17_role', v_membership.role,
    'r17_status', v_membership.status,
    'current_role', case when not v_has_assignment then null else
      jsonb_build_object('id', v_assignment.role_id, 'name', v_assignment.name, 'display_name', v_assignment.display_name)
    end,
    'effective_keys', coalesce(v_keys, array[]::text[])
  );
end;
$$;

-- Internal: the user-role jsonb for one user, with NO permission check.
-- The public RPCs check first; the mutation RPCs call this directly because
-- a role manager (rental.roles.manage) need not also hold rental.roles.read
-- to see the assignment they just made.
create or replace function public.rental_admin_user_role_json(p_owner_id text, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_membership record;
  v_assignment record;
  v_has_assignment boolean;
  v_keys text[];
  v_email text;
begin
  select lower(nullif(btrim(email), '')) into v_email from auth.users where id = p_user_id;

  select role, status, invited_email
    into v_membership
    from public.workspace_members
   where owner_id = p_owner_id and member_user_id = p_user_id;

  select ur.role_id, r.name, r.display_name
    into v_assignment
    from public.rental_user_roles ur
    join public.rental_roles r on r.id = ur.role_id
   where ur.owner_id = p_owner_id and ur.app_key = 'rental'
     and ur.user_id = p_user_id and ur.status = 'active';
  -- NB: never test a record with IS NULL after SELECT INTO (see
  -- rental_lookup_user): FOUND is the reliable existence test.
  v_has_assignment := found;

  if not v_has_assignment then
    v_keys := array[]::text[];
  else
    select coalesce(array_agg(capability_key order by capability_key), array[]::text[])
      into v_keys
      from public.rental_role_capabilities where role_id = v_assignment.role_id;
  end if;

  return jsonb_build_object(
    'user_id', p_user_id,
    'email', coalesce(v_email, v_membership.invited_email),
    'r17_role', v_membership.role,
    'r17_status', v_membership.status,
    'current_role', case when not v_has_assignment then null else
      jsonb_build_object('id', v_assignment.role_id, 'name', v_assignment.name, 'display_name', v_assignment.display_name)
    end,
    'effective_keys', coalesce(v_keys, array[]::text[])
  );
end;
$$;

-- The caller's own framework role + effective keys for one user. Same shape
-- as rental_lookup_user but addressed by user id directly.
create or replace function public.rental_get_user_role(p_owner_id text, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
begin
  perform public.rental_admin_require_key(p_owner_id, 'rental.roles.read');
  if p_user_id is null then
    raise exception 'A user id is required.' using errcode = '22023';
  end if;
  return public.rental_admin_user_role_json(p_owner_id, p_user_id);
end;
$$;

-- Assign a role to a user. Transactional: revoke any existing active
-- assignment, insert the new one, audit both. Idempotent on request_id.
-- The target must hold an ACTIVE workspace_members row in this workspace;
-- the owner and co-owner are implicit and cannot be assigned a role.
create or replace function public.rental_assign_role(p_owner_id text, p_user_id uuid, p_role_id text, p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_role record;
  v_role_keys text[];
  v_existing record;
  v_prior record;
  v_has_prior boolean;
  v_assignment_id text;
  v_membership_role text;
begin
  perform public.rental_admin_require_manager(p_owner_id);
  if p_user_id is null or btrim(coalesce(p_role_id, '')) = '' or btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'A user id, role id, and request id are required.' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() and not public.rental_admin_is_privileged(p_owner_id) then
    raise exception 'You cannot change your own role.' using errcode = '42501';
  end if;

  -- Idempotency: replaying the same request returns the existing assignment.
  -- NB: FOUND (not IS NOT NULL) is the existence test for a record: a row
  -- containing any null field makes both IS NULL and IS NOT NULL false.
  select * into v_existing from public.rental_user_roles
   where owner_id = p_owner_id and app_key = 'rental' and user_id = p_user_id and request_id = p_request_id;
  if found then
    if v_existing.role_id <> p_role_id then
      raise exception 'This request was already used to assign a different role.' using errcode = '23505';
    end if;
    return public.rental_admin_user_role_json(p_owner_id, p_user_id);
  end if;

  select id, name, display_name, retired_at into v_role
    from public.rental_roles
   where id = p_role_id and owner_id = p_owner_id and app_key = 'rental';
  if not found then
    raise exception 'No role with that id exists in this workspace.' using errcode = '22023';
  end if;
  if v_role.retired_at is not null then
    raise exception 'That role has been retired.' using errcode = '22023';
  end if;

  -- The target must be an active team member of this workspace. The owner
  -- has no membership row; a co-owner already holds full access.
  select role into v_membership_role from public.workspace_members
   where owner_id = p_owner_id and member_user_id = p_user_id and status = 'active';
  if v_membership_role is null then
    raise exception 'That user does not have an active team membership in this workspace.' using errcode = '22023';
  end if;
  if v_membership_role = 'co_owner' then
    raise exception 'A co-owner already has full access and cannot be assigned a role.' using errcode = '22023';
  end if;

  -- Fixed ceiling: a staff admin may only assign keys they hold, and may
  -- never assign a role that carries rental.roles.manage.
  select coalesce(array_agg(capability_key order by capability_key), array[]::text[])
    into v_role_keys from public.rental_role_capabilities where role_id = p_role_id;
  if not public.rental_admin_ceiling_ok(p_owner_id, v_role_keys) then
    raise exception 'You cannot assign a role with permissions you do not hold.' using errcode = '42501';
  end if;

  -- Revoke any existing active assignment first (one active role per user).
  select * into v_prior from public.rental_user_roles
   where owner_id = p_owner_id and app_key = 'rental' and user_id = p_user_id and status = 'active';
  v_has_prior := found;
  if v_has_prior and v_prior.role_id = p_role_id then
    -- Already holds this role: return the current assignment (no-op).
    return public.rental_admin_user_role_json(p_owner_id, p_user_id);
  end if;
  if v_has_prior then
    update public.rental_user_roles
       set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
     where id = v_prior.id;
    insert into public.rental_role_audit (owner_id, app_key, actor_user_id, action, target_role_id, target_user_id, detail)
      values (p_owner_id, 'rental', auth.uid(), 'role.revoked', v_prior.role_id, p_user_id,
              jsonb_build_object('request_id', p_request_id, 'superseded_by', p_role_id));
  end if;

  v_assignment_id := 'rental_user_role_' || gen_random_uuid()::text;
  insert into public.rental_user_roles (id, owner_id, app_key, user_id, role_id, status, request_id, assigned_by)
    values (v_assignment_id, p_owner_id, 'rental', p_user_id, p_role_id, 'active', p_request_id, auth.uid());
  insert into public.rental_role_audit (owner_id, app_key, actor_user_id, action, target_role_id, target_user_id, detail)
    values (p_owner_id, 'rental', auth.uid(), 'role.assigned', p_role_id, p_user_id,
            jsonb_build_object('request_id', p_request_id, 'role_name', v_role.name,
                               'previous_role_id', v_prior.role_id));

  return public.rental_admin_user_role_json(p_owner_id, p_user_id);
end;
$$;

-- Revoke a user's active role. Transactional + audited. Idempotent on
-- request_id. Staff admins cannot revoke their own assignment.
create or replace function public.rental_revoke_role(p_owner_id text, p_user_id uuid, p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_existing record;
  v_active record;
begin
  perform public.rental_admin_require_manager(p_owner_id);
  if p_user_id is null or btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'A user id and request id are required.' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() and not public.rental_admin_is_privileged(p_owner_id) then
    raise exception 'You cannot change your own role.' using errcode = '42501';
  end if;

  select * into v_existing from public.rental_user_roles
   where owner_id = p_owner_id and app_key = 'rental' and user_id = p_user_id
     and request_id = p_request_id and status = 'revoked';
  if found then
    return public.rental_admin_user_role_json(p_owner_id, p_user_id);
  end if;

  select * into v_active from public.rental_user_roles
   where owner_id = p_owner_id and app_key = 'rental' and user_id = p_user_id and status = 'active';
  if not found then
    raise exception 'That user does not have an active role to revoke.' using errcode = '22023';
  end if;

  update public.rental_user_roles
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
   where id = v_active.id;
  insert into public.rental_role_audit (owner_id, app_key, actor_user_id, action, target_role_id, target_user_id, detail)
    values (p_owner_id, 'rental', auth.uid(), 'role.revoked', v_active.role_id, p_user_id,
            jsonb_build_object('request_id', p_request_id));

  return public.rental_admin_user_role_json(p_owner_id, p_user_id);
end;
$$;

-- Edit a role's capabilities. Optimistic version CAS: the update applies
-- only when the stored version equals p_expected_version; otherwise the
-- caller gets a stale-version error (the API maps it to 409 with a fresh
-- diff). The change + audit are atomic, and the new capabilities take
-- effect for all assignees on the next request (they are read live).
create or replace function public.rental_update_role(p_owner_id text, p_role_id text, p_add_keys text[], p_remove_keys text[], p_expected_version integer, p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_role record;
  v_key text;
  v_before text[];
  v_added text[] := array[]::text[];
  v_removed text[] := array[]::text[];
  v_affected integer;
  v_updated boolean;
begin
  perform public.rental_admin_require_manager(p_owner_id);
  if btrim(coalesce(p_role_id, '')) = '' or btrim(coalesce(p_request_id, '')) = '' or p_expected_version is null then
    raise exception 'A role id, expected version, and request id are required.' using errcode = '22023';
  end if;

  -- Idempotency: replaying an already-applied edit returns the current role.
  if exists (
    select 1 from public.rental_role_audit
     where owner_id = p_owner_id and action = 'role.updated' and target_role_id = p_role_id
       and detail ->> 'request_id' = p_request_id
  ) then
    return jsonb_build_object('role', (select row_to_json(r) from (select * from public.rental_roles where id = p_role_id) r),
                              'affected_user_count', (select count(*) from public.rental_user_roles where role_id = p_role_id and status = 'active'),
                              'added', '[]'::jsonb, 'removed', '[]'::jsonb, 'version', (select version from public.rental_roles where id = p_role_id));
  end if;

  select * into v_role from public.rental_roles
   where id = p_role_id and owner_id = p_owner_id and app_key = 'rental';
  if not found then
    raise exception 'No role with that id exists in this workspace.' using errcode = '22023';
  end if;
  if v_role.retired_at is not null then
    raise exception 'That role has been retired.' using errcode = '22023';
  end if;

  -- Staff admins may not edit another admin role (any role listing
  -- rental.roles.manage); only a privileged actor may.
  if not public.rental_admin_is_privileged(p_owner_id)
     and exists (select 1 from public.rental_role_capabilities
                  where role_id = p_role_id and capability_key = 'rental.roles.manage') then
    raise exception 'Only the owner or co-owner can edit an admin role.' using errcode = '42501';
  end if;

  if p_add_keys is not null then
    perform public.rental_admin_validate_keys(p_add_keys);
    if not public.rental_admin_ceiling_ok(p_owner_id, p_add_keys) then
      raise exception 'You cannot grant permissions you do not hold.' using errcode = '42501';
    end if;
    foreach v_key in array p_add_keys loop
      if p_remove_keys is not null and v_key = any (p_remove_keys) then
        raise exception 'Permission % cannot be both added and removed.' , v_key using errcode = '22023';
      end if;
    end loop;
  end if;
  if p_remove_keys is not null then
    perform public.rental_admin_validate_keys(p_remove_keys);
  end if;

  select coalesce(array_agg(capability_key order by capability_key), array[]::text[])
    into v_before from public.rental_role_capabilities where role_id = p_role_id;

  -- Optimistic CAS: exactly one row must match the expected version.
  update public.rental_roles
     set version = version + 1, updated_at = now()
   where id = p_role_id and version = p_expected_version;
  v_updated := found;
  if not v_updated then
    select version into v_role.version from public.rental_roles where id = p_role_id;
    raise exception 'This role was changed by someone else (stale version: expected %, current %). Reload and try again.',
      p_expected_version, v_role.version using errcode = 'P0001';
  end if;

  if p_add_keys is not null then
    foreach v_key in array p_add_keys loop
      if not (v_key = any (v_before)) then
        insert into public.rental_role_capabilities (role_id, capability_key)
          values (p_role_id, v_key) on conflict (role_id, capability_key) do nothing;
        v_added := array_append(v_added, v_key);
      end if;
    end loop;
  end if;
  if p_remove_keys is not null then
    foreach v_key in array p_remove_keys loop
      if v_key = any (v_before) then
        delete from public.rental_role_capabilities where role_id = p_role_id and capability_key = v_key;
        v_removed := array_append(v_removed, v_key);
      end if;
    end loop;
  end if;

  select count(*) into v_affected from public.rental_user_roles
   where role_id = p_role_id and status = 'active';

  insert into public.rental_role_audit (owner_id, app_key, actor_user_id, action, target_role_id, detail)
    values (p_owner_id, 'rental', auth.uid(), 'role.updated', p_role_id,
            jsonb_build_object(
              'request_id', p_request_id,
              'previous_version', p_expected_version,
              'new_version', p_expected_version + 1,
              'added', v_added, 'removed', v_removed,
              'before', v_before,
              'affected_user_count', v_affected));

  return jsonb_build_object(
    'role', (select row_to_json(r) from (select * from public.rental_roles where id = p_role_id) r),
    'affected_user_count', v_affected,
    'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed),
    'version', p_expected_version + 1);
end;
$$;

-- Create a custom role. The name must be unique per workspace; a replay of
-- the same request returns the role created the first time.
create or replace function public.rental_create_role(p_owner_id text, p_name text, p_display_name text, p_keys text[], p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_existing record;
  v_role_id text;
  v_key text;
begin
  perform public.rental_admin_require_manager(p_owner_id);
  if btrim(coalesce(p_name, '')) = '' or btrim(coalesce(p_display_name, '')) = '' or btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'A role name, display name, and request id are required.' using errcode = '22023';
  end if;
  if p_keys is not null then
    perform public.rental_admin_validate_keys(p_keys);
    if not public.rental_admin_ceiling_ok(p_owner_id, p_keys) then
      raise exception 'You cannot grant permissions you do not hold.' using errcode = '42501';
    end if;
  end if;

  select * into v_existing from public.rental_roles
   where owner_id = p_owner_id and app_key = 'rental' and name = btrim(p_name);
  if found then
    if exists (
      select 1 from public.rental_role_audit
       where owner_id = p_owner_id and action = 'role.created' and target_role_id = v_existing.id
         and detail ->> 'request_id' = p_request_id
    ) then
      return jsonb_build_object('role', (select row_to_json(r) from (select * from public.rental_roles where id = v_existing.id) r));
    end if;
    raise exception 'A role with that name already exists.' using errcode = '23505';
  end if;

  v_role_id := 'rental_role_' || gen_random_uuid()::text;
  insert into public.rental_roles (id, owner_id, app_key, name, display_name, is_system, version)
    values (v_role_id, p_owner_id, 'rental', btrim(p_name), btrim(p_display_name), false, 1);
  if p_keys is not null then
    foreach v_key in array p_keys loop
      insert into public.rental_role_capabilities (role_id, capability_key)
        values (v_role_id, v_key) on conflict (role_id, capability_key) do nothing;
    end loop;
  end if;
  insert into public.rental_role_audit (owner_id, app_key, actor_user_id, action, target_role_id, detail)
    values (p_owner_id, 'rental', auth.uid(), 'role.created', v_role_id,
            jsonb_build_object('request_id', p_request_id, 'name', btrim(p_name),
                               'display_name', btrim(p_display_name), 'keys', coalesce(p_keys, array[]::text[])));

  return jsonb_build_object('role', (select row_to_json(r) from (select * from public.rental_roles where id = v_role_id) r));
end;
$$;

-- Retire a role. Refuses when active assignees exist unless a reassignment
-- role is given (every assignee is moved first, each move audited). Staff
-- admins may not retire an admin role.
create or replace function public.rental_retire_role(p_owner_id text, p_role_id text, p_reassign_role_id text, p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_role record;
  v_reassign record;
  v_assignee record;
  v_count integer;
begin
  perform public.rental_admin_require_manager(p_owner_id);
  if btrim(coalesce(p_role_id, '')) = '' or btrim(coalesce(p_request_id, '')) = '' then
    raise exception 'A role id and request id are required.' using errcode = '22023';
  end if;

  select * into v_role from public.rental_roles
   where id = p_role_id and owner_id = p_owner_id and app_key = 'rental';
  if not found then
    raise exception 'No role with that id exists in this workspace.' using errcode = '22023';
  end if;
  if v_role.retired_at is not null then
    return jsonb_build_object('role', (select row_to_json(r) from (select * from public.rental_roles where id = p_role_id) r),
                              'reassigned_count', 0);
  end if;
  if v_role.is_system then
    raise exception 'A starter role cannot be retired.' using errcode = '22023';
  end if;
  if not public.rental_admin_is_privileged(p_owner_id)
     and exists (select 1 from public.rental_role_capabilities
                  where role_id = p_role_id and capability_key = 'rental.roles.manage') then
    raise exception 'Only the owner or co-owner can retire an admin role.' using errcode = '42501';
  end if;

  select count(*) into v_count from public.rental_user_roles
   where role_id = p_role_id and status = 'active';
  if v_count > 0 and (p_reassign_role_id is null or btrim(p_reassign_role_id) = '') then
    raise exception 'That role still has % active member(s). Choose a role to move them to first.', v_count using errcode = '22023';
  end if;

  if v_count > 0 then
    select * into v_reassign from public.rental_roles
     where id = p_reassign_role_id and owner_id = p_owner_id and app_key = 'rental';
    if not found then
      raise exception 'The reassignment role does not exist or is retired.' using errcode = '22023';
    end if;
    if v_reassign.retired_at is not null then
      raise exception 'The reassignment role does not exist or is retired.' using errcode = '22023';
    end if;
    if v_reassign.id = p_role_id then
      raise exception 'A role cannot be reassigned to itself.' using errcode = '22023';
    end if;
    for v_assignee in
      select user_id from public.rental_user_roles
       where role_id = p_role_id and status = 'active'
    loop
      perform public.rental_assign_role(p_owner_id, v_assignee.user_id, v_reassign.id,
                                        p_request_id || ':' || v_assignee.user_id::text);
    end loop;
  end if;

  update public.rental_roles
     set retired_at = now(), version = version + 1, updated_at = now()
   where id = p_role_id;
  insert into public.rental_role_audit (owner_id, app_key, actor_user_id, action, target_role_id, detail)
    values (p_owner_id, 'rental', auth.uid(), 'role.retired', p_role_id,
            jsonb_build_object('request_id', p_request_id,
                               'reassigned_count', v_count,
                               'reassign_role_id', p_reassign_role_id));

  return jsonb_build_object('role', (select row_to_json(r) from (select * from public.rental_roles where id = p_role_id) r),
                            'reassigned_count', v_count);
end;
$$;

-- Audit timeline for a workspace (newest first). Requires rental.audit.read.
create or replace function public.rental_get_role_audit(p_owner_id text, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_result jsonb;
begin
  perform public.rental_admin_require_key(p_owner_id, 'rental.audit.read');
  select coalesce(jsonb_agg(entry order by entry ->> 'created_at' desc), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
        'id', a.id, 'action', a.action,
        'actor_user_id', a.actor_user_id,
        'target_role_id', a.target_role_id,
        'target_user_id', a.target_user_id,
        'detail', a.detail, 'created_at', a.created_at
      ) as entry
      from public.rental_role_audit a
     where a.owner_id = p_owner_id and a.app_key = 'rental'
     order by a.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) entries;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- ============================================================================
-- 5. Function privileges: revoke the Supabase default EXECUTE, grant
--    EXECUTE to authenticated only. The RPCs enforce the actor checks
--    themselves; no function is callable by anon. The revoke MUST name the
--    roles explicitly (public, anon, authenticated, service_role):
--    production's default privileges grant EXECUTE to the named roles with
--    no PUBLIC entry, so REVOKE ... FROM public alone is a no-op and anon
--    keeps EXECUTE (PR #766 P1 — the original from-public-only form passed
--    the proof 20/20 on a clean cluster and failed G3 under Supabase-like
--    defaults, and anon could call rental_admin_user_role_json).
-- ============================================================================

revoke all on function public.rental_admin_catalog_keys() from public, anon, authenticated, service_role;
revoke all on function public.rental_admin_owner_only_keys() from public, anon, authenticated, service_role;
revoke all on function public.rental_admin_starter_role_keys(text) from public, anon, authenticated, service_role;
revoke all on function public.rental_admin_is_privileged(text) from public, anon, authenticated, service_role;
revoke all on function public.rental_get_my_effective_permissions(text) from public, anon, authenticated, service_role;
revoke all on function public.rental_admin_caller_has_key(text, text) from public, anon, authenticated, service_role;
revoke all on function public.rental_admin_validate_keys(text[]) from public, anon, authenticated, service_role;
revoke all on function public.rental_admin_ceiling_ok(text, text[]) from public, anon, authenticated, service_role;
revoke all on function public.rental_admin_require_manager(text) from public, anon, authenticated, service_role;
revoke all on function public.rental_admin_require_key(text, text) from public, anon, authenticated, service_role;
revoke all on function public.rental_ensure_starter_roles(text) from public, anon, authenticated, service_role;
revoke all on function public.rental_list_roles(text) from public, anon, authenticated, service_role;
revoke all on function public.rental_lookup_user(text, text) from public, anon, authenticated, service_role;
revoke all on function public.rental_admin_user_role_json(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.rental_get_user_role(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.rental_assign_role(text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.rental_revoke_role(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.rental_update_role(text, text, text[], text[], integer, text) from public, anon, authenticated, service_role;
revoke all on function public.rental_create_role(text, text, text, text[], text) from public, anon, authenticated, service_role;
revoke all on function public.rental_retire_role(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.rental_get_role_audit(text, integer) from public, anon, authenticated, service_role;

grant execute on function public.rental_admin_catalog_keys() to authenticated;
grant execute on function public.rental_admin_owner_only_keys() to authenticated;
grant execute on function public.rental_admin_starter_role_keys(text) to authenticated;
grant execute on function public.rental_admin_is_privileged(text) to authenticated;
grant execute on function public.rental_get_my_effective_permissions(text) to authenticated;
grant execute on function public.rental_admin_caller_has_key(text, text) to authenticated;
grant execute on function public.rental_admin_validate_keys(text[]) to authenticated;
grant execute on function public.rental_admin_ceiling_ok(text, text[]) to authenticated;
grant execute on function public.rental_admin_require_manager(text) to authenticated;
grant execute on function public.rental_admin_require_key(text, text) to authenticated;
grant execute on function public.rental_ensure_starter_roles(text) to authenticated;
grant execute on function public.rental_list_roles(text) to authenticated;
grant execute on function public.rental_lookup_user(text, text) to authenticated;
grant execute on function public.rental_admin_user_role_json(text, uuid) to authenticated;
grant execute on function public.rental_get_user_role(text, uuid) to authenticated;
grant execute on function public.rental_assign_role(text, uuid, text, text) to authenticated;
grant execute on function public.rental_revoke_role(text, uuid, text) to authenticated;
grant execute on function public.rental_update_role(text, text, text[], text[], integer, text) to authenticated;
grant execute on function public.rental_create_role(text, text, text, text[], text) to authenticated;
grant execute on function public.rental_retire_role(text, text, text, text) to authenticated;
grant execute on function public.rental_get_role_audit(text, integer) to authenticated;

-- ============================================================================
-- 6. Additive RLS policies: migrate the low-risk tenant and maintenance
--    surfaces to the new keys. Existing policies are untouched (these are
--    OR-ed with them). No DELETE policy is added in slice 1: deletes stay
--    owner/co-owner only (fail-closed; the proof asserts this).
--
-- Tenants (rental_tenants):
--   * SELECT on rental.tenants.read (read-only roles see the list).
--   * INSERT on rental.tenants.create.
--   * UPDATE on rental.tenants.edit OR rental.tenants.invite. PostgreSQL
--     has no column-scoped UPDATE policies, so the invite key cannot be
--     column-scoped at the RLS layer; its separation is enforced at the
--     invite action (see the JS gate in _actions/tenants.js). Known gap,
--     recorded in the manifest: a direct DB call holding only the invite
--     key could update other tenant columns.
-- Maintenance (rental_maintenance_requests / rental_maintenance_work_orders):
--   * SELECT on rental.maintenance.read (requests; work orders are already
--     readable through the R17 visibility policy).
--   * INSERT on rental.maintenance.create; UPDATE on rental.maintenance.edit
--     OR rental.maintenance.assign OR rental.maintenance.close.
--   * The existing R17 work-order staff_write policy (maintenance.manage)
--     stays in place; the new policies add access for framework assignees
--     whose R17 role does not carry maintenance.manage.
--
-- Reports: the reports route is gated in the API layer (rental.reports.read
-- for a view, rental.reports.export for CSV) on top of the existing
-- visibility behavior; the underlying tables are not re-policied in slice 1.
-- See src/lib/rental/adminPermissions.js (the enforcement manifest).
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rental_tenants' and policyname = 'rental_tenants_admin_read') then
    create policy "rental_tenants_admin_read" on public.rental_tenants
      for select to authenticated
      using (public.has_rental_permission(owner_id, 'rental.tenants.read'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rental_tenants' and policyname = 'rental_tenants_admin_insert') then
    create policy "rental_tenants_admin_insert" on public.rental_tenants
      for insert to authenticated
      with check (public.has_rental_permission(owner_id, 'rental.tenants.create'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rental_tenants' and policyname = 'rental_tenants_admin_update') then
    -- NOTE: PostgreSQL has no column-scoped UPDATE policies (the FOR
    -- UPDATE OF ... form is a GRANT construct, not CREATE POLICY), so the
    -- invite key cannot be column-scoped here. The UPDATE policy therefore
    -- permits edit OR invite, and the invite key's separation is enforced
    -- at the invite action (src/app/api/rental/_actions/tenants.js), which
    -- requires rental.tenants.invite (or workspace access) before touching
    -- invited_at/status. Known slice-1 gap, recorded in the enforcement
    -- manifest: a direct DB call holding only the invite key could update
    -- other tenant columns; column-level enforcement (trigger or invite
    -- RPC) is a follow-on.
    create policy "rental_tenants_admin_update" on public.rental_tenants
      for update to authenticated
      using (
        public.has_rental_permission(owner_id, 'rental.tenants.edit')
        or public.has_rental_permission(owner_id, 'rental.tenants.invite')
      )
      with check (
        public.has_rental_permission(owner_id, 'rental.tenants.edit')
        or public.has_rental_permission(owner_id, 'rental.tenants.invite')
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rental_maintenance_requests' and policyname = 'rental_maintenance_requests_admin_read') then
    create policy "rental_maintenance_requests_admin_read" on public.rental_maintenance_requests
      for select to authenticated
      using (public.has_rental_permission(owner_id, 'rental.maintenance.read'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rental_maintenance_requests' and policyname = 'rental_maintenance_requests_admin_insert') then
    create policy "rental_maintenance_requests_admin_insert" on public.rental_maintenance_requests
      for insert to authenticated
      with check (public.has_rental_permission(owner_id, 'rental.maintenance.create'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rental_maintenance_requests' and policyname = 'rental_maintenance_requests_admin_update') then
    create policy "rental_maintenance_requests_admin_update" on public.rental_maintenance_requests
      for update to authenticated
      using (
        public.has_rental_permission(owner_id, 'rental.maintenance.edit')
        or public.has_rental_permission(owner_id, 'rental.maintenance.assign')
        or public.has_rental_permission(owner_id, 'rental.maintenance.close')
      )
      with check (
        public.has_rental_permission(owner_id, 'rental.maintenance.edit')
        or public.has_rental_permission(owner_id, 'rental.maintenance.assign')
        or public.has_rental_permission(owner_id, 'rental.maintenance.close')
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rental_maintenance_work_orders' and policyname = 'rental_maintenance_work_orders_admin_insert') then
    create policy "rental_maintenance_work_orders_admin_insert" on public.rental_maintenance_work_orders
      for insert to authenticated
      with check (public.has_rental_permission(owner_id, 'rental.maintenance.create'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rental_maintenance_work_orders' and policyname = 'rental_maintenance_work_orders_admin_update') then
    create policy "rental_maintenance_work_orders_admin_update" on public.rental_maintenance_work_orders
      for update to authenticated
      using (
        public.has_rental_permission(owner_id, 'rental.maintenance.edit')
        or public.has_rental_permission(owner_id, 'rental.maintenance.assign')
        or public.has_rental_permission(owner_id, 'rental.maintenance.close')
      )
      with check (
        public.has_rental_permission(owner_id, 'rental.maintenance.edit')
        or public.has_rental_permission(owner_id, 'rental.maintenance.assign')
        or public.has_rental_permission(owner_id, 'rental.maintenance.close')
      );
  end if;
end $$;

-- End of slice 1 migration. Nothing in this file touches has_workspace_access,
-- the PR #753 billing policies/RPCs, workspace_members, or any other app's
-- permissions. The role tables start empty; starter roles are materialized
-- only by rental_ensure_starter_roles (owner/co-owner only).
