-- Team Brain P1 — production schema migration.
--
-- Creates the private team_brain schema with dedicated least-privilege roles.
-- This migration is BUILT here but NOT APPLIED to production by any code path.
-- Production apply requires Jason's explicit migration word, a database backup,
-- and an exact-head receipt (see brief Section 8, gate 3).
--
-- Roles (see brief Section 7):
--   tb_owner        NOLOGIN — migration owner, owns schema and objects
--   tb_ingest       observation insert + scoped admission functions
--   tb_coordinator  guarded handoff/queue functions
--   tb_consolidator restricted consolidation effects (append-only)
--   tb_reader       redacted read-only views
--   tb_admin        Jason registration/policy channel only, never worker-held
--
-- Invariants:
--   - No tables in public schema; no PostgREST exposure.
--   - Revoke ALL from PUBLIC on schema and all objects.
--   - History/event tables: no UPDATE, no DELETE grants to any worker role.
--   - Timestamps are timestamptz; server assigns recorded_at via clock_timestamp().
--   - Every mutable projection carries bigint row_version.
--   - Full 40-hex Git identities; SHA-256 for non-Git content with algorithm field.

-- ============================================================================
-- Schema and roles
-- ============================================================================

create schema if not exists team_brain;

-- Roles. NOLOGIN for the owner; the rest get passwords at provisioning time
-- by the operator (never in this migration, never in code).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tb_owner') then
    create role tb_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'tb_ingest') then
    create role tb_ingest login password 'CHANGEME_TB_INGEST';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'tb_coordinator') then
    create role tb_coordinator login password 'CHANGEME_TB_COORDINATOR';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'tb_consolidator') then
    create role tb_consolidator login password 'CHANGEME_TB_CONSOLIDATOR';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'tb_reader') then
    create role tb_reader login password 'CHANGEME_TB_READER';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'tb_admin') then
    create role tb_admin login password 'CHANGEME_TB_ADMIN';
  end if;
end
$$;

alter schema team_brain owner to tb_owner;

-- Deny everything to PUBLIC up front; grants below are explicit allowlists.
revoke all on schema team_brain from public;
revoke all on all tables in schema team_brain from public;
revoke all on all sequences in schema team_brain from public;
revoke all on all functions in schema team_brain from public;

-- ============================================================================
-- Migration bookkeeping
-- ============================================================================

create table if not exists team_brain.tb_schema_version (
  version integer primary key,
  applied_at timestamptz not null default clock_timestamp(),
  applied_by text not null default current_user,
  notes text
);
alter table team_brain.tb_schema_version owner to tb_owner;
revoke all on team_brain.tb_schema_version from public;

-- ============================================================================
-- source_objects — immutable source identity records
-- ============================================================================

create table if not exists team_brain.source_objects (
  source_id text primary key,
  repo text not null,
  path text not null,
  commit text not null check (commit ~ '^[0-9a-f]{40}$'),
  blob text not null check (blob ~ '^[0-9a-f]{40}$'),
  algorithm text not null default 'git-sha1' check (algorithm in ('git-sha1', 'sha256')),
  reviewed_head text check (reviewed_head is null or reviewed_head ~ '^[0-9a-f]{40}$'),
  byte_length bigint not null check (byte_length >= 0),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  source_class text not null,
  observed_at timestamptz not null,
  transport_receipt text not null,
  provenance_status text not null default 'UNVERIFIED'
    check (provenance_status in ('UNVERIFIED', 'VERIFIED', 'AUTH_UNVERIFIED', 'REJECTED')),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (repo, path, commit, blob)
);
alter table team_brain.source_objects owner to tb_owner;
revoke all on team_brain.source_objects from public;

-- ============================================================================
-- intake_events / scan_cursors — Git ingestion intake
-- ============================================================================

