-- FORGE External Accounts Register — owner-only register of every
-- external provider / service account used across FORGE and the
-- surrounding work.
--
-- Scope brief: results/chatgpt/external-accounts-register-scope-2026-11-17.md
-- (drop 166c9c6e4, ChatGPT GO TO BUILD scope only; Jason approved the
-- build 2026-11-17 ~21:44 CST).
--
-- What this migration does:
--   1. Creates forge_external_accounts (one row per provider/service
--      account), forge_external_account_threads (normalized linked
--      work threads), and forge_external_account_audit (append-only).
--   2. Enables RLS + FORCE RLS on all three. The ONLY actors who can
--      see a row are the household itself: auth.uid() = platform_owner_id
--      (Jason, the primary platform owner) or an ACTIVE co_owner
--      membership for that owner (Brandy) — the gate is
--      forge_external_account_actor_may_act() AND
--      public.has_workspace_access(platform_owner_id). The may_act()
--      half is load-bearing: has_workspace_access() alone passes ANY
--      authenticated user for their own id via the owner-equality
--      branch, so a staff member would otherwise resolve into an empty
--      scope of their own and could write a parallel register there.
--      may_act() denies staff roles (manager/bookkeeper/read_only) in
--      any workspace and any suspended (revoked) membership. Ordinary
--      members, managers, bookkeepers, viewers, revoked co-owners,
--      unrelated owners, and anon see no row, no count, no name, no
--      presence signal. Typed/copied IDs yield the generic
--      FORGE_EXTERNAL_ACCOUNT_NOT_FOUND, never a leak.
--   3. All mutations go through SECURITY DEFINER RPCs that re-check
--      household membership, resolve the effective owner (so Brandy's
--      writes land under Jason's platform_owner_id, never her own),
--      validate enums + secret patterns, enforce optimistic
--      concurrency (version), and write audit rows (changed field
--      NAMES only, never values — a credential locator is never
--      replicated into audit).
--   4. A BEFORE INSERT/UPDATE trigger rejects obvious secret-like
--      values in free-text columns (API keys, tokens, private keys,
--      credential URLs, password assignments) on accounts and threads.
--      Defense in depth only: it cannot catch every secret format.
--   5. Seed + reconcile RPCs. The seed is idempotent on seed_key
--      (external_accounts_seed_v1:<slug>): a re-run creates only
--      missing candidates and NEVER overwrites owner-edited values.
--      Reconcile is idempotent on the Gmail message reference.
--
-- FILE ONLY in this PR. Do NOT apply to production without a merge +
-- ChatGPT GO + Muse's agreement check AND Jason's separate word: this
-- brief retains an explicit migration-apply gate (apply on HOLD even
-- after code GO).
-- Migration number 20261117140000 confirmed as next free against main
-- 2cee2565 at build time (newest on main is 20261117130000).

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_external_accounts (
  id uuid primary key default gen_random_uuid(),
  platform_owner_id text not null,
  seed_key text null,
  provider_name text not null check (btrim(provider_name) <> ''),
  purpose text not null check (btrim(purpose) <> ''),
  associated_app text not null check (btrim(associated_app) <> ''),
  work_thread_label text null,
  account_email text null check (account_email is null or account_email like '%@%.%'),
  plan_status text not null default 'unknown'
    check (plan_status in ('unknown', 'free', 'paid', 'trial', 'not_applicable')),
  billing_arrangement text null check (billing_arrangement is null or char_length(billing_arrangement) <= 500),
  api_integration_status text not null default 'unknown'
    check (api_integration_status in ('unknown', 'integrated', 'not_integrated', 'not_applicable')),
  still_needed boolean null,
  credential_location text null check (credential_location is null or char_length(credential_location) <= 300),
  record_status text not null default 'unverified_lead'
    check (record_status in ('confirmed_account', 'unverified_lead', 'evaluating_service', 'local_tool', 'no_account_required', 'closed')),
  setup_status text not null default 'unknown'
    check (setup_status in ('unknown', 'not_started', 'in_progress', 'blocked', 'ready', 'not_applicable', 'retired')),
  source_kind text not null default 'manual'
    check (source_kind in ('reconstructed_inventory', 'email_crosscheck', 'manual')),
  source_reference text null check (source_reference is null or char_length(source_reference) <= 500),
  notes text null check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null,
  last_verified_at timestamptz null,
  deleted_at timestamptz null,
  deleted_by uuid null,
  version integer not null default 1 check (version >= 1)
);
comment on table public.forge_external_accounts is
'Owner-only register of external providers/service accounts (FORGE External Accounts Register). One row per provider/service account. platform_owner_id is the primary platform owner''s auth uid; the household (owner + active co-owner) is the only audience. NEVER store a password, API key, token, recovery code, full card number, raw email body, or secret URL in any column — credential_location is a human-readable locator only.';

create unique index if not exists idx_forge_external_accounts_seed_key
  on public.forge_external_accounts (seed_key) where seed_key is not null;
create index if not exists idx_forge_external_accounts_owner_provider
  on public.forge_external_accounts (platform_owner_id, lower(btrim(provider_name)));
create index if not exists idx_forge_external_accounts_owner_duplicate
  on public.forge_external_accounts (platform_owner_id, lower(btrim(provider_name)), lower(btrim(coalesce(account_email, ''))), lower(btrim(associated_app)));
create index if not exists idx_forge_external_accounts_owner_deleted
  on public.forge_external_accounts (platform_owner_id, deleted_at);

create table if not exists public.forge_external_account_threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.forge_external_accounts (id) on delete cascade,
  platform_owner_id text not null,
  title text not null check (btrim(title) <> '' and char_length(title) <= 500),
  reference text null check (reference is null or char_length(reference) <= 1000),
  state text not null default 'open'
    check (state in ('none', 'open', 'blocked', 'waiting', 'complete', 'abandoned')),
  next_action text null check (next_action is null or char_length(next_action) <= 1000),
  owner text null check (owner is null or char_length(owner) <= 200),
  next_review_on date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);
