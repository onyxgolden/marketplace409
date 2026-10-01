-- Tenant screening workflow (Rentec parity R22, free layer).
-- AUTHORED, NOT APPLIED. Jason applies migrations.
--
-- DEPENDENCY: requires R21's 20261001030000_rental_listings_applications.sql
-- (rental_applications) to be applied first — PR #526. Migration timestamps
-- order R21 before R22, so a normal forward apply is safe.
--
-- Free layer (this migration):
--   * rental_application_screenings: one screening workflow row per
--     application — status machine (not_requested → requested → in_progress
--     → complete), consent verification, MANUALLY recorded results
--     (credit score/band, criminal + eviction flags with notes), a
--     recommendation, and a tokenized applicant link. No provider is
--     connected: provider_status is always 'not_connected'.
--   * rental_screening_events: append-only audit of every screening action.
--   * rental_screening_public_attempts: DB-backed per-token/per-IP attempt
--     log so the applicant link's rate limit survives serverless restarts.
--
-- Explicitly OUT of this slice: integrated screening reports (TransUnion /
-- Experian / etc.). Pulling a report costs a per-report fee and needs
-- Jason's word on provider, cost, and who pays — see
-- src/domains/rental-screening/SCREENING_GATE.md. Nothing in this slice
-- calls a screening provider.
--
-- Security model: RLS forced; all policies gated on
-- has_workspace_access(owner_id) (the workspace pattern). The applicant's
-- no-login link goes through the service-role client in the API route
-- layer, scoped to a single screening's random token — RLS still denies
-- anon/authenticated. The read-only-member restriction (owner/co-owner
-- write, read-only 403) is enforced in the API route layer via
-- getActiveWorkspaceRole, matching the R6 message-templates route — RLS
-- cannot see that role distinction.
--
-- Additive only: no existing table is changed.

create table if not exists rental_application_screenings (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  application_id text not null,
  -- Status machine: not_requested → requested → in_progress → complete.
  -- A row is created when the owner requests screening; the machine is
  -- enforced in the domain layer (src/domains/rental-screening/screening.js)
  -- and re-checked in the route layer. Consent must be recorded on the
  -- application (R21's answers.consent) before a request is accepted —
  -- the route fails closed without it.
  status text not null default 'not_requested'
    check (status in ('not_requested', 'requested', 'in_progress', 'complete')),
  -- Random 24-char token: the applicant's no-login link
  -- (/rentals/screening/<token>). Never the application id.
  screening_token text not null,
  -- Consent: R21 collects it on the application form; the applicant link
  -- re-confirms it when they provide their screening info.
  consent_verified_on_application boolean not null default false,
  consent_recorded boolean not null default false,
  consent_recorded_at timestamptz,
  consent_text_shown text,
  requested_by text,
  requested_at timestamptz,
  -- Provider integration: always 'not_connected' in this slice. The column
  -- exists so a future connected provider has somewhere to report status;
  -- nothing may write another value without Jason's approval.
  provider_status text not null default 'not_connected'
    check (provider_status = 'not_connected'),
  provider_key text,
  -- Manual results: the owner runs screening elsewhere (or reads a report
  -- the applicant paid for) and records the outcome here.
  credit_score integer check (credit_score is null or (credit_score between 300 and 850)),
  credit_band text check (credit_band is null or credit_band in ('poor', 'fair', 'good', 'very_good', 'excellent')),
  criminal_flag boolean not null default false,
  criminal_notes text,
  eviction_flag boolean not null default false,
  eviction_notes text,
  -- Info the applicant provided through the tokenized link (no-login).
  applicant_provided jsonb not null default '{}'::jsonb,
  -- Decision support: the owner's recorded recommendation + reasons. The
  -- actual approve/deny still goes through R21's decision endpoint — this
  -- slice never decides on its own.
  recommendation text check (recommendation is null or recommendation in ('approve', 'conditional', 'deny')),
  recommendation_reasons text,
  results_recorded_by text,
  results_recorded_at timestamptz,
  completed_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, screening_token),
  foreign key (owner_id, application_id) references rental_applications(owner_id, id) on delete cascade
);

-- One active screening per application: a second request while one is open
-- is rejected in the route layer (409); this index makes it impossible in
-- the database too.
create unique index if not exists idx_rental_screenings_owner_application_active
  on rental_application_screenings(owner_id, application_id)
  where status in ('requested', 'in_progress');

create index if not exists idx_rental_screenings_owner_status
  on rental_application_screenings(owner_id, status);
create index if not exists idx_rental_screenings_token
  on rental_application_screenings(screening_token);

-- Append-only audit: every screening action is logged with its actor.
-- actor_user_id is null when the applicant acted through the no-login link.
create table if not exists rental_screening_events (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  screening_id text not null,
  application_id text not null,
  event text not null check (event in (
    'requested', 'marked_in_progress', 'consent_recorded',
    'applicant_info_received', 'results_recorded', 'recommendation_set',
    'provider_attempt_blocked', 'completed', 'token_regenerated'
  )),
  actor_user_id text,
  note text,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, screening_id) references rental_application_screenings(owner_id, id) on delete cascade,
  foreign key (owner_id, application_id) references rental_applications(owner_id, id) on delete cascade
);

create index if not exists idx_rental_screening_events_screening
  on rental_screening_events(owner_id, screening_id, created_at);

-- Public-link attempt log: written by the service-role public route, never
-- by workspace members — no member policies at all.
create table if not exists rental_screening_public_attempts (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  screening_token text not null,
  ip_hash text not null,
  attempted_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create index if not exists idx_rental_screening_public_attempts_guard
  on rental_screening_public_attempts(owner_id, screening_token, ip_hash, attempted_at desc);

-- RLS: forced on, workspace-access policies, explicit grants (R6 pattern).

alter table rental_application_screenings enable row level security;
alter table rental_application_screenings force row level security;
alter table rental_screening_events enable row level security;
alter table rental_screening_events force row level security;
alter table rental_screening_public_attempts enable row level security;
alter table rental_screening_public_attempts force row level security;

drop policy if exists "rental_application_screenings_owner_select" on rental_application_screenings;
create policy "rental_application_screenings_owner_select" on rental_application_screenings for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_application_screenings_owner_insert" on rental_application_screenings;
create policy "rental_application_screenings_owner_insert" on rental_application_screenings for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_application_screenings_owner_update" on rental_application_screenings;
create policy "rental_application_screenings_owner_update" on rental_application_screenings for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_application_screenings_owner_delete" on rental_application_screenings;
create policy "rental_application_screenings_owner_delete" on rental_application_screenings for delete to authenticated
  using (has_workspace_access(owner_id));

-- Audit rows are append-only: members may read and write them, never
-- update or delete.
drop policy if exists "rental_screening_events_owner_select" on rental_screening_events;
create policy "rental_screening_events_owner_select" on rental_screening_events for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_screening_events_owner_insert" on rental_screening_events;
create policy "rental_screening_events_owner_insert" on rental_screening_events for insert to authenticated
  with check (has_workspace_access(owner_id));

revoke all on rental_application_screenings from anon, authenticated;
grant select, insert, update, delete on rental_application_screenings to authenticated;
revoke all on rental_screening_events from anon, authenticated;
grant select, insert on rental_screening_events to authenticated;
revoke all on rental_screening_public_attempts from anon, authenticated;
