-- ===========================================================================
-- SaaS 30-day trial (20261113030000)
-- Owner-granted 30-day trials for Planner + Capture.
--
-- Depends on (applies AFTER, in timestamp order):
--   20261113010000 SaaS Auth PR 1 (forge_workspaces, forge_app_entitlements,
--     forge_platform_operators, forge_security_audit,
--     forge_auth_idempotency_receipts, forge_has_app_entitlement,
--     forge_has_platform_role, forge_check_app_access,
--     forge_app_entitlement_grant, forge_app_entitlement_revoke)
--   20261113020000 slice-7 PDF blockers (in-flight PR #802, file-only at
--     the time this migration was written — this file does not depend on it)
--
-- Design (brief: results/chatgpt/saas-trial-30day-implementable-build-brief-2026-11-13.md):
--   * Trial = entitlement status active + source owner_trial, with a
--     server-generated 30-day window (starts_at from the DB clock,
--     ends_at = starts_at + interval '30 days', exactly 720 hours).
--   * The live predicate forge_has_app_entitlement denies at and after
--     ends_at with NO worker run; the expiry worker only flips the
--     stored status to 'expired' and writes the audit receipt.
--   * One initial trial per SaaS Workspace (owner_id) per app, ever.
--     Renewal is explicit, only after expiry, chained via renewal_of.
--   * Conversion to owner_manual keeps the trial history and the
--     last-trial reference; it never deletes or re-provisions data.
--   * Capture trial issuance stays DISABLED (availability seed below)
--     until native-auth PR 4 lands; only a reviewed PR-4 completion
--     operation may flip it. No Capture clock starts in this slice.
--   * Platform-owner bootstrap (D6) is OUT of scope: forge_platform_operators
--     is seeded empty by Auth PR 1, and every trial RPC/UI path fails
--     closed until the owner registry is bootstrapped out-of-band.
--   * No payment, checkout, billing webhook, self-serve signup, or
--     automatic trial is built here (D8, separate launch-blocking PR).
--   * The generic grant RPC is NOT allowed to overwrite an owner_trial
--     row (see section 8): trials convert only through
--     forge_app_trial_convert_to_paid.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. forge_app_trial_availability — server-enforced per-app trial switch.
--    Seeded: Planner enabled, Capture disabled with the PR-4 reason.
--    No flip RPC exists by design; only a reviewed PR-4 completion
--    migration may enable Capture.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_app_trial_availability (
  app_key text not null primary key check (app_key in ('planner', 'capture')),
  enabled boolean not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  updated_at timestamptz not null default now()
);

comment on table public.forge_app_trial_availability is
'SaaS 30-day trial: server-enforced per-app trial switch. Planner enabled; Capture disabled until native-auth PR 4 lands. Grant/renew RPCs reject while disabled even when called directly.';

insert into public.forge_app_trial_availability (app_key, enabled, reason)
values
  ('planner', true, 'Planner trials enabled.'),
  ('capture', false, 'Capture trial issuance is disabled until native-auth PR 4 lands. Local capture on the device is unaffected.')
on conflict (app_key) do nothing;

alter table public.forge_app_trial_availability enable row level security;
alter table public.forge_app_trial_availability force row level security;

-- No SELECT policy: the switch is readable only through the SECURITY
-- DEFINER trial RPCs / owner overview RPC. Direct reads deny.
revoke all on table public.forge_app_trial_availability from public, anon, service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 2. forge_app_trial_grants — immutable trial history.
--    One row per grant (initial or renewal). The mutable entitlement row
--    is never the only record of a trial: conversion overwrites the
--    entitlement's source/dates, the grant rows survive.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_app_trial_grants (
  id uuid not null default gen_random_uuid() primary key,
  owner_id text not null references public.forge_workspaces(owner_id) on delete restrict,
  app_key text not null check (app_key in ('planner', 'capture')),
  grant_kind text not null check (grant_kind in ('initial', 'renewal')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  granted_by uuid references auth.users(id) on delete set null,
  grant_reason text not null check (char_length(btrim(grant_reason)) between 1 and 500),
  renewal_of uuid references public.forge_app_trial_grants(id) on delete restrict,
  request_id text not null unique check (char_length(btrim(request_id)) between 1 and 200),
  created_at timestamptz not null default now(),
  check (ends_at = starts_at + interval '30 days'),
  check (grant_kind = 'renewal' or renewal_of is null),
  check (grant_kind = 'initial' or renewal_of is not null)
);

comment on table public.forge_app_trial_grants is
'SaaS 30-day trial: immutable grant history. Exactly one initial grant per (owner_id, app_key) ever (partial unique index below); renewals chain via renewal_of. The 30-day window is enforced by CHECK (ends_at = starts_at + 30 days).';

create unique index if not exists forge_app_trial_grants_one_initial_idx
  on public.forge_app_trial_grants (owner_id, app_key) where grant_kind = 'initial';

create unique index if not exists forge_app_trial_grants_renewal_of_idx
  on public.forge_app_trial_grants (renewal_of) where renewal_of is not null;

create index if not exists forge_app_trial_grants_owner_app_idx
  on public.forge_app_trial_grants (owner_id, app_key, created_at desc);

alter table public.forge_app_trial_grants enable row level security;
alter table public.forge_app_trial_grants force row level security;

-- No SELECT policy: grant history is readable only through the SECURITY
-- DEFINER owner overview RPC. Direct reads and all direct DML deny.
revoke all on table public.forge_app_trial_grants from public, anon, service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 3. forge_app_trial_audit — append-only trial receipts.
--    SELECT restricted to platform owner + support roles (NOT programmers,
--    NOT workspace owners). No UPDATE/DELETE policy and no DML grant, so
--    the table is append-only. Retention >= 7 years; no purge job exists.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_app_trial_audit (
  id uuid not null default gen_random_uuid() primary key,
  owner_id text not null references public.forge_workspaces(owner_id) on delete restrict,
  app_key text not null check (app_key in ('planner', 'capture')),
  trial_grant_id uuid references public.forge_app_trial_grants(id) on delete restrict,
  event text not null check (event in ('granted', 'renewed', 'expired', 'converted_to_paid')),
  actor_id uuid,
  actor_class text not null check (actor_class in ('platform_owner', 'system')),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  before_state jsonb,
  after_state jsonb,
  request_id text not null check (char_length(btrim(request_id)) between 1 and 200),
  correlation_id text,
  created_at timestamptz not null default now()
);

comment on table public.forge_app_trial_audit is
'SaaS 30-day trial: append-only receipts (granted / renewed / expired / converted_to_paid). Written in the same transaction as the mutation. Readable by platform owner + support only; never by programmers or workspace owners. Retention >= 7 years; no purge.';

create index if not exists forge_app_trial_audit_owner_idx
  on public.forge_app_trial_audit (owner_id, created_at desc);

create index if not exists forge_app_trial_audit_grant_idx
  on public.forge_app_trial_audit (trial_grant_id, created_at desc);

alter table public.forge_app_trial_audit enable row level security;
alter table public.forge_app_trial_audit force row level security;

drop policy if exists forge_app_trial_audit_select on public.forge_app_trial_audit;
create policy forge_app_trial_audit_select
  on public.forge_app_trial_audit for select to authenticated
  using (
    public.forge_has_platform_role('owner')
    or public.forge_has_platform_role('support')
  );

revoke all on table public.forge_app_trial_audit from public, anon, service_role, authenticated;
grant select on table public.forge_app_trial_audit to authenticated;

-- ---------------------------------------------------------------------------
-- 4. forge_app_entitlements.last_trial_grant_id — pointer to the latest
--    trial grant for the workspace/app. History stays in
--    forge_app_trial_grants; this column only speeds the renewal lookup
--    and survives conversion (a converted row still names its trial).
-- ---------------------------------------------------------------------------

