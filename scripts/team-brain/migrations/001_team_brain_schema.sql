-- Team Brain slice 1 — durable obligation ledger schema (local PGlite only).
-- Versioned migration. This file is the schema's single source of truth;
-- migrations/schema.snapshot.md is generated from it and verified by test.
-- No production migration, no Supabase table, no live adapter belongs here.

-- Migration bookkeeping.
create table if not exists team_brain_schema_version (
  version integer primary key,
  applied_at text not null
);

-- Obligations: tasks, authorizations, verdicts, evidence.
-- Retention guard: there is no delete path and no TTL in this schema or its API.
create table if not exists team_brain_obligations (
  obligation_id text primary key,
  kind text not null check (kind in ('TASK', 'AUTHORIZATION', 'VERDICT', 'EVIDENCE')),
  filed_at text not null,
  source_repo text not null,
  source_path text not null,
  source_commit text,
  source_blob text,
  source_head text,
  state text not null default 'OPEN'
    check (state in ('OPEN', 'IN_PROGRESS', 'CLOSED', 'REVOKED', 'SUPERSEDED')),
  retention_disposition text not null,
  dependencies text not null default '[]',
  supersedes text references team_brain_obligations (obligation_id),
  superseded_by text references team_brain_obligations (obligation_id),
  priority_override text,
  created_at text not null,
  check (supersedes is null or supersedes <> obligation_id),
  check (superseded_by is null or superseded_by <> obligation_id)
);

-- Append-only event history. Rows are never updated or deleted.
create table if not exists team_brain_obligation_events (
  seq integer generated always as identity primary key,
  obligation_id text not null references team_brain_obligations (obligation_id),
  actor text not null,
  recorded_at text not null,
  event_type text not null,
  reason text not null,
  evidence_refs text not null default '[]',
  extra text not null default '{}'
);

create index if not exists team_brain_obligation_events_obligation_id_idx
  on team_brain_obligation_events (obligation_id);

-- Handoffs: transaction-gated write -> verify -> queue update -> complete.
create table if not exists team_brain_handoffs (
  handoff_id text primary key,
  state text not null default 'OPEN'
    check (state in ('OPEN', 'OUTCOME_WRITTEN', 'READBACK_VERIFIED', 'QUEUE_UPDATED', 'COMPLETE')),
  artifact_repo text,
  artifact_path text,
  artifact_commit text,
  artifact_blob text,
  artifact_head text,
  queue_repo text,
  queue_path text,
  queue_commit text,
  queue_blob text,
  created_at text not null,
  updated_at text not null
);

create table if not exists team_brain_handoff_events (
  seq integer generated always as identity primary key,
  handoff_id text not null references team_brain_handoffs (handoff_id),
  from_state text not null,
  to_state text not null,
  actor text not null,
  recorded_at text not null,
  reason text not null,
  artifact_commit text,
  artifact_blob text,
  artifact_head text,
  queue_commit text,
  queue_blob text
);

create index if not exists team_brain_handoff_events_handoff_id_idx
  on team_brain_handoff_events (handoff_id);

insert into team_brain_schema_version (version, applied_at)
values (1, 'schema-seed')
on conflict (version) do nothing;
