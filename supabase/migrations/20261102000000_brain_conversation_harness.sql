-- FORGE Brain conversation harness (scope 2026-11-02, drop e55b7d72) — AUTHORED, NOT APPLIED.
-- Jason applies migrations; this file is never applied by the build itself.
-- Ships DISABLED: the harness activates only on Jason's word after P8 passes
-- (BRAIN_CONVERSATION_HARNESS_ENABLED=true). Until then these tables sit empty.
--
-- Security model: RLS forced; select/insert/update/delete policies gated on
-- has_workspace_access(owner_id) (the workspace pattern, see
-- 20260829000100_add_workspace_authorization_helpers.sql).
--
-- Reference-only tenant pointers (Q5): record_type/record_id columns carry
-- pointers to rental records only — never tenant names, emails, amounts, or
-- other tenant details. Memory content itself is owner-authored text; tenant
-- details are never duplicated into these tables.
--
-- Additive only: no existing table is changed.

create table if not exists brain_semantic_entries (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  content text not null check (btrim(content) <> ''),
  fact_key text,
  salience text not null default 'inferred' check (salience in ('owner_stated', 'verified', 'inferred')),
  provenance_source text,
  provenance_at timestamptz,
  record_type text,
  record_id text,
  decay_flagged boolean not null default false,
  decay_flagged_at timestamptz,
  superseded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists brain_episodes (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  session_id text not null,
  content text,
  content_gist text,
  archive_storage_path text,
  status text not null default 'active' check (status in ('active', 'archived')),
  tags text[] not null default '{}',
  -- Structured candidate facts ({key, text}) attached at append time.
  -- Consolidation promotes these; it never does free-text extraction.
  candidate_facts jsonb not null default '[]',
  record_type text,
  record_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  check (status = 'archived' or (content is not null and btrim(content) <> ''))
);

create table if not exists brain_episode_corrections (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  episode_id text not null,
  correction text not null check (btrim(correction) <> ''),
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, episode_id) references brain_episodes (owner_id, id) on delete cascade
);

create table if not exists brain_procedures (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  title text not null check (btrim(title) <> ''),
  steps text not null check (btrim(steps) <> ''),
  context_tags text[] not null default '{}',
  confirmed boolean not null default false,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists brain_conversation_preferences (
  owner_id text not null,
  preference_key text not null check (preference_key in ('inferred_decay_days', 'brain_icon_position')),
  preference_value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, preference_key)
);

