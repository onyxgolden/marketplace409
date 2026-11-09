-- Brandy AI Voice Receptionist — Track 2 v1 (brief §7)
-- ADDITIVE ONLY. Never apply without a separate owner word, a pre-apply
-- backup, and a post-apply ACL + RLS receipt. No live tenant data is
-- seeded here; all rows arrive via the signed ingestion endpoint.
--
-- Security posture (brief §11.13; fix round 1 for ChatGPT verdict
-- NEEDS CHANGES, drop 716b1b6f):
--  * RLS ENABLED + FORCED on every table; owner-scoped policies only.
--  * Policies use the repo's proven predicate public.has_workspace_access
--    (owner, or an ACTIVE co_owner member) tied to auth.uid(). The
--    earlier app.current_owner_id session setting is NOT used anywhere:
--    no route ever set it, so owner reads would have been denied.
--  * Default Supabase grants are REVOKED explicitly (defaults grant ALL
--    to anon/authenticated/service_role on new tables — a selective GRANT
--    alone does not remove them).
--  * service_role BYPASSES RLS in Supabase, so its writes are gated by
--    relation ACLs alone: it gets only the minimal INSERT/SELECT/UPDATE
--    the ingestion endpoint needs. authenticated gets SELECT on every
--    table plus UPDATE on drafts (the review path) — no browser/client
--    direct writes to calls, events, alerts, attempts or outbox.
--  * Events table is append-only (trigger rejects UPDATE/DELETE).
--  * Composite owner FKs: child rows cannot reference another owner's
--    call. Every composite FK target carries a matching UNIQUE key.
--  * Unique idempotency keys: duplicate/out-of-order provider events are
--    safe. Signed-ingest nonces carry a lifecycle (fix round 2, P1-2):
--    IN_PROGRESS -> COMMITTED | FAILED. Claiming a nonce does not mark
--    the delivery complete: only receptionist_complete_ingest_nonce
--    does, after every ingest write lands. A failed delivery is marked
--    FAILED so an identical retry re-runs the ingest instead of being
--    told it is already a duplicate. A committed replay returns the
--    stored original result; the same nonce with a different request
--    hash is rejected. Rows expire after the replay window.
--  * callback_e164_encrypted holds AES-256-GCM ciphertext produced by
--    the ingestion endpoint (format v1.<keyId>.<base64(iv||tag||ct)>);
--    the key lives in server env only, never in this migration.
--  * No PUBLIC/anon/authenticated grants anywhere beyond the minimal
--    SELECT/UPDATE listed below. This file is idempotent: policies are
--    created behind pg_policies guards, so a second apply is a no-op.
--  * Proven on real PostgreSQL 16 (scripts/brandy-receptionist-rls-proof):
--    migration applies twice cleanly; owner/co-owner/service personas,
--    cross-owner negatives, nonce consumption and draft idempotency.

-- ---------------------------------------------------------------- calls ---
create table if not exists public.forge_rental_receptionist_calls (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  operation_id text not null default 'brandy-rental-office',
  provider_call_sid text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  direction text not null default 'INBOUND' check (direction = 'INBOUND'),
  intent text check (intent in ('LEASING', 'MAINTENANCE', 'EMERGENCY', 'OTHER', 'UNKNOWN')),
  caller_ani_masked text,
  name_claimed text,
  need_excerpt text,
  -- AES-256-GCM ciphertext (v1.<keyId>.<base64(iv||tag||ciphertext)>),
  -- encrypted by the ingestion endpoint with a server-env key. Never
  -- plaintext: the column name is a promise, enforced by the endpoint
  -- (fail closed when no key is configured) and by tests.
  callback_e164_encrypted text,
  callback_confirmed boolean not null default false,
  callback_source text check (callback_source in ('spoken', 'ani_unverified')),
  property_hint text,
  match_status text not null default 'REVIEW_REQUIRED'
    check (match_status in ('REVIEW_REQUIRED', 'MATCHED', 'NO_MATCH')),
  tenant_id uuid,
  lead_id uuid,
  maintenance_draft_id uuid,
  emergency_event_id text,
  consent_status text,
  processing_state text not null default 'IN_PROGRESS',
  policy_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider_call_sid),
  -- Composite-FK target for events/drafts: PostgreSQL requires a UNIQUE
  -- key on (owner_id, id) before a child may reference those columns.
  unique (owner_id, id)
);

