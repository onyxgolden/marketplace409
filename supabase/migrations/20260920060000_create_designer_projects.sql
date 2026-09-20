-- FORGE room/layout designer projects (Phase 1).
--
-- One row per saved design. The whole design document (walls, rooms,
-- openings, furniture, settings) lives in the `design` jsonb column, in the
-- shape produced by src/domains/roomDesigner/designerDocument.js --
-- passed straight through to/from supabase-js, no JSON.stringify needed.
create table if not exists designer_projects (
  owner_id text not null,
  id text not null,
  primary key (owner_id, id),

  project_name text not null default 'Untitled design',
  design jsonb not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_designer_projects_owner
  on designer_projects(owner_id);

alter table designer_projects enable row level security;

alter table designer_projects force row level security;

-- Owners see and manage only their own designs.
create policy "designer_projects_owner_all"
on designer_projects
for all
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);
