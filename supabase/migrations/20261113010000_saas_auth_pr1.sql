-- =============================================================================
-- SaaS Auth PR 1 — shared identity, membership, operator registry,
-- entitlement enforcement (implementable build brief:
-- results/chatgpt/saas-auth-pr1-implementable-build-brief-2026-11-13.md).
--
-- FILE ONLY. DO NOT APPLY without Jason's separate word (migration apply is
-- a separate approval after merge). Owner decisions D1–D8 approved as
-- recommended 2026-11-13 (results/muse/saas-auth-pr1-owner-decisions-2026-11-13.md).
--
-- Design (inventory-first, reuse-don't-duplicate):
--   * workspace_members is EXTENDED, not replaced: multi-workspace
--     membership (the one-active-workspace partial unique index is dropped —
--     the 20260829 migration named relaxing it as the intended extension
--     point), status gains 'revoked', role gains 'workspace_admin' (D3),
--     revoked_by/revoked_reason added. forge_workspace_memberships is a
--     compatibility VIEW over it.
--   * has_workspace_access() is NOT touched and NOT broadened anywhere.
--     Platform operators never become workspace members through it.
--   * forge_workspaces is keyed by the existing owner_id (text), the same
--     key every table already uses. Backfill creates one ACTIVE workspace
--     per distinct live owner_id so current use is preserved; NEW workspaces
--     provision as 'pending' and deny app access until activated.
--   * forge_app_entitlements backfill grants ACTIVE owner_manual
--     entitlements for all four apps on every pre-existing workspace — a
--     migration-time owner-authorized grant preserving live use. New
--     workspaces get 'pending' entitlements. verified_billing_webhook rows
--     are rejected until the webhook slice exists; owner_trial grants are
--     rejected until Jason decides the trial mechanics (open D7).
--   * forge_platform_operators and forge_programmer_grants are SEEDED EMPTY.
--     Bootstrap is BLOCKED until Jason confirms the two immutable
--     auth.users.id values out-of-band (D6). No email fallback anywhere.
--   * The server gate (require_forge_app_access) degrades to allow + warn
--     while this migration is not yet applied, so the code can deploy
--     before the migration applies. After apply, the gate is live and the
--     post-apply receipt must verify it.
--   * Direct-table RLS on the 100+ legacy tables is NOT rewritten here:
--     enforcement in PR 1 is at server routes + SECURITY DEFINER RPCs +
--     all new tables. The RLS-rewrite slice is a recorded follow-up
--     (CONTROL_MATRIX_AUTH1.csv AUTH-RES-1).
--
-- Live collision check, 2026-11-13 (sb-sql, project bzqvenxjlstinmgbuvvg):
--   * No forge_workspaces / forge_app_entitlements / forge_platform_operators /
--     forge_programmer_grants / forge_support_contexts / forge_security_audit /
--     forge_workspace_invitations / forge_app_roles* / forge_auth_idempotency_receipts
--     table exists in production. forge_clients/sites/projects owner_id is
--     text, matching workspace_members.
--   * Planner capability CHECK carries 45 keys, scheduling 23 keys (per
--     #797/#799 apply receipts). This migration does NOT recreate either
--     CHECK and touches neither catalog.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. workspace_members — multi-workspace membership, revoked status,
--    workspace_admin role, revocation metadata.
--    (CHECK-widening follows the R17 pattern: look the auto-named
--    constraint up by definition, drop it, re-add a named one.)
-- ---------------------------------------------------------------------------

-- The old role constraint (if any) is dropped first: a column can
-- carry several CHECKs, and an old IN-list would AND with the new
-- one and silently forbid the new role. pg_get_constraintdef
-- normalizes IN-lists to "= ANY (ARRAY[...])", so the match is on
-- the normalized form — and on the new name itself, so re-apply
-- drops what the first apply added instead of failing.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'workspace_members'::regclass
       and contype = 'c'
       and (conname = 'workspace_members_role_check_auth1'
            or pg_get_constraintdef(oid) ilike '%(role = any%')
  loop
    execute format('alter table workspace_members drop constraint %I', r.conname);
  end loop;
end
$$;

alter table workspace_members
  add constraint workspace_members_role_check_auth1
  check (role in (
    'primary_owner', 'co_owner', 'manager', 'property_manager',
    'bookkeeper', 'maintenance', 'marketing', 'read_only',
    'workspace_admin'
  ));

do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'workspace_members'::regclass
       and contype = 'c'
       and (conname = 'workspace_members_status_check_auth1'
            or pg_get_constraintdef(oid) ilike '%(status = any%')
  loop
    execute format('alter table workspace_members drop constraint %I', r.conname);
  end loop;
end
$$;

alter table workspace_members
  add constraint workspace_members_status_check_auth1
  check (status in ('invited', 'active', 'suspended', 'revoked'));

alter table workspace_members
  add column if not exists revoked_by uuid,
  add column if not exists revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 1000);

-- Multi-workspace membership: drop the one-active-workspace partial unique
-- index. The (owner_id, member_user_id) unique constraint still prevents
-- duplicate memberships in one workspace.
drop index if exists workspace_members_one_active_workspace_per_member;

-- D3: exactly one active workspace_admin per workspace.
create unique index if not exists workspace_members_one_active_admin_uq
  on workspace_members (owner_id)
  where role = 'workspace_admin' and status = 'active';

-- The legacy invite RPC enforced the old one-workspace rule at the RPC
-- level too ("That user already has an active workspace membership
-- elsewhere"). Remove that guard; the RPC keeps its existing-account,
-- verified-email and co_owner-only behavior otherwise.
create or replace function public.invite_workspace_member(p_email text, p_role text default 'co_owner')
returns workspace_members
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    owner_id_value text := auth.uid()::text;
    normalized_email text := lower(btrim(coalesce(p_email, '')));
    owner_email text;
    invitee_user_id uuid;
    invitee_confirmed_at timestamptz;
    new_id text;
    inserted workspace_members%rowtype;
begin
    if owner_id_value is null then
        raise exception 'An authenticated owner is required.' using errcode = '42501';
    end if;
    if normalized_email = '' then
        raise exception 'An email address is required.' using errcode = '22023';
    end if;
    if p_role <> 'co_owner' then
        raise exception 'Only co_owner invitations are supported in this release.' using errcode = '22023';
    end if;

    select lower(nullif(btrim(users.email), ''))
      into owner_email
      from auth.users users
     where users.id = auth.uid();
    if owner_email is not null and owner_email = normalized_email then
        raise exception 'You cannot invite yourself.' using errcode = '22023';
    end if;

    select users.id, users.email_confirmed_at
      into invitee_user_id, invitee_confirmed_at
      from auth.users users
     where lower(nullif(btrim(users.email), '')) = normalized_email;
    if invitee_user_id is null then
        raise exception 'No existing account was found for that email address.' using errcode = '22023';
    end if;
    if invitee_confirmed_at is null then
        raise exception 'That account has not confirmed its email address yet.' using errcode = '22023';
    end if;

    -- AUTH PR 1: the elsewhere-active guard is removed. One person may
    -- now hold active memberships in multiple workspaces; the
    -- (owner_id, member_user_id) upsert below still prevents duplicates
    -- inside one workspace.

    new_id := 'workspace_member_' || gen_random_uuid()::text;

    insert into workspace_members (
        owner_id, id, member_user_id, role, status, invited_email, invited_by
    ) values (
        owner_id_value, new_id, invitee_user_id, p_role, 'invited', normalized_email, auth.uid()
    )
    on conflict (owner_id, member_user_id) do update
        set role = excluded.role,
            status = 'invited',
            invited_email = excluded.invited_email,
            invited_by = excluded.invited_by,
            invited_at = now(),
            activated_at = null,
            suspended_at = null,
            updated_at = now()
    returning * into inserted;

    return inserted;
end;
$$;

-- Deterministic default workspace resolution now that one person may hold
-- several active memberships: the old LIMIT 1 was unordered. Single
-- membership behavior is unchanged; multi-membership resolves to the
-- lowest owner_id until PR 2 stores an explicit selection.
--
-- Fix round 1 (P2): the actor is NEVER caller-supplied. The parameter
-- stays (dropping the one-argument signature would orphan the
-- pre-existing dependents that call it, and the grants ride the
-- signature), but any explicit argument that is not the authenticated
-- user is refused with insufficient_privilege: an authenticated caller
-- passing another user's UUID learns nothing about that user's
-- workspace. The only in-repo callers that pass an explicit argument
-- are log_team_audit (R17 + repair), which pass actor := auth.uid()
-- verbatim, so no legitimate caller is affected. No separate
-- privileged internal resolver is created: no internal caller needs
-- to resolve for anyone but the authenticated user.
create or replace function public.resolve_effective_owner_id(p_actor uuid default auth.uid())
returns text
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
begin
  if p_actor is distinct from auth.uid() then
    raise exception 'resolve_effective_owner_id: actor must be the authenticated user'
      using errcode = 'insufficient_privilege';
  end if;
  return (
    select coalesce(
        (select owner_id from workspace_members
         where member_user_id = p_actor and status = 'active'
         order by owner_id
         limit 1),
        p_actor::text
    )
  );
end;
$$;

-- The replacement above keeps the 2026-08-29 grants, but this
-- migration owns the function now: state the ACL explicitly.
revoke all on function public.resolve_effective_owner_id(uuid) from public, anon, service_role;
grant execute on function public.resolve_effective_owner_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. forge_workspaces — the workspace registry, keyed by the existing
--    owner_id (text). The primary owner is implicit (no membership row),
--    exactly as the existing model.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_workspaces (
  owner_id text not null primary key,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 200),
  legal_name text check (legal_name is null or char_length(btrim(legal_name)) between 1 and 200),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'suspended', 'closed')),
  version integer not null default 1 check (version >= 1),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.forge_workspaces is
'SaaS Auth PR 1: workspace registry. owner_id is the existing workspace/security tenant key (text, auth.uid()::text); never a business-client id. Backfilled ACTIVE for pre-existing live workspaces; new workspaces provision as pending.';

alter table public.forge_workspaces enable row level security;
alter table public.forge_workspaces force row level security;

drop policy if exists forge_workspaces_select on public.forge_workspaces;
create policy forge_workspaces_select
  on public.forge_workspaces for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or exists (
      select 1 from public.workspace_members wm
      where wm.owner_id = forge_workspaces.owner_id
        and wm.member_user_id = auth.uid()
        and wm.status = 'active'
    )
  );

-- No direct DML policies: every write goes through the SECURITY DEFINER
-- RPCs below. Explicitly revoke the Supabase default grants.
revoke all on table public.forge_workspaces from public, anon, service_role, authenticated;
grant select on table public.forge_workspaces to authenticated;

-- Backfill: one ACTIVE workspace per distinct live owner_id. display_name
-- stays null for backfilled rows (no display-name source exists anywhere
-- in the codebase; the owner sets it later — everything editable).
insert into public.forge_workspaces (owner_id, display_name, legal_name, status, created_by, updated_by)
select owner_id, null, null, 'active', owner_id, owner_id
from (
  select owner_id from public.workspace_members
  union select owner_id from public.forge_clients
  union select owner_id from public.forge_work_packages
  union select owner_id from public.capture_library
  union select owner_id from public.designer_projects
  union select owner_id from public.rental_leases
) as owners
on conflict (owner_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. forge_app_entitlements — per-workspace, per-app entitlement state.
--    pending is the default and denies app access. source is nullable for
--    pending rows (no grant has happened yet).
-- ---------------------------------------------------------------------------

create table if not exists public.forge_app_entitlements (
  owner_id text not null,
  app_key text not null check (app_key in ('designer', 'scheduler', 'planner', 'capture')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'expired', 'suspended', 'revoked')),
  source text check (source is null or source in ('owner_manual', 'owner_trial', 'verified_billing_webhook')),
  starts_at timestamptz,
  ends_at timestamptz,
  granted_by text,
  grant_reason text check (grant_reason is null or char_length(grant_reason) <= 1000),
  external_reference text,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, app_key),
  check (starts_at is null or ends_at is null or starts_at < ends_at),
  check (status <> 'active' or source is not null),
  check (status <> 'active' or granted_by is not null)
);

