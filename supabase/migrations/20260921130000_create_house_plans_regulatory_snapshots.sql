-- HOUSE PLANS (HP-L4) immutable Regulatory Snapshots.
--
-- A snapshot captures the reference-library state -- which regulatory source
-- records, their factual metadata, retrieval/verification dates -- at a point
-- in time. Snapshots are IMMUTABLE and APPEND-ONLY:
--
--   - Rows are created once and never mutated. No UPDATE or DELETE RLS
--     policy exists for this table, so with RLS enabled and forced no
--     authenticated session can change or remove a historical row through
--     any path. The application exposes POST (create) and GET (list) only,
--     and no domain mutator exists. Newer data triggers a NEW snapshot
--     row; it never silently rewrites a historical one.
--   - Each row carries a content_hash of its canonical entries so the API can
--     tell "library changed since the last snapshot" from "no new data"
--     without touching history.
--
-- Link-only scope (inherited from HP-L1): entries are a JSONB array of
-- FACTUAL METADATA ONLY (titles, section identifiers, issuing
-- authority/jurisdiction, edition/effective dates, official URLs, topic tags,
-- provenance, retrieval/verification dates, jurisdiction state). There are no
-- summary, content, explanation, or paraphrase columns anywhere: FORGE never
-- authors or reproduces explanatory text about regulatory requirements.
--
-- The optional label is a short user-provided factual note (e.g. the project
-- milestone the snapshot was taken for). It carries no interpretation.

create table if not exists house_plans_regulatory_snapshots (
  owner_id text not null,
  id uuid not null default gen_random_uuid(),
  primary key (owner_id, id),

  label text,
  entries jsonb not null check (jsonb_typeof(entries) = 'array'),
  content_hash text not null check (char_length(content_hash) > 0),
  captured_at timestamptz not null default now()
);

create index if not exists idx_house_plans_regulatory_snapshots_owner_captured
  on house_plans_regulatory_snapshots(owner_id, captured_at desc);

alter table house_plans_regulatory_snapshots enable row level security;

alter table house_plans_regulatory_snapshots force row level security;

-- Shared FORGE workspace membership: the acting user resolves to their
-- effective owner (resolveEffectiveOwnerId, the JS twin of
-- resolve_effective_owner_id()) and reads/writes rows under that canonical
-- owner_id; active co-owners get the same access as the primary owner.
--
-- Append-only at the persistence boundary: workspace members may SELECT and
-- INSERT snapshots. There is deliberately no UPDATE or DELETE policy, so with
-- RLS enabled and forced no authenticated session can mutate or remove a
-- historical snapshot through any path -- the application only exposes POST
-- (create) and GET (list) as well.
create policy "house_plans_regulatory_snapshots_select"
on house_plans_regulatory_snapshots
for select
to authenticated
using (has_workspace_access(owner_id));

create policy "house_plans_regulatory_snapshots_insert"
on house_plans_regulatory_snapshots
for insert
to authenticated
with check (has_workspace_access(owner_id));