comment on table public.forge_external_account_threads is
'Normalized linked work threads for one register row. A thread links a register account to unfinished work (tracker row, drop brief, PR); the register row itself is not a project tracker. platform_owner_id is denormalized so RLS needs no join.';

create index if not exists idx_forge_external_account_threads_account
  on public.forge_external_account_threads (account_id, state);
create index if not exists idx_forge_external_account_threads_owner
  on public.forge_external_account_threads (platform_owner_id, state);

create table if not exists public.forge_external_account_audit (
  id uuid primary key default gen_random_uuid(),
  account_id uuid null,
  platform_owner_id text not null,
  actor_user_id uuid not null,
  action text not null check (action in ('create', 'update', 'delete', 'restore', 'permanent_erase', 'seed_apply', 'reconcile_create', 'reconcile_match', 'reconcile_skip', 'thread_add', 'thread_state')),
  changed_fields text[] not null default '{}',
  detail jsonb null,
  created_at timestamptz not null default now()
);
comment on table public.forge_external_account_audit is
'Append-only audit for the External Accounts Register. changed_fields holds field NAMES only — never values, so a credential locator is never replicated into audit. No FK on account_id: the row survives a permanent erase. Written only by the SECURITY DEFINER RPCs below; no direct INSERT/UPDATE/DELETE policy exists for authenticated.';

create index if not exists idx_forge_external_account_audit_account
  on public.forge_external_account_audit (account_id, created_at);
create index if not exists idx_forge_external_account_audit_owner
  on public.forge_external_account_audit (platform_owner_id, created_at);

-- The household gate predicate lives here, ahead of the policies that
-- call it (a policy cannot reference a function that does not exist yet).
-- See section 4 for the full rationale.

create or replace function public.forge_external_account_actor_may_act()
returns boolean language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_actor uuid := auth.uid();
  v_owner text;
begin
  if v_actor is null then return false; end if;
  if exists (select 1 from public.workspace_members
             where member_user_id = v_actor
               and ((status = 'active' and role in ('manager', 'bookkeeper', 'read_only'))
                    or status = 'suspended')) then
    return false;
  end if;
  v_owner := public.resolve_effective_owner_id(v_actor);
  return public.has_workspace_access(v_owner);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. RLS + grants.
--
-- Default pg_default_acl grants ALL on new tables to anon/authenticated/
-- service_role, so the REVOKEs below are load-bearing, not decorative:
-- anon must hold nothing (RLS alone is not the whole story), and the
-- grants that remain are exactly SELECT/INSERT/UPDATE/DELETE for
-- authenticated (RLS-gated to the household) and service_role (server
-- side only). The audit table grants SELECT only — writes are RPC-only.
-- ---------------------------------------------------------------------------

alter table public.forge_external_accounts enable row level security;
alter table public.forge_external_accounts force row level security;
alter table public.forge_external_account_threads enable row level security;
alter table public.forge_external_account_threads force row level security;
alter table public.forge_external_account_audit enable row level security;
alter table public.forge_external_account_audit force row level security;

revoke all on table public.forge_external_accounts from public, anon, authenticated, service_role;
revoke all on table public.forge_external_account_threads from public, anon, authenticated, service_role;
revoke all on table public.forge_external_account_audit from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.forge_external_accounts to authenticated, service_role;
grant select, insert, update, delete on table public.forge_external_account_threads to authenticated, service_role;
grant select on table public.forge_external_account_audit to authenticated, service_role;

drop policy if exists forge_external_accounts_household_select on public.forge_external_accounts;
create policy forge_external_accounts_household_select on public.forge_external_accounts for select to authenticated
  using (public.forge_external_account_actor_may_act() and public.has_workspace_access(platform_owner_id));
drop policy if exists forge_external_accounts_household_insert on public.forge_external_accounts;
create policy forge_external_accounts_household_insert on public.forge_external_accounts for insert to authenticated
  with check (public.forge_external_account_actor_may_act() and public.has_workspace_access(platform_owner_id));
drop policy if exists forge_external_accounts_household_update on public.forge_external_accounts;
create policy forge_external_accounts_household_update on public.forge_external_accounts for update to authenticated
  using (public.forge_external_account_actor_may_act() and public.has_workspace_access(platform_owner_id))
  with check (public.forge_external_account_actor_may_act() and public.has_workspace_access(platform_owner_id));
drop policy if exists forge_external_accounts_household_delete on public.forge_external_accounts;
create policy forge_external_accounts_household_delete on public.forge_external_accounts for delete to authenticated
  using (public.forge_external_account_actor_may_act() and public.has_workspace_access(platform_owner_id));

drop policy if exists forge_external_account_threads_household_select on public.forge_external_account_threads;
create policy forge_external_account_threads_household_select on public.forge_external_account_threads for select to authenticated
  using (public.forge_external_account_actor_may_act() and public.has_workspace_access(platform_owner_id));