comment on table public.forge_app_entitlements is
'SaaS Auth PR 1: per-workspace app entitlement. pending denies; active only within starts_at/ends_at and only after a trusted owner-authorized grant. One app active never enables another.';

alter table public.forge_app_entitlements enable row level security;
alter table public.forge_app_entitlements force row level security;

drop policy if exists forge_app_entitlements_select on public.forge_app_entitlements;
create policy forge_app_entitlements_select
  on public.forge_app_entitlements for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or exists (
      select 1 from public.workspace_members wm
      where wm.owner_id = forge_app_entitlements.owner_id
        and wm.member_user_id = auth.uid()
        and wm.status = 'active'
    )
  );

revoke all on table public.forge_app_entitlements from public, anon, service_role, authenticated;
grant select on table public.forge_app_entitlements to authenticated;

-- Backfill: ACTIVE owner_manual entitlements for all four apps on every
-- pre-existing workspace. This is the migration-time owner-authorized
-- grant preserving live use; it is NOT an automatic trial and does not
-- authorize any pilot or charge.
insert into public.forge_app_entitlements
  (owner_id, app_key, status, source, granted_by, grant_reason)
select w.owner_id, app.app_key, 'active', 'owner_manual', w.owner_id,
       'migration-20261113010000 backfill: pre-existing live workspace'
from public.forge_workspaces w
cross join (values ('designer'), ('scheduler'), ('planner'), ('capture')) as app(app_key)
on conflict (owner_id, app_key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. forge_workspace_memberships — compatibility VIEW over the extended
--    workspace_members (brief §2.1: reuse, don't duplicate).
-- ---------------------------------------------------------------------------

create or replace view public.forge_workspace_memberships as
select
  owner_id,
  member_user_id as user_id,
  role,
  status,
  invited_email,
  invited_by,
  invited_at,
  activated_at,
  suspended_at,
  revoked_by,
  revoked_reason,
  created_at,
  updated_at
from public.workspace_members;

-- ---------------------------------------------------------------------------
-- 5. forge_platform_operators — platform-operator registry keyed by stable
--    immutable auth.users.id. SEEDED EMPTY: bootstrap is BLOCKED until
--    Jason confirms the two IDs out-of-band (D6). No email/domain match,
--    no metadata flag, no self-service insert.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_platform_operators (
  user_id uuid not null primary key references auth.users(id) on delete cascade,
  platform_role text not null check (platform_role in ('owner', 'programmer', 'support')),
  is_active boolean not null default true,
  granted_by uuid references auth.users(id),
  verification_method text not null check (btrim(verification_method) <> ''),
  verification_reference text,
  grant_reason text not null check (char_length(btrim(grant_reason)) between 1 and 1000),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (revoked_at is null or revoked_by is not null)
);

comment on table public.forge_platform_operators is
'SaaS Auth PR 1: platform-operator registry. Seeded EMPTY; bootstrap only via reviewed migration/controlled operation with owner-confirmed immutable auth.users.id values. Not editable by workspace admins or clients.';

alter table public.forge_platform_operators enable row level security;
alter table public.forge_platform_operators force row level security;

-- An operator sees their own row. No workspace admin or client can list
-- the platform directory.
drop policy if exists forge_platform_operators_select on public.forge_platform_operators;
create policy forge_platform_operators_select
  on public.forge_platform_operators for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.forge_platform_operators from public, anon, service_role, authenticated;
grant select on table public.forge_platform_operators to authenticated;

-- ---------------------------------------------------------------------------
-- 6. forge_programmer_grants — stable-user-ID programmer authorization.
--    SEEDED EMPTY: no programmer is named yet (open D4). Email is never
--    authority; an email change neither grants nor removes privilege.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_programmer_grants (
  user_id uuid not null primary key references auth.users(id) on delete cascade,
  scope jsonb not null default '{"read_only_diagnostics": true}'::jsonb,
  is_active boolean not null default true,
  granted_by uuid not null references auth.users(id),
  grant_reason text not null check (char_length(btrim(grant_reason)) between 1 and 1000),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (revoked_at is null or revoked_by is not null)
);

comment on table public.forge_programmer_grants is
'SaaS Auth PR 1: programmer authorization by stable auth.users.id. Default scope is read-only diagnostics; any write or command execution needs separate owner approval.';

alter table public.forge_programmer_grants enable row level security;
alter table public.forge_programmer_grants force row level security;

drop policy if exists forge_programmer_grants_select on public.forge_programmer_grants;
create policy forge_programmer_grants_select
  on public.forge_programmer_grants for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.forge_programmer_grants from public, anon, service_role, authenticated;
grant select on table public.forge_programmer_grants to authenticated;

-- ---------------------------------------------------------------------------
-- 7. forge_support_contexts — short-lived, server-issued, audited support
--    contexts. Never a reusable impersonation token.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_support_contexts (
  id text not null primary key,
  operator_user_id uuid not null references auth.users(id) on delete cascade,
  target_owner_id text not null,
  purpose text not null check (char_length(btrim(purpose)) between 1 and 200),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  allowed_actions jsonb not null default '[]'::jsonb,
  allowed_apps text[] not null default '{}'::text[],
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 1000),
  request_id text not null unique,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (expires_at <= created_at + interval '8 hours'),
  check (revoked_at is null or revoked_by is not null)
);

comment on table public.forge_support_contexts is
'SaaS Auth PR 1: audited support contexts. Max lifetime 8 hours; explicit target workspace, purpose, allowed actions and apps; revocation effective immediately.';

create index if not exists forge_support_contexts_operator_idx
  on public.forge_support_contexts (operator_user_id, created_at desc);
create index if not exists forge_support_contexts_target_idx
  on public.forge_support_contexts (target_owner_id, created_at desc);

alter table public.forge_support_contexts enable row level security;
alter table public.forge_support_contexts force row level security;

drop policy if exists forge_support_contexts_select on public.forge_support_contexts;
create policy forge_support_contexts_select
  on public.forge_support_contexts for select to authenticated
  using (operator_user_id = auth.uid());

revoke all on table public.forge_support_contexts from public, anon, service_role, authenticated;
grant select on table public.forge_support_contexts to authenticated;

-- ---------------------------------------------------------------------------
-- 8. forge_security_audit — immutable, append-only security audit.
--    Mutations and their audit row commit or roll back together (every
--    mutating RPC below writes through forge_audit_event in the same
--    transaction). UPDATE/DELETE are revoked from every non-owner role and
--    no UPDATE/DELETE policy exists, so the table is append-only in
--    practice. No raw invite tokens, passwords, auth tokens or secrets
--    are ever logged.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_security_audit (
  id uuid not null default gen_random_uuid() primary key,
  actor_user_id uuid,
  actor_class text not null check (actor_class in ('owner', 'workspace_admin', 'member', 'platform_operator', 'programmer', 'support', 'system')),
  target_owner_id text,
  app_key text check (app_key is null or app_key in ('designer', 'scheduler', 'planner', 'capture', 'rental')),
  action text not null check (btrim(action) <> ''),
  entity_type text,
  entity_id text,
  before_json jsonb,
  after_json jsonb,
  reason text,
  request_id text,
  source text not null default 'rpc' check (btrim(source) <> ''),
  outcome text not null default 'allowed' check (outcome in ('allowed', 'denied')),
  created_at timestamptz not null default now()
);

create index if not exists forge_security_audit_target_idx
  on public.forge_security_audit (target_owner_id, created_at desc);
create index if not exists forge_security_audit_actor_idx
  on public.forge_security_audit (actor_user_id, created_at desc);
create index if not exists forge_security_audit_action_idx
  on public.forge_security_audit (action, created_at desc);

alter table public.forge_security_audit enable row level security;
alter table public.forge_security_audit force row level security;

-- Audit is readable by the workspace owner/co-owner (their own
-- workspace's events) and by the actor themself. Platform operators read
-- through the diagnostics panel (PR 3), not through this policy.
drop policy if exists forge_security_audit_select on public.forge_security_audit;
create policy forge_security_audit_select
  on public.forge_security_audit for select to authenticated
  using (
    actor_user_id = auth.uid()
    or (target_owner_id is not null and public.has_workspace_access(target_owner_id))
  );

revoke all on table public.forge_security_audit from public, anon, service_role, authenticated;
grant select on table public.forge_security_audit to authenticated;

-- ---------------------------------------------------------------------------
-- 9. forge_workspace_invitations — token-hash invitations, single-use,
--    short-lived, revocable. The raw token is returned ONCE by the create
--    RPC and is never stored. (The legacy invite_workspace_member RPCs
--    for the rental team flow are untouched.)
-- ---------------------------------------------------------------------------

create table if not exists public.forge_workspace_invitations (
  id text not null primary key,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  owner_id text not null,
  invited_email text not null check (btrim(invited_email) <> ''),
  app_key text not null check (app_key in ('designer', 'scheduler', 'planner', 'capture')),
  role_key text not null check (btrim(role_key) <> ''),
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  accepted_user_id uuid references auth.users(id),
  request_id text not null unique,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  check (expires_at > created_at),
  check (status <> 'accepted' or (accepted_user_id is not null and accepted_at is not null)),
  check (status <> 'revoked' or revoked_at is not null)
);

create index if not exists forge_workspace_invitations_owner_idx
  on public.forge_workspace_invitations (owner_id, created_at desc);
create index if not exists forge_workspace_invitations_email_idx
  on public.forge_workspace_invitations (owner_id, invited_email, status);

alter table public.forge_workspace_invitations enable row level security;
alter table public.forge_workspace_invitations force row level security;

drop policy if exists forge_workspace_invitations_select on public.forge_workspace_invitations;
create policy forge_workspace_invitations_select
  on public.forge_workspace_invitations for select to authenticated
  using (public.has_workspace_access(owner_id));

revoke all on table public.forge_workspace_invitations from public, anon, service_role, authenticated;
grant select on table public.forge_workspace_invitations to authenticated;

-- ---------------------------------------------------------------------------
-- 10. forge_auth_idempotency_receipts — request-id replay store shared by
--     every mutating RPC in this migration. Same request id + same action
--     + same payload hash replays the stored result; a changed payload
--     under a reused request id conflicts.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_auth_idempotency_receipts (
  request_id text not null primary key,
  owner_id text,
  action text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.forge_auth_idempotency_receipts enable row level security;
alter table public.forge_auth_idempotency_receipts force row level security;

-- No SELECT policy for authenticated: receipts are only readable through
-- the RPC replay path (SECURITY DEFINER, row_security off).
revoke all on table public.forge_auth_idempotency_receipts from public, anon, service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Canonical app-role tables for Designer + Capture (planner and
--     scheduling keep their own per-app tables; forge_has_app_capability
--     dispatches to each app's own framework). User ids are text
--     (auth.uid()::text), matching the planner/scheduling convention.
--     Starter catalogs are minimal defaults — the exact capability matrix
--     is still an open owner decision (D3).
-- ---------------------------------------------------------------------------

create table if not exists public.forge_app_roles (
  owner_id text not null,
  app_key text not null check (app_key in ('designer', 'capture')),
  id text not null,
  role_key text not null check (char_length(trim(role_key)) > 0),
  name text not null check (char_length(trim(name)) > 0),
  is_builtin boolean not null default false,
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, app_key, id),
  check (retired_at is null or retired_by is not null)
);

create unique index if not exists forge_app_roles_active_key_uq
  on public.forge_app_roles (owner_id, app_key, role_key)
  where retired_at is null;

create table if not exists public.forge_app_role_capabilities (
  owner_id text not null,
  app_key text not null check (app_key in ('designer', 'capture')),
  id text not null,
  role_id text not null,
  capability_key text not null check (
    (app_key = 'designer' and capability_key in (
      'designer.designs.read', 'designer.designs.create', 'designer.designs.edit', 'designer.designs.delete',
      'designer.drawings.read', 'designer.drawings.upload', 'designer.drawings.link', 'designer.drawings.unlink', 'designer.drawings.delete',
      'designer.roles.read', 'designer.roles.manage', 'designer.audit.read'
    ))
    or (app_key = 'capture' and capability_key in (
      'capture.library.read', 'capture.library.upload', 'capture.library.delete',
      'capture.recordings.read', 'capture.recordings.create', 'capture.recordings.delete',
      'capture.roles.read', 'capture.roles.manage', 'capture.audit.read'
    ))
  ),
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, app_key, id),
  foreign key (owner_id, app_key, role_id) references public.forge_app_roles (owner_id, app_key, id) on delete restrict
);

create index if not exists forge_app_role_capabilities_role_idx
  on public.forge_app_role_capabilities (owner_id, app_key, role_id);

create table if not exists public.forge_app_user_role_assignments (
  owner_id text not null,
  app_key text not null check (app_key in ('designer', 'capture')),
  id text not null,
  user_id text not null,
  role_id text not null,
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, app_key, id),
  foreign key (owner_id, app_key, role_id) references public.forge_app_roles (owner_id, app_key, id) on delete restrict,
  check (retired_at is null or retired_by is not null)
);

create unique index if not exists forge_app_user_role_assignments_active_uq
  on public.forge_app_user_role_assignments (owner_id, app_key, user_id)
  where retired_at is null;

alter table public.forge_app_roles enable row level security;
alter table public.forge_app_roles force row level security;
alter table public.forge_app_role_capabilities enable row level security;
alter table public.forge_app_role_capabilities force row level security;
alter table public.forge_app_user_role_assignments enable row level security;
alter table public.forge_app_user_role_assignments force row level security;

-- NOTE: the SELECT policies for these three tables live after the
-- forge_has_app_capability predicate definition below (a policy may not
-- reference a function that does not exist yet).

revoke all on table public.forge_app_roles from public, anon, service_role, authenticated;
grant select on table public.forge_app_roles to authenticated;
revoke all on table public.forge_app_role_capabilities from public, anon, service_role, authenticated;
grant select on table public.forge_app_role_capabilities to authenticated;
revoke all on table public.forge_app_user_role_assignments from public, anon, service_role, authenticated;
grant select on table public.forge_app_user_role_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Audit writer. NO execute grant to authenticated: any authenticated
--     caller could otherwise forge audit rows with any actor. The mutating
--     RPCs below call it from inside SECURITY DEFINER functions, where the
--     call runs as the function owner.
--     Idempotency receipts are read/written directly by the RPCs (also
--     SECURITY DEFINER, row_security off) for the same reason: receipts
--     must never be readable or writable by direct callers.
-- ---------------------------------------------------------------------------

create or replace function public.forge_audit_event(
  p_actor_user_id uuid,
  p_actor_class text,
  p_target_owner_id text,
  p_app_key text,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_before jsonb,
  p_after jsonb,
  p_reason text,
  p_request_id text,
  p_source text default 'rpc',
  p_outcome text default 'allowed'
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_id uuid;
begin
  insert into public.forge_security_audit
    (actor_user_id, actor_class, target_owner_id, app_key, action,
     entity_type, entity_id, before_json, after_json, reason, request_id,
     source, outcome)
  values
    (p_actor_user_id, p_actor_class, p_target_owner_id, p_app_key, p_action,
     p_entity_type, p_entity_id, p_before, p_after, p_reason, p_request_id,
     p_source, p_outcome)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.forge_audit_event(uuid, text, text, text, text, text, text, jsonb, jsonb, text, text, text, text) from public, anon, service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 13. Predicates.
-- ---------------------------------------------------------------------------

-- Entitlement: active + inside its window + workspace itself active.
-- A pending/suspended/closed workspace blocks app access even when a
-- stale entitlement row says active.
create or replace function public.forge_has_app_entitlement(p_owner_id text, p_app_key text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.forge_workspaces w
    join public.forge_app_entitlements e
      on e.owner_id = w.owner_id and e.app_key = p_app_key
    where w.owner_id = p_owner_id
      and w.status = 'active'
      and e.status = 'active'
      and (e.starts_at is null or e.starts_at <= now())
      and (e.ends_at is null or e.ends_at > now())
  );
$$;

revoke all on function public.forge_has_app_entitlement(text, text) from public, anon, service_role;
grant execute on function public.forge_has_app_entitlement(text, text) to authenticated;

-- Platform operator: active registry entry for auth.uid() only. Never
-- accepts a caller-supplied user id or boolean.
create or replace function public.has_platform_operator()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.forge_platform_operators
    where user_id = auth.uid() and is_active
  );
$$;

revoke all on function public.has_platform_operator() from public, anon, service_role;
grant execute on function public.has_platform_operator() to authenticated;

create or replace function public.forge_has_platform_role(p_platform_role text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.forge_platform_operators
    where user_id = auth.uid()
      and is_active
      and platform_role = p_platform_role
  );
$$;

revoke all on function public.forge_has_platform_role(text) from public, anon, service_role;
grant execute on function public.forge_has_platform_role(text) to authenticated;

create or replace function public.forge_is_programmer()
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1 from public.forge_programmer_grants
    where user_id = auth.uid() and is_active
  );