-- --------------------------------------------------------------- events ---
create table if not exists public.forge_rental_receptionist_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null,
  owner_id uuid not null,
  event_id text not null,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  payload_minimal jsonb not null default '{}'::jsonb,
  source_turn_id text,
  policy_version text not null,
  ingest_idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, ingest_idempotency_key),
  unique (owner_id, event_id),
  foreign key (owner_id, call_id)
    references public.forge_rental_receptionist_calls (owner_id, id)
);

-- Append-only: UPDATE/DELETE on the event stream are rejected.
create or replace function public.forge_rental_receptionist_events_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'forge_rental_receptionist_events is append-only';
end $$;

drop trigger if exists receptionist_events_append_only on public.forge_rental_receptionist_events;
create trigger receptionist_events_append_only
  before update or delete on public.forge_rental_receptionist_events
  for each row execute function public.forge_rental_receptionist_events_append_only();

-- --------------------------------------------------------------- alerts ---
create table if not exists public.forge_rental_receptionist_alerts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  emergency_event_id text not null,
  hazard text not null,
  detected_at timestamptz not null default now(),
  human_ack_at timestamptz,
  ack_method text check (ack_method in ('dtmf', 'authenticated')),
  backup_attempted_at timestamptz,
  resolution_state text not null default 'UNRESOLVED'
    check (resolution_state in ('UNRESOLVED', 'ACKNOWLEDGED', 'DEAD_LETTER')),
  created_at timestamptz not null default now(),
  unique (owner_id, emergency_event_id)
);

create table if not exists public.forge_rental_receptionist_alert_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  emergency_event_id text not null,
  target_role text not null check (target_role in ('PRIMARY', 'BACKUP')),
  channel text not null check (channel in ('VOICE', 'SMS')),
  attempt_no integer not null default 1,
  provider_sid text,
  state text not null default 'PENDING'
    check (state in ('PENDING', 'ACCEPTED', 'DELIVERED', 'FAILED')),
  failure_class text,
  requested_at timestamptz,
  provider_accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, dedupe_key),
  foreign key (owner_id, emergency_event_id)
    references public.forge_rental_receptionist_alerts (owner_id, emergency_event_id)
);

-- --------------------------------------------------------------- drafts ---
create table if not exists public.forge_rental_receptionist_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  call_id uuid not null,
  draft_kind text not null check (draft_kind in ('LEASING_LEAD', 'MAINTENANCE_INTAKE', 'GENERAL_MESSAGE')),
  claimed_tenant_id uuid,
  claimed_property_id uuid,
  proposed_payload jsonb not null default '{}'::jsonb,
  review_state text not null default 'PENDING'
    check (review_state in ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_INFO')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  committed_record_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One draft per (owner, call, kind): a replayed signed ingest upserts
  -- onto the existing draft instead of minting a duplicate PENDING draft.
  unique (owner_id, call_id, draft_kind),
  foreign key (owner_id, call_id)
    references public.forge_rental_receptionist_calls (owner_id, id)
);

-- -------------------------------------------------------------- outbox ----
create table if not exists public.forge_rental_receptionist_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  event_id text not null,
  channel text not null,
  recipient_role text not null,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'PENDING'
    check (state in ('PENDING', 'CLAIMED', 'SENT', 'DEAD_LETTER')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  unique (owner_id, event_id, channel, recipient_role)
);