alter table public.forge_app_entitlements
  add column if not exists last_trial_grant_id uuid
  references public.forge_app_trial_grants(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 5. Trial RPCs.
--    All SECURITY DEFINER, fixed search_path, row_security off, actor
--    from auth.uid(), platform-owner only, mandatory bounded reason +
--    request_id, payload-hash idempotency on forge_auth_idempotency_receipts,
--    advisory-lock serialization (per workspace/app AND per request id).
--    Error codes follow Auth PR 1 (FORGE_AUTH_*, mapped to plain words by
--    src/app/api/forge/auth/_lib/rpcRoute.js).
-- ---------------------------------------------------------------------------

-- Grant: one initial 30-day trial per workspace/app, ever.
create or replace function public.forge_app_trial_grant(
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
  v_actor_text text := auth.uid()::text;
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_reason text;
  v_workspace_status text;
  v_ent public.forge_app_entitlements%rowtype;
  v_starts timestamptz;
  v_ends timestamptz;
  v_grant_id uuid;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_app_key is null or p_app_key not in ('designer', 'scheduler', 'planner', 'capture') then
    raise exception 'FORGE_AUTH_UNKNOWN_APP' using errcode = '22023';
  end if;
  if p_app_key not in ('planner', 'capture') then
    raise exception 'FORGE_AUTH_TRIAL_UNAVAILABLE' using errcode = '22023';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_payload_hash := encode(extensions.digest(convert_to('trial_grant|' || p_owner_id || '|' || p_app_key || '|' || v_reason, 'UTF8'), 'sha256'), 'hex');
  -- Serialize concurrent grants for the same workspace/app (two different
  -- request ids would otherwise both pass the one-initial check and race
  -- the partial unique index). Lock order is fixed (workspace/app first,
  -- then request id) across all trial RPCs and the generic entitlement
  -- grant (section 8), which takes the same workspace/app lock; the
  -- expiry worker takes no advisory lock, so no advisory/row-lock
  -- deadlock cycle exists.
  perform pg_advisory_xact_lock(hashtext(p_owner_id || '|' || p_app_key), hashtext('trial_serialize'));
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  -- Authorization precedes the idempotency replay: a caller who is not
  -- currently a platform owner must never receive a stored result for
  -- a request id they did not (or no longer) own.
  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'trial_grant' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  -- Server-enforced availability: Capture stays disabled until PR 4.
  if not coalesce((select enabled from public.forge_app_trial_availability where app_key = p_app_key), false) then
    raise exception 'FORGE_AUTH_TRIAL_UNAVAILABLE' using errcode = '22023';
  end if;

  select status into v_workspace_status from public.forge_workspaces where owner_id = p_owner_id;
  if v_workspace_status is null then
    raise exception 'FORGE_AUTH_WORKSPACE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_workspace_status <> 'active' then
    raise exception 'FORGE_AUTH_WORKSPACE_NOT_ACTIVE' using errcode = '42501';
  end if;

  select * into v_ent from public.forge_app_entitlements where owner_id = p_owner_id and app_key = p_app_key;
  if v_ent.owner_id is null then
    raise exception 'FORGE_AUTH_ENTITLEMENT_NOT_FOUND' using errcode = '22023';
  end if;
  -- One initial trial per workspace/app, ever: a prior initial — expired,
  -- converted, or renewed — blocks a second grant. Renewal is the only
  -- path to a further trial window. This check comes before the pending
  -- check so a repeat grant after expiry/conversion reports the real
  -- reason (already granted) instead of the incidental row state.
  if exists (select 1 from public.forge_app_trial_grants where owner_id = p_owner_id and app_key = p_app_key and grant_kind = 'initial') then
    raise exception 'FORGE_AUTH_TRIAL_ALREADY_GRANTED' using errcode = '23505';
  end if;
  if v_ent.status <> 'pending' then
    raise exception 'FORGE_AUTH_TRIAL_NOT_PENDING' using errcode = '42501';
  end if;

  v_starts := clock_timestamp();
  v_ends := v_starts + interval '30 days';
  v_grant_id := gen_random_uuid();

  insert into public.forge_app_trial_grants
    (id, owner_id, app_key, grant_kind, starts_at, ends_at, granted_by, grant_reason, renewal_of, request_id)
  values (v_grant_id, p_owner_id, p_app_key, 'initial', v_starts, v_ends, v_actor, v_reason, null, p_request_id);

  update public.forge_app_entitlements
    set status = 'active', source = 'owner_trial', starts_at = v_starts, ends_at = v_ends,
        granted_by = v_actor_text, grant_reason = v_reason, version = version + 1,
        last_trial_grant_id = v_grant_id, updated_at = now()
  where owner_id = p_owner_id and app_key = p_app_key;

  insert into public.forge_app_trial_audit
    (owner_id, app_key, trial_grant_id, event, actor_id, actor_class, reason,
     before_state, after_state, request_id, correlation_id)
  values (p_owner_id, p_app_key, v_grant_id, 'granted', v_actor, 'platform_owner', v_reason,
    jsonb_build_object('status', v_ent.status, 'source', v_ent.source, 'starts_at', v_ent.starts_at, 'ends_at', v_ent.ends_at, 'version', v_ent.version),
    jsonb_build_object('status', 'active', 'source', 'owner_trial', 'starts_at', v_starts, 'ends_at', v_ends, 'version', v_ent.version + 1),
    p_request_id, p_request_id);

  v_result := jsonb_build_object('owner_id', p_owner_id, 'app_key', p_app_key, 'grant_id', v_grant_id,
    'status', 'active', 'source', 'owner_trial', 'starts_at', v_starts, 'ends_at', v_ends);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, p_owner_id, 'trial_grant', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_app_trial_grant(text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_app_trial_grant(text, text, text, text) to authenticated;

-- Renew: explicit owner action, only after the previous trial window has
-- ended, chained to the latest grant. Never extends an unexpired trial,
-- never renews a converted owner_manual row, never auto-renews.
create or replace function public.forge_app_trial_renew(
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
  v_actor_text text := auth.uid()::text;
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_reason text;
  v_workspace_status text;
  v_ent public.forge_app_entitlements%rowtype;
  v_latest public.forge_app_trial_grants%rowtype;
  v_starts timestamptz;
  v_ends timestamptz;
  v_grant_id uuid;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_app_key is null or p_app_key not in ('designer', 'scheduler', 'planner', 'capture') then
    raise exception 'FORGE_AUTH_UNKNOWN_APP' using errcode = '22023';
  end if;
  if p_app_key not in ('planner', 'capture') then
    raise exception 'FORGE_AUTH_TRIAL_UNAVAILABLE' using errcode = '22023';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_payload_hash := encode(extensions.digest(convert_to('trial_renew|' || p_owner_id || '|' || p_app_key || '|' || v_reason, 'UTF8'), 'sha256'), 'hex');
  -- Shared workspace/app serialization lock (trial_serialize), same key
  -- as the grant/convert RPCs and the generic entitlement grant
  -- (section 8); lock order is fixed (workspace/app first, then
  -- request id) across all of them.
  perform pg_advisory_xact_lock(hashtext(p_owner_id || '|' || p_app_key), hashtext('trial_serialize'));
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  -- Authorization precedes the idempotency replay: a caller who is not
  -- currently a platform owner must never receive a stored result for
  -- a request id they did not (or no longer) own.
  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'trial_renew' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if not coalesce((select enabled from public.forge_app_trial_availability where app_key = p_app_key), false) then
    raise exception 'FORGE_AUTH_TRIAL_UNAVAILABLE' using errcode = '22023';
  end if;

  select status into v_workspace_status from public.forge_workspaces where owner_id = p_owner_id;
  if v_workspace_status is null then
    raise exception 'FORGE_AUTH_WORKSPACE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_workspace_status <> 'active' then
    raise exception 'FORGE_AUTH_WORKSPACE_NOT_ACTIVE' using errcode = '42501';
  end if;

  select * into v_ent from public.forge_app_entitlements where owner_id = p_owner_id and app_key = p_app_key;
  if v_ent.owner_id is null then
    raise exception 'FORGE_AUTH_ENTITLEMENT_NOT_FOUND' using errcode = '22023';
  end if;
  -- A converted row (owner_manual) is paid access, not a trial: it can
  -- never be renewed as a trial.
  if v_ent.source <> 'owner_trial' then
    raise exception 'FORGE_AUTH_TRIAL_NOT_ACTIVE' using errcode = '42501';
  end if;
  if v_ent.status not in ('active', 'expired') then
    raise exception 'FORGE_AUTH_TRIAL_NOT_ACTIVE' using errcode = '42501';
  end if;
  if v_ent.ends_at is null or v_ent.ends_at > clock_timestamp() then
    raise exception 'FORGE_AUTH_TRIAL_NOT_EXPIRED' using errcode = '42501';
  end if;

  -- Latest grant in the chain: prefer the entitlement's pointer, fall
  -- back to the newest grant row. The entitlement window must match the
  -- latest grant's window, or the state is inconsistent — fail closed.
  if v_ent.last_trial_grant_id is not null then
    select * into v_latest from public.forge_app_trial_grants where id = v_ent.last_trial_grant_id;
  else
    select * into v_latest from public.forge_app_trial_grants
    where owner_id = p_owner_id and app_key = p_app_key
    order by created_at desc, id desc limit 1;
  end if;
  if v_latest.id is null then
    raise exception 'FORGE_AUTH_TRIAL_STATE_MISMATCH' using errcode = '42501';
  end if;
  if v_latest.ends_at is distinct from v_ent.ends_at then
    raise exception 'FORGE_AUTH_TRIAL_STATE_MISMATCH' using errcode = '42501';
  end if;
  if exists (select 1 from public.forge_app_trial_grants where renewal_of = v_latest.id) then
    raise exception 'FORGE_AUTH_TRIAL_ALREADY_RENEWED' using errcode = '23505';
  end if;

  v_starts := clock_timestamp();
  v_ends := v_starts + interval '30 days';
  v_grant_id := gen_random_uuid();

  insert into public.forge_app_trial_grants
    (id, owner_id, app_key, grant_kind, starts_at, ends_at, granted_by, grant_reason, renewal_of, request_id)
  values (v_grant_id, p_owner_id, p_app_key, 'renewal', v_starts, v_ends, v_actor, v_reason, v_latest.id, p_request_id);

  update public.forge_app_entitlements
    set status = 'active', source = 'owner_trial', starts_at = v_starts, ends_at = v_ends,
        granted_by = v_actor_text, grant_reason = v_reason, version = version + 1,
        last_trial_grant_id = v_grant_id, updated_at = now()
  where owner_id = p_owner_id and app_key = p_app_key;

  insert into public.forge_app_trial_audit
    (owner_id, app_key, trial_grant_id, event, actor_id, actor_class, reason,
     before_state, after_state, request_id, correlation_id)
  values (p_owner_id, p_app_key, v_grant_id, 'renewed', v_actor, 'platform_owner', v_reason,
    jsonb_build_object('status', v_ent.status, 'source', v_ent.source, 'starts_at', v_ent.starts_at, 'ends_at', v_ent.ends_at, 'version', v_ent.version),
    jsonb_build_object('status', 'active', 'source', 'owner_trial', 'starts_at', v_starts, 'ends_at', v_ends, 'version', v_ent.version + 1),
    p_request_id, p_request_id);

  v_result := jsonb_build_object('owner_id', p_owner_id, 'app_key', p_app_key, 'grant_id', v_grant_id,
    'status', 'active', 'source', 'owner_trial', 'starts_at', v_starts, 'ends_at', v_ends,
    'renewal_of', v_latest.id);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, p_owner_id, 'trial_renew', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_app_trial_renew(text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_app_trial_renew(text, text, text, text) to authenticated;

-- Expire due trials (worker only). The live predicate denies an expired
-- trial even if this worker never runs; the worker only flips the stored
-- status and writes the system audit receipt. Idempotent by construction:
-- only active owner_trial rows with ends_at <= now() qualify, and the
-- row is re-checked under its FOR UPDATE lock before the flip, so a
-- concurrent renewal (new window, still active) is never expired.
create or replace function public.forge_app_trial_expire_due()
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_expired jsonb := '[]'::jsonb;
  r record;
  v_before public.forge_app_entitlements%rowtype;
begin
  for r in
    select e.owner_id, e.app_key, e.ends_at, e.version, e.last_trial_grant_id
    from public.forge_app_entitlements e
    where e.source = 'owner_trial'
      and e.status = 'active'
      and e.ends_at is not null
      and e.ends_at <= clock_timestamp()
    order by e.owner_id, e.app_key
    for update of e
  loop
    select * into v_before from public.forge_app_entitlements
    where owner_id = r.owner_id and app_key = r.app_key;
    if v_before.status = 'active' and v_before.source = 'owner_trial'
       and v_before.ends_at is not null and v_before.ends_at <= clock_timestamp() then
      update public.forge_app_entitlements
        set status = 'expired', version = version + 1, updated_at = now()
        where owner_id = r.owner_id and app_key = r.app_key;
      insert into public.forge_app_trial_audit
        (owner_id, app_key, trial_grant_id, event, actor_id, actor_class, reason,
         before_state, after_state, request_id, correlation_id)
      values (r.owner_id, r.app_key, r.last_trial_grant_id, 'expired', null, 'system',
        'Trial ended after 30 days.',
        jsonb_build_object('status', 'active', 'source', 'owner_trial', 'starts_at', v_before.starts_at, 'ends_at', v_before.ends_at, 'version', v_before.version),
        jsonb_build_object('status', 'expired', 'source', 'owner_trial', 'starts_at', v_before.starts_at, 'ends_at', v_before.ends_at, 'version', v_before.version + 1),
        'trial_expire_due|' || r.owner_id || '|' || r.app_key || '|' || to_char(v_before.ends_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF'),
        'trial_expire_due|' || r.owner_id || '|' || r.app_key);
      v_expired := v_expired || jsonb_build_object('owner_id', r.owner_id, 'app_key', r.app_key, 'ends_at', v_before.ends_at);
    end if;
  end loop;
  return jsonb_build_object('expired_count', jsonb_array_length(v_expired), 'expired', v_expired);
end;
$$;

revoke all on function public.forge_app_trial_expire_due() from public, anon, authenticated;
grant execute on function public.forge_app_trial_expire_due() to service_role;

-- Convert: one-click conversion of a trial (active or expired) to
-- owner_manual access. No data is deleted, copied, or re-provisioned;
-- the trial history and the last-trial reference are kept. owner_manual
-- here is an owner-authorized record, never proof of payment (D8 billing
-- remains a separate launch-blocking PR). Conversion does not check the
-- availability switch: it is not issuance, and a trial must stay
-- convertible even if new trials are later disabled.
create or replace function public.forge_app_trial_convert_to_paid(
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
  v_actor_text text := auth.uid()::text;
  v_payload_hash text;
  v_r_action text;
  v_r_hash text;
  v_result jsonb;
  v_reason text;
  v_workspace_status text;
  v_ent public.forge_app_entitlements%rowtype;
  v_starts timestamptz;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'FORGE_AUTH_REQUEST_ID_REQUIRED' using errcode = '22023'; end if;
  if p_app_key is null or p_app_key not in ('designer', 'scheduler', 'planner', 'capture') then
    raise exception 'FORGE_AUTH_UNKNOWN_APP' using errcode = '22023';
  end if;
  if p_app_key not in ('planner', 'capture') then
    raise exception 'FORGE_AUTH_TRIAL_UNAVAILABLE' using errcode = '22023';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception 'FORGE_AUTH_REASON_REQUIRED' using errcode = '22023';
  end if;

  v_payload_hash := encode(extensions.digest(convert_to('trial_convert|' || p_owner_id || '|' || p_app_key || '|' || v_reason, 'UTF8'), 'sha256'), 'hex');
  -- Shared workspace/app serialization lock (trial_serialize), same key
  -- as the grant/renew RPCs and the generic entitlement grant
  -- (section 8); lock order is fixed (workspace/app first, then
  -- request id) across all of them.
  perform pg_advisory_xact_lock(hashtext(p_owner_id || '|' || p_app_key), hashtext('trial_serialize'));
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  -- Authorization precedes the idempotency replay: a caller who is not
  -- currently a platform owner must never receive a stored result for
  -- a request id they did not (or no longer) own.
  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'trial_convert' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  select status into v_workspace_status from public.forge_workspaces where owner_id = p_owner_id;
  if v_workspace_status is null then
    raise exception 'FORGE_AUTH_WORKSPACE_NOT_FOUND' using errcode = '22023';
  end if;
  if v_workspace_status <> 'active' then
    raise exception 'FORGE_AUTH_WORKSPACE_NOT_ACTIVE' using errcode = '42501';
  end if;

  select * into v_ent from public.forge_app_entitlements where owner_id = p_owner_id and app_key = p_app_key;
  if v_ent.owner_id is null then
    raise exception 'FORGE_AUTH_ENTITLEMENT_NOT_FOUND' using errcode = '22023';
  end if;
  if v_ent.source <> 'owner_trial' then
    raise exception 'FORGE_AUTH_TRIAL_NOT_ACTIVE' using errcode = '42501';
  end if;
  if v_ent.status not in ('active', 'expired') then
    raise exception 'FORGE_AUTH_TRIAL_NOT_ACTIVE' using errcode = '42501';
  end if;

  v_starts := clock_timestamp();

  update public.forge_app_entitlements
    set status = 'active', source = 'owner_manual', starts_at = v_starts, ends_at = null,
        granted_by = v_actor_text, grant_reason = v_reason, version = version + 1,
        updated_at = now()
  where owner_id = p_owner_id and app_key = p_app_key;

  insert into public.forge_app_trial_audit
    (owner_id, app_key, trial_grant_id, event, actor_id, actor_class, reason,
     before_state, after_state, request_id, correlation_id)
  values (p_owner_id, p_app_key, v_ent.last_trial_grant_id, 'converted_to_paid', v_actor, 'platform_owner', v_reason,
    jsonb_build_object('status', v_ent.status, 'source', v_ent.source, 'starts_at', v_ent.starts_at, 'ends_at', v_ent.ends_at, 'version', v_ent.version),
    jsonb_build_object('status', 'active', 'source', 'owner_manual', 'starts_at', v_starts, 'ends_at', null, 'version', v_ent.version + 1),
    p_request_id, p_request_id);

  v_result := jsonb_build_object('owner_id', p_owner_id, 'app_key', p_app_key,
    'status', 'active', 'source', 'owner_manual', 'starts_at', v_starts, 'ends_at', null,
    'last_trial_grant_id', v_ent.last_trial_grant_id);
  insert into public.forge_auth_idempotency_receipts (request_id, owner_id, action, payload_hash, result)
  values (p_request_id, p_owner_id, 'trial_convert', v_payload_hash, v_result)
  on conflict (request_id) do nothing;
  return v_result;
end;
$$;

revoke all on function public.forge_app_trial_convert_to_paid(text, text, text, text) from public, anon, service_role;
grant execute on function public.forge_app_trial_convert_to_paid(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Owner-console read RPCs (SECURITY DEFINER, platform-owner only).
--    forge_workspaces has no SELECT policy admitting platform owners, so
--    the console reads through these RPCs — never through a general
--    customer directory exposed to client admins.
-- ---------------------------------------------------------------------------

create or replace function public.forge_platform_trial_overview(p_owner_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  if not exists (select 1 from public.forge_workspaces where owner_id = p_owner_id) then
    raise exception 'FORGE_AUTH_WORKSPACE_NOT_FOUND' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'owner_id', w.owner_id,
    'display_name', w.display_name,
    'status', w.status,
    'entitlements', coalesce((select jsonb_agg(jsonb_build_object('app_key', e.app_key, 'status', e.status, 'source', e.source, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'granted_by', e.granted_by, 'grant_reason', e.grant_reason, 'version', e.version, 'last_trial_grant_id', e.last_trial_grant_id) order by e.app_key) from public.forge_app_entitlements e where e.owner_id = w.owner_id), '[]'::jsonb),
    'trials', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'app_key', g.app_key, 'grant_kind', g.grant_kind, 'starts_at', g.starts_at, 'ends_at', g.ends_at, 'granted_by', g.granted_by, 'grant_reason', g.grant_reason, 'renewal_of', g.renewal_of, 'created_at', g.created_at) order by g.created_at) from public.forge_app_trial_grants g where g.owner_id = w.owner_id), '[]'::jsonb),
    'availability', coalesce((select jsonb_agg(jsonb_build_object('app_key', a.app_key, 'enabled', a.enabled, 'reason', a.reason) order by a.app_key) from public.forge_app_trial_availability a), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'app_key', s.app_key, 'event', s.event, 'actor_id', s.actor_id, 'actor_class', s.actor_class, 'reason', s.reason, 'before_state', s.before_state, 'after_state', s.after_state, 'request_id', s.request_id, 'created_at', s.created_at) order by s.created_at desc) from (select au.* from public.forge_app_trial_audit au where au.owner_id = w.owner_id order by au.created_at desc limit 100) s), '[]'::jsonb)
  ) into v_result from public.forge_workspaces w where w.owner_id = p_owner_id;
  return v_result;
end;
$$;

revoke all on function public.forge_platform_trial_overview(text) from public, anon, service_role;
grant execute on function public.forge_platform_trial_overview(text) to authenticated;

create or replace function public.forge_platform_trial_workspace_list(p_search text)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_term text;
begin
  if v_actor is null then raise exception 'FORGE_AUTH_ACTOR_REQUIRED' using errcode = '42501'; end if;
  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  -- Escape LIKE wildcards in the caller's term so a search can never
  -- widen into a pattern.
  v_term := replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_');
  select coalesce(jsonb_agg(jsonb_build_object('owner_id', w.owner_id, 'display_name', w.display_name, 'status', w.status) order by w.display_name, w.owner_id), '[]'::jsonb)
  into v_result
  from public.forge_workspaces w
  where v_term = '' or w.display_name ilike '%' || v_term || '%' escape '\';
  return v_result;
end;
$$;

revoke all on function public.forge_platform_trial_workspace_list(text) from public, anon, service_role;
grant execute on function public.forge_platform_trial_workspace_list(text) to authenticated;
-- ---------------------------------------------------------------------------
-- 7. forge_check_app_access — redefined with ONE added branch: a trial
--    whose window has ended returns the distinct reason TRIAL_ENDED
--    instead of ENTITLEMENT_NOT_ACTIVE. Every other line is byte-identical
--    to the Auth PR 1 definition (20261113010000); Auth PR 1 tests never
--    create owner_trial rows, so they still pass unchanged.
-- ---------------------------------------------------------------------------

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
    -- Trial slice (20261113030000): a trial whose window has ended gets
    -- its own reason so the app can tell the user the trial ended and
    -- their data is safe, instead of the generic not-active message.
    -- The live predicate above already denies at/after ends_at with no
    -- worker run; this branch only names the reason.
    if exists (
      select 1 from public.forge_app_entitlements e
      where e.owner_id = p_owner_id and e.app_key = p_app_key
        and e.source = 'owner_trial'
        and e.ends_at is not null and e.ends_at <= now()
        and e.status in ('active', 'expired')
    ) then
      return jsonb_build_object('allowed', false, 'reason', 'TRIAL_ENDED', 'via', null);
    end if;
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

-- ---------------------------------------------------------------------------
-- 8. forge_app_entitlement_grant — redefined with THREE trial-slice
--    additions: (1) the generic grant path refuses to overwrite an
--    owner_trial row (FORGE_AUTH_TRIAL_MUST_CONVERT); trials convert
--    only through forge_app_trial_convert_to_paid. (2) the generic
--    grant takes the shared workspace/app serialization lock
--    (trial_serialize) before its first entitlement read, so it
--    serializes with the trial RPCs; the entitlement read below is
--    therefore a post-lock re-read. (3) fix-round-2 P2: the
--    platform-owner check now precedes the idempotency receipt lookup,
--    like the three trial RPCs (section 5) — a non-owner replaying a
--    known request id gets FORGE_AUTH_PLATFORM_OWNER_ONLY, never the
--    stored result. Every other line is byte-identical to the Auth
--    PR 1 definition.
-- ---------------------------------------------------------------------------

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
  -- Trial slice (20261113030000): serialize with the trial RPCs on the
  -- shared workspace/app lock before reading the entitlement row, so a
  -- concurrent trial grant cannot commit between our read and our
  -- upsert (and vice versa). Lock order is fixed (workspace/app first,
  -- then request id) across the generic grant and all trial RPCs. The
  -- entitlement read below is therefore a post-lock re-read: if a trial
  -- committed first, v_before shows owner_trial and the guard refuses.
  perform pg_advisory_xact_lock(hashtext(p_owner_id || '|' || p_app_key), hashtext('trial_serialize'));
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  -- Fix-round-2 P2: authorization precedes the idempotency replay — the
  -- same order as the three trial RPCs (section 5). A caller who is not
  -- currently a platform owner must never receive a stored result for
  -- a request id they did not (or no longer) own.
  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'entitlement_grant' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
  end if;

  if not exists (select 1 from public.forge_workspaces where owner_id = p_owner_id) then
    raise exception 'FORGE_AUTH_WORKSPACE_NOT_FOUND' using errcode = '22023';
  end if;

  select * into v_before from public.forge_app_entitlements
  where owner_id = p_owner_id and app_key = p_app_key;

  -- Trial slice (20261113030000): a trial row converts only through
  -- forge_app_trial_convert_to_paid, so the conversion keeps the trial
  -- history, the audit receipt, and the last-trial reference. The generic
  -- grant path must never silently overwrite an owner_trial row as
  -- owner_manual.
  if v_before.source = 'owner_trial' then
    raise exception 'FORGE_AUTH_TRIAL_MUST_CONVERT' using errcode = '42501';
  end if;

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

-- ---------------------------------------------------------------------------
-- 8b. forge_app_entitlement_revoke — redefined with TWO trial-slice
--    additions: (1) the revoke takes the shared workspace/app
--    serialization lock (trial_serialize) before its request-id lock
--    and before reading the entitlement, so it serializes with the
--    trial RPCs and the generic grant (section 8). Without it, a
--    revoke racing a trial renewal could commit between the renewal's
--    read and its update, and the renewal would then overwrite the
--    revoked row from its earlier snapshot. Lock order is fixed
--    (workspace/app first, then request id) across the revoke, the
--    generic grant, and all trial RPCs. The expiry worker takes no
--    advisory lock, so no advisory/row-lock deadlock cycle exists.
--    (2) fix round 3 (TRIAL-OBS-3 ruling): the platform-owner check
--    now runs before the idempotency receipt lookup — the same
--    authorization-before-replay order as the generic grant (§8) and
--    the trial RPCs. Every other line is byte-identical to the Auth
--    PR 1 definition.
-- ---------------------------------------------------------------------------

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
  -- Trial slice (20261113030000): serialize with the trial RPCs and the
  -- generic grant on the shared workspace/app lock before the request-id
  -- lock and before reading the entitlement (see the section header).
  perform pg_advisory_xact_lock(hashtext(p_owner_id || '|' || p_app_key), hashtext('trial_serialize'));
  -- Serialize concurrent duplicate request ids: the receipt
  -- check below must see the first execution's commit, or a
  -- loser would re-execute instead of replaying.
  perform pg_advisory_xact_lock(hashtext(p_owner_id), hashtext(p_request_id));
  -- Fix-round-3 (TRIAL-OBS-3 ruling): authorization precedes the
  -- idempotency replay — the same order as the generic grant (§8) and
  -- the three trial RPCs (section 5). A caller who is not currently a
  -- platform owner must never receive a stored result for a request id
  -- they did not (or no longer) own.
  if not public.forge_has_platform_role('owner') then
    raise exception 'FORGE_AUTH_PLATFORM_OWNER_ONLY' using errcode = '42501';
  end if;
  select r.action, r.payload_hash, r.result into v_r_action, v_r_hash, v_result
    from public.forge_auth_idempotency_receipts r where r.request_id = p_request_id;
  if found then
    if v_r_action <> 'entitlement_revoke' or v_r_hash <> v_payload_hash then
      raise exception 'FORGE_AUTH_REQUEST_ID_CONFLICT' using errcode = '23505';
    end if;
    return v_result;
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

-- ---------------------------------------------------------------------------
-- 9. Planner + Capture data-plane RLS: the live entitlement predicate is
--    ANDed into every app-specific policy (explicit drop + recreate,
--    policy names preserved). Each rewrite is guarded on the policy
--    existing (pg_policies): a policy renamed or not yet created by an
--    in-flight PR (#802 slice-7 artifacts + controlled-drawings bucket,
--    #786 slice-9 milestones) is skipped, never duplicated, and the
--    migration test battery asserts the final state per table. Tables
--    with no owner_id (lifecycle_transitions, package_type_gates,
--    planning_process_template) keep using(true) — shared reference data,
--    no predicate can apply. Tables with RLS enabled and no policies stay
--    deny-all for direct access; their writes are covered by the section
--    10 triggers.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_packages' and policyname = 'forge_work_packages_workspace_select') then
    drop policy "forge_work_packages_workspace_select" on public.forge_work_packages;
    create policy "forge_work_packages_workspace_select" on public.forge_work_packages for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_package_transitions' and policyname = 'forge_work_package_transitions_workspace_select') then
    drop policy "forge_work_package_transitions_workspace_select" on public.forge_work_package_transitions;
    create policy "forge_work_package_transitions_workspace_select" on public.forge_work_package_transitions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_assets' and policyname = 'forge_work_assets_workspace_select') then
    drop policy "forge_work_assets_workspace_select" on public.forge_work_assets;
    create policy "forge_work_assets_workspace_select" on public.forge_work_assets for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_asset_components' and policyname = 'forge_work_asset_components_workspace_select') then
    drop policy "forge_work_asset_components_workspace_select" on public.forge_work_asset_components;
    create policy "forge_work_asset_components_workspace_select" on public.forge_work_asset_components for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_inspection_observations' and policyname = 'forge_work_inspection_observations_workspace_select') then
    drop policy "forge_work_inspection_observations_workspace_select" on public.forge_work_inspection_observations;
    create policy "forge_work_inspection_observations_workspace_select" on public.forge_work_inspection_observations for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_locations' and policyname = 'forge_work_locations_workspace_select') then
    drop policy "forge_work_locations_workspace_select" on public.forge_work_locations;
    create policy "forge_work_locations_workspace_select" on public.forge_work_locations for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_scope_baselines' and policyname = 'forge_work_scope_baselines_workspace_select') then
    drop policy "forge_work_scope_baselines_workspace_select" on public.forge_work_scope_baselines;
    create policy "forge_work_scope_baselines_workspace_select" on public.forge_work_scope_baselines for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_scope_changes' and policyname = 'forge_work_scope_changes_workspace_select') then
    drop policy "forge_work_scope_changes_workspace_select" on public.forge_work_scope_changes;
    create policy "forge_work_scope_changes_workspace_select" on public.forge_work_scope_changes for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_gate_attestations' and policyname = 'forge_work_gate_attestations_workspace_select') then
    drop policy "forge_work_gate_attestations_workspace_select" on public.forge_work_gate_attestations;
    create policy "forge_work_gate_attestations_workspace_select" on public.forge_work_gate_attestations for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_gate_evaluations' and policyname = 'forge_work_gate_evaluations_workspace_select') then
    drop policy "forge_work_gate_evaluations_workspace_select" on public.forge_work_gate_evaluations;
    create policy "forge_work_gate_evaluations_workspace_select" on public.forge_work_gate_evaluations for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_gate_overrides' and policyname = 'forge_work_gate_overrides_workspace_select') then
    drop policy "forge_work_gate_overrides_workspace_select" on public.forge_work_gate_overrides;
    create policy "forge_work_gate_overrides_workspace_select" on public.forge_work_gate_overrides for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_package_sequences' and policyname = 'forge_work_package_sequences_workspace_select') then
    drop policy "forge_work_package_sequences_workspace_select" on public.forge_work_package_sequences;
    create policy "forge_work_package_sequences_workspace_select" on public.forge_work_package_sequences for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_packages' and policyname = 'forge_work_packages_workspace_insert') then
    drop policy "forge_work_packages_workspace_insert" on public.forge_work_packages;
    create policy "forge_work_packages_workspace_insert" on public.forge_work_packages for insert to authenticated
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_packages' and policyname = 'forge_work_packages_workspace_update') then
    drop policy "forge_work_packages_workspace_update" on public.forge_work_packages;
    create policy "forge_work_packages_workspace_update" on public.forge_work_packages for update to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_assets' and policyname = 'forge_work_assets_workspace_write') then
    drop policy "forge_work_assets_workspace_write" on public.forge_work_assets;
    create policy "forge_work_assets_workspace_write" on public.forge_work_assets for all to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_asset_components' and policyname = 'forge_work_asset_components_workspace_write') then
    drop policy "forge_work_asset_components_workspace_write" on public.forge_work_asset_components;
    create policy "forge_work_asset_components_workspace_write" on public.forge_work_asset_components for all to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_inspection_observations' and policyname = 'forge_work_inspection_observations_workspace_write') then
    drop policy "forge_work_inspection_observations_workspace_write" on public.forge_work_inspection_observations;
    create policy "forge_work_inspection_observations_workspace_write" on public.forge_work_inspection_observations for all to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_locations' and policyname = 'forge_work_locations_workspace_write') then
    drop policy "forge_work_locations_workspace_write" on public.forge_work_locations;
    create policy "forge_work_locations_workspace_write" on public.forge_work_locations for all to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_scope_changes' and policyname = 'forge_work_scope_changes_workspace_insert') then
    drop policy "forge_work_scope_changes_workspace_insert" on public.forge_work_scope_changes;
    create policy "forge_work_scope_changes_workspace_insert" on public.forge_work_scope_changes for insert to authenticated
      with check (public.has_workspace_access(owner_id) and status = 'proposed' and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_gate_attestations' and policyname = 'forge_work_gate_attestations_workspace_insert') then
    drop policy "forge_work_gate_attestations_workspace_insert" on public.forge_work_gate_attestations;
    create policy "forge_work_gate_attestations_workspace_insert" on public.forge_work_gate_attestations for insert to authenticated
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_gate_evaluations' and policyname = 'forge_work_gate_evaluations_workspace_insert') then
    drop policy "forge_work_gate_evaluations_workspace_insert" on public.forge_work_gate_evaluations;
    create policy "forge_work_gate_evaluations_workspace_insert" on public.forge_work_gate_evaluations for insert to authenticated
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_gate_overrides' and policyname = 'forge_work_gate_overrides_workspace_insert') then
    drop policy "forge_work_gate_overrides_workspace_insert" on public.forge_work_gate_overrides;
    create policy "forge_work_gate_overrides_workspace_insert" on public.forge_work_gate_overrides for insert to authenticated
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_manpower_days' and policyname = 'forge_work_manpower_days_owner') then
    drop policy "forge_work_manpower_days_owner" on public.forge_work_manpower_days;
    create policy "forge_work_manpower_days_owner" on public.forge_work_manpower_days for all to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_package_baselines' and policyname = 'forge_work_package_baselines_owner') then
    drop policy "forge_work_package_baselines_owner" on public.forge_work_package_baselines;
    create policy "forge_work_package_baselines_owner" on public.forge_work_package_baselines for all to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_progress_snapshots' and policyname = 'forge_work_progress_snapshots_owner') then
    drop policy "forge_work_progress_snapshots_owner" on public.forge_work_progress_snapshots;
    create policy "forge_work_progress_snapshots_owner" on public.forge_work_progress_snapshots for all to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_weekly_commitments' and policyname = 'forge_work_weekly_commitments_owner') then
    drop policy "forge_work_weekly_commitments_owner" on public.forge_work_weekly_commitments;
    create policy "forge_work_weekly_commitments_owner" on public.forge_work_weekly_commitments for all to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_document_library' and policyname = 'forge_work_document_library_workspace_select') then
    drop policy "forge_work_document_library_workspace_select" on public.forge_work_document_library;
    create policy "forge_work_document_library_workspace_select" on public.forge_work_document_library for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_document_library' and policyname = 'forge_work_document_library_workspace_insert') then
    drop policy "forge_work_document_library_workspace_insert" on public.forge_work_document_library;
    create policy "forge_work_document_library_workspace_insert" on public.forge_work_document_library for insert to authenticated
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_document_library' and policyname = 'forge_work_document_library_workspace_update') then
    drop policy "forge_work_document_library_workspace_update" on public.forge_work_document_library;
    create policy "forge_work_document_library_workspace_update" on public.forge_work_document_library for update to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_package_budget_revisions' and policyname = 'forge_work_package_budget_revisions_workspace_select') then
    drop policy "forge_work_package_budget_revisions_workspace_select" on public.forge_work_package_budget_revisions;
    create policy "forge_work_package_budget_revisions_workspace_select" on public.forge_work_package_budget_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_package_deletions' and policyname = 'forge_work_package_deletions_workspace_select') then
    drop policy "forge_work_package_deletions_workspace_select" on public.forge_work_package_deletions;
    create policy "forge_work_package_deletions_workspace_select" on public.forge_work_package_deletions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_progress_revisions' and policyname = 'forge_work_progress_revisions_workspace_select') then
    drop policy "forge_work_progress_revisions_workspace_select" on public.forge_work_progress_revisions;
    create policy "forge_work_progress_revisions_workspace_select" on public.forge_work_progress_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_permit_annotation_revisions' and policyname = 'forge_work_permit_annotation_revisions_workspace_select') then
    drop policy "forge_work_permit_annotation_revisions_workspace_select" on public.forge_work_permit_annotation_revisions;
    create policy "forge_work_permit_annotation_revisions_workspace_select" on public.forge_work_permit_annotation_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_permit_annotations' and policyname = 'forge_work_permit_annotations_workspace_select') then
    drop policy "forge_work_permit_annotations_workspace_select" on public.forge_work_permit_annotations;
    create policy "forge_work_permit_annotations_workspace_select" on public.forge_work_permit_annotations for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_craft_assignment_revisions' and policyname = 'forge_work_craft_assignment_revisions_workspace_select') then
    drop policy "forge_work_craft_assignment_revisions_workspace_select" on public.forge_work_craft_assignment_revisions;
    create policy "forge_work_craft_assignment_revisions_workspace_select" on public.forge_work_craft_assignment_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_craft_assignments' and policyname = 'forge_work_craft_assignments_workspace_select') then
    drop policy "forge_work_craft_assignments_workspace_select" on public.forge_work_craft_assignments;
    create policy "forge_work_craft_assignments_workspace_select" on public.forge_work_craft_assignments for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_step_drawing_link_revisions' and policyname = 'forge_work_step_drawing_link_revisions_workspace_select') then
    drop policy "forge_work_step_drawing_link_revisions_workspace_select" on public.forge_work_step_drawing_link_revisions;
    create policy "forge_work_step_drawing_link_revisions_workspace_select" on public.forge_work_step_drawing_link_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_step_drawing_links' and policyname = 'forge_work_step_drawing_links_workspace_select') then
    drop policy "forge_work_step_drawing_links_workspace_select" on public.forge_work_step_drawing_links;
    create policy "forge_work_step_drawing_links_workspace_select" on public.forge_work_step_drawing_links for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_step_order' and policyname = 'forge_work_step_order_workspace_select') then
    drop policy "forge_work_step_order_workspace_select" on public.forge_work_step_order;
    create policy "forge_work_step_order_workspace_select" on public.forge_work_step_order for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_step_revisions' and policyname = 'forge_work_step_revisions_workspace_select') then
    drop policy "forge_work_step_revisions_workspace_select" on public.forge_work_step_revisions;
    create policy "forge_work_step_revisions_workspace_select" on public.forge_work_step_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_steps' and policyname = 'forge_work_steps_workspace_select') then
    drop policy "forge_work_steps_workspace_select" on public.forge_work_steps;
    create policy "forge_work_steps_workspace_select" on public.forge_work_steps for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_step_curve_placement_revisions' and policyname = 'forge_work_step_curve_placement_revisions_select') then
    drop policy "forge_work_step_curve_placement_revisions_select" on public.forge_work_step_curve_placement_revisions;
    create policy "forge_work_step_curve_placement_revisions_select" on public.forge_work_step_curve_placement_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_step_curve_placements' and policyname = 'forge_work_step_curve_placements_select') then
    drop policy "forge_work_step_curve_placements_select" on public.forge_work_step_curve_placements;
    create policy "forge_work_step_curve_placements_select" on public.forge_work_step_curve_placements for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_wp_drawing_field_redlines' and policyname = 'forge_wp_drawing_field_redlines_select') then
    drop policy "forge_wp_drawing_field_redlines_select" on public.forge_wp_drawing_field_redlines;
    create policy "forge_wp_drawing_field_redlines_select" on public.forge_wp_drawing_field_redlines for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_wp_drawing_ifc_releases' and policyname = 'forge_wp_drawing_ifc_releases_select') then
    drop policy "forge_wp_drawing_ifc_releases_select" on public.forge_wp_drawing_ifc_releases;
    create policy "forge_wp_drawing_ifc_releases_select" on public.forge_wp_drawing_ifc_releases for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_wp_drawing_redlines' and policyname = 'forge_wp_drawing_redlines_select') then
    drop policy "forge_wp_drawing_redlines_select" on public.forge_wp_drawing_redlines;
    create policy "forge_wp_drawing_redlines_select" on public.forge_wp_drawing_redlines for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_wp_drawing_review_events' and policyname = 'forge_wp_drawing_review_events_select') then
    drop policy "forge_wp_drawing_review_events_select" on public.forge_wp_drawing_review_events;
    create policy "forge_wp_drawing_review_events_select" on public.forge_wp_drawing_review_events for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_wp_drawing_reviews' and policyname = 'forge_wp_drawing_reviews_select') then
    drop policy "forge_wp_drawing_reviews_select" on public.forge_wp_drawing_reviews;
    create policy "forge_wp_drawing_reviews_select" on public.forge_wp_drawing_reviews for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_wp_drawing_revisions' and policyname = 'forge_wp_drawing_revisions_select') then
    drop policy "forge_wp_drawing_revisions_select" on public.forge_wp_drawing_revisions;
    create policy "forge_wp_drawing_revisions_select" on public.forge_wp_drawing_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_change_order_revisions' and policyname = 'forge_work_change_order_revisions_select') then
    drop policy "forge_work_change_order_revisions_select" on public.forge_work_change_order_revisions;
    create policy "forge_work_change_order_revisions_select" on public.forge_work_change_order_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_change_orders' and policyname = 'forge_work_change_orders_select') then
    drop policy "forge_work_change_orders_select" on public.forge_work_change_orders;
    create policy "forge_work_change_orders_select" on public.forge_work_change_orders for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_control_estimate_revisions' and policyname = 'forge_work_control_estimate_revisions_select') then
    drop policy "forge_work_control_estimate_revisions_select" on public.forge_work_control_estimate_revisions;
    create policy "forge_work_control_estimate_revisions_select" on public.forge_work_control_estimate_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_control_estimates' and policyname = 'forge_work_control_estimates_select') then
    drop policy "forge_work_control_estimates_select" on public.forge_work_control_estimates;
    create policy "forge_work_control_estimates_select" on public.forge_work_control_estimates for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_craft_rate_revisions' and policyname = 'forge_work_craft_rate_revisions_select') then
    drop policy "forge_work_craft_rate_revisions_select" on public.forge_work_craft_rate_revisions;
    create policy "forge_work_craft_rate_revisions_select" on public.forge_work_craft_rate_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_craft_rates' and policyname = 'forge_work_craft_rates_select') then
    drop policy "forge_work_craft_rates_select" on public.forge_work_craft_rates;
    create policy "forge_work_craft_rates_select" on public.forge_work_craft_rates for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_package_links' and policyname = 'forge_work_package_links_owner_select') then
    drop policy "forge_work_package_links_owner_select" on public.forge_work_package_links;
    create policy "forge_work_package_links_owner_select" on public.forge_work_package_links for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

-- forge_work_links / forge_work_link_confirmations DO have policies
-- (FOR ALL *_workspace_all, not "no policies" as an early inventory
-- claimed): rewrite them with the entitlement predicate like the rest.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_links' and policyname = 'forge_work_links_workspace_all') then
    drop policy "forge_work_links_workspace_all" on public.forge_work_links;
    create policy "forge_work_links_workspace_all" on public.forge_work_links for all to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_link_confirmations' and policyname = 'forge_work_link_confirmations_workspace_all') then
    drop policy "forge_work_link_confirmations_workspace_all" on public.forge_work_link_confirmations;
    create policy "forge_work_link_confirmations_workspace_all" on public.forge_work_link_confirmations for all to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_drawings' and policyname = 'forge_work_drawings_workspace_select') then
    drop policy "forge_work_drawings_workspace_select" on public.forge_work_drawings;
    create policy "forge_work_drawings_workspace_select" on public.forge_work_drawings for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_drawings' and policyname = 'forge_work_drawings_workspace_insert') then
    drop policy "forge_work_drawings_workspace_insert" on public.forge_work_drawings;
    create policy "forge_work_drawings_workspace_insert" on public.forge_work_drawings for insert to authenticated
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_drawings' and policyname = 'forge_work_drawings_workspace_delete') then
    drop policy "forge_work_drawings_workspace_delete" on public.forge_work_drawings;
    create policy "forge_work_drawings_workspace_delete" on public.forge_work_drawings for delete to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_takeoff_lines' and policyname = 'forge_work_takeoff_lines_workspace_select') then
    drop policy "forge_work_takeoff_lines_workspace_select" on public.forge_work_takeoff_lines;
    create policy "forge_work_takeoff_lines_workspace_select" on public.forge_work_takeoff_lines for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_takeoff_lines' and policyname = 'forge_work_takeoff_lines_workspace_insert') then
    drop policy "forge_work_takeoff_lines_workspace_insert" on public.forge_work_takeoff_lines;
    create policy "forge_work_takeoff_lines_workspace_insert" on public.forge_work_takeoff_lines for insert to authenticated
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_takeoff_lines' and policyname = 'forge_work_takeoff_lines_workspace_update') then
    drop policy "forge_work_takeoff_lines_workspace_update" on public.forge_work_takeoff_lines;
    create policy "forge_work_takeoff_lines_workspace_update" on public.forge_work_takeoff_lines for update to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_takeoff_lines' and policyname = 'forge_work_takeoff_lines_workspace_delete') then
    drop policy "forge_work_takeoff_lines_workspace_delete" on public.forge_work_takeoff_lines;
    create policy "forge_work_takeoff_lines_workspace_delete" on public.forge_work_takeoff_lines for delete to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_progress_entries' and policyname = 'forge_work_progress_entries_workspace_select') then
    drop policy "forge_work_progress_entries_workspace_select" on public.forge_work_progress_entries;
    create policy "forge_work_progress_entries_workspace_select" on public.forge_work_progress_entries for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_progress_entries' and policyname = 'forge_work_progress_entries_workspace_insert') then
    drop policy "forge_work_progress_entries_workspace_insert" on public.forge_work_progress_entries;
    create policy "forge_work_progress_entries_workspace_insert" on public.forge_work_progress_entries for insert to authenticated
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_progress_entries' and policyname = 'forge_work_progress_entries_workspace_update') then
    drop policy "forge_work_progress_entries_workspace_update" on public.forge_work_progress_entries;
    create policy "forge_work_progress_entries_workspace_update" on public.forge_work_progress_entries for update to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'))
      with check (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_planning_process_instances' and policyname = 'forge_work_planning_process_instances_select') then
    drop policy "forge_work_planning_process_instances_select" on public.forge_work_planning_process_instances;
    create policy "forge_work_planning_process_instances_select" on public.forge_work_planning_process_instances for select to authenticated
      using ((public.has_workspace_access(owner_id) or public.has_planner_permission(owner_id, 'planner.planning_steps.read')) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_planning_process_revisions' and policyname = 'forge_work_planning_process_revisions_select') then
    drop policy "forge_work_planning_process_revisions_select" on public.forge_work_planning_process_revisions;
    create policy "forge_work_planning_process_revisions_select" on public.forge_work_planning_process_revisions for select to authenticated
      using ((public.has_workspace_access(owner_id) or public.has_planner_permission(owner_id, 'planner.planning_steps.read')) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capture_library' and policyname = 'capture_library_owner_select') then
    drop policy "capture_library_owner_select" on public.capture_library;
    create policy "capture_library_owner_select" on public.capture_library for select to authenticated
      using (owner_id = auth.uid()::text and public.forge_has_app_entitlement(owner_id, 'capture'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capture_library' and policyname = 'capture_library_owner_insert') then
    drop policy "capture_library_owner_insert" on public.capture_library;
    create policy "capture_library_owner_insert" on public.capture_library for insert to authenticated
      with check (owner_id = auth.uid()::text and public.forge_has_app_entitlement(owner_id, 'capture'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capture_library' and policyname = 'capture_library_owner_update') then
    drop policy "capture_library_owner_update" on public.capture_library;
    create policy "capture_library_owner_update" on public.capture_library for update to authenticated
      using (owner_id = auth.uid()::text and public.forge_has_app_entitlement(owner_id, 'capture'))
      with check (owner_id = auth.uid()::text and public.forge_has_app_entitlement(owner_id, 'capture'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capture_library' and policyname = 'capture_library_owner_delete') then
    drop policy "capture_library_owner_delete" on public.capture_library;
    create policy "capture_library_owner_delete" on public.capture_library for delete to authenticated
      using (owner_id = auth.uid()::text and public.forge_has_app_entitlement(owner_id, 'capture'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capture_library_audit_log' and policyname = 'capture_library_audit_log_owner_select') then
    drop policy "capture_library_audit_log_owner_select" on public.capture_library_audit_log;
    create policy "capture_library_audit_log_owner_select" on public.capture_library_audit_log for select to authenticated
      using (owner_id = auth.uid()::text and public.forge_has_app_entitlement(owner_id, 'capture'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'capture_library_audit_log' and policyname = 'capture_library_audit_log_owner_insert') then
    drop policy "capture_library_audit_log_owner_insert" on public.capture_library_audit_log;
    create policy "capture_library_audit_log_owner_insert" on public.capture_library_audit_log for insert to authenticated
      with check (owner_id = auth.uid()::text and public.forge_has_app_entitlement(owner_id, 'capture'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'capture_library_objects_owner_select') then
    drop policy "capture_library_objects_owner_select" on storage.objects;
    create policy "capture_library_objects_owner_select" on storage.objects for select to authenticated
      using ((bucket_id = 'capture-library' and (storage.foldername(name))[1] = auth.uid()::text and public.forge_has_app_entitlement((storage.foldername(name))[1], 'capture')));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'capture_library_objects_owner_insert') then
    drop policy "capture_library_objects_owner_insert" on storage.objects;
    create policy "capture_library_objects_owner_insert" on storage.objects for insert to authenticated
      with check ((bucket_id = 'capture-library' and (storage.foldername(name))[1] = auth.uid()::text and public.forge_has_app_entitlement((storage.foldername(name))[1], 'capture')));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'capture_library_objects_owner_delete') then
    drop policy "capture_library_objects_owner_delete" on storage.objects;
    create policy "capture_library_objects_owner_delete" on storage.objects for delete to authenticated
      using ((bucket_id = 'capture-library' and (storage.foldername(name))[1] = auth.uid()::text and public.forge_has_app_entitlement((storage.foldername(name))[1], 'capture')));
  end if;
end $$;

-- Planner document library storage (work-documents bucket): same
-- entitlement predicate as the forge_work_document_library table.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'work_document_objects_workspace_select') then
    drop policy "work_document_objects_workspace_select" on storage.objects;
    create policy "work_document_objects_workspace_select" on storage.objects for select to authenticated
      using ((bucket_id = 'work-documents' and public.has_workspace_access((storage.foldername(name))[1]) and public.forge_has_app_entitlement((storage.foldername(name))[1], 'planner')));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'work_document_objects_workspace_insert') then
    drop policy "work_document_objects_workspace_insert" on storage.objects;
    create policy "work_document_objects_workspace_insert" on storage.objects for insert to authenticated
      with check ((bucket_id = 'work-documents' and public.has_workspace_access((storage.foldername(name))[1]) and public.forge_has_app_entitlement((storage.foldername(name))[1], 'planner')));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'work_document_objects_orphan_cleanup') then
    drop policy "work_document_objects_orphan_cleanup" on storage.objects;
    create policy "work_document_objects_orphan_cleanup" on storage.objects for delete to authenticated
      using ((bucket_id = 'work-documents' and public.has_workspace_access((storage.foldername(name))[1]) and public.forge_has_app_entitlement((storage.foldername(name))[1], 'planner') and not exists (select 1 from public.forge_work_document_library d where d.bucket = 'work-documents' and d.object_path = storage.objects.name)));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_wp_drawing_artifacts' and policyname = 'forge_wp_drawing_artifacts_select') then
    drop policy "forge_wp_drawing_artifacts_select" on public.forge_wp_drawing_artifacts;
    create policy "forge_wp_drawing_artifacts_select" on public.forge_wp_drawing_artifacts for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'controlled_drawing_objects_workspace_select') then
    drop policy "controlled_drawing_objects_workspace_select" on storage.objects;
    create policy "controlled_drawing_objects_workspace_select" on storage.objects for select to authenticated
      using ((bucket_id = 'controlled-drawings' and public.has_workspace_access((storage.foldername(name))[1]) and public.forge_has_app_entitlement((storage.foldername(name))[1], 'planner')));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'controlled_drawing_objects_workspace_insert') then
    drop policy "controlled_drawing_objects_workspace_insert" on storage.objects;
    create policy "controlled_drawing_objects_workspace_insert" on storage.objects for insert to authenticated
      with check ((bucket_id = 'controlled-drawings' and public.has_workspace_access((storage.foldername(name))[1]) and public.forge_has_app_entitlement((storage.foldername(name))[1], 'planner')));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'controlled_drawing_objects_orphan_cleanup') then
    drop policy "controlled_drawing_objects_orphan_cleanup" on storage.objects;
    create policy "controlled_drawing_objects_orphan_cleanup" on storage.objects for delete to authenticated
      using ((bucket_id = 'controlled-drawings' and public.has_workspace_access((storage.foldername(name))[1]) and public.forge_has_app_entitlement((storage.foldername(name))[1], 'planner') and not exists (select 1 from public.forge_wp_drawing_artifacts a where a.bucket = 'controlled-drawings' and a.object_path = storage.objects.name)));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_milestone_templates' and policyname = 'forge_work_milestone_templates_select') then
    drop policy "forge_work_milestone_templates_select" on public.forge_work_milestone_templates;
    create policy "forge_work_milestone_templates_select" on public.forge_work_milestone_templates for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_milestone_template_revisions' and policyname = 'forge_work_milestone_template_revisions_select') then
    drop policy "forge_work_milestone_template_revisions_select" on public.forge_work_milestone_template_revisions;
    create policy "forge_work_milestone_template_revisions_select" on public.forge_work_milestone_template_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_milestone_template_complexity_offsets' and policyname = 'forge_work_milestone_offsets_select') then
    drop policy "forge_work_milestone_offsets_select" on public.forge_work_milestone_template_complexity_offsets;
    create policy "forge_work_milestone_offsets_select" on public.forge_work_milestone_template_complexity_offsets for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_milestones' and policyname = 'forge_work_milestones_select') then
    drop policy "forge_work_milestones_select" on public.forge_work_milestones;
    create policy "forge_work_milestones_select" on public.forge_work_milestones for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_work_milestone_revisions' and policyname = 'forge_work_milestone_revisions_select') then
    drop policy "forge_work_milestone_revisions_select" on public.forge_work_milestone_revisions;
    create policy "forge_work_milestone_revisions_select" on public.forge_work_milestone_revisions for select to authenticated
      using (public.has_workspace_access(owner_id) and public.forge_has_app_entitlement(owner_id, 'planner'));
  end if;
end $$;
-- ---------------------------------------------------------------------------
-- 10. Write-path enforcement for SECURITY DEFINER RPCs.
--    61 SECURITY DEFINER functions touch the Planner/Capture tables; the
--    functions bypass RLS by design, so the RLS rewrites in section 9 do
--    not constrain them. Redefining all 61 bodies to add one check each
--    would silently drift from the shipped bodies. Instead, a BEFORE
--    INSERT/UPDATE/DELETE trigger on every workspace-data table enforces
--    the live entitlement predicate uniformly — direct SQL, any RPC, and
--    future RPCs — and raises FORGE_TRIAL_ENTITLEMENT_REQUIRED (42501).
--    The three owner_id-less reference tables take no trigger (no owner
--    to check). The trigger functions keep their default proacl (PUBLIC
--    EXECUTE, like the existing trigger functions): a trigger function
--    invoked directly fails closed (TG_OP/NEW are null), and revoking
--    EXECUTE would break the triggers themselves for authenticated users.
--    KNOWN HAZARD (recorded): a future migration that inserts Planner
--    rows for a workspace without an active entitlement (e.g. a backfill
--    for a pending workspace) will trip the trigger; such a migration
--    must disable the trigger for its own backfill or grant first.
-- ---------------------------------------------------------------------------

create or replace function public.forge_trial_require_planner_entitlement()
returns trigger
language plpgsql
as $$
declare
  v_owner text;
begin
  if TG_OP = 'DELETE' then v_owner := OLD.owner_id; else v_owner := NEW.owner_id; end if;
  if not public.forge_has_app_entitlement(v_owner, 'planner') then
    raise exception 'FORGE_TRIAL_ENTITLEMENT_REQUIRED' using errcode = '42501';
  end if;
  return coalesce(NEW, OLD);
end;
$$;

create or replace function public.forge_trial_require_capture_entitlement()
returns trigger
language plpgsql
as $$
declare
  v_owner text;
begin
  if TG_OP = 'DELETE' then v_owner := OLD.owner_id; else v_owner := NEW.owner_id; end if;
  if not public.forge_has_app_entitlement(v_owner, 'capture') then
    raise exception 'FORGE_TRIAL_ENTITLEMENT_REQUIRED' using errcode = '42501';
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_packages;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_packages
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_package_transitions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_package_transitions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_assets;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_assets
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_asset_components;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_asset_components
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_inspection_observations;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_inspection_observations
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_locations;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_locations
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_scope_baselines;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_scope_baselines
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_scope_changes;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_scope_changes
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_gate_attestations;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_gate_attestations
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_gate_evaluations;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_gate_evaluations
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_gate_overrides;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_gate_overrides
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_package_sequences;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_package_sequences
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_manpower_days;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_manpower_days
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_package_baselines;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_package_baselines
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_progress_snapshots;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_progress_snapshots
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_weekly_commitments;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_weekly_commitments
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_document_library;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_document_library
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_package_budget_revisions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_package_budget_revisions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_package_deletions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_package_deletions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_drawings;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_drawings
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_takeoff_lines;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_takeoff_lines
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_progress_entries;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_progress_entries
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_progress_revisions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_progress_revisions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_permit_annotation_revisions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_permit_annotation_revisions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_permit_annotations;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_permit_annotations
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_craft_assignment_revisions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_craft_assignment_revisions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_craft_assignments;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_craft_assignments
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_step_drawing_link_revisions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_step_drawing_link_revisions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_step_drawing_links;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_step_drawing_links
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_step_order;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_step_order
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_step_revisions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_step_revisions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_steps;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_steps
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_step_curve_placement_revisions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_step_curve_placement_revisions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_step_curve_placements;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_step_curve_placements
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_wp_drawing_field_redlines;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_wp_drawing_field_redlines
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_wp_drawing_ifc_releases;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_wp_drawing_ifc_releases
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_wp_drawing_redlines;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_wp_drawing_redlines
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_wp_drawing_review_events;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_wp_drawing_review_events
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_wp_drawing_reviews;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_wp_drawing_reviews
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_wp_drawing_revisions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_wp_drawing_revisions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_change_order_revisions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_change_order_revisions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_change_orders;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_change_orders
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_control_estimate_revisions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_control_estimate_revisions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_control_estimates;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_control_estimates
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_craft_rate_revisions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_craft_rate_revisions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_craft_rates;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_craft_rates
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_planning_process_instances;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_planning_process_instances
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_planning_process_revisions;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_planning_process_revisions
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_package_links;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_package_links
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_capture_entitlement on public.capture_library;
create trigger forge_trial_capture_entitlement
  before insert or update or delete on public.capture_library
  for each row execute function public.forge_trial_require_capture_entitlement();

drop trigger if exists forge_trial_capture_entitlement on public.capture_library_audit_log;
create trigger forge_trial_capture_entitlement
  before insert or update or delete on public.capture_library_audit_log
  for each row execute function public.forge_trial_require_capture_entitlement();

do $$
begin
  if to_regclass('public.forge_wp_drawing_artifacts') is not null then
    drop trigger if exists forge_trial_planner_entitlement on public.forge_wp_drawing_artifacts;
    create trigger forge_trial_planner_entitlement
      before insert or update or delete on public.forge_wp_drawing_artifacts
      for each row execute function public.forge_trial_require_planner_entitlement();
  end if;
end $$;

do $$
begin
  if to_regclass('public.forge_work_milestone_templates') is not null then
    drop trigger if exists forge_trial_planner_entitlement on public.forge_work_milestone_templates;
    create trigger forge_trial_planner_entitlement
      before insert or update or delete on public.forge_work_milestone_templates
      for each row execute function public.forge_trial_require_planner_entitlement();
  end if;
end $$;

do $$
begin
  if to_regclass('public.forge_work_milestone_template_revisions') is not null then
    drop trigger if exists forge_trial_planner_entitlement on public.forge_work_milestone_template_revisions;
    create trigger forge_trial_planner_entitlement
      before insert or update or delete on public.forge_work_milestone_template_revisions
      for each row execute function public.forge_trial_require_planner_entitlement();
  end if;
end $$;

do $$
begin
  if to_regclass('public.forge_work_milestone_template_complexity_offsets') is not null then
    drop trigger if exists forge_trial_planner_entitlement on public.forge_work_milestone_template_complexity_offsets;
    create trigger forge_trial_planner_entitlement
      before insert or update or delete on public.forge_work_milestone_template_complexity_offsets
      for each row execute function public.forge_trial_require_planner_entitlement();
  end if;
end $$;

do $$
begin
  if to_regclass('public.forge_work_milestones') is not null then
    drop trigger if exists forge_trial_planner_entitlement on public.forge_work_milestones;
    create trigger forge_trial_planner_entitlement
      before insert or update or delete on public.forge_work_milestones
      for each row execute function public.forge_trial_require_planner_entitlement();
  end if;
end $$;

do $$
begin
  if to_regclass('public.forge_work_milestone_revisions') is not null then
    drop trigger if exists forge_trial_planner_entitlement on public.forge_work_milestone_revisions;
    create trigger forge_trial_planner_entitlement
      before insert or update or delete on public.forge_work_milestone_revisions
      for each row execute function public.forge_trial_require_planner_entitlement();
  end if;
end $$;

-- No-policy tables (RLS enabled, no policies): direct access already
-- denies; the trigger is the write enforcement for their RPC-only paths.
drop trigger if exists forge_trial_planner_entitlement on public.forge_work_links;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_links
  for each row execute function public.forge_trial_require_planner_entitlement();

drop trigger if exists forge_trial_planner_entitlement on public.forge_work_link_confirmations;
create trigger forge_trial_planner_entitlement
  before insert or update or delete on public.forge_work_link_confirmations
  for each row execute function public.forge_trial_require_planner_entitlement();
-- ---------------------------------------------------------------------------
-- 11. Read-returning RPCs redefined with an entitlement check at the top.
--     forge_work_package_deletion_blocker_counts is the read leg behind
--     forge_work_package_deletion_blockers (which delegates to it after
--     its own workspace check), so guarding it covers both. The body is
--     PR #784's version verbatim (active-only arms + revision arms —
--     a strict superset of the 20261110070000 body on main), converted
--     from language sql to language plpgsql so the guard can raise;
--     the query itself is unchanged. forge_work_planning_process_checklist
--     is the #796 body verbatim with the guard inserted after its
--     workspace check. Mutation RPCs need no redefinition: their writes
--     are blocked by the section 10 triggers before any data returns.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_package_deletion_blocker_counts(
  p_owner_id text,
  p_package_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.forge_has_app_entitlement(p_owner_id, 'planner') then
    raise exception 'FORGE_TRIAL_ENTITLEMENT_REQUIRED' using errcode = '42501';
  end if;
  return (
select coalesce(
    jsonb_agg(
      jsonb_build_object('type', t.type, 'count', t.count)
      order by t.type
    ),
    '[]'::jsonb
  )
  from (
    select 'attestations'::text as type, count(*)::int as count
      from forge_work_gate_attestations
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'budget_revisions', count(*)::int
      from forge_work_package_budget_revisions
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'gate_evaluations', count(*)::int
      from forge_work_gate_evaluations
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'gate_overrides', count(*)::int
      from forge_work_gate_overrides
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'link_confirmations', count(*)::int
      from forge_work_link_confirmations c
      where c.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_links l
          where l.owner_id = c.owner_id and l.id = c.link_id
            and ((l.source_domain = 'workmgmt' and l.source_type = 'work_package'
                  and l.source_id = p_package_id)
              or (l.target_domain = 'workmgmt' and l.target_type = 'work_package'
                  and l.target_id = p_package_id))
        )
    union all
    select 'links', count(*)::int
      from forge_work_links
      where owner_id = p_owner_id
        and ((source_domain = 'workmgmt' and source_type = 'work_package'
              and source_id = p_package_id)
          or (target_domain = 'workmgmt' and target_type = 'work_package'
              and target_id = p_package_id))
    union all
    select 'manpower_days', count(*)::int
      from forge_work_manpower_days
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'observations', count(*)::int
      from forge_work_inspection_observations
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'package_baselines', count(*)::int
      from forge_work_package_baselines
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'progress_snapshots', count(*)::int
      from forge_work_progress_snapshots
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'scope_baselines', count(*)::int
      from forge_work_scope_baselines
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'scope_changes', count(*)::int
      from forge_work_scope_changes
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'transitions', count(*)::int
      from forge_work_package_transitions
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'weekly_commitments', count(*)::int
      from forge_work_weekly_commitments
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'drawings', count(*)::int
      from forge_work_drawings
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'progress_entries', count(*)::int
      from forge_work_progress_entries
      where owner_id = p_owner_id and work_package_id = p_package_id
    -- --- changed by this fix: active-only (retired rows no longer block) ---
    union all
    select 'permit_annotations', count(*)::int
      from forge_work_permit_annotations
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'permit_annotation_revisions', count(*)::int
      from forge_work_permit_annotation_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_permit_annotations a
          where a.owner_id = r.owner_id and a.id = r.annotation_id
            and a.work_package_id = p_package_id and a.retired_at is null
        )
    union all
    select 'craft_assignments', count(*)::int
      from forge_work_craft_assignments
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'craft_assignment_revisions', count(*)::int
      from forge_work_craft_assignment_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_craft_assignments a
          where a.owner_id = r.owner_id and a.id = r.assignment_id
            and a.work_package_id = p_package_id and a.retired_at is null
        )
    union all
    select 'steps', count(*)::int
      from forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'step_revisions', count(*)::int
      from forge_work_step_revisions sr
      where sr.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_steps s
          where s.owner_id = sr.owner_id and s.id = sr.step_id
            and s.work_package_id = p_package_id
            and s.retired_at is null
        )
    -- step_order intentionally dropped from this list -- see 20261110070000.
    union all
    select 'control_estimates', count(*)::int
      from forge_work_control_estimates
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'control_estimate_revisions', count(*)::int
      from forge_work_control_estimate_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_control_estimates e
          where e.owner_id = r.owner_id and e.id = r.estimate_id
            and e.work_package_id = p_package_id and e.retired_at is null
        )
    union all
    select 'change_orders', count(*)::int
      from forge_work_change_orders
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'change_order_revisions', count(*)::int
      from forge_work_change_order_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_change_orders o
          where o.owner_id = r.owner_id and o.id = r.change_order_id
            and o.work_package_id = p_package_id and o.retired_at is null
        )
    union all
    select 'craft_rates', count(*)::int
      from forge_work_craft_rates
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'craft_rate_revisions', count(*)::int
      from forge_work_craft_rate_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_craft_rates c
          where c.owner_id = r.owner_id and c.id = r.craft_rate_id
            and c.work_package_id = p_package_id and c.retired_at is null
        )
  ) t
  where t.count > 0
  );
end;
$$;

revoke all on function public.forge_work_package_deletion_blocker_counts(text, text)
  from public, anon, authenticated;
grant execute on function public.forge_work_package_deletion_blocker_counts(text, text)
  to service_role;

create or replace function public.forge_work_planning_process_checklist(
  p_owner_id text,
  p_package_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_complexity text;
  v_template_version integer;
  v_can_update boolean;
  v_can_review boolean;
  v_is_owner boolean;
  v_count integer;
  v_keys integer;
  v_credit numeric;
  v_hours numeric;
  v_instances integer;
begin
  if not (public.has_workspace_access(p_owner_id)
          or public.has_planner_permission(p_owner_id, 'planner.planning_steps.read')) then
    raise exception 'WPP10_WORKSPACE_FORBIDDEN';
  end if;
  -- Trial slice (20261113030000): the checklist is Planner data; a
  -- workspace without an active planner entitlement gets no checklist,
  -- even for a member holding planner.planning_steps.read.
  if not public.forge_has_app_entitlement(p_owner_id, 'planner') then
    raise exception 'FORGE_TRIAL_ENTITLEMENT_REQUIRED' using errcode = '42501';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP10_INVALID_ACTOR';
  end if;

  select planning_complexity, planning_template_version
    into v_complexity, v_template_version
    from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id;
  if v_complexity is null then
    raise exception 'WPP10_PACKAGE_NOT_FOUND';
  end if;

  -- F3: verify the bound template BEFORE instantiating. A template
  -- that cannot reach 100% (or has a missing/duplicated row) must fail
  -- closed, never mint a checklist that reports a misleading percent.
  select count(*), count(distinct step_key),
         coalesce(sum(credit_pct), 0), coalesce(sum(mhrs_standard), 0)
    into v_count, v_keys, v_credit, v_hours
    from public.forge_work_planning_process_template
    where version = v_template_version;
  if v_count <> 22 or v_keys <> 22 or v_credit <> 100 or v_hours <> 40 then
    raise exception 'WPP10_TEMPLATE_INVALID: template version % has % rows (% distinct keys), credits %, hours %',
      v_template_version, v_count, v_keys, v_credit, v_hours;
  end if;

  v_can_update := public.has_planner_permission(p_owner_id, 'planner.planning_steps.update');
  v_can_review := public.has_planner_permission(p_owner_id, 'planner.planning_steps.review');
  v_is_owner := public.has_workspace_access(p_owner_id);

  -- F1 (fix round 1): READ-ONLY. The 22 instance rows are created
  -- atomically with the package row (trigger, section 9) or by the
  -- idempotent backfill (section 10). A GET never mutates: a
  -- missing/duplicated set is unavailable, never auto-created.
  select count(*), count(distinct template_step_id) into v_instances, v_keys
    from public.forge_work_planning_process_instances
    where owner_id = p_owner_id and work_package_id = p_package_id;
  if v_instances <> 22 or v_keys <> 22 then
    raise exception 'WPP10_CHECKLIST_INCOMPLETE: package % has % planning instances (% distinct step keys), expected 22', p_package_id, v_instances, v_keys;
  end if;

  return jsonb_build_object(
    'packageId', p_package_id,
    'complexity', v_complexity,
    'templateVersion', v_template_version,
    'canUpdate', v_can_update,
    'canReview', v_can_review,
    'isOwner', v_is_owner,
    'constructionReadiness', jsonb_build_object(
      'status', 'not_established',
      'detail', 'No package-level release decision exists yet. Planning percent never authorizes construction or releases an IFC drawing.'
    ),
    'template', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.sort_order), '[]'::jsonb)
      from (select version, step_key, step_number, sort_order, name, role, credit_pct, mhrs_standard, description, provenance
              from public.forge_work_planning_process_template
              where version = v_template_version) t
    ),
    'instances', (
      select coalesce(jsonb_agg(row_to_json(i) order by i.template_step_id), '[]'::jsonb)
      from (select id, work_package_id, template_version, template_step_id, status, evidence_link,
                   reviewed_by, reviewed_at, submitted_by, version, updated_by, updated_at
              from public.forge_work_planning_process_instances
              where owner_id = p_owner_id and work_package_id = p_package_id) i
    )
  );
end;
$$;

revoke all on function public.forge_work_planning_process_checklist(text, text) from public, anon, service_role;
grant execute on function public.forge_work_planning_process_checklist(text, text) to authenticated;