$$;

revoke all on function public.forge_is_programmer() from public, anon, service_role;
grant execute on function public.forge_is_programmer() to authenticated;

-- Capability: workspace + entitlement first, then the owner/co-owner
-- structural bypass for the capability dimension, then the app's own
-- role framework. Unknown app or capability denies. The owner/co-owner
-- bypass deliberately does NOT skip the entitlement check above — a
-- suspended workspace or expired entitlement blocks owners too.
create or replace function public.forge_has_app_capability(p_owner_id text, p_app_key text, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select case
    when p_app_key not in ('designer', 'scheduler', 'planner', 'capture') then false
    when p_capability_key is null or position(p_app_key || '.' in p_capability_key) <> 1 then false
    when not public.forge_has_app_entitlement(p_owner_id, p_app_key) then false
    when p_owner_id = auth.uid()::text then true
    when exists (
      select 1 from public.workspace_members
      where owner_id = p_owner_id and member_user_id = auth.uid()
        and status = 'active' and role = 'co_owner'
    ) then true
    when not exists (
      select 1 from public.workspace_members
      where owner_id = p_owner_id and member_user_id = auth.uid()
        and status = 'active'
    ) then false
    when p_app_key = 'planner' then public.has_planner_permission(p_owner_id, p_capability_key)
    when p_app_key = 'scheduler' then public.has_scheduling_permission(p_owner_id, p_capability_key)
    else exists (
      select 1
      from public.forge_app_user_role_assignments ura
      join public.forge_app_role_capabilities rc
        on rc.owner_id = ura.owner_id and rc.app_key = ura.app_key and rc.role_id = ura.role_id
      where ura.owner_id = p_owner_id
        and ura.app_key = p_app_key
        and ura.user_id = auth.uid()::text
        and ura.retired_at is null
        and rc.capability_key = p_capability_key
    )
  end;
$$;

revoke all on function public.forge_has_app_capability(text, text, text) from public, anon, service_role;
grant execute on function public.forge_has_app_capability(text, text, text) to authenticated;

-- Fix round 1 (P1): does the caller hold an ACTIVE assignment to an
-- ACTIVE role in this app? Planner/scheduler use their own role
-- frameworks; designer/capture use the canonical tables. Both the
-- assignment AND the role must be unretired: revoking either denies
-- on the next request. Owner and co-owner never reach this helper
-- from the gate (their structural bypass lives in
-- forge_check_app_access); called directly it answers only the
-- assignment question, so it returns false for an owner who holds no
-- assignment in the app.
create or replace function public.forge_has_app_role(p_owner_id text, p_app_key text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select case
    when p_app_key not in ('designer', 'scheduler', 'planner', 'capture') then false
    when p_app_key = 'planner' then exists (
      select 1
      from public.forge_planner_user_role_assignments ura
      join public.forge_planner_roles r
        on r.owner_id = ura.owner_id and r.id = ura.role_id
      where ura.owner_id = p_owner_id
        and ura.assignee_user_id = auth.uid()::text
        and ura.retired_at is null
        and r.retired_at is null
    )
    when p_app_key = 'scheduler' then exists (
      select 1
      from public.forge_scheduling_user_role_assignments ura
      join public.forge_scheduling_roles r
        on r.owner_id = ura.owner_id and r.id = ura.role_id
      where ura.owner_id = p_owner_id
        and ura.assignee_user_id = auth.uid()::text
        and ura.retired_at is null
        and r.retired_at is null
    )
    else exists (
      select 1
      from public.forge_app_user_role_assignments ura
      join public.forge_app_roles r
        on r.owner_id = ura.owner_id and r.app_key = ura.app_key and r.id = ura.role_id
      where ura.owner_id = p_owner_id
        and ura.app_key = p_app_key
        and ura.user_id = auth.uid()::text
        and ura.retired_at is null
        and r.retired_at is null
    )
  end;
$$;

revoke all on function public.forge_has_app_role(text, text) from public, anon, service_role;
grant execute on function public.forge_has_app_role(text, text) to authenticated;

-- The gate RPC the server helper calls. VOLATILE (not STABLE) because the
-- support-context path writes an audit row. Returns one jsonb object so
-- the server can render a plain-words denial reason.
create or replace function public.forge_check_app_access(
  p_owner_id text,
  p_app_key text,
  p_capability_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_ctx public.forge_support_contexts%rowtype;
  v_allowed boolean;
  v_reason text;
  v_via text;
begin
  if v_actor is null then
    return jsonb_build_object('allowed', false, 'reason', 'AUTH_REQUIRED', 'via', null);
  end if;
  if p_app_key not in ('designer', 'scheduler', 'planner', 'capture') then
    return jsonb_build_object('allowed', false, 'reason', 'UNKNOWN_APP', 'via', null);
  end if;
  if p_capability_key is not null
     and (position(p_app_key || '.' in p_capability_key) <> 1) then
    return jsonb_build_object('allowed', false, 'reason', 'UNKNOWN_CAPABILITY', 'via', null);
  end if;

  -- Platform-operator path: an active operator with a live support
  -- context for THIS workspace, covering the app and (when a capability
  -- is asked for) the action. The context use is audited; the context
  -- itself is never a reusable impersonation token.
  if public.has_platform_operator() then
    select * into v_ctx
    from public.forge_support_contexts
    where operator_user_id = v_actor
      and target_owner_id = p_owner_id
      and p_app_key = any (allowed_apps)
      and revoked_at is null
      and expires_at > now()
      and (p_capability_key is null
           or allowed_actions @> jsonb_build_array(p_capability_key)
           or allowed_actions @> jsonb_build_array('*'))
    order by created_at desc
    limit 1;
    if v_ctx.id is not null then
      perform public.forge_audit_event(
        v_actor, 'platform_operator', p_owner_id, p_app_key,
        'support_context.used', 'forge_support_contexts', v_ctx.id,
        null,
        jsonb_build_object('capability', p_capability_key),
        v_ctx.reason, v_ctx.request_id, 'rpc', 'allowed');
      return jsonb_build_object('allowed', true, 'reason', null, 'via', 'support_context');
    end if;
  end if;

  if not exists (select 1 from public.forge_workspaces where owner_id = p_owner_id) then
    return jsonb_build_object('allowed', false, 'reason', 'WORKSPACE_NOT_FOUND', 'via', null);
  end if;
  if not exists (
    select 1 from public.forge_workspaces where owner_id = p_owner_id and status = 'active'
  ) then
    return jsonb_build_object('allowed', false, 'reason', 'WORKSPACE_NOT_ACTIVE', 'via', null);
  end if;

  v_allowed := (p_owner_id = v_actor::text)
    or exists (
      select 1 from public.workspace_members
      where owner_id = p_owner_id and member_user_id = v_actor and status = 'active'
    );
  if not v_allowed then
    return jsonb_build_object('allowed', false, 'reason', 'NO_MEMBERSHIP', 'via', null);
  end if;

  if not public.forge_has_app_entitlement(p_owner_id, p_app_key) then
    return jsonb_build_object('allowed', false, 'reason', 'ENTITLEMENT_NOT_ACTIVE', 'via', null);
  end if;

  -- Fix round 1 (P1): a no-capability entry requires an app role.
  -- Without this, any active member passed every entitled app's
  -- entry gate even with no role in that app (cross-app bypass).
  -- Owner/co-owner keep their structural bypass; the
  -- platform-operator support-context path already returned above.
  -- Pre-role entry routes (provisioning / invite acceptance) do not
  -- call this gate — they use their own authenticated SECURITY
  -- DEFINER RPC boundary — so this never blocks onboarding.
  if p_capability_key is null
     and p_owner_id <> v_actor::text
     and not exists (
       select 1 from public.workspace_members
       where owner_id = p_owner_id and member_user_id = v_actor
         and status = 'active' and role = 'co_owner'
     )
     and not public.forge_has_app_role(p_owner_id, p_app_key) then
    return jsonb_build_object('allowed', false, 'reason', 'APP_ROLE_REQUIRED', 'via', null);
  end if;

  if p_capability_key is not null
     and not public.forge_has_app_capability(p_owner_id, p_app_key, p_capability_key) then
    return jsonb_build_object('allowed', false, 'reason', 'CAPABILITY_DENIED', 'via', null);
  end if;

  v_via := case when p_owner_id = v_actor::text then 'owner' else 'membership' end;
  return jsonb_build_object('allowed', true, 'reason', null, 'via', v_via);
end;
$$;

revoke all on function public.forge_check_app_access(text, text, text) from public, anon, service_role;
grant execute on function public.forge_check_app_access(text, text, text) to authenticated;

-- Deferred RLS policies for the canonical designer/capture role tables
-- (they reference forge_has_app_capability, defined above).
drop policy if exists forge_app_roles_select on public.forge_app_roles;
create policy forge_app_roles_select
  on public.forge_app_roles for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or public.forge_has_app_capability(owner_id, app_key, app_key || '.roles.read')
    or public.forge_has_app_capability(owner_id, app_key, app_key || '.roles.manage')
  );

drop policy if exists forge_app_role_capabilities_select on public.forge_app_role_capabilities;
create policy forge_app_role_capabilities_select
  on public.forge_app_role_capabilities for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or public.forge_has_app_capability(owner_id, app_key, app_key || '.roles.read')
    or public.forge_has_app_capability(owner_id, app_key, app_key || '.roles.manage')
  );

drop policy if exists forge_app_user_role_assignments_select on public.forge_app_user_role_assignments;
create policy forge_app_user_role_assignments_select
  on public.forge_app_user_role_assignments for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or user_id = auth.uid()::text
    or public.forge_has_app_capability(owner_id, app_key, app_key || '.roles.read')
    or public.forge_has_app_capability(owner_id, app_key, app_key || '.roles.manage')
  );