-- -------------------------------------------------- ingest nonce registry --
-- Signed-ingest replay protection (P2-1; lifecycle fix round 2, P1-2):
-- one row per (owner, nonce), with a state machine. The old
-- receptionist_consume_ingest_nonce committed the nonce BEFORE the
-- ingest writes ran, so a failed delivery could never retry — an
-- identical retry was told "duplicate" while its records were missing.
-- The new RPCs split the lifecycle: claim (fresh / retry / committed /
-- hash_mismatch), complete (only after every write lands), fail (so an
-- identical retry re-runs the ingest). Same nonce + same hash retries
-- unfinished work; same nonce + different hash is rejected; a
-- committed replay returns the stored original result.
create table if not exists public.forge_rental_receptionist_ingest_nonces (
  owner_id uuid not null,
  nonce text not null,
  request_hash text not null,
  state text not null default 'IN_PROGRESS'
    check (state in ('IN_PROGRESS', 'COMMITTED', 'FAILED')),
  call_id uuid,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (owner_id, nonce)
);

alter table public.forge_rental_receptionist_ingest_nonces
  add column if not exists state text not null default 'IN_PROGRESS'
    check (state in ('IN_PROGRESS', 'COMMITTED', 'FAILED'));
alter table public.forge_rental_receptionist_ingest_nonces
  add column if not exists call_id uuid;
alter table public.forge_rental_receptionist_ingest_nonces
  add column if not exists result jsonb;
alter table public.forge_rental_receptionist_ingest_nonces
  add column if not exists updated_at timestamptz not null default now();

-- The pre-fix consume RPC is dropped: its commit-before-write semantics
-- are the P1-2 bug. Nothing calls it after this migration.
drop function if exists public.receptionist_consume_ingest_nonce(uuid, text, text);