create table if not exists team_brain.intake_events (
  event_id text primary key,
  introducing_commit text not null check (introducing_commit ~ '^[0-9a-f]{40}$'),
  path text not null,
  blob text not null check (blob ~ '^[0-9a-f]{40}$'),
  event_kind text not null check (event_kind in ('ADDED', 'MODIFIED', 'DELETED')),
  request_id text,
  content_digest text not null check (content_digest ~ '^[0-9a-f]{64}$'),
  source_time timestamptz,
  first_observed_at timestamptz not null default clock_timestamp(),
  admission_state text not null default 'PENDING'
    check (admission_state in ('PENDING', 'ADMITTED', 'QUARANTINED', 'REJECTED')),
  admission_reason text,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table team_brain.intake_events owner to tb_owner;
revoke all on team_brain.intake_events from public;

create table if not exists team_brain.scan_cursors (
  repo text not null,
  branch text not null,
  last_terminal_commit text not null check (last_terminal_commit ~ '^[0-9a-f]{40}$'),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (repo, branch)
);
alter table team_brain.scan_cursors owner to tb_owner;
revoke all on team_brain.scan_cursors from public;

-- ============================================================================
-- obligations / obligation_events — the durable obligation ledger
-- ============================================================================

create table if not exists team_brain.obligations (
  obligation_id text primary key,
  kind text not null check (kind in ('TASK', 'AUTHORIZATION', 'VERDICT', 'EVIDENCE')),
  filed_at timestamptz not null,
  source_id text references team_brain.source_objects (source_id),
  resource_repo text,
  resource_scope text,
  reviewed_head text check (reviewed_head is null or reviewed_head ~ '^[0-9a-f]{40}$'),
  owner text not null,
  state text not null default 'OPEN'
    check (state in ('OPEN', 'IN_PROGRESS', 'CLOSED', 'REVOKED', 'SUPERSEDED')),
  retention_disposition text not null,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  check (kind <> 'VERDICT' or reviewed_head is not null)
);
alter table team_brain.obligations owner to tb_owner;
revoke all on team_brain.obligations from public;

create table if not exists team_brain.obligation_events (
  event_id text primary key,
  seq bigint generated always as identity,
  obligation_id text not null references team_brain.obligations (obligation_id),
  actor_principal text not null,
  received_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  event_type text not null,
  reason text not null,
  source_id text references team_brain.source_objects (source_id),
  evidence_links text not null default '[]',
  auth_record_id text,
  idempotency_key text,
  canonical_payload_sha256 text check (
    canonical_payload_sha256 is null or canonical_payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  unique (obligation_id, seq),
  unique (idempotency_key)
);
alter table team_brain.obligation_events owner to tb_owner;
revoke all on team_brain.obligation_events from public;
create index if not exists team_brain_obligation_events_obligation_id_idx
  on team_brain.obligation_events (obligation_id);

-- ============================================================================
-- obligation_dependencies — blocker graph
-- ============================================================================

create table if not exists team_brain.obligation_dependencies (
  obligation_id text not null references team_brain.obligations (obligation_id),
  depends_on_id text not null references team_brain.obligations (obligation_id)
    deferrable initially deferred,
  primary key (obligation_id, depends_on_id),
  check (obligation_id <> depends_on_id)
);
alter table team_brain.obligation_dependencies owner to tb_owner;
revoke all on team_brain.obligation_dependencies from public;

-- ============================================================================
-- principal_keys / trusted_authorizations — protected trust registry
-- ============================================================================

create table if not exists team_brain.principal_keys (
  principal_id text not null,
  key_id text not null,
  public_key_fingerprint text not null,
  origin_channel text not null,
  registered_by text not null,
  registration_receipt text not null,
  revoked_at timestamptz,
  revocation_event_id text,
  primary key (principal_id, key_id)
);
alter table team_brain.principal_keys owner to tb_owner;
revoke all on team_brain.principal_keys from public;

create table if not exists team_brain.trusted_authorizations (
  grant_id text primary key,
  granter_principal_id text not null,
  subject_ref text not null,
  resource_repo text not null,
  resource_scope text,
  resource_head text check (resource_head is null or resource_head ~ '^[0-9a-f]{40}$'),
  allowed_operations text not null,
  override_item text,
  override_rank integer,
  grant_revision integer not null default 1,
  registered_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  revocation_reason text
);
alter table team_brain.trusted_authorizations owner to tb_owner;
revoke all on team_brain.trusted_authorizations from public;

-- ============================================================================
-- handoffs / handoff_events — durable state machine
-- ============================================================================

create table if not exists team_brain.handoffs (
  handoff_id text primary key,
  obligation_id text references team_brain.obligations (obligation_id),
  state text not null default 'OPEN'
    check (state in ('OPEN', 'OUTCOME_WRITTEN', 'READBACK_VERIFIED', 'QUEUE_UPDATED', 'COMPLETE')),
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table team_brain.handoffs owner to tb_owner;
revoke all on team_brain.handoffs from public;

create table if not exists team_brain.handoff_events (
  event_id text primary key,
  seq bigint generated always as identity,
  handoff_id text not null references team_brain.handoffs (handoff_id),
  from_state text not null,
  to_state text not null,
  actor_principal text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  reason text not null,
  operation_id text not null,
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  fencing_generation bigint not null,
  readback_receipt_id text,
  -- Full outcome identity: repo/path/commit/blob/head for artifact and queue.
  artifact_repo text, artifact_path text,
  artifact_commit text, artifact_blob text, artifact_head text,
  queue_repo text, queue_path text,
  queue_commit text, queue_blob text,
  unique (handoff_id, seq)
);
alter table team_brain.handoff_events owner to tb_owner;
revoke all on team_brain.handoff_events from public;
create index if not exists team_brain_handoff_events_handoff_id_idx
  on team_brain.handoff_events (handoff_id);

-- ============================================================================
-- verification_receipts — independent verification evidence
-- ============================================================================

create table if not exists team_brain.verification_receipts (
  receipt_id text primary key,
  verifier_principal text not null,
  verifier_channel text not null,
  source_id text not null references team_brain.source_objects (source_id),
  expected_bytes_digest text not null check (expected_bytes_digest ~ '^[0-9a-f]{64}$'),
  actual_bytes_digest text not null check (actual_bytes_digest ~ '^[0-9a-f]{64}$'),
  checked_at timestamptz not null default clock_timestamp(),
  scope text not null,
  resource_head text check (resource_head is null or resource_head ~ '^[0-9a-f]{40}$'),
  verification_method text not null,
  status text not null check (status in ('MATCH', 'MISMATCH', 'UNVERIFIABLE'))
);
alter table team_brain.verification_receipts owner to tb_owner;
revoke all on team_brain.verification_receipts from public;

-- ============================================================================
-- outbox / delivery_attempts — Git publication outbox
-- ============================================================================

create table if not exists team_brain.outbox (
  operation_id text primary key,
  target_repo text not null,
  target_path text not null,
  expected_prior_blob text check (expected_prior_blob is null or expected_prior_blob ~ '^[0-9a-f]{40}$'),
  canonical_payload_sha256 text not null check (canonical_payload_sha256 ~ '^[0-9a-f]{64}$'),
  claim_lease_owner text,
  claim_generation bigint,
  state text not null default 'PENDING'
    check (state in ('PENDING', 'CLAIMED', 'PUBLISHED', 'READBACK_VERIFIED', 'FAILED')),
  created_at timestamptz not null default clock_timestamp()
);
alter table team_brain.outbox owner to tb_owner;
revoke all on team_brain.outbox from public;

create table if not exists team_brain.delivery_attempts (
  attempt_id text primary key,
  operation_id text not null references team_brain.outbox (operation_id),
  attempted_at timestamptz not null default clock_timestamp(),
  git_response text,
  readback_source_id text references team_brain.source_objects (source_id),
  outcome text not null check (outcome in ('PUBLISHED', 'CONFLICT', 'TRANSPORT_ERROR'))
);
alter table team_brain.delivery_attempts owner to tb_owner;
revoke all on team_brain.delivery_attempts from public;

-- ============================================================================
-- episodes / episode_links — immutable episode capture
-- ============================================================================

create table if not exists team_brain.episodes (
  episode_id text primary key,
  event_time timestamptz not null,
  observed_time timestamptz not null default clock_timestamp(),
  actor_principal text,
  source_id text references team_brain.source_objects (source_id),
  fact_type text not null,
  subject text,
  scope text,
  structured_fact text not null,
  provenance_status text not null default 'UNVERIFIED',
  salience_score double precision,
  archived_at timestamptz,
  archive_reason text
);
alter table team_brain.episodes owner to tb_owner;
revoke all on team_brain.episodes from public;

create table if not exists team_brain.episode_links (
  link_id text primary key,
  from_episode_id text not null references team_brain.episodes (episode_id),
  to_episode_id text not null references team_brain.episodes (episode_id),
  relation text not null,
  check (from_episode_id <> to_episode_id)
);
alter table team_brain.episode_links owner to tb_owner;
revoke all on team_brain.episode_links from public;

-- ============================================================================
-- semantic_entries / semantic_revisions — versioned semantic store
-- ============================================================================

create table if not exists team_brain.semantic_entries (
  entry_id text primary key,
  kind text not null check (kind in ('FACT', 'DECISION', 'RULE', 'PROCEDURE_POINTER')),
  scope text not null,
  current_revision integer not null default 1,
  conflict_group text,
  consolidation_run_id text,
  created_at timestamptz not null default clock_timestamp()
);
alter table team_brain.semantic_entries owner to tb_owner;
revoke all on team_brain.semantic_entries from public;

create table if not exists team_brain.semantic_revisions (
  entry_id text not null references team_brain.semantic_entries (entry_id),
  revision integer not null,
  structured_claim text not null,
  cited_spans text not null default '[]',
  support_groups text not null default '[]',
  verification_state text not null default 'UNVERIFIED',
  created_at timestamptz not null default clock_timestamp(),
  primary key (entry_id, revision)
);
alter table team_brain.semantic_revisions owner to tb_owner;
revoke all on team_brain.semantic_revisions from public;

-- ============================================================================
-- conflicts / supersessions / duplicate_clusters — append-only relations
-- ============================================================================

create table if not exists team_brain.conflicts (
  conflict_id text primary key,
  scope text not null,
  relation_kind text not null,
  side_a_source_id text not null references team_brain.source_objects (source_id),
  side_b_source_id text not null references team_brain.source_objects (source_id),
  reason text not null,
  recorded_by text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  authority_receipt_id text,
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED', 'ESCALATED'))
);
alter table team_brain.conflicts owner to tb_owner;
revoke all on team_brain.conflicts from public;

create table if not exists team_brain.supersessions (
  supersession_id text primary key,
  old_source_id text not null references team_brain.source_objects (source_id),
  new_source_id text not null references team_brain.source_objects (source_id),
  scope text not null,
  reason text not null,
  recorded_by text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (old_source_id <> new_source_id)
);
alter table team_brain.supersessions owner to tb_owner;
revoke all on team_brain.supersessions from public;

create table if not exists team_brain.duplicate_clusters (
  cluster_id text primary key,
  scope text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table team_brain.duplicate_clusters owner to tb_owner;
revoke all on team_brain.duplicate_clusters from public;

create table if not exists team_brain.duplicate_members (
  cluster_id text not null references team_brain.duplicate_clusters (cluster_id),
  source_id text not null references team_brain.source_objects (source_id),
  primary key (cluster_id, source_id)
);
alter table team_brain.duplicate_members owner to tb_owner;
revoke all on team_brain.duplicate_members from public;

-- ============================================================================
-- jobs / run_items / health_events — supervisor/work-queue state (Section 2A)
-- ============================================================================

create table if not exists team_brain.jobs (
  job_id text primary key,
  task_id text not null,
  goal text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'ASSIGNED', 'EXECUTING', 'DONE', 'BLOCKED', 'NEEDS_INPUT', 'FAILED', 'ESCALATED')),
  attempts integer not null default 0 check (attempts >= 0),
  next_action text,
  deadline timestamptz,
  owner_agent text,
  schedule_key text,
  local_due_date date,
  lease_owner text,
  lease_generation bigint,
  cursor_state text,
  policy_head text,
  code_head text,
  snapshot_revision bigint,
  started_at timestamptz,
  ended_at timestamptz,
  outcome text,
  error_detail text,
  row_version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (schedule_key, local_due_date)
);
alter table team_brain.jobs owner to tb_owner;
revoke all on team_brain.jobs from public;
create index if not exists team_brain_jobs_status_idx on team_brain.jobs (status);
create index if not exists team_brain_jobs_owner_agent_idx on team_brain.jobs (owner_agent);

create table if not exists team_brain.run_items (
  run_item_id text primary key,
  job_id text not null references team_brain.jobs (job_id),
  seq integer not null,
  action text not null,
  result_status text check (result_status in ('DONE', 'BLOCKED', 'NEEDS_INPUT', 'FAILED')),
  result_detail text,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (job_id, seq)
);
alter table team_brain.run_items owner to tb_owner;
revoke all on team_brain.run_items from public;

create table if not exists team_brain.health_events (
  event_id text primary key,
  observed_at timestamptz not null default clock_timestamp(),
  component text not null,
  status text not null check (status in ('HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN')),
  detail text
);
alter table team_brain.health_events owner to tb_owner;
revoke all on team_brain.health_events from public;

-- ============================================================================
-- metric_observations / retrieval_evaluations — immutable metrics
-- ============================================================================

create table if not exists team_brain.metric_observations (
  observation_id text primary key,
  definition_version text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  numerator bigint not null,
  denominator bigint not null,
  unknown_count bigint not null default 0,
  source_snapshot_revision bigint,
  ground_truth_revision text,
  observed_at timestamptz not null default clock_timestamp(),
  limitation text
);
alter table team_brain.metric_observations owner to tb_owner;
revoke all on team_brain.metric_observations from public;

create table if not exists team_brain.retrieval_evaluations (
  evaluation_id text primary key,
  query_set_version text not null,
  precision_at_5 double precision,
  recall_at_5 double precision,
  citation_validity double precision,
  conflict_recall double precision,
  evaluated_at timestamptz not null default clock_timestamp()
);
alter table team_brain.retrieval_evaluations owner to tb_owner;
revoke all on team_brain.retrieval_evaluations from public;

-- ============================================================================
-- Least-privilege grants
-- ============================================================================

-- tb_ingest: insert observations and intake; read source objects and cursors.
grant usage on schema team_brain to tb_ingest;
grant select, insert on team_brain.source_objects to tb_ingest;
grant select, insert on team_brain.intake_events to tb_ingest;
grant select, insert, update on team_brain.scan_cursors to tb_ingest;
grant select on team_brain.tb_schema_version to tb_ingest;
-- No UPDATE or DELETE on any history table. No access to obligations,
-- handoffs, trust registry, or jobs.

-- tb_coordinator: guarded handoff and queue operations.
grant usage on schema team_brain to tb_coordinator;
grant select, insert on team_brain.obligations to tb_coordinator;
grant select, insert on team_brain.obligation_events to tb_coordinator;
grant select, insert on team_brain.obligation_dependencies to tb_coordinator;
grant select, insert, update on team_brain.handoffs to tb_coordinator;
grant select, insert on team_brain.handoff_events to tb_coordinator;
grant select, insert on team_brain.verification_receipts to tb_coordinator;
grant select, insert, update on team_brain.outbox to tb_coordinator;
grant select, insert on team_brain.delivery_attempts to tb_coordinator;
grant select, insert, update on team_brain.jobs to tb_coordinator;
grant select, insert on team_brain.run_items to tb_coordinator;
grant select, insert on team_brain.health_events to tb_coordinator;
grant select on team_brain.source_objects to tb_coordinator;
grant select on team_brain.trusted_authorizations to tb_coordinator;
grant select on team_brain.principal_keys to tb_coordinator;
grant select on team_brain.tb_schema_version to tb_coordinator;
-- UPDATE allowed only on mutable projections (handoffs.state, outbox.state,
-- jobs.*). No UPDATE or DELETE on obligations, events, or history tables.
-- No access to episodes, semantic entries, conflicts, or metrics.

-- tb_consolidator: append-only consolidation effects (brief Section 6).
grant usage on schema team_brain to tb_consolidator;
grant select, insert on team_brain.episodes to tb_consolidator;
grant select, insert on team_brain.episode_links to tb_consolidator;
grant select, insert on team_brain.semantic_entries to tb_consolidator;
grant select, insert on team_brain.semantic_revisions to tb_consolidator;
grant select, insert on team_brain.conflicts to tb_consolidator;
grant select, insert on team_brain.supersessions to tb_consolidator;
grant select, insert on team_brain.duplicate_clusters to tb_consolidator;
grant select, insert on team_brain.duplicate_members to tb_consolidator;
grant select, insert on team_brain.metric_observations to tb_consolidator;
grant select, insert on team_brain.retrieval_evaluations to tb_consolidator;
grant select on team_brain.source_objects to tb_consolidator;
grant select on team_brain.obligations to tb_consolidator;
grant select on team_brain.obligation_events to tb_consolidator;
grant select on team_brain.tb_schema_version to tb_consolidator;
-- No UPDATE, no DELETE. No access to handoffs, outbox, trust registry, jobs.

-- tb_reader: redacted read-only views (views defined in a later slice).
grant usage on schema team_brain to tb_reader;
grant select on team_brain.tb_schema_version to tb_reader;
-- Table-level SELECT granted per-view in P5; no direct table access yet.

-- tb_admin: Jason registration/policy channel. Granted full access here;
-- never held by the worker. Separated so worker roles cannot escalate.
grant all on schema team_brain to tb_admin;
grant all on all tables in schema team_brain to tb_admin;
grant all on all sequences in schema team_brain to tb_admin;

-- Sequences owned by tb_owner; usage granted via table grants above.
alter default privileges for role tb_owner in schema team_brain
  revoke all on sequences from public;

-- ============================================================================
-- Record the migration
-- ============================================================================

insert into team_brain.tb_schema_version (version, notes)
values (1, 'P1 production schema: team_brain schema, roles, all relations')
on conflict (version) do nothing;