-- ---------------------------------------------------------------------------
-- 14. Mutating RPCs. Conventions shared by all of them:
--     * SECURITY DEFINER, search_path = public, row_security off.
--     * p_request_id is REQUIRED; same id + same action + same payload
--       replays the stored result, a changed payload under a reused id
--       raises FORGE_AUTH_REQUEST_ID_CONFLICT (23505).
--     * Receipts never contain secrets: invite-create stores a redacted
--       result (no token); the token is returned only on first call.
--     * Every mutation writes its forge_security_audit row in the same
--       transaction (a failure rolls the audit back with the mutation).
--     * No RPC ever broadens has_workspace_access or spoofs auth.uid().
-- ---------------------------------------------------------------------------

-- Starter roles for Designer / Capture (canonical tables). Mirrors the
-- planner/scheduling provision RPCs: idempotent, owner/co-owner only,
-- audited per role created.
create or replace function public.forge_app_roles_provision_starter_set(
  p_owner_id text,
  p_app_key text,
  p_request_id text
)
returns setof public.forge_app_roles
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor text := auth.uid()::text;
  v_is_owner boolean;
  v_starter jsonb;
  v_def jsonb;
  v_role_id text;
  v_cap text;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_app_key = 'designer' then
    v_starter := '[
      {"role_key":"designer_admin","name":"Designer admin","capabilities":["designer.designs.read","designer.designs.create","designer.designs.edit","designer.designs.delete","designer.drawings.read","designer.drawings.upload","designer.drawings.link","designer.drawings.unlink","designer.drawings.delete","designer.roles.read","designer.roles.manage","designer.audit.read"]},
      {"role_key":"designer_user","name":"Designer user","capabilities":["designer.designs.read","designer.designs.create","designer.designs.edit","designer.drawings.read","designer.drawings.upload","designer.drawings.link"]},
      {"role_key":"designer_read_only","name":"Designer read-only","capabilities":["designer.designs.read","designer.drawings.read"]}
    ]'::jsonb;
  elsif p_app_key = 'capture' then
    v_starter := '[
      {"role_key":"capture_admin","name":"Capture admin","capabilities":["capture.library.read","capture.library.upload","capture.library.delete","capture.recordings.read","capture.recordings.create","capture.recordings.delete","capture.roles.read","capture.roles.manage","capture.audit.read"]},
      {"role_key":"capture_user","name":"Capture user","capabilities":["capture.library.read","capture.library.upload","capture.recordings.read","capture.recordings.create"]},
      {"role_key":"capture_read_only","name":"Capture read-only","capabilities":["capture.library.read","capture.recordings.read"]}
    ]'::jsonb;
  else
    raise exception 'FORGE_AUTH_UNKNOWN_APP' using errcode = '22023';
  end if;

  v_is_owner := (p_owner_id = v_actor) or exists (
    select 1 from public.workspace_members
    where owner_id = p_owner_id and member_user_id::text = v_actor
      and status = 'active' and role = 'co_owner'
  );
  if not v_is_owner then raise exception 'FORGE_AUTH_OWNER_ONLY' using errcode = '42501'; end if;

  for v_def in select * from jsonb_array_elements(v_starter)
  loop
    if exists (select 1 from public.forge_app_roles
               where owner_id = p_owner_id and app_key = p_app_key
                 and role_key = v_def->>'role_key' and retired_at is null) then
      continue;
    end if;
    v_role_id := 'forge_ar_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.forge_app_roles
      (owner_id, app_key, id, role_key, name, is_builtin, created_by, updated_by)
    values (p_owner_id, p_app_key, v_role_id, v_def->>'role_key', v_def->>'name', true, v_actor, v_actor);
    for v_cap in select jsonb_array_elements_text(v_def->'capabilities')
    loop
      insert into public.forge_app_role_capabilities (owner_id, app_key, id, role_id, capability_key, created_by)
      values (p_owner_id, p_app_key, 'forge_arc_' || replace(gen_random_uuid()::text, '-', ''), v_role_id, v_cap, v_actor);
    end loop;
    perform public.forge_audit_event(
      auth.uid(), 'owner', p_owner_id, p_app_key, 'app_role.created',
      'forge_app_roles', v_role_id, null,
      jsonb_build_object('role_key', v_def->>'role_key', 'capabilities', v_def->'capabilities'),
      'starter role provisioning', p_request_id, 'rpc', 'allowed');
  end loop;

  return query
    select * from public.forge_app_roles
    where owner_id = p_owner_id and app_key = p_app_key
      and is_builtin = true and retired_at is null
    order by role_key;
end;
$$;

revoke all on function public.forge_app_roles_provision_starter_set(text, text, text) from public, anon, service_role;
grant execute on function public.forge_app_roles_provision_starter_set(text, text, text) to authenticated;