drop policy if exists forge_external_account_threads_household_insert on public.forge_external_account_threads;
create policy forge_external_account_threads_household_insert on public.forge_external_account_threads for insert to authenticated
  with check (public.forge_external_account_actor_may_act() and public.has_workspace_access(platform_owner_id));
drop policy if exists forge_external_account_threads_household_update on public.forge_external_account_threads;
create policy forge_external_account_threads_household_update on public.forge_external_account_threads for update to authenticated
  using (public.forge_external_account_actor_may_act() and public.has_workspace_access(platform_owner_id))
  with check (public.forge_external_account_actor_may_act() and public.has_workspace_access(platform_owner_id));
drop policy if exists forge_external_account_threads_household_delete on public.forge_external_account_threads;
create policy forge_external_account_threads_household_delete on public.forge_external_account_threads for delete to authenticated
  using (public.forge_external_account_actor_may_act() and public.has_workspace_access(platform_owner_id));

drop policy if exists forge_external_account_audit_household_select on public.forge_external_account_audit;
create policy forge_external_account_audit_household_select on public.forge_external_account_audit for select to authenticated
  using (public.forge_external_account_actor_may_act() and public.has_workspace_access(platform_owner_id));

-- ---------------------------------------------------------------------------
-- 3. Triggers: platform_owner_id immutability, updated_at maintenance,
--    secret-pattern rejection, audit append-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_external_accounts_owner_immutable()
returns trigger language plpgsql as $$
begin
  if old.platform_owner_id is distinct from new.platform_owner_id then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_OWNER_IMMUTABLE: platform_owner_id cannot change after creation';
  end if;
  if old.seed_key is distinct from new.seed_key then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_SEED_KEY_IMMUTABLE: seed_key cannot change after creation';
  end if;
  return new;
end;
$$;

drop trigger if exists forge_external_accounts_owner_immutable on public.forge_external_accounts;
create trigger forge_external_accounts_owner_immutable
  before update on public.forge_external_accounts
  for each row execute function public.forge_external_accounts_owner_immutable();

create or replace function public.forge_external_account_threads_owner_immutable()
returns trigger language plpgsql as $$
begin
  if old.platform_owner_id is distinct from new.platform_owner_id then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_OWNER_IMMUTABLE: platform_owner_id cannot change after creation';
  end if;
  if old.account_id is distinct from new.account_id then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_THREAD_IMMUTABLE: account_id cannot change after creation';
  end if;
  return new;
end;
$$;

drop trigger if exists forge_external_account_threads_owner_immutable on public.forge_external_account_threads;
create trigger forge_external_account_threads_owner_immutable
  before update on public.forge_external_account_threads
  for each row execute function public.forge_external_account_threads_owner_immutable();

create or replace function public.forge_external_accounts_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists forge_external_accounts_touch_updated_at on public.forge_external_accounts;
create trigger forge_external_accounts_touch_updated_at
  before update on public.forge_external_accounts
  for each row execute function public.forge_external_accounts_touch_updated_at();

drop trigger if exists forge_external_account_threads_touch_updated_at on public.forge_external_account_threads;
create trigger forge_external_account_threads_touch_updated_at
  before update on public.forge_external_account_threads
  for each row execute function public.forge_external_accounts_touch_updated_at();

-- Secret-pattern rejection (defense in depth, not a guarantee against
-- all secret formats). Checks every free-text column a caller could
-- paste a credential into. The message never echoes the value.
create or replace function public.forge_external_accounts_reject_secrets()
returns trigger language plpgsql as $$
declare
  v_text text;
begin
  v_text := coalesce(new.credential_location, '') || E'\n'
    || coalesce(new.notes, '') || E'\n'
    || coalesce(new.billing_arrangement, '') || E'\n'
    || coalesce(new.source_reference, '');
  if v_text ~* '(sk-[A-Za-z0-9]{16,}|sk-ant-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----|api[_-]?key\s*=\s*\S+|password\s*=\s*\S+|token\s*=\s*\S+|https?://[^/\s]+:[^/\s@]+@)' then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_SECRET_REJECTED: that value looks like a credential — store only a location (for example, 1Password → FORGE), never the credential itself';
  end if;
  return new;
end;
$$;

drop trigger if exists forge_external_accounts_reject_secrets on public.forge_external_accounts;
create trigger forge_external_accounts_reject_secrets
  before insert or update on public.forge_external_accounts
  for each row execute function public.forge_external_accounts_reject_secrets();

create or replace function public.forge_external_account_threads_reject_secrets()
returns trigger language plpgsql as $$
declare
  v_text text;
begin
  v_text := coalesce(new.title, '') || E'\n'
    || coalesce(new.reference, '') || E'\n'
    || coalesce(new.next_action, '');
  if v_text ~* '(sk-[A-Za-z0-9]{16,}|sk-ant-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----|api[_-]?key\s*=\s*\S+|password\s*=\s*\S+|token\s*=\s*\S+|https?://[^/\s]+:[^/\s@]+@)' then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_SECRET_REJECTED: that value looks like a credential — store only a location (for example, 1Password → FORGE), never the credential itself';
  end if;
  return new;
end;
$$;

drop trigger if exists forge_external_account_threads_reject_secrets on public.forge_external_account_threads;
create trigger forge_external_account_threads_reject_secrets
  before insert or update on public.forge_external_account_threads
  for each row execute function public.forge_external_account_threads_reject_secrets();