create table if not exists brain_consolidation_flags (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  kind text not null check (kind in ('conflict', 'inferred_decay', 'stale_retired')),
  subject_type text not null check (subject_type in ('semantic', 'episode')),
  subject_id text not null,
  detail text not null check (btrim(detail) <> ''),
  resolved boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create index if not exists idx_brain_semantic_owner_salience
  on brain_semantic_entries (owner_id, salience);
create index if not exists idx_brain_semantic_owner_created
  on brain_semantic_entries (owner_id, created_at desc);
create index if not exists idx_brain_episodes_owner_created
  on brain_episodes (owner_id, created_at desc);
create index if not exists idx_brain_episodes_owner_status
  on brain_episodes (owner_id, status);
create index if not exists idx_brain_episode_corrections_owner_episode
  on brain_episode_corrections (owner_id, episode_id);
create index if not exists idx_brain_procedures_owner_confirmed
  on brain_procedures (owner_id, confirmed);
create index if not exists idx_brain_flags_owner_resolved
  on brain_consolidation_flags (owner_id, resolved, created_at desc);

alter table brain_semantic_entries enable row level security;
alter table brain_semantic_entries force row level security;
alter table brain_episodes enable row level security;
alter table brain_episodes force row level security;
alter table brain_episode_corrections enable row level security;
alter table brain_episode_corrections force row level security;
alter table brain_procedures enable row level security;
alter table brain_procedures force row level security;
alter table brain_conversation_preferences enable row level security;
alter table brain_conversation_preferences force row level security;
alter table brain_consolidation_flags enable row level security;
alter table brain_consolidation_flags force row level security;

drop policy if exists "brain_semantic_entries_owner_select" on brain_semantic_entries;
create policy "brain_semantic_entries_owner_select" on brain_semantic_entries for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "brain_semantic_entries_owner_insert" on brain_semantic_entries;
create policy "brain_semantic_entries_owner_insert" on brain_semantic_entries for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "brain_semantic_entries_owner_update" on brain_semantic_entries;
create policy "brain_semantic_entries_owner_update" on brain_semantic_entries for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "brain_semantic_entries_owner_delete" on brain_semantic_entries;
create policy "brain_semantic_entries_owner_delete" on brain_semantic_entries for delete to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "brain_episodes_owner_select" on brain_episodes;
create policy "brain_episodes_owner_select" on brain_episodes for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "brain_episodes_owner_insert" on brain_episodes;
create policy "brain_episodes_owner_insert" on brain_episodes for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "brain_episodes_owner_update" on brain_episodes;
create policy "brain_episodes_owner_update" on brain_episodes for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "brain_episodes_owner_delete" on brain_episodes;
create policy "brain_episodes_owner_delete" on brain_episodes for delete to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "brain_episode_corrections_owner_select" on brain_episode_corrections;
create policy "brain_episode_corrections_owner_select" on brain_episode_corrections for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "brain_episode_corrections_owner_insert" on brain_episode_corrections;
create policy "brain_episode_corrections_owner_insert" on brain_episode_corrections for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "brain_episode_corrections_owner_update" on brain_episode_corrections;
create policy "brain_episode_corrections_owner_update" on brain_episode_corrections for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "brain_episode_corrections_owner_delete" on brain_episode_corrections;
create policy "brain_episode_corrections_owner_delete" on brain_episode_corrections for delete to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "brain_procedures_owner_select" on brain_procedures;
create policy "brain_procedures_owner_select" on brain_procedures for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "brain_procedures_owner_insert" on brain_procedures;
create policy "brain_procedures_owner_insert" on brain_procedures for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "brain_procedures_owner_update" on brain_procedures;
create policy "brain_procedures_owner_update" on brain_procedures for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "brain_procedures_owner_delete" on brain_procedures;
create policy "brain_procedures_owner_delete" on brain_procedures for delete to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "brain_conversation_preferences_owner_select" on brain_conversation_preferences;
create policy "brain_conversation_preferences_owner_select" on brain_conversation_preferences for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "brain_conversation_preferences_owner_insert" on brain_conversation_preferences;
create policy "brain_conversation_preferences_owner_insert" on brain_conversation_preferences for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "brain_conversation_preferences_owner_update" on brain_conversation_preferences;
create policy "brain_conversation_preferences_owner_update" on brain_conversation_preferences for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "brain_conversation_preferences_owner_delete" on brain_conversation_preferences;
create policy "brain_conversation_preferences_owner_delete" on brain_conversation_preferences for delete to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "brain_consolidation_flags_owner_select" on brain_consolidation_flags;
create policy "brain_consolidation_flags_owner_select" on brain_consolidation_flags for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "brain_consolidation_flags_owner_insert" on brain_consolidation_flags;
create policy "brain_consolidation_flags_owner_insert" on brain_consolidation_flags for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "brain_consolidation_flags_owner_update" on brain_consolidation_flags;
create policy "brain_consolidation_flags_owner_update" on brain_consolidation_flags for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "brain_consolidation_flags_owner_delete" on brain_consolidation_flags;
create policy "brain_consolidation_flags_owner_delete" on brain_consolidation_flags for delete to authenticated
  using (has_workspace_access(owner_id));

revoke all on brain_semantic_entries from anon, authenticated;
grant select, insert, update, delete on brain_semantic_entries to authenticated;
revoke all on brain_episodes from anon, authenticated;
grant select, insert, update, delete on brain_episodes to authenticated;
revoke all on brain_episode_corrections from anon, authenticated;
grant select, insert, update, delete on brain_episode_corrections to authenticated;
revoke all on brain_procedures from anon, authenticated;
grant select, insert, update, delete on brain_procedures to authenticated;
revoke all on brain_conversation_preferences from anon, authenticated;
grant select, insert, update, delete on brain_conversation_preferences to authenticated;
revoke all on brain_consolidation_flags from anon, authenticated;
grant select, insert, update, delete on brain_consolidation_flags to authenticated;