-- Workspace provisioning: new workspace starts 'pending' (D7 — no
-- automatic activation) with four 'pending' entitlements and starter
-- roles for all four apps. One primary workspace per person: the
-- owner_id IS the workspace key, so a second provision conflicts.
create or replace function public.forge_provision_workspace(
  p_display_name text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_text text := auth.uid()::text;
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_name text;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  v_name := btrim(coalesce(p_display_name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 200 then
    raise exception 'FORGE_AUTH_DISPLAY_NAME_REQUIRED' using errcode = '22023';
  end if;

  v_payload_hash := encode(extensions.digest(convert_to('provision_workspace|' || v_actor_text || '|' || v_name, 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(v_actor_text), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'provision_workspace' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if exists (select 1 from public.forge_workspaces where owner_id = v_actor_text) then
    raise exception 'FORGE_AUTH_WORKSPACE_EXISTS' using errcode = '23505';
  end if;

  insert into public.forge_workspaces (owner_id, display_name, status, created_by, updated_by)
  values (v_actor_text, v_name, 'pending', v_actor_text, v_actor_text);

  insert into public.forge_app_entitlements (owner_id, app_key, status)
  select v_actor_text, app_key, 'pending'
  from (values ('designer'), ('scheduler'), ('planner'), ('capture')) as a(app_key);

  -- Starter roles for all four apps (planner/scheduling via their own
  -- provision RPCs; designer/capture via the canonical one above).
  perform public.forge_planner_roles_provision_starter_set(v_actor_text, p_request_id);
  perform public.forge_scheduling_roles_provision_starter_set(v_actor_text, p_request_id);
  perform public.forge_app_roles_provision_starter_set(v_actor_text, 'designer', p_request_id);
  perform public.forge_app_roles_provision_starter_set(v_actor_text, 'capture', p_request_id);

  perform public.forge_audit_event(
    v_actor, 'owner', v_actor_text, null, 'workspace.created',
    'forge_workspaces', v_actor_text, null,
    jsonb_build_object('display_name', v_name, 'status', 'pending'),
    'workspace provisioning', p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object(
    'owner_id', v_actor_text, 'status', 'pending',
    'apps', jsonb_build_array('designer', 'scheduler', 'planner', 'capture'));
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, v_actor_text, 'provision_workspace', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_provision_workspace(text, text) from public, anon, service_role;
grant execute on function public.forge_provision_workspace(text, text) to authenticated;

-- Invite create: owner/co-owner, or an active workspace_admin (invite
-- capability is inherent to that membership role). Token is returned ONCE;
-- the stored receipt is redacted (no token) so a replay never leaks it.
create or replace function public.forge_workspace_invite_create(
  p_owner_id text,
  p_email text,
  p_app_key text,
  p_role_key text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_text text := auth.uid()::text;
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_stored jsonb;
  v_email text;
  v_actor_email text;
  v_actor_class text;
  v_is_owner boolean;
  v_is_admin boolean;
  v_role_id text;
  v_role_has_manage boolean;
  v_token text;
  v_token_hash text;
  v_invitation_id text;
  v_expires timestamptz;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' then raise exception 'FORGE_AUTH_EMAIL_REQUIRED' using errcode = '22023'; end if;
  if p_app_key not in ('designer', 'scheduler', 'planner', 'capture') then
    raise exception 'FORGE_AUTH_UNKNOWN_APP' using errcode = '22023';
  end if;
  if p_role_key is null or trim(p_role_key) = '' then raise exception 'FORGE_AUTH_ROLE_REQUIRED' using errcode = '22023'; end if;

  v_payload_hash := encode(extensions.digest(convert_to('invite_create|' || p_owner_id || '|' || v_email || '|' || p_app_key || '|' || p_role_key, 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'invite_create' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if not exists (select 1 from public.forge_workspaces where owner_id = p_owner_id and status = 'active') then
    raise exception 'FORGE_AUTH_WORKSPACE_NOT_ACTIVE' using errcode = '42501';
  end if;

  v_is_owner := (p_owner_id = v_actor_text) or exists (
    select 1 from public.workspace_members
    where owner_id = p_owner_id and member_user_id = v_actor
      and status = 'active' and role = 'co_owner'
  );
  v_is_admin := exists (
    select 1 from public.workspace_members
    where owner_id = p_owner_id and member_user_id = v_actor
      and status = 'active' and role = 'workspace_admin'
  );
  if not v_is_owner and not v_is_admin then
    raise exception 'FORGE_AUTH_INVITE_FORBIDDEN' using errcode = '42501';
  end if;
  v_actor_class := case when v_is_owner then 'owner' else 'workspace_admin' end;

  select lower(nullif(btrim(u.email), '')) into v_actor_email
    from auth.users u where u.id = v_actor;
  if v_actor_email is not null and v_actor_email = v_email then
    raise exception 'FORGE_AUTH_SELF_INVITE' using errcode = '22023';
  end if;

  -- Target role must exist, be active, and never be the immutable 'owner'
  -- role. A workspace_admin inviter may not invite into a role holding
  -- <app>.roles.manage (the delegation ceiling, D3).
  if p_app_key = 'planner' then
    select r.id into v_role_id from public.forge_planner_roles r
    where r.owner_id = p_owner_id and r.role_key = p_role_key and r.retired_at is null;
    v_role_has_manage := exists (
      select 1 from public.forge_planner_role_capabilities c
      where c.owner_id = p_owner_id and c.role_id = v_role_id
        and c.capability_key = 'planner.roles.manage');
  elsif p_app_key = 'scheduler' then
    select r.id into v_role_id from public.forge_scheduling_roles r
    where r.owner_id = p_owner_id and r.role_key = p_role_key and r.retired_at is null;
    v_role_has_manage := exists (
      select 1 from public.forge_scheduling_role_capabilities c
      where c.owner_id = p_owner_id and c.role_id = v_role_id
        and c.capability_key = 'scheduling.roles.manage');
  else
    select r.id into v_role_id from public.forge_app_roles r
    where r.owner_id = p_owner_id and r.app_key = p_app_key
      and r.role_key = p_role_key and r.retired_at is null;
    v_role_has_manage := exists (
      select 1 from public.forge_app_role_capabilities c
      where c.owner_id = p_owner_id and c.app_key = p_app_key and c.role_id = v_role_id
        and c.capability_key = p_app_key || '.roles.manage');
  end if;
  if v_role_id is null then raise exception 'FORGE_AUTH_ROLE_STALE' using errcode = '22023'; end if;
  if p_role_key = 'owner' then raise exception 'FORGE_AUTH_ROLE_STALE' using errcode = '22023'; end if;
  if v_is_admin and not v_is_owner and coalesce(v_role_has_manage, false) then
    raise exception 'FORGE_AUTH_CEILING_EXCEEDED' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.forge_workspace_invitations
    where owner_id = p_owner_id and invited_email = v_email and app_key = p_app_key
      and status = 'pending' and expires_at > now()
  ) then
    raise exception 'FORGE_AUTH_INVITE_EXISTS' using errcode = '23505';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex');
  v_invitation_id := 'forge_inv_' || replace(gen_random_uuid()::text, '-', '');
  v_expires := now() + interval '7 days';

  insert into public.forge_workspace_invitations
    (id, token_hash, owner_id, invited_email, app_key, role_key, invited_by,
     expires_at, status, request_id)
  values (v_invitation_id, v_token_hash, p_owner_id, v_email, p_app_key,
          p_role_key, v_actor, v_expires, 'pending', p_request_id);

  perform public.forge_audit_event(
    v_actor, v_actor_class, p_owner_id, p_app_key, 'invitation.created',
    'forge_workspace_invitations', v_invitation_id, null,
    jsonb_build_object('invited_email', v_email, 'role_key', p_role_key),
    'workspace invitation', p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object(
    'invitation_id', v_invitation_id, 'token', v_token, 'expires_at', v_expires);
  v_stored := jsonb_build_object(
    'invitation_id', v_invitation_id, 'expires_at', v_expires);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, p_owner_id, 'invite_create', v_payload_hash, v_stored)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_workspace_invite_create(text, text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_workspace_invite_create(text, text, text, text, text) to authenticated;

-- Invite accept: exact verified-email match; rechecks inviter authority,
-- workspace state, entitlement and role ceiling; atomically activates the
-- membership (role read_only — D3 member default) and the app role
-- assignment. Replay/expired/revoked tokens and email mismatches all
-- raise the same generic error so nothing leaks about the target.
create or replace function public.forge_workspace_invite_accept(
  p_token text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_text text := auth.uid()::text;
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_token_hash text;
  v_inv public.forge_workspace_invitations%rowtype;
  v_actor_email text;
  v_actor_confirmed timestamptz;
  v_inviter_is_owner boolean;
  v_inviter_is_admin boolean;
  v_role_id text;
  v_role_has_manage boolean;
  v_member public.workspace_members%rowtype;
  v_member_id text;
  v_is_new_member boolean;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_token is null or trim(p_token) = '' then raise exception 'FORGE_AUTH_INVITE_INVALID' using errcode = '22023'; end if;

  v_payload_hash := encode(extensions.digest(convert_to('invite_accept|' || v_actor_text || '|' || trim(p_token), 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext('invite_accept'), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'invite_accept' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  v_token_hash := encode(extensions.digest(convert_to(trim(p_token), 'UTF8'), 'sha256'), 'hex');
  select * into v_inv from public.forge_workspace_invitations
  where token_hash = v_token_hash and status = 'pending';
  if v_inv.id is null then
    raise exception 'FORGE_AUTH_INVITE_INVALID' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    update public.forge_workspace_invitations set status = 'expired' where id = v_inv.id;
    raise exception 'FORGE_AUTH_INVITE_INVALID' using errcode = '22023';
  end if;

  select lower(nullif(btrim(u.email), '')), u.email_confirmed_at
    into v_actor_email, v_actor_confirmed
    from auth.users u where u.id = v_actor;
  if v_actor_email is null or v_actor_email <> v_inv.invited_email or v_actor_confirmed is null then
    raise exception 'FORGE_AUTH_INVITE_INVALID' using errcode = '22023';
  end if;
  if v_actor = v_inv.invited_by then
    raise exception 'FORGE_AUTH_INVITE_INVALID' using errcode = '22023';
  end if;

  -- Inviter must still hold invite authority.
  v_inviter_is_owner := (v_inv.owner_id = v_inv.invited_by::text) or exists (
    select 1 from public.workspace_members
    where owner_id = v_inv.owner_id and member_user_id = v_inv.invited_by
      and status = 'active' and role = 'co_owner'
  );
  v_inviter_is_admin := exists (
    select 1 from public.workspace_members
    where owner_id = v_inv.owner_id and member_user_id = v_inv.invited_by
      and status = 'active' and role = 'workspace_admin'
  );
  if not v_inviter_is_owner and not v_inviter_is_admin then
    raise exception 'FORGE_AUTH_INVITER_REVOKED' using errcode = '42501';
  end if;

  if not exists (select 1 from public.forge_workspaces where owner_id = v_inv.owner_id and status = 'active') then
    raise exception 'FORGE_AUTH_WORKSPACE_NOT_ACTIVE' using errcode = '42501';
  end if;
  if not public.forge_has_app_entitlement(v_inv.owner_id, v_inv.app_key) then
    raise exception 'FORGE_AUTH_ENTITLEMENT_NOT_ACTIVE' using errcode = '42501';
  end if;

  -- Role must still exist and still be within the inviter's ceiling.
  if v_inv.app_key = 'planner' then
    select r.id into v_role_id from public.forge_planner_roles r
    where r.owner_id = v_inv.owner_id and r.role_key = v_inv.role_key and r.retired_at is null;
    v_role_has_manage := exists (
      select 1 from public.forge_planner_role_capabilities c
      where c.owner_id = v_inv.owner_id and c.role_id = v_role_id
        and c.capability_key = 'planner.roles.manage');
  elsif v_inv.app_key = 'scheduler' then
    select r.id into v_role_id from public.forge_scheduling_roles r
    where r.owner_id = v_inv.owner_id and r.role_key = v_inv.role_key and r.retired_at is null;
    v_role_has_manage := exists (
      select 1 from public.forge_scheduling_role_capabilities c
      where c.owner_id = v_inv.owner_id and c.role_id = v_role_id
        and c.capability_key = 'scheduling.roles.manage');
  else
    select r.id into v_role_id from public.forge_app_roles r
    where r.owner_id = v_inv.owner_id and r.app_key = v_inv.app_key
      and r.role_key = v_inv.role_key and r.retired_at is null;
    v_role_has_manage := exists (
      select 1 from public.forge_app_role_capabilities c
      where c.owner_id = v_inv.owner_id and c.app_key = v_inv.app_key and c.role_id = v_role_id
        and c.capability_key = v_inv.app_key || '.roles.manage');
  end if;
  if v_role_id is null then raise exception 'FORGE_AUTH_ROLE_STALE' using errcode = '22023'; end if;
  if v_inviter_is_admin and not v_inviter_is_owner and coalesce(v_role_has_manage, false) then
    raise exception 'FORGE_AUTH_CEILING_EXCEEDED' using errcode = '42501';
  end if;

  -- Membership: new row, or reactivate a non-active row (a fresh invite
  -- is an explicit reinstatement event). An already-active member
  -- conflicts — they are already in.
  select * into v_member from public.workspace_members
  where owner_id = v_inv.owner_id and member_user_id = v_actor;
  if v_member.id is not null and v_member.status = 'active' then
    raise exception 'FORGE_AUTH_ALREADY_MEMBER' using errcode = '23505';
  end if;
  v_is_new_member := (v_member.id is null);
  v_member_id := coalesce(v_member.id, 'workspace_member_' || gen_random_uuid()::text);
  insert into public.workspace_members
    (owner_id, id, member_user_id, role, status, invited_email, invited_by,
     invited_at, activated_at, suspended_at, revoked_by, revoked_reason)
  values (v_inv.owner_id, v_member_id, v_actor, 'read_only', 'active',
          v_inv.invited_email, v_inv.invited_by, now(), now(), null, null, null)
  on conflict (owner_id, member_user_id) do update
    set role = 'read_only', status = 'active',
        invited_email = excluded.invited_email, invited_by = excluded.invited_by,
        invited_at = now(), activated_at = now(), suspended_at = null,
        revoked_by = null, revoked_reason = null, updated_at = now();

  -- App role assignment: retire any active assignment first (one active
  -- assignment per user per app), then insert the invited role.
  if v_inv.app_key = 'planner' then
    update public.forge_planner_user_role_assignments
       set retired_at = now(), retired_by = v_inv.invited_by::text, updated_at = now()
     where owner_id = v_inv.owner_id and assignee_user_id = v_actor_text and retired_at is null;
    insert into public.forge_planner_user_role_assignments
      (owner_id, id, assignee_user_id, role_id, assigned_by, updated_by)
    values (v_inv.owner_id, 'forge_pura_' || replace(gen_random_uuid()::text, '-', ''),
            v_actor_text, v_role_id, v_inv.invited_by::text, v_inv.invited_by::text);
  elsif v_inv.app_key = 'scheduler' then
    update public.forge_scheduling_user_role_assignments
       set retired_at = now(), retired_by = v_inv.invited_by::text, updated_at = now()
     where owner_id = v_inv.owner_id and assignee_user_id = v_actor_text and retired_at is null;
    insert into public.forge_scheduling_user_role_assignments
      (owner_id, id, assignee_user_id, role_id, assigned_by, updated_by)
    values (v_inv.owner_id, 'forge_sura_' || replace(gen_random_uuid()::text, '-', ''),
            v_actor_text, v_role_id, v_inv.invited_by::text, v_inv.invited_by::text);
  else
    update public.forge_app_user_role_assignments
       set retired_at = now(), retired_by = v_inv.invited_by::text, updated_at = now()
     where owner_id = v_inv.owner_id and app_key = v_inv.app_key
       and user_id = v_actor_text and retired_at is null;
    insert into public.forge_app_user_role_assignments
      (owner_id, app_key, id, user_id, role_id, assigned_by, updated_by)
    values (v_inv.owner_id, v_inv.app_key, 'forge_aura_' || replace(gen_random_uuid()::text, '-', ''),
            v_actor_text, v_role_id, v_inv.invited_by::text, v_inv.invited_by::text);
  end if;

  update public.forge_workspace_invitations
     set status = 'accepted', accepted_user_id = v_actor, accepted_at = now()
   where id = v_inv.id;

  perform public.forge_audit_event(
    v_actor, 'member', v_inv.owner_id, v_inv.app_key, 'invitation.accepted',
    'forge_workspace_invitations', v_inv.id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'accepted', 'role_key', v_inv.role_key,
                       'new_member', v_is_new_member),
    'invitation acceptance', p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object(
    'owner_id', v_inv.owner_id, 'app_key', v_inv.app_key,
    'role_key', v_inv.role_key, 'membership', 'active');
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, v_inv.owner_id, 'invite_accept', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_workspace_invite_accept(text, text) from public, anon, service_role;
grant execute on function public.forge_workspace_invite_accept(text, text) to authenticated;

create or replace function public.forge_workspace_invite_revoke(
  p_invitation_id text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_text text := auth.uid()::text;
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_inv public.forge_workspace_invitations%rowtype;
  v_is_owner boolean;
  v_is_admin boolean;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('invite_revoke|' || p_invitation_id, 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_invitation_id), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'invite_revoke' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  select * into v_inv from public.forge_workspace_invitations where id = p_invitation_id;
  if v_inv.id is null then raise exception 'FORGE_AUTH_INVITE_INVALID' using errcode = '22023'; end if;
  v_is_owner := (v_inv.owner_id = v_actor_text) or exists (
    select 1 from public.workspace_members
    where owner_id = v_inv.owner_id and member_user_id = v_actor
      and status = 'active' and role = 'co_owner'
  );
  v_is_admin := exists (
    select 1 from public.workspace_members
    where owner_id = v_inv.owner_id and member_user_id = v_actor
      and status = 'active' and role = 'workspace_admin'
  );
  if not v_is_owner and not v_is_admin then
    raise exception 'FORGE_AUTH_INVITE_FORBIDDEN' using errcode = '42501';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'FORGE_AUTH_INVITE_INVALID' using errcode = '22023';
  end if;

  update public.forge_workspace_invitations
     set status = 'revoked', revoked_at = now(), revoked_by = v_actor
   where id = v_inv.id;
  perform public.forge_audit_event(
    v_actor, case when v_is_owner then 'owner' else 'workspace_admin' end,
    v_inv.owner_id, v_inv.app_key, 'invitation.revoked',
    'forge_workspace_invitations', v_inv.id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'revoked'),
    'invitation revocation', p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('invitation_id', v_inv.id, 'status', 'revoked');
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, v_inv.owner_id, 'invite_revoke', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_workspace_invite_revoke(text, text) from public, anon, service_role;
grant execute on function public.forge_workspace_invite_revoke(text, text) to authenticated;

-- Membership revoke: owner/co-owner only. Revokes every active app role
-- assignment for the user across all four apps; effective on the next
-- protected request. Revocation history is never erased.
create or replace function public.forge_workspace_membership_revoke(
  p_owner_id text,
  p_user_id uuid,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_text text := auth.uid()::text;
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_is_owner boolean;
  v_member public.workspace_members%rowtype;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('membership_revoke|' || p_owner_id || '|' || p_user_id::text || '|' || btrim(p_reason), 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'membership_revoke' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  v_is_owner := (p_owner_id = v_actor_text) or exists (
    select 1 from public.workspace_members
    where owner_id = p_owner_id and member_user_id = v_actor
      and status = 'active' and role = 'co_owner'
  );
  if not v_is_owner then raise exception 'FORGE_AUTH_OWNER_ONLY' using errcode = '42501'; end if;
  if p_user_id = v_actor then raise exception 'FORGE_AUTH_SELF_REVOKE' using errcode = '22023'; end if;

  select * into v_member from public.workspace_members
  where owner_id = p_owner_id and member_user_id = p_user_id;
  if v_member.id is null then raise exception 'FORGE_AUTH_MEMBER_NOT_FOUND' using errcode = '22023'; end if;
  if v_member.status = 'revoked' then raise exception 'FORGE_AUTH_ALREADY_REVOKED' using errcode = '22023'; end if;

  update public.workspace_members
     set status = 'revoked', revoked_by = v_actor, revoked_reason = btrim(p_reason),
         updated_at = now()
   where owner_id = p_owner_id and member_user_id = p_user_id;

  update public.forge_planner_user_role_assignments
     set retired_at = now(), retired_by = v_actor_text, updated_at = now()
   where owner_id = p_owner_id and assignee_user_id = p_user_id::text and retired_at is null;
  update public.forge_scheduling_user_role_assignments
     set retired_at = now(), retired_by = v_actor_text, updated_at = now()
   where owner_id = p_owner_id and assignee_user_id = p_user_id::text and retired_at is null;
  update public.forge_app_user_role_assignments
     set retired_at = now(), retired_by = v_actor_text, updated_at = now()
   where owner_id = p_owner_id and user_id = p_user_id::text and retired_at is null;

  perform public.forge_audit_event(
    v_actor, 'owner', p_owner_id, null, 'member.revoked',
    'workspace_members', v_member.id,
    jsonb_build_object('status', v_member.status, 'role', v_member.role),
    jsonb_build_object('status', 'revoked'),
    btrim(p_reason), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('owner_id', p_owner_id, 'user_id', p_user_id, 'status', 'revoked');
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, p_owner_id, 'membership_revoke', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_workspace_membership_revoke(text, uuid, text, text) from public, anon, service_role;
grant execute on function public.forge_workspace_membership_revoke(text, uuid, text, text) to authenticated;

-- Membership role set: owner/co-owner any role (except primary_owner);
-- workspace_admin only up to the ceiling (never co_owner, never
-- workspace_admin).
create or replace function public.forge_workspace_membership_role_set(
  p_owner_id text,
  p_user_id uuid,
  p_role text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_text text := auth.uid()::text;
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_is_owner boolean;
  v_is_admin boolean;
  v_member public.workspace_members%rowtype;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_role not in ('co_owner', 'manager', 'property_manager', 'bookkeeper',
                   'maintenance', 'marketing', 'read_only', 'workspace_admin') then
    raise exception 'FORGE_AUTH_UNKNOWN_ROLE' using errcode = '22023';
  end if;
  v_payload_hash := encode(extensions.digest(convert_to('membership_role_set|' || p_owner_id || '|' || p_user_id::text || '|' || p_role, 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'membership_role_set' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  v_is_owner := (p_owner_id = v_actor_text) or exists (
    select 1 from public.workspace_members
    where owner_id = p_owner_id and member_user_id = v_actor
      and status = 'active' and role = 'co_owner'
  );
  v_is_admin := exists (
    select 1 from public.workspace_members
    where owner_id = p_owner_id and member_user_id = v_actor
      and status = 'active' and role = 'workspace_admin'
  );
  if not v_is_owner and not v_is_admin then
    raise exception 'FORGE_AUTH_OWNER_ONLY' using errcode = '42501';
  end if;
  if v_is_admin and not v_is_owner and p_role in ('co_owner', 'workspace_admin') then
    raise exception 'FORGE_AUTH_CEILING_EXCEEDED' using errcode = '42501';
  end if;
  if p_user_id = v_actor then raise exception 'FORGE_AUTH_SELF_ROLE' using errcode = '22023'; end if;

  select * into v_member from public.workspace_members
  where owner_id = p_owner_id and member_user_id = p_user_id;
  if v_member.id is null then raise exception 'FORGE_AUTH_MEMBER_NOT_FOUND' using errcode = '22023'; end if;
  if v_member.status = 'revoked' then raise exception 'FORGE_AUTH_MEMBER_REVOKED' using errcode = '22023'; end if;

  update public.workspace_members
     set role = p_role, updated_at = now()
   where owner_id = p_owner_id and member_user_id = p_user_id;

  perform public.forge_audit_event(
    v_actor, case when v_is_owner then 'owner' else 'workspace_admin' end,
    p_owner_id, null, 'member.role_changed',
    'workspace_members', v_member.id,
    jsonb_build_object('role', v_member.role),
    jsonb_build_object('role', p_role),
    'membership role change', p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('owner_id', p_owner_id, 'user_id', p_user_id, 'role', p_role);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, p_owner_id, 'membership_role_set', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_workspace_membership_role_set(text, uuid, text, text) from public, anon, service_role;
grant execute on function public.forge_workspace_membership_role_set(text, uuid, text, text) to authenticated;

-- Entitlement grant/revoke + workspace status: platform owner ONLY.
-- A workspace owner can never self-grant an entitlement (that would be
-- subscription forgery). owner_trial is rejected until Jason decides the
-- trial mechanics (open D7); verified_billing_webhook is rejected until
-- the webhook slice exists (D1/D8).
create or replace function public.forge_app_entitlement_grant(
  p_owner_id text,
  p_app_key text,
  p_source text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_text text := auth.uid()::text;
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_before public.forge_app_entitlements%rowtype;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_app_key not in ('designer', 'scheduler', 'planner', 'capture') then
    raise exception 'FORGE_AUTH_UNKNOWN_APP' using errcode = '22023';
  end if;
  if p_source = 'owner_trial' then
    raise exception 'FORGE_AUTH_TRIAL_UNDECIDED' using errcode = '22023';
  end if;
  if p_source = 'verified_billing_webhook' then
    raise exception 'FORGE_AUTH_BILLING_WEBHOOK_UNAVAILABLE' using errcode = '22023';
  end if;
  if p_source <> 'owner_manual' then
    raise exception 'FORGE_AUTH_UNKNOWN_SOURCE' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('entitlement_grant|' || p_owner_id || '|' || p_app_key || '|' || p_source || '|' || coalesce(p_starts_at::text, '') || '|' || coalesce(p_ends_at::text, '') || '|' || btrim(p_reason), 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'entitlement_grant' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  if not exists (select 1 from public.forge_workspaces where owner_id = p_owner_id) then
    raise exception 'FORGE_AUTH_WORKSPACE_NOT_FOUND' using errcode = '22023';
  end if;

  select * into v_before from public.forge_app_entitlements
  where owner_id = p_owner_id and app_key = p_app_key;

  insert into public.forge_app_entitlements
    (owner_id, app_key, status, source, starts_at, ends_at, granted_by, grant_reason, version)
  values (p_owner_id, p_app_key, 'active', p_source, p_starts_at, p_ends_at,
          v_actor_text, btrim(p_reason), 1)
  on conflict (owner_id, app_key) do update
    set status = 'active', source = excluded.source,
        starts_at = excluded.starts_at, ends_at = excluded.ends_at,
        granted_by = excluded.granted_by, grant_reason = excluded.grant_reason,
        version = public.forge_app_entitlements.version + 1,
        updated_at = now();

  perform public.forge_audit_event(
    v_actor, 'platform_operator', p_owner_id, p_app_key, 'entitlement.granted',
    'forge_app_entitlements', p_owner_id || '|' || p_app_key,
    case when v_before.owner_id is null then null
         else jsonb_build_object('status', v_before.status, 'source', v_before.source) end,
    jsonb_build_object('status', 'active', 'source', p_source),
    btrim(p_reason), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('owner_id', p_owner_id, 'app_key', p_app_key, 'status', 'active', 'source', p_source);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, p_owner_id, 'entitlement_grant', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_app_entitlement_grant(text, text, text, timestamptz, timestamptz, text, text) from public, anon, service_role;
grant execute on function public.forge_app_entitlement_grant(text, text, text, timestamptz, timestamptz, text, text) to authenticated;

create or replace function public.forge_app_entitlement_revoke(
  p_owner_id text,
  p_app_key text,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_before public.forge_app_entitlements%rowtype;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_app_key not in ('designer', 'scheduler', 'planner', 'capture') then
    raise exception 'FORGE_AUTH_UNKNOWN_APP' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('entitlement_revoke|' || p_owner_id || '|' || p_app_key || '|' || btrim(p_reason), 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'entitlement_revoke' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  select * into v_before from public.forge_app_entitlements
  where owner_id = p_owner_id and app_key = p_app_key;
  if v_before.owner_id is null then raise exception 'FORGE_AUTH_ENTITLEMENT_NOT_FOUND' using errcode = '22023'; end if;

  update public.forge_app_entitlements
     set status = 'revoked', version = version + 1, updated_at = now()
   where owner_id = p_owner_id and app_key = p_app_key;

  perform public.forge_audit_event(
    v_actor, 'platform_operator', p_owner_id, p_app_key, 'entitlement.revoked',
    'forge_app_entitlements', p_owner_id || '|' || p_app_key,
    jsonb_build_object('status', v_before.status),
    jsonb_build_object('status', 'revoked'),
    btrim(p_reason), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('owner_id', p_owner_id, 'app_key', p_app_key, 'status', 'revoked');
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, p_owner_id, 'entitlement_revoke', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_app_entitlement_revoke(text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_app_entitlement_revoke(text, text, text, text) to authenticated;

create or replace function public.forge_workspace_status_set(
  p_owner_id text,
  p_status text,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_before text;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_status not in ('pending', 'active', 'suspended', 'closed') then
    raise exception 'FORGE_AUTH_UNKNOWN_STATUS' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('workspace_status_set|' || p_owner_id || '|' || p_status || '|' || btrim(p_reason), 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'workspace_status_set' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  select status into v_before from public.forge_workspaces where owner_id = p_owner_id;
  if v_before is null then raise exception 'FORGE_AUTH_WORKSPACE_NOT_FOUND' using errcode = '22023'; end if;

  update public.forge_workspaces
     set status = p_status, version = version + 1, updated_at = now()
   where owner_id = p_owner_id;

  perform public.forge_audit_event(
    v_actor, 'platform_operator', p_owner_id, null, 'workspace.status_changed',
    'forge_workspaces', p_owner_id,
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', p_status),
    btrim(p_reason), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('owner_id', p_owner_id, 'status', p_status);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, p_owner_id, 'workspace_status_set', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_workspace_status_set(text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_workspace_status_set(text, text, text, text) to authenticated;

-- Platform-operator grant/revoke: platform owner only. The FIRST grant
-- can never be made through this RPC (no operator exists yet to call
-- it) — bootstrap is a reviewed migration/controlled operation (D6).
create or replace function public.forge_platform_operator_grant(
  p_user_id uuid,
  p_platform_role text,
  p_verification_method text,
  p_verification_reference text,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_platform_role not in ('owner', 'programmer', 'support') then
    raise exception 'FORGE_AUTH_UNKNOWN_ROLE' using errcode = '22023';
  end if;
  if p_verification_method is null or btrim(p_verification_method) = '' then
    raise exception 'FORGE_AUTH_VERIFICATION_REQUIRED' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('operator_grant|' || p_user_id::text || '|' || p_platform_role || '|' || btrim(p_reason), 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'operator_grant' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'FORGE_AUTH_USER_NOT_FOUND' using errcode = '22023';
  end if;

  insert into public.forge_platform_operators
    (user_id, platform_role, is_active, granted_by, verification_method,
     verification_reference, grant_reason)
  values (p_user_id, p_platform_role, true, v_actor, btrim(p_verification_method),
          p_verification_reference, btrim(p_reason))
  on conflict (user_id) do update
    set platform_role = excluded.platform_role, is_active = true,
        granted_by = excluded.granted_by,
        verification_method = excluded.verification_method,
        verification_reference = excluded.verification_reference,
        grant_reason = excluded.grant_reason,
        revoked_at = null, revoked_by = null, revoked_reason = null,
        updated_at = now();

  perform public.forge_audit_event(
    v_actor, 'platform_operator', null, null, 'operator.granted',
    'forge_platform_operators', p_user_id::text, null,
    jsonb_build_object('platform_role', p_platform_role),
    btrim(p_reason), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('user_id', p_user_id, 'platform_role', p_platform_role, 'is_active', true);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, null, 'operator_grant', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_platform_operator_grant(uuid, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_platform_operator_grant(uuid, text, text, text, text, text) to authenticated;

create or replace function public.forge_platform_operator_revoke(
  p_user_id uuid,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_active_owners integer;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('operator_revoke|' || p_user_id::text || '|' || btrim(p_reason), 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'operator_revoke' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  -- Last-owner first: when only one owner remains, the target IS the
  -- caller, so this check must precede the self-revoke check or the
  -- LAST_OWNER path could never fire.
  select count(*) into v_active_owners from public.forge_platform_operators
  where platform_role = 'owner' and is_active;
  if v_active_owners <= 1 then
    raise exception 'FORGE_AUTH_LAST_OWNER' using errcode = '22023';
  end if;
  if p_user_id = v_actor then raise exception 'FORGE_AUTH_SELF_REVOKE' using errcode = '22023'; end if;

  update public.forge_platform_operators
     set is_active = false, revoked_at = now(), revoked_by = v_actor,
         revoked_reason = btrim(p_reason), updated_at = now()
   where user_id = p_user_id and is_active;
  if not found then raise exception 'FORGE_AUTH_OPERATOR_NOT_FOUND' using errcode = '22023'; end if;

  perform public.forge_audit_event(
    v_actor, 'platform_operator', null, null, 'operator.revoked',
    'forge_platform_operators', p_user_id::text,
    jsonb_build_object('is_active', true),
    jsonb_build_object('is_active', false),
    btrim(p_reason), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('user_id', p_user_id, 'is_active', false);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, null, 'operator_revoke', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_platform_operator_revoke(uuid, text, text) from public, anon, service_role;
grant execute on function public.forge_platform_operator_revoke(uuid, text, text) to authenticated;

-- Programmer grant/revoke: platform owner only. Default scope is
-- read-only diagnostics; email is never authority.
create or replace function public.forge_programmer_grant(
  p_user_id uuid,
  p_scope jsonb,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_scope jsonb;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023'; end if;
  v_scope := coalesce(p_scope, '{"read_only_diagnostics": true}'::jsonb);
  if jsonb_typeof(v_scope) <> 'object' then raise exception 'FORGE_AUTH_SCOPE_OBJECT' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('programmer_grant|' || p_user_id::text || '|' || v_scope::text || '|' || btrim(p_reason), 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'programmer_grant' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'FORGE_AUTH_USER_NOT_FOUND' using errcode = '22023';
  end if;

  insert into public.forge_programmer_grants
    (user_id, scope, is_active, granted_by, grant_reason)
  values (p_user_id, v_scope, true, v_actor, btrim(p_reason))
  on conflict (user_id) do update
    set scope = excluded.scope, is_active = true, granted_by = excluded.granted_by,
        grant_reason = excluded.grant_reason,
        revoked_at = null, revoked_by = null, revoked_reason = null,
        updated_at = now();

  perform public.forge_audit_event(
    v_actor, 'platform_operator', null, null, 'programmer.granted',
    'forge_programmer_grants', p_user_id::text, null,
    jsonb_build_object('scope', v_scope),
    btrim(p_reason), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('user_id', p_user_id, 'is_active', true, 'scope', v_scope);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, null, 'programmer_grant', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_programmer_grant(uuid, jsonb, text, text) from public, anon, service_role;
grant execute on function public.forge_programmer_grant(uuid, jsonb, text, text) to authenticated;

create or replace function public.forge_programmer_revoke(
  p_user_id uuid,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('programmer_revoke|' || p_user_id::text || '|' || btrim(p_reason), 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'programmer_revoke' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;

  update public.forge_programmer_grants
     set is_active = false, revoked_at = now(), revoked_by = v_actor,
         revoked_reason = btrim(p_reason), updated_at = now()
   where user_id = p_user_id and is_active;
  if not found then raise exception 'FORGE_AUTH_PROGRAMMER_NOT_FOUND' using errcode = '22023'; end if;

  perform public.forge_audit_event(
    v_actor, 'platform_operator', null, null, 'programmer.revoked',
    'forge_programmer_grants', p_user_id::text,
    jsonb_build_object('is_active', true),
    jsonb_build_object('is_active', false),
    btrim(p_reason), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('user_id', p_user_id, 'is_active', false);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, null, 'programmer_revoke', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_programmer_revoke(uuid, text, text) from public, anon, service_role;
grant execute on function public.forge_programmer_revoke(uuid, text, text) to authenticated;

-- Support contexts: short-lived, reasoned, owner-created. Programmers
-- and support staff may only call forge_support_context_use within an
-- active context. Nothing here grants access; it records the reasoned
-- permission that the application layer then enforces.
create or replace function public.forge_support_context_create(
  p_owner_id text,
  p_granted_user_id uuid,
  p_purpose text,
  p_reason text,
  p_allowed_apps text[],
  p_allowed_actions jsonb,
  p_expires_at timestamptz,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_context_id text;
  v_now timestamptz := now();
  v_expiry timestamptz;
  v_apps text[];
  v_actions jsonb;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_purpose is null or char_length(btrim(p_purpose)) < 1 or char_length(btrim(p_purpose)) > 200 then
    raise exception 'FORGE_AUTH_PURPOSE_REQUIRED' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023'; end if;
  v_apps := coalesce(p_allowed_apps, '{}'::text[]);
  if exists (select 1 from unnest(v_apps) a where a not in ('designer', 'scheduler', 'planner', 'capture')) then
    raise exception 'FORGE_AUTH_UNKNOWN_APP' using errcode = '22023';
  end if;
  v_actions := coalesce(p_allowed_actions, '[]'::jsonb);
  if jsonb_typeof(v_actions) <> 'array' then raise exception 'FORGE_AUTH_ACTIONS_ARRAY' using errcode = '22023'; end if;
  v_expiry := coalesce(p_expires_at, v_now + interval '1 hour');
  if v_expiry <= v_now then raise exception 'FORGE_AUTH_EXPIRY_PAST' using errcode = '22023'; end if;
  if v_expiry > v_now + interval '8 hours' then raise exception 'FORGE_AUTH_CONTEXT_TOO_LONG' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('support_context_create|' || p_owner_id || '|' || p_granted_user_id::text || '|' || btrim(p_purpose) || '|' || btrim(p_reason) || '|' || v_apps::text || '|' || v_actions::text || '|' || v_expiry::text, 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'support_context_create' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  if not exists (select 1 from public.forge_platform_operators
                 where user_id = p_granted_user_id and platform_role in ('programmer', 'support') and is_active) then
    raise exception 'FORGE_AUTH_CONTEXT_GRANTEE' using errcode = '22023';
  end if;
  if not exists (select 1 from public.forge_workspaces where owner_id = p_owner_id) then
    raise exception 'FORGE_AUTH_WORKSPACE_NOT_FOUND' using errcode = '22023';
  end if;

  v_context_id := 'forge_ctx_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.forge_support_contexts
    (id, operator_user_id, target_owner_id, purpose, reason,
     allowed_actions, allowed_apps, created_by, expires_at, request_id)
  values (v_context_id, p_granted_user_id, p_owner_id, btrim(p_purpose),
          btrim(p_reason), v_actions, v_apps, v_actor, v_expiry, p_request_id);

  perform public.forge_audit_event(
    v_actor, 'platform_operator', p_owner_id, null, 'support_context.created',
    'forge_support_contexts', v_context_id, null,
    jsonb_build_object('granted_user_id', p_granted_user_id, 'allowed_apps', v_apps, 'expires_at', v_expiry),
    btrim(p_reason), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('context_id', v_context_id, 'owner_id', p_owner_id,
                                 'granted_user_id', p_granted_user_id, 'allowed_apps', v_apps, 'expires_at', v_expiry);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, p_owner_id, 'support_context_create', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_support_context_create(text, uuid, text, text, text[], jsonb, timestamptz, text) from public, anon, service_role;
grant execute on function public.forge_support_context_create(text, uuid, text, text, text[], jsonb, timestamptz, text) to authenticated;

create or replace function public.forge_support_context_revoke(
  p_context_id text,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_ctx public.forge_support_contexts%rowtype;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('support_context_revoke|' || p_context_id || '|' || btrim(p_reason), 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_context_id), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'support_context_revoke' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  select * into v_ctx from public.forge_support_contexts where id = p_context_id;
  if v_ctx.id is null then raise exception 'FORGE_AUTH_CONTEXT_NOT_FOUND' using errcode = '22023'; end if;

  update public.forge_support_contexts
     set revoked_at = now(), revoked_by = v_actor, revoked_reason = btrim(p_reason)
   where id = p_context_id;

  perform public.forge_audit_event(
    v_actor, 'platform_operator', v_ctx.target_owner_id, null, 'support_context.revoked',
    'forge_support_contexts', p_context_id,
    jsonb_build_object('revoked_at', null),
    jsonb_build_object('revoked_at', now()),
    btrim(p_reason), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('context_id', p_context_id, 'revoked', true);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, v_ctx.target_owner_id, 'support_context_revoke', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_support_context_revoke(text, text, text) from public, anon, service_role;
grant execute on function public.forge_support_context_revoke(text, text, text) to authenticated;

-- Context use: the grantee attests to each use of the context. Returns
-- the context status; the application layer still enforces read-only
-- diagnostics unless a separate owner approval exists.
create or replace function public.forge_support_context_use(
  p_context_id text,
  p_action_summary text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_ctx public.forge_support_contexts%rowtype;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_action_summary is null or char_length(btrim(p_action_summary)) < 1 then raise exception 'FORGE_AUTH_ACTION_SUMMARY_REQUIRED' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('support_context_use|' || p_context_id || '|' || btrim(p_action_summary), 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_context_id), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'support_context_use' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  select * into v_ctx from public.forge_support_contexts where id = p_context_id;
  if v_ctx.id is null then raise exception 'FORGE_AUTH_CONTEXT_NOT_FOUND' using errcode = '22023'; end if;
  if v_ctx.operator_user_id <> v_actor then
    raise exception 'FORGE_AUTH_CONTEXT_NOT_YOURS' using errcode = '42501';
  end if;
  if v_ctx.revoked_at is not null then raise exception 'FORGE_AUTH_CONTEXT_REVOKED' using errcode = '42501'; end if;
  if v_ctx.expires_at <= now() then raise exception 'FORGE_AUTH_CONTEXT_EXPIRED' using errcode = '42501'; end if;

  perform public.forge_audit_event(
    v_actor, 'programmer', v_ctx.target_owner_id, null, 'support_context.used',
    'forge_support_contexts', p_context_id, null,
    jsonb_build_object('action_summary', btrim(p_action_summary)),
    btrim(p_action_summary), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('context_id', p_context_id, 'owner_id', v_ctx.target_owner_id, 'allowed', true);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, v_ctx.target_owner_id, 'support_context_use', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_support_context_use(text, text, text) from public, anon, service_role;
grant execute on function public.forge_support_context_use(text, text, text) to authenticated;

-- App-role assign/revoke for designer + capture (the canonical-role
-- apps). Planner/scheduler assignments go through their own role
-- tables; their assign/revoke RPCs live in their own slices so this PR
-- does not rewire their existing flows.
create or replace function public.forge_app_role_assign(
  p_owner_id text,
  p_app_key text,
  p_user_id uuid,
  p_role_key text,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_text text := auth.uid()::text;
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_is_owner boolean;
  v_is_admin boolean;
  v_role_id text;
  v_role_has_manage boolean;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_app_key not in ('designer', 'capture') then
    raise exception 'FORGE_AUTH_APP_NOT_CANONICAL' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('app_role_assign|' || p_owner_id || '|' || p_app_key || '|' || p_user_id::text || '|' || p_role_key, 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'app_role_assign' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  v_is_owner := (p_owner_id = v_actor_text) or exists (
    select 1 from public.workspace_members
    where owner_id = p_owner_id and member_user_id = v_actor
      and status = 'active' and role = 'co_owner'
  );
  v_is_admin := exists (
    select 1 from public.workspace_members
    where owner_id = p_owner_id and member_user_id = v_actor
      and status = 'active' and role = 'workspace_admin'
  );
  if not v_is_owner and not v_is_admin then
    raise exception 'FORGE_AUTH_ROLE_ASSIGN_FORBIDDEN' using errcode = '42501';
  end if;

  select r.id into v_role_id from public.forge_app_roles r
  where r.owner_id = p_owner_id and r.app_key = p_app_key
    and r.role_key = p_role_key and r.retired_at is null;
  if v_role_id is null then raise exception 'FORGE_AUTH_ROLE_NOT_FOUND' using errcode = '22023'; end if;
  v_role_has_manage := exists (
    select 1 from public.forge_app_role_capabilities c
    where c.owner_id = p_owner_id and c.app_key = p_app_key and c.role_id = v_role_id
      and c.capability_key = p_app_key || '.roles.manage');
  if v_is_admin and not v_is_owner and coalesce(v_role_has_manage, false) then
    raise exception 'FORGE_AUTH_CEILING_EXCEEDED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspace_members
                 where owner_id = p_owner_id and member_user_id = p_user_id
                   and status = 'active') then
    raise exception 'FORGE_AUTH_MEMBER_NOT_FOUND' using errcode = '22023';
  end if;

  update public.forge_app_user_role_assignments
     set retired_at = now(), retired_by = v_actor_text, updated_at = now()
   where owner_id = p_owner_id and app_key = p_app_key
     and user_id = p_user_id::text and retired_at is null;
  insert into public.forge_app_user_role_assignments
    (owner_id, app_key, id, user_id, role_id, assigned_by, updated_by)
  values (p_owner_id, p_app_key, 'forge_aura_' || replace(gen_random_uuid()::text, '-', ''),
          p_user_id::text, v_role_id, v_actor_text, v_actor_text);

  perform public.forge_audit_event(
    v_actor, case when v_is_owner then 'owner' else 'workspace_admin' end,
    p_owner_id, p_app_key, 'app_role.assigned',
    'forge_app_user_role_assignments', p_user_id::text || '|' || p_app_key,
    jsonb_build_object('role_key', null),
    jsonb_build_object('role_key', p_role_key),
    btrim(p_reason), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('owner_id', p_owner_id, 'app_key', p_app_key,
                                 'user_id', p_user_id, 'role_key', p_role_key);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, p_owner_id, 'app_role_assign', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_app_role_assign(text, text, uuid, text, text, text) from public, anon, service_role;
grant execute on function public.forge_app_role_assign(text, text, uuid, text, text, text) to authenticated;

create or replace function public.forge_app_role_revoke(
  p_owner_id text,
  p_app_key text,
  p_user_id uuid,
  p_reason text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_text text := auth.uid()::text;
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_is_owner boolean;
  v_is_admin boolean;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_app_key not in ('designer', 'capture') then
    raise exception 'FORGE_AUTH_APP_NOT_CANONICAL' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 1 then raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023'; end if;
  v_payload_hash := encode(extensions.digest(convert_to('app_role_revoke|' || p_owner_id || '|' || p_app_key || '|' || p_user_id::text || '|' || btrim(p_reason), 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'app_role_revoke' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  v_is_owner := (p_owner_id = v_actor_text) or exists (
    select 1 from public.workspace_members
    where owner_id = p_owner_id and member_user_id = v_actor
      and status = 'active' and role = 'co_owner'
  );
  v_is_admin := exists (
    select 1 from public.workspace_members
    where owner_id = p_owner_id and member_user_id = v_actor
      and status = 'active' and role = 'workspace_admin'
  );
  if not v_is_owner and not v_is_admin then
    raise exception 'FORGE_AUTH_ROLE_REVOKE_FORBIDDEN' using errcode = '42501';
  end if;

  update public.forge_app_user_role_assignments
     set retired_at = now(), retired_by = v_actor_text, updated_at = now()
   where owner_id = p_owner_id and app_key = p_app_key
     and user_id = p_user_id::text and retired_at is null;
  if not found then raise exception 'FORGE_AUTH_ASSIGNMENT_NOT_FOUND' using errcode = '22023'; end if;

  perform public.forge_audit_event(
    v_actor, case when v_is_owner then 'owner' else 'workspace_admin' end,
    p_owner_id, p_app_key, 'app_role.revoked',
    'forge_app_user_role_assignments', p_user_id::text || '|' || p_app_key,
    jsonb_build_object('role_key', null),
    jsonb_build_object('revoked', true),
    btrim(p_reason), p_request_id, 'rpc', 'allowed');

  v_result := jsonb_build_object('owner_id', p_owner_id, 'app_key', p_app_key,
                                 'user_id', p_user_id, 'revoked', true);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, p_owner_id, 'app_role_revoke', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_app_role_revoke(text, text, uuid, text, text) from public, anon, service_role;
grant execute on function public.forge_app_role_revoke(text, text, uuid, text, text) to authenticated;

-- Backfill: existing (pre-Auth-PR-1) workspaces need the canonical
-- starter roles for designer + capture. Planner/scheduler already have
-- their own role catalogs; nothing is backfilled there.
insert into public.forge_app_roles (owner_id, app_key, id, role_key, name, is_builtin, created_by, updated_by)
select w.owner_id, a.app_key,
       'forge_ar_' || a.app_key || '_' || a.role_key || '_' || replace(w.owner_id, '-', ''),
       a.role_key, a.display_name, true, 'auth-pr1-backfill', 'auth-pr1-backfill'
  from public.forge_workspaces w
  cross join (values
    ('designer', 'designer_admin', 'Designer admin'),
    ('designer', 'designer_user', 'Designer user'),
    ('designer', 'designer_read_only', 'Designer read-only'),
    ('capture', 'capture_admin', 'Capture admin'),
    ('capture', 'capture_user', 'Capture user'),
    ('capture', 'capture_read_only', 'Capture read-only')) a(app_key, role_key, display_name)
  on conflict (owner_id, app_key, role_key) where retired_at is null do nothing;

-- One capability row per (role, capability); the unique index below is
-- what the backfill's ON CONFLICT targets.
create unique index if not exists forge_app_role_capabilities_role_cap_uq
  on public.forge_app_role_capabilities (owner_id, app_key, role_id, capability_key);

insert into public.forge_app_role_capabilities (owner_id, app_key, id, role_id, capability_key, created_by)
select r.owner_id, r.app_key,
       'forge_arc_' || r.role_key || '_' || replace(c.capability_key, '.', '_'),
       r.id, c.capability_key, 'auth-pr1-backfill'
  from public.forge_app_roles r
  join (values
    ('designer', 'designer_admin', 'designer.designs.read'),
    ('designer', 'designer_admin', 'designer.designs.create'),
    ('designer', 'designer_admin', 'designer.designs.edit'),
    ('designer', 'designer_admin', 'designer.designs.delete'),
    ('designer', 'designer_admin', 'designer.drawings.read'),
    ('designer', 'designer_admin', 'designer.drawings.upload'),
    ('designer', 'designer_admin', 'designer.drawings.link'),
    ('designer', 'designer_admin', 'designer.drawings.unlink'),
    ('designer', 'designer_admin', 'designer.drawings.delete'),
    ('designer', 'designer_admin', 'designer.roles.read'),
    ('designer', 'designer_admin', 'designer.roles.manage'),
    ('designer', 'designer_admin', 'designer.audit.read'),
    ('designer', 'designer_user', 'designer.designs.read'),
    ('designer', 'designer_user', 'designer.designs.create'),
    ('designer', 'designer_user', 'designer.designs.edit'),
    ('designer', 'designer_user', 'designer.drawings.read'),
    ('designer', 'designer_user', 'designer.drawings.upload'),
    ('designer', 'designer_user', 'designer.drawings.link'),
    ('designer', 'designer_read_only', 'designer.designs.read'),
    ('designer', 'designer_read_only', 'designer.drawings.read'),
    ('capture', 'capture_admin', 'capture.library.read'),
    ('capture', 'capture_admin', 'capture.library.upload'),
    ('capture', 'capture_admin', 'capture.library.delete'),
    ('capture', 'capture_admin', 'capture.recordings.read'),
    ('capture', 'capture_admin', 'capture.recordings.create'),
    ('capture', 'capture_admin', 'capture.recordings.delete'),
    ('capture', 'capture_admin', 'capture.roles.read'),
    ('capture', 'capture_admin', 'capture.roles.manage'),
    ('capture', 'capture_admin', 'capture.audit.read'),
    ('capture', 'capture_user', 'capture.library.read'),
    ('capture', 'capture_user', 'capture.library.upload'),
    ('capture', 'capture_user', 'capture.recordings.read'),
    ('capture', 'capture_user', 'capture.recordings.create'),
    ('capture', 'capture_read_only', 'capture.library.read'),
    ('capture', 'capture_read_only', 'capture.recordings.read')) c(app_key, role_key, capability_key)
    on c.app_key = r.app_key and c.role_key = r.role_key
  on conflict (owner_id, app_key, role_id, capability_key) do nothing;

-- (No blanket revoke here: the per-function REVOKE/GRANT statements
-- above are the only privilege changes in this migration. A sweep over
-- ALL functions would strip EXECUTE from pre-existing RPCs.)