create or replace function public.receptionist_claim_ingest_nonce(
  p_owner_id uuid, p_nonce text, p_request_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_row public.forge_rental_receptionist_ingest_nonces%rowtype;
  v_found boolean := false;
begin
  if p_owner_id is null or p_nonce is null or btrim(p_nonce) = '' then
    raise exception 'An owner id and a nonce are required.' using errcode = '22023';
  end if;
  delete from public.forge_rental_receptionist_ingest_nonces
    where expires_at <= now();
  -- One atomic claim: insert wins for a fresh nonce; on conflict the
  -- existing row decides. Two attempts cover a purge race.
  for _attempt in 1..2 loop
    insert into public.forge_rental_receptionist_ingest_nonces
      (owner_id, nonce, request_hash, expires_at)
      values (p_owner_id, p_nonce, coalesce(p_request_hash, ''), now() + interval '600 seconds')
      on conflict (owner_id, nonce) do nothing
      returning * into v_row;
    if found then
      return jsonb_build_object('status', 'fresh', 'call_id', null, 'result', null);
    end if;
    select * into v_row from public.forge_rental_receptionist_ingest_nonces
      where owner_id = p_owner_id and nonce = p_nonce;
    if found then
      v_found := true;
      exit;
    end if;
  end loop;
  if not v_found then
    raise exception 'Ingest nonce claim failed for an unknown reason.' using errcode = '55000';
  end if;
  if v_row.request_hash <> coalesce(p_request_hash, '') then
    return jsonb_build_object('status', 'hash_mismatch',
      'call_id', v_row.call_id, 'result', v_row.result);
  end if;
  if v_row.state = 'COMMITTED' then
    return jsonb_build_object('status', 'committed',
      'call_id', v_row.call_id, 'result', v_row.result);
  end if;
  -- IN_PROGRESS or FAILED with the same hash: retry the ingest. The
  -- writes are idempotent (call upsert, event dedupe, draft upsert),
  -- so a concurrent duplicate collapses onto the same records.
  return jsonb_build_object('status', 'retry',
    'call_id', v_row.call_id, 'result', null);
end;
$$;

create or replace function public.receptionist_complete_ingest_nonce(
  p_owner_id uuid, p_nonce text, p_request_hash text,
  p_call_id uuid, p_result jsonb
) returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  update public.forge_rental_receptionist_ingest_nonces
    set state = 'COMMITTED', call_id = p_call_id, result = p_result,
        expires_at = now() + interval '600 seconds', updated_at = now()
    where owner_id = p_owner_id and nonce = p_nonce
      and request_hash = coalesce(p_request_hash, '')
      and state in ('IN_PROGRESS', 'FAILED');
  return found;
end;
$$;

create or replace function public.receptionist_fail_ingest_nonce(
  p_owner_id uuid, p_nonce text, p_request_hash text
) returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  -- Only an in-flight nonce can fail. A COMMITTED nonce is never
  -- un-completed: its records already landed.
  update public.forge_rental_receptionist_ingest_nonces
    set state = 'FAILED', updated_at = now()
    where owner_id = p_owner_id and nonce = p_nonce
      and request_hash = coalesce(p_request_hash, '')
      and state = 'IN_PROGRESS';
  return found;
end;
$$;

-- ------------------------------------------------------------------ RLS ---
alter table public.forge_rental_receptionist_calls enable row level security;
alter table public.forge_rental_receptionist_calls force row level security;
alter table public.forge_rental_receptionist_events enable row level security;
alter table public.forge_rental_receptionist_events force row level security;
alter table public.forge_rental_receptionist_alerts enable row level security;
alter table public.forge_rental_receptionist_alerts force row level security;
alter table public.forge_rental_receptionist_alert_attempts enable row level security;
alter table public.forge_rental_receptionist_alert_attempts force row level security;
alter table public.forge_rental_receptionist_drafts enable row level security;
alter table public.forge_rental_receptionist_drafts force row level security;
alter table public.forge_rental_receptionist_delivery_outbox enable row level security;
alter table public.forge_rental_receptionist_delivery_outbox force row level security;
alter table public.forge_rental_receptionist_ingest_nonces enable row level security;
alter table public.forge_rental_receptionist_ingest_nonces force row level security;

-- Owner-scoped policies on the repo's proven predicate
-- has_workspace_access(owner_id): the primary owner, or an ACTIVE
-- co_owner member (auth.uid() based). Manager / bookkeeper / read-only
-- members can never satisfy it, and cross-owner rows are invisible.
-- Per-command policies: authenticated may SELECT every table and UPDATE
-- drafts (the review path) — nothing else. The service role bypasses
-- RLS, so its writes need no policy; relation ACLs are its only gate.
-- Each policy is created behind a pg_policies guard so re-applying this
-- migration is a no-op.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_rental_receptionist_calls' and policyname = 'receptionist_calls_owner_select') then
    create policy receptionist_calls_owner_select on public.forge_rental_receptionist_calls
      for select to authenticated using (public.has_workspace_access(owner_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_rental_receptionist_events' and policyname = 'receptionist_events_owner_select') then
    create policy receptionist_events_owner_select on public.forge_rental_receptionist_events
      for select to authenticated using (public.has_workspace_access(owner_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_rental_receptionist_alerts' and policyname = 'receptionist_alerts_owner_select') then
    create policy receptionist_alerts_owner_select on public.forge_rental_receptionist_alerts
      for select to authenticated using (public.has_workspace_access(owner_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_rental_receptionist_alert_attempts' and policyname = 'receptionist_alert_attempts_owner_select') then
    create policy receptionist_alert_attempts_owner_select on public.forge_rental_receptionist_alert_attempts
      for select to authenticated using (public.has_workspace_access(owner_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_rental_receptionist_drafts' and policyname = 'receptionist_drafts_owner_select') then
    create policy receptionist_drafts_owner_select on public.forge_rental_receptionist_drafts
      for select to authenticated using (public.has_workspace_access(owner_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_rental_receptionist_drafts' and policyname = 'receptionist_drafts_owner_update') then
    create policy receptionist_drafts_owner_update on public.forge_rental_receptionist_drafts
      for update to authenticated using (public.has_workspace_access(owner_id))
      with check (public.has_workspace_access(owner_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_rental_receptionist_delivery_outbox' and policyname = 'receptionist_outbox_owner_select') then
    create policy receptionist_outbox_owner_select on public.forge_rental_receptionist_delivery_outbox
      for select to authenticated using (public.has_workspace_access(owner_id));
  end if;
end $$;

-- --------------------------------------------------------------- grants ---
-- Close the Supabase default-grant hole explicitly, then grant the minimum.
-- The ingestion service role inserts calls/events/drafts/alerts, updates
-- calls (upsert conflict leg + maintenance_draft_id) and drafts/outbox,
-- and consumes ingest nonces; review actions run as the authenticated
-- owner via RLS (SELECT everywhere, UPDATE on drafts only).
revoke all on public.forge_rental_receptionist_calls from public, anon, authenticated, service_role;
revoke all on public.forge_rental_receptionist_events from public, anon, authenticated, service_role;
revoke all on public.forge_rental_receptionist_alerts from public, anon, authenticated, service_role;
revoke all on public.forge_rental_receptionist_alert_attempts from public, anon, authenticated, service_role;
revoke all on public.forge_rental_receptionist_drafts from public, anon, authenticated, service_role;
revoke all on public.forge_rental_receptionist_delivery_outbox from public, anon, authenticated, service_role;
revoke all on public.forge_rental_receptionist_ingest_nonces from public, anon, authenticated, service_role;
revoke all on function public.forge_rental_receptionist_events_append_only() from public;
revoke all on function public.receptionist_claim_ingest_nonce(uuid, text, text) from public;
revoke all on function public.receptionist_complete_ingest_nonce(uuid, text, text, uuid, jsonb) from public;
revoke all on function public.receptionist_fail_ingest_nonce(uuid, text, text) from public;
-- The append-only trigger must be able to FIRE for the roles that might
-- ever hold UPDATE on events: without EXECUTE it would fail with a bare
-- 42501 instead of the append-only message. The function only raises,
-- so granting EXECUTE to the two application roles is safe.
grant execute on function public.forge_rental_receptionist_events_append_only() to service_role, authenticated;

-- service_role needs UPDATE on calls: the ingest upsert's conflict leg
-- and the maintenance_draft_id update both write an existing call row.
grant select, insert, update on public.forge_rental_receptionist_calls to service_role;
grant select, insert on public.forge_rental_receptionist_events to service_role;
grant select, insert on public.forge_rental_receptionist_alerts to service_role;
grant select, insert on public.forge_rental_receptionist_alert_attempts to service_role;
grant select, insert, update on public.forge_rental_receptionist_drafts to service_role;
grant select, insert, update on public.forge_rental_receptionist_delivery_outbox to service_role;
grant select, insert, delete on public.forge_rental_receptionist_ingest_nonces to service_role;
grant execute on function public.receptionist_claim_ingest_nonce(uuid, text, text) to service_role;
grant execute on function public.receptionist_complete_ingest_nonce(uuid, text, text, uuid, jsonb) to service_role;
grant execute on function public.receptionist_fail_ingest_nonce(uuid, text, text) to service_role;

-- authenticated: SELECT everywhere, UPDATE on drafts only. No direct
-- browser/client writes to calls, events, alerts, attempts or outbox.
grant select on public.forge_rental_receptionist_calls to authenticated;
grant select on public.forge_rental_receptionist_events to authenticated;
grant select on public.forge_rental_receptionist_alerts to authenticated;
grant select on public.forge_rental_receptionist_alert_attempts to authenticated;
grant select, update on public.forge_rental_receptionist_drafts to authenticated;
grant select on public.forge_rental_receptionist_delivery_outbox to authenticated;

-- No UPDATE/DELETE grant on events for anyone: append-only at the ACL layer too.
-- No grants at all on the nonce registry for authenticated: nonces are a
-- service-side concern and invisible to browser clients.