create or replace function public.forge_external_account_audit_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'FORGE_EXTERNAL_ACCOUNT_AUDIT_APPEND_ONLY: audit rows cannot be changed or deleted';
end;
$$;

drop trigger if exists forge_external_account_audit_append_only on public.forge_external_account_audit;
create trigger forge_external_account_audit_append_only
  before update or delete on public.forge_external_account_audit
  for each row execute function public.forge_external_account_audit_append_only();

-- ---------------------------------------------------------------------------
-- 4. Shared RPC helpers: actor resolution + audit writer.
--
-- Every RPC below runs SECURITY DEFINER as postgres with search_path =
-- public. The actor is always auth.uid(); the effective owner is
-- resolve_effective_owner_id() (Brandy resolves to Jason's owner id,
-- so her writes land in the shared household, never under her own
-- id).
--
-- The household gate is forge_external_account_actor_may_act(), NOT bare
-- has_workspace_access(): resolve_effective_owner_id() maps a staff
-- member to themselves (they hold no co_owner row), and
-- has_workspace_access() then passes via the owner-equality branch —
-- so a staff member would silently pass into an empty scope of their
-- own and could seed/write a parallel register there. may_act() closes
-- that hole: staff roles (manager/bookkeeper/read_only) in ANY workspace
-- never own a register scope, and a suspended (revoked) membership
-- confers nothing. A non-household caller gets the generic
-- FORGE_EXTERNAL_ACCOUNT_NOT_FOUND, never a leak.
-- ---------------------------------------------------------------------------

create or replace function public.forge_external_account_audit_insert(
  p_account_id uuid,
  p_platform_owner_id text,
  p_actor uuid,
  p_action text,
  p_changed_fields text[],
  p_detail jsonb
)
returns void language sql security definer set search_path = public set row_security = off as $$
  insert into public.forge_external_account_audit
    (account_id, platform_owner_id, actor_user_id, action, changed_fields, detail)
  values (p_account_id, p_platform_owner_id, p_actor, p_action, p_changed_fields, p_detail);
$$;

create or replace function public.forge_external_account_require_household()
returns text language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_NOT_FOUND: that register entry was not found';
  end if;
  if not public.forge_external_account_actor_may_act() then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_NOT_FOUND: that register entry was not found';
  end if;
  return public.resolve_effective_owner_id(v_actor);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Mutation RPCs.
-- ---------------------------------------------------------------------------

-- Create. Payload keys: provider_name, purpose, associated_app,
-- work_thread_label, account_email, plan_status,
-- api_integration_status, still_needed, credential_location,
-- record_status, setup_status, source_kind, source_reference, notes,
-- allow_duplicate (boolean, default false). Duplicate = same household
-- + normalized provider + canonical email + associated app. On a
-- duplicate without allow_duplicate the RPC does NOT insert; it
-- returns { conflict: true, existing_id } so the UI can run the
-- duplicate-review workflow.
create or replace function public.forge_external_account_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner text := public.forge_external_account_require_household();
  v_actor uuid := auth.uid();
  v_provider text := btrim(coalesce(p_payload ->> 'provider_name', ''));
  v_purpose text := btrim(coalesce(p_payload ->> 'purpose', ''));
  v_app text := btrim(coalesce(p_payload ->> 'associated_app', ''));
  v_email text := nullif(btrim(coalesce(p_payload ->> 'account_email', '')), '');
  v_existing uuid;
  v_id uuid;
begin
  if v_provider = '' then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_PROVIDER_REQUIRED: a provider name is required';
  end if;
  if v_purpose = '' then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_PURPOSE_REQUIRED: a purpose is required';
  end if;
  if v_app = '' then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_APP_REQUIRED: an associated app is required';
  end if;
  if v_email is not null and v_email not like '%@%.%' then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_EMAIL_INVALID: that email address does not look valid';
  end if;

  select id into v_existing from public.forge_external_accounts
    where platform_owner_id = v_owner
      and deleted_at is null
      and lower(btrim(provider_name)) = lower(v_provider)
      and lower(btrim(coalesce(account_email, ''))) = lower(coalesce(v_email, ''))
      and lower(btrim(associated_app)) = lower(v_app)
    limit 1;
  if v_existing is not null and not coalesce((p_payload ->> 'allow_duplicate')::boolean, false) then
    return jsonb_build_object('conflict', true, 'existing_id', v_existing);
  end if;

  insert into public.forge_external_accounts (
    platform_owner_id, provider_name, purpose, associated_app, work_thread_label,
    account_email, plan_status, billing_arrangement, api_integration_status,
    still_needed, credential_location, record_status, setup_status,
    source_kind, source_reference, notes, created_by, updated_by
  ) values (
    v_owner, v_provider, v_purpose, v_app,
    nullif(btrim(coalesce(p_payload ->> 'work_thread_label', '')), ''),
    v_email,
    coalesce(p_payload ->> 'plan_status', 'unknown'),
    nullif(btrim(coalesce(p_payload ->> 'billing_arrangement', '')), ''),
    coalesce(p_payload ->> 'api_integration_status', 'unknown'),
    (p_payload ->> 'still_needed')::boolean,
    nullif(btrim(coalesce(p_payload ->> 'credential_location', '')), ''),
    coalesce(p_payload ->> 'record_status', 'unverified_lead'),
    coalesce(p_payload ->> 'setup_status', 'unknown'),
    coalesce(p_payload ->> 'source_kind', 'manual'),
    nullif(btrim(coalesce(p_payload ->> 'source_reference', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'notes', '')), ''),
    v_actor, v_actor
  ) returning id into v_id;

  perform public.forge_external_account_audit_insert(
    v_id, v_owner, v_actor, 'create',
    array['provider_name', 'purpose', 'associated_app'],
    jsonb_build_object('provider_name', v_provider));

  return jsonb_build_object('conflict', false, 'id', v_id);
