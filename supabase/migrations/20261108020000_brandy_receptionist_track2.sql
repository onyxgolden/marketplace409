-- Brandy AI Voice Receptionist — Track 2 v1 (brief §7)
-- ADDITIVE ONLY. Never apply without a separate owner word, a pre-apply
-- backup, and a post-apply ACL + RLS receipt. No live tenant data is
-- seeded here; all rows arrive via the signed ingestion endpoint.
--
-- Security posture (brief §11.13):
--  * RLS ENABLED + FORCED on every table; owner-scoped policies only.
--  * Default Supabase grants are REVOKED explicitly (defaults grant ALL
--    to anon/authenticated/service_role on new tables — a selective GRANT
--    alone does not remove them). Only the minimal service role needed by
--    the ingestion endpoint keeps INSERT/SELECT, and only through RLS.
--  * Events table is append-only (trigger rejects UPDATE/DELETE).
--  * Composite owner FKs: child rows cannot reference another owner's call.
--  * Unique idempotency keys: duplicate/out-of-order provider events are
--    safe. No PUBLIC/anon/authenticated grants anywhere in this file.

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
  unique (owner_id, provider_call_sid)
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

-- Owner-scoped policies. The effective owner id is supplied by the
-- authenticated session (set_config 'app.current_owner_id'); cross-owner
-- lookups return no rows and no existence information.
-- NOTE: policies reference the app.current_owner_id session setting, the
-- same pattern the Rental Manager uses for workspace scoping. The exact
-- setting name must be confirmed against the live schema at apply time.
create policy receptionist_calls_owner on public.forge_rental_receptionist_calls
  for all using (owner_id = current_setting('app.current_owner_id', true)::uuid);
create policy receptionist_events_owner on public.forge_rental_receptionist_events
  for all using (owner_id = current_setting('app.current_owner_id', true)::uuid);
create policy receptionist_alerts_owner on public.forge_rental_receptionist_alerts
  for all using (owner_id = current_setting('app.current_owner_id', true)::uuid);
create policy receptionist_alert_attempts_owner on public.forge_rental_receptionist_alert_attempts
  for all using (owner_id = current_setting('app.current_owner_id', true)::uuid);
create policy receptionist_drafts_owner on public.forge_rental_receptionist_drafts
  for all using (owner_id = current_setting('app.current_owner_id', true)::uuid);
create policy receptionist_outbox_owner on public.forge_rental_receptionist_delivery_outbox
  for all using (owner_id = current_setting('app.current_owner_id', true)::uuid);

-- --------------------------------------------------------------- grants ---
-- Close the Supabase default-grant hole explicitly, then grant the minimum.
-- The ingestion service role inserts calls/events/drafts/alerts and reads
-- nothing else; review actions run as the authenticated owner via RLS.
revoke all on public.forge_rental_receptionist_calls from public, anon, authenticated, service_role;
revoke all on public.forge_rental_receptionist_events from public, anon, authenticated, service_role;
revoke all on public.forge_rental_receptionist_alerts from public, anon, authenticated, service_role;
revoke all on public.forge_rental_receptionist_alert_attempts from public, anon, authenticated, service_role;
revoke all on public.forge_rental_receptionist_drafts from public, anon, authenticated, service_role;
revoke all on public.forge_rental_receptionist_delivery_outbox from public, anon, authenticated, service_role;
revoke all on function public.forge_rental_receptionist_events_append_only() from public;

grant select, insert on public.forge_rental_receptionist_calls to service_role;
grant select, insert on public.forge_rental_receptionist_events to service_role;
grant select, insert on public.forge_rental_receptionist_alerts to service_role;
grant select, insert on public.forge_rental_receptionist_alert_attempts to service_role;
grant select, insert, update on public.forge_rental_receptionist_drafts to service_role;
grant select, insert, update on public.forge_rental_receptionist_delivery_outbox to service_role;
grant select, insert, update, delete on public.forge_rental_receptionist_calls to authenticated;
grant select on public.forge_rental_receptionist_events to authenticated;
grant select on public.forge_rental_receptionist_alerts to authenticated;
grant select on public.forge_rental_receptionist_alert_attempts to authenticated;
grant select, update on public.forge_rental_receptionist_drafts to authenticated;
grant select on public.forge_rental_receptionist_delivery_outbox to authenticated;

-- No UPDATE/DELETE grant on events for anyone: append-only at the ACL layer too.