end;
$$;

-- Update. Only the listed fields may change; platform_owner_id,
-- seed_key, id, and audit columns are never writable here. The caller
-- passes the version it read; a mismatch is a 409-style conflict
-- (concurrent Jason/Brandy edit) and nothing is written.
create or replace function public.forge_external_account_update(
  p_account_id uuid, p_payload jsonb, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner text := public.forge_external_account_require_household();
  v_actor uuid := auth.uid();
  v_row public.forge_external_accounts%rowtype;
  v_changed text[] := '{}';
begin
  select * into v_row from public.forge_external_accounts
    where id = p_account_id and platform_owner_id = v_owner and deleted_at is null;
  if not found then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_NOT_FOUND: that register entry was not found';
  end if;
  if v_row.version <> p_expected_version then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_VERSION_CONFLICT: that entry changed since you opened it — reload and try again';
  end if;

  update public.forge_external_accounts set
    provider_name = case when p_payload ? 'provider_name' then nullif(btrim(p_payload ->> 'provider_name'), '') else provider_name end,
    purpose = case when p_payload ? 'purpose' then nullif(btrim(p_payload ->> 'purpose'), '') else purpose end,
    associated_app = case when p_payload ? 'associated_app' then nullif(btrim(p_payload ->> 'associated_app'), '') else associated_app end,
    work_thread_label = case when p_payload ? 'work_thread_label' then nullif(btrim(p_payload ->> 'work_thread_label'), '') else work_thread_label end,
    account_email = case when p_payload ? 'account_email' then nullif(btrim(p_payload ->> 'account_email'), '') else account_email end,
    plan_status = case when p_payload ? 'plan_status' then p_payload ->> 'plan_status' else plan_status end,
    billing_arrangement = case when p_payload ? 'billing_arrangement' then nullif(btrim(p_payload ->> 'billing_arrangement'), '') else billing_arrangement end,
    api_integration_status = case when p_payload ? 'api_integration_status' then p_payload ->> 'api_integration_status' else api_integration_status end,
    still_needed = case when p_payload ? 'still_needed' then (p_payload ->> 'still_needed')::boolean else still_needed end,
    credential_location = case when p_payload ? 'credential_location' then nullif(btrim(p_payload ->> 'credential_location'), '') else credential_location end,
    record_status = case when p_payload ? 'record_status' then p_payload ->> 'record_status' else record_status end,
    setup_status = case when p_payload ? 'setup_status' then p_payload ->> 'setup_status' else setup_status end,
    source_kind = case when p_payload ? 'source_kind' then p_payload ->> 'source_kind' else source_kind end,
    source_reference = case when p_payload ? 'source_reference' then nullif(btrim(p_payload ->> 'source_reference'), '') else source_reference end,
    notes = case when p_payload ? 'notes' then nullif(btrim(p_payload ->> 'notes'), '') else notes end,
    last_verified_at = case when p_payload ? 'last_verified_at' then (p_payload ->> 'last_verified_at')::timestamptz else last_verified_at end,
    updated_by = v_actor,
    version = version + 1
  where id = p_account_id;

  select array_agg(k) into v_changed from jsonb_object_keys(p_payload) as k;
  perform public.forge_external_account_audit_insert(
    p_account_id, v_owner, v_actor, 'update',
    coalesce(v_changed, '{}'),
    jsonb_build_object('provider_name', v_row.provider_name));

  return jsonb_build_object('id', p_account_id, 'version', p_expected_version + 1);
end;
$$;

-- Delete: logical by default (deleted_at/deleted_by, restorable).
-- Permanent erase only when the row is already logically deleted; it
-- removes the row and its threads (cascade) and keeps the audit trail
-- (the erase audit row is written first and keeps the account id).
-- Deleting a register row NEVER touches the real external account or
-- any credential — it only removes the register entry.
create or replace function public.forge_external_account_delete(
  p_account_id uuid, p_permanent boolean default false)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner text := public.forge_external_account_require_household();
  v_actor uuid := auth.uid();
  v_row public.forge_external_accounts%rowtype;
begin
  select * into v_row from public.forge_external_accounts
    where id = p_account_id and platform_owner_id = v_owner;
  if not found then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_NOT_FOUND: that register entry was not found';
  end if;

  if p_permanent then
    if v_row.deleted_at is null then
      raise exception 'FORGE_EXTERNAL_ACCOUNT_NOT_DELETED: permanently erase only a register entry that is already deleted — delete it first, then erase it';
    end if;
    perform public.forge_external_account_audit_insert(
      p_account_id, v_owner, v_actor, 'permanent_erase', array['*'],
      jsonb_build_object('provider_name', v_row.provider_name));
    delete from public.forge_external_accounts where id = p_account_id;
    return jsonb_build_object('id', p_account_id, 'permanent', true);
  end if;

  if v_row.deleted_at is not null then
    return jsonb_build_object('id', p_account_id, 'already_deleted', true);
  end if;
  update public.forge_external_accounts
    set deleted_at = now(), deleted_by = v_actor, updated_by = v_actor, version = version + 1
    where id = p_account_id;
  perform public.forge_external_account_audit_insert(
    p_account_id, v_owner, v_actor, 'delete', array['deleted_at'],
    jsonb_build_object('provider_name', v_row.provider_name));
  return jsonb_build_object('id', p_account_id, 'deleted', true);
end;
$$;

create or replace function public.forge_external_account_restore(p_account_id uuid)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner text := public.forge_external_account_require_household();
  v_actor uuid := auth.uid();
  v_row public.forge_external_accounts%rowtype;
begin
  select * into v_row from public.forge_external_accounts
    where id = p_account_id and platform_owner_id = v_owner;
  if not found then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_NOT_FOUND: that register entry was not found';
  end if;
  if v_row.deleted_at is null then
    return jsonb_build_object('id', p_account_id, 'already_active', true);
  end if;
  update public.forge_external_accounts
    set deleted_at = null, deleted_by = null, updated_by = v_actor, version = version + 1
    where id = p_account_id;
  perform public.forge_external_account_audit_insert(
    p_account_id, v_owner, v_actor, 'restore', array['deleted_at'],
    jsonb_build_object('provider_name', v_row.provider_name));
  return jsonb_build_object('id', p_account_id, 'restored', true);
end;
$$;

-- Thread add + state. Threads share the account's household scope.
create or replace function public.forge_external_account_thread_add(
  p_account_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner text := public.forge_external_account_require_household();
  v_actor uuid := auth.uid();
  v_row public.forge_external_accounts%rowtype;
  v_title text := btrim(coalesce(p_payload ->> 'title', ''));
  v_id uuid;
begin
  select * into v_row from public.forge_external_accounts
    where id = p_account_id and platform_owner_id = v_owner and deleted_at is null;
  if not found then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_NOT_FOUND: that register entry was not found';
  end if;
  if v_title = '' then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_THREAD_TITLE_REQUIRED: a thread title is required';
  end if;
  insert into public.forge_external_account_threads (
    account_id, platform_owner_id, title, reference, state,
    next_action, owner, next_review_on, created_by, updated_by
  ) values (
    p_account_id, v_owner, v_title,
    nullif(btrim(coalesce(p_payload ->> 'reference', '')), ''),
    coalesce(p_payload ->> 'state', 'open'),
    nullif(btrim(coalesce(p_payload ->> 'next_action', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'owner', '')), ''),
    (p_payload ->> 'next_review_on')::date,
    v_actor, v_actor
  ) returning id into v_id;
  perform public.forge_external_account_audit_insert(
    p_account_id, v_owner, v_actor, 'thread_add', array['threads'],
    jsonb_build_object('provider_name', v_row.provider_name, 'thread_title', v_title));
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.forge_external_account_thread_set_state(
  p_thread_id uuid, p_state text, p_next_action text default null, p_next_review_on date default null)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner text := public.forge_external_account_require_household();
  v_actor uuid := auth.uid();
  v_thread public.forge_external_account_threads%rowtype;
begin
  select * into v_thread from public.forge_external_account_threads
    where id = p_thread_id and platform_owner_id = v_owner;
  if not found then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_NOT_FOUND: that work thread was not found';
  end if;
  update public.forge_external_account_threads
    set state = p_state,
        next_action = coalesce(p_next_action, next_action),
        next_review_on = coalesce(p_next_review_on, next_review_on),
        updated_by = v_actor
    where id = p_thread_id;
  perform public.forge_external_account_audit_insert(
    v_thread.account_id, v_owner, v_actor, 'thread_state', array['threads'],
    jsonb_build_object('thread_title', v_thread.title, 'state', p_state));
  return jsonb_build_object('id', p_thread_id, 'state', p_state);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Seed preview / apply + Gmail reconcile.
--
-- Seed version external_accounts_seed_v1. Candidates arrive as a JSON
-- array; each carries a stable seed_key. Preview computes
-- create/match/conflict/no-op per candidate WITHOUT writing. Apply
-- inserts only the missing candidates and NEVER updates an existing
-- row — owner-edited values survive every re-run. A candidate whose
-- seed_key exists but whose normalized identity differs is a
-- conflict (surfaced, never silently merged). Seed changes are
-- audited (one seed_apply row per created candidate).
--
-- Reconcile takes one Gmail evidence lead
-- {provider, account_email, subject, date, message_ref,
--  evidence_strength, candidate_stage}. Idempotent on message_ref:
--  a second call with the same ref returns the first decision.
--  A signup mail proves only a lead: reconcile creates an
--  unverified_lead row (or matches an existing row) — it never
--  confirms an account and never overwrites a manually validated
--  status.
-- ---------------------------------------------------------------------------

create or replace function public.forge_external_accounts_seed_preview(
  p_seed_version text, p_candidates jsonb)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner text := public.forge_external_account_require_household();
  v_items jsonb := '[]'::jsonb;
  v_candidate jsonb;
  v_key text;
  v_existing record;
  v_creates integer := 0;
  v_matches integer := 0;
  v_conflicts integer := 0;
begin
  if p_seed_version is null or btrim(p_seed_version) = '' then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_SEED_VERSION_REQUIRED: a seed version is required';
  end if;
  for v_candidate in select * from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) loop
    v_key := v_candidate ->> 'seed_key';
    if v_key is null or btrim(v_key) = '' then
      v_items := v_items || jsonb_build_object('decision', 'conflict', 'reason', 'missing seed_key');
      v_conflicts := v_conflicts + 1;
      continue;
    end if;
    select id, provider_name, account_email, associated_app
      into v_existing from public.forge_external_accounts
      where seed_key = v_key and platform_owner_id = v_owner;
    if found then
      if lower(btrim(v_existing.provider_name)) = lower(btrim(coalesce(v_candidate ->> 'provider_name', '')))
        and lower(btrim(coalesce(v_existing.account_email, ''))) = lower(btrim(coalesce(v_candidate ->> 'account_email', '')))
        and lower(btrim(v_existing.associated_app)) = lower(btrim(coalesce(v_candidate ->> 'associated_app', ''))) then
        v_items := v_items || jsonb_build_object('decision', 'match', 'seed_key', v_key, 'account_id', v_existing.id);
        v_matches := v_matches + 1;
      else
        v_items := v_items || jsonb_build_object('decision', 'conflict', 'seed_key', v_key, 'account_id', v_existing.id, 'reason', 'seed_key exists with different provider/email/app');
        v_conflicts := v_conflicts + 1;
      end if;
    else
      v_items := v_items || jsonb_build_object('decision', 'create', 'seed_key', v_key);
      v_creates := v_creates + 1;
    end if;
  end loop;
  return jsonb_build_object(
    'seed_version', p_seed_version,
    'creates', v_creates, 'matches', v_matches, 'conflicts', v_conflicts,
    'no_ops', v_matches, 'items', v_items);
end;
$$;

create or replace function public.forge_external_accounts_seed_apply(
  p_seed_version text, p_candidates jsonb, p_request_id text)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner text := public.forge_external_account_require_household();
  v_actor uuid := auth.uid();
  v_preview jsonb := public.forge_external_accounts_seed_preview(p_seed_version, p_candidates);
  v_candidate jsonb;
  v_item jsonb;
  v_id uuid;
  v_created integer := 0;
begin
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_REQUEST_ID_REQUIRED: a request id is required';
  end if;
  for v_item in select * from jsonb_array_elements(v_preview -> 'items') loop
    if v_item ->> 'decision' <> 'create' then
      continue;
    end if;
    select c into v_candidate from jsonb_array_elements(p_candidates) c
      where c ->> 'seed_key' = (v_item ->> 'seed_key') limit 1;
    insert into public.forge_external_accounts (
      platform_owner_id, seed_key, provider_name, purpose, associated_app,
      work_thread_label, account_email, plan_status, billing_arrangement,
      api_integration_status, still_needed, credential_location,
      record_status, setup_status, source_kind, source_reference, notes,
      created_by, updated_by
    ) values (
      v_owner, v_candidate ->> 'seed_key',
      btrim(v_candidate ->> 'provider_name'), btrim(v_candidate ->> 'purpose'),
      btrim(v_candidate ->> 'associated_app'),
      nullif(btrim(coalesce(v_candidate ->> 'work_thread_label', '')), ''),
      nullif(btrim(coalesce(v_candidate ->> 'account_email', '')), ''),
      coalesce(v_candidate ->> 'plan_status', 'unknown'),
      nullif(btrim(coalesce(v_candidate ->> 'billing_arrangement', '')), ''),
      coalesce(v_candidate ->> 'api_integration_status', 'unknown'),
      (v_candidate ->> 'still_needed')::boolean,
      nullif(btrim(coalesce(v_candidate ->> 'credential_location', '')), ''),
      coalesce(v_candidate ->> 'record_status', 'unverified_lead'),
      coalesce(v_candidate ->> 'setup_status', 'unknown'),
      coalesce(v_candidate ->> 'source_kind', 'reconstructed_inventory'),
      nullif(btrim(coalesce(v_candidate ->> 'source_reference', '')), ''),
      nullif(btrim(coalesce(v_candidate ->> 'notes', '')), ''),
      v_actor, v_actor
    ) returning id into v_id;
    perform public.forge_external_account_audit_insert(
      v_id, v_owner, v_actor, 'seed_apply', array['*'],
      jsonb_build_object('seed_version', p_seed_version, 'request_id', p_request_id,
        'provider_name', btrim(v_candidate ->> 'provider_name')));
    v_created := v_created + 1;
  end loop;
  return jsonb_build_object(
    'seed_version', p_seed_version,
    'creates', (v_preview ->> 'creates')::integer, 'matches', (v_preview ->> 'matches')::integer,
    'conflicts', (v_preview ->> 'conflicts')::integer, 'no_ops', (v_preview ->> 'matches')::integer,
    'created', v_created, 'items', v_preview -> 'items');
end;
$$;

create or replace function public.forge_external_accounts_reconcile_lead(p_lead jsonb)
returns jsonb language plpgsql security definer set search_path = public set row_security = off as $$
declare
  v_owner text := public.forge_external_account_require_household();
  v_actor uuid := auth.uid();
  v_provider text := btrim(coalesce(p_lead ->> 'provider', ''));
  v_email text := nullif(btrim(coalesce(p_lead ->> 'account_email', '')), '');
  v_ref text := nullif(btrim(coalesce(p_lead ->> 'message_ref', '')), '');
  v_existing uuid;
  v_id uuid;
begin
  if v_provider = '' then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_PROVIDER_REQUIRED: a provider name is required';
  end if;
  if v_ref is null then
    raise exception 'FORGE_EXTERNAL_ACCOUNT_MESSAGE_REF_REQUIRED: a Gmail message reference is required';
  end if;

  -- Idempotent on the message reference: the first decision wins.
  select id into v_existing from public.forge_external_accounts
    where platform_owner_id = v_owner and source_kind = 'email_crosscheck'
      and source_reference = v_ref and deleted_at is null limit 1;
  if v_existing is not null then
    return jsonb_build_object('decision', 'duplicate', 'account_id', v_existing);
  end if;

  -- Match by normalized provider + email (never by provider alone):
  -- confirm-link, no write, no overwrite of a validated status.
  select id into v_existing from public.forge_external_accounts
    where platform_owner_id = v_owner and deleted_at is null
      and lower(btrim(provider_name)) = lower(v_provider)
      and lower(btrim(coalesce(account_email, ''))) = lower(coalesce(v_email, ''))
    limit 1;
  if v_existing is not null then
    perform public.forge_external_account_audit_insert(
      v_existing, v_owner, v_actor, 'reconcile_match', array['source_reference'],
      jsonb_build_object('provider_name', v_provider, 'message_ref', v_ref));
    return jsonb_build_object('decision', 'match', 'account_id', v_existing);
  end if;

  insert into public.forge_external_accounts (
    platform_owner_id, provider_name, purpose, associated_app,
    account_email, record_status, setup_status, source_kind,
    source_reference, notes, created_by, updated_by
  ) values (
    v_owner, v_provider,
    coalesce(nullif(btrim(p_lead ->> 'purpose'), ''), 'Account found in Gmail signup mail — confirm what it is for.'),
    coalesce(nullif(btrim(p_lead ->> 'associated_app'), ''), 'Other / cross-program'),
    v_email, 'unverified_lead', 'unknown', 'email_crosscheck', v_ref,
    coalesce(nullif(btrim(p_lead ->> 'notes'), ''),
      'Gmail signup/verification mail: ' || coalesce(p_lead ->> 'subject', '') || ' (' || coalesce(p_lead ->> 'date', '') || '). A signup mail proves only a lead, not activation.'),
    v_actor, v_actor
  ) returning id into v_id;
  perform public.forge_external_account_audit_insert(
    v_id, v_owner, v_actor, 'reconcile_create', array['*'],
    jsonb_build_object('provider_name', v_provider, 'message_ref', v_ref));
  return jsonb_build_object('decision', 'created', 'account_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Function grants.
--
-- Explicit REVOKEs first: REVOKE ... FROM public is a no-op for
-- functions under Supabase-like defaults (pg_default_acl grants
-- EXECUTE to NAMED roles), so each function is revoked from public,
-- anon, authenticated, and service_role, then EXECUTE is granted to
-- authenticated only. The helpers (audit insert + household gate)
-- are NOT granted to any application role: they run only inside the
-- RPCs above. The ONE exception is actor_may_act(): the RLS policies
-- call it directly, and a policy expression runs as the querying user,
-- so authenticated needs EXECUTE on it — it is a boolean predicate
-- about the caller's own membership, it reveals nothing about any
-- other user, and it writes nothing. anon holds no EXECUTE anywhere here.
-- ---------------------------------------------------------------------------

revoke all on function public.forge_external_account_actor_may_act() from public, anon, authenticated, service_role;
revoke all on function public.forge_external_account_audit_insert(uuid, text, uuid, text, text[], jsonb) from public, anon, authenticated, service_role;
revoke all on function public.forge_external_account_require_household() from public, anon, authenticated, service_role;
revoke all on function public.forge_external_accounts_owner_immutable() from public, anon, authenticated, service_role;
revoke all on function public.forge_external_account_threads_owner_immutable() from public, anon, authenticated, service_role;
revoke all on function public.forge_external_accounts_touch_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.forge_external_accounts_reject_secrets() from public, anon, authenticated, service_role;
revoke all on function public.forge_external_account_threads_reject_secrets() from public, anon, authenticated, service_role;
revoke all on function public.forge_external_account_audit_append_only() from public, anon, authenticated, service_role;

revoke all on function public.forge_external_account_create(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.forge_external_account_update(uuid, jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.forge_external_account_delete(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.forge_external_account_restore(uuid) from public, anon, authenticated, service_role;
revoke all on function public.forge_external_account_thread_add(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.forge_external_account_thread_set_state(uuid, text, text, date) from public, anon, authenticated, service_role;
revoke all on function public.forge_external_accounts_seed_preview(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.forge_external_accounts_seed_apply(text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.forge_external_accounts_reconcile_lead(jsonb) from public, anon, authenticated, service_role;

grant execute on function public.forge_external_account_create(jsonb) to authenticated;
grant execute on function public.forge_external_account_update(uuid, jsonb, integer) to authenticated;
grant execute on function public.forge_external_account_delete(uuid, boolean) to authenticated;
grant execute on function public.forge_external_account_restore(uuid) to authenticated;
grant execute on function public.forge_external_account_thread_add(uuid, jsonb) to authenticated;
grant execute on function public.forge_external_account_thread_set_state(uuid, text, text, date) to authenticated;
grant execute on function public.forge_external_accounts_seed_preview(text, jsonb) to authenticated;
grant execute on function public.forge_external_accounts_seed_apply(text, jsonb, text) to authenticated;
grant execute on function public.forge_external_accounts_reconcile_lead(jsonb) to authenticated;
grant execute on function public.forge_external_account_actor_may_act() to authenticated;
