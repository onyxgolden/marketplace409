-- FORGE Work Management — Work Package Planner, slice 1: drawing-set
-- intake and per-P&ID takeoff totals (forge-ai-drop
-- commands/claude/work-package-planner-takeoff-slice-2026-11-03.md).
--
-- Fills the documented gap in docs/forge-work-management/existing-domain-
-- inventory.md ("no first-class sheet/revision/version entity yet" under
-- Designer): forge_work_drawings is that first-class sheet entity — one
-- row per P&ID / cut sheet / isometric brought into a work package.
-- Deliberately does NOT reference forge_work_document_library or
-- designer_projects: slice 1 is structured takeoff data entry against a
-- drawing sheet's metadata, never the drawing file itself (automated
-- parsing of drawing files into quantities is explicitly out of this
-- slice). A sheet that also has an uploaded file or a linked Designer
-- project uses the EXISTING forge_work_links relationship types
-- (supported_by_drawing / library_supporting_document) for that —
-- this migration does not duplicate them.
--
-- Isolation follows the shared-workspace model used across Work
-- Management: owner_id is the effective workspace owner and RLS uses
-- has_workspace_access(owner_id) (see existing-domain-inventory.md).
-- Production apply needs Jason's separate word, same as every migration.

create table if not exists forge_work_drawings (
  owner_id text not null,
  id text not null,
  package_id text not null,
  drawing_number text not null check (btrim(drawing_number) <> ''),
  drawing_type text not null check (drawing_type in ('p_id', 'cut_sheet', 'isometric')),
  title text,
  -- Which P&ID this drawing's takeoff rolls up to. Required for
  -- cut_sheet/isometric, must be null for p_id (a P&ID rolls up to
  -- itself; enforced below, not by a self-referencing value here, so a
  -- P&ID's own id does not have to exist yet at insert time).
  p_id_drawing_id text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, package_id, drawing_number),
  foreign key (owner_id, package_id) references forge_work_packages (owner_id, id),
  foreign key (owner_id, p_id_drawing_id) references forge_work_drawings (owner_id, id),
  check (
    (drawing_type = 'p_id' and p_id_drawing_id is null)
    or (drawing_type <> 'p_id' and p_id_drawing_id is not null)
  )
);

create index if not exists idx_forge_work_drawings_owner_package
  on forge_work_drawings (owner_id, package_id, drawing_type);
create index if not exists idx_forge_work_drawings_owner_pid
  on forge_work_drawings (owner_id, p_id_drawing_id) where p_id_drawing_id is not null;

create table if not exists forge_work_takeoff_lines (
  owner_id text not null,
  id text not null,
  drawing_id text not null,
  line_no integer not null check (line_no > 0),
  description text not null check (btrim(description) <> ''),
  material_spec text,
  size_label text,
  quantity numeric not null check (quantity > 0),
  unit text not null check (btrim(unit) <> ''),
  category text not null default 'other'
    check (category in ('pipe', 'fitting', 'valve', 'support', 'other')),
  fab_location text not null check (fab_location in ('shop', 'field')),
  -- Suggested-FW/FFW inputs (slice brief): declared per line by the
  -- planner entering the takeoff, never inferred from geometry or a
  -- drawing file. requires_field_fit flags a random (field-cut,
  -- verified-on-site piece) — never a fixed cut length.
  field_weld_count integer not null default 0 check (field_weld_count >= 0),
  requires_field_fit boolean not null default false,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, drawing_id, line_no),
  foreign key (owner_id, drawing_id) references forge_work_drawings (owner_id, id)
);

create index if not exists idx_forge_work_takeoff_lines_owner_drawing
  on forge_work_takeoff_lines (owner_id, drawing_id, line_no);

grant select, insert, update, delete on forge_work_drawings to authenticated;
grant select, insert, update, delete on forge_work_takeoff_lines to authenticated;

alter table forge_work_drawings enable row level security;
alter table forge_work_drawings force row level security;
alter table forge_work_takeoff_lines enable row level security;
alter table forge_work_takeoff_lines force row level security;

create policy forge_work_drawings_workspace_select on forge_work_drawings
  for select to authenticated using (has_workspace_access(owner_id));
create policy forge_work_drawings_workspace_insert on forge_work_drawings
  for insert to authenticated with check (has_workspace_access(owner_id));
create policy forge_work_drawings_workspace_update on forge_work_drawings
  for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
create policy forge_work_drawings_workspace_delete on forge_work_drawings
  for delete to authenticated using (has_workspace_access(owner_id));

create policy forge_work_takeoff_lines_workspace_select on forge_work_takeoff_lines
  for select to authenticated using (has_workspace_access(owner_id));
create policy forge_work_takeoff_lines_workspace_insert on forge_work_takeoff_lines
  for insert to authenticated with check (has_workspace_access(owner_id));
create policy forge_work_takeoff_lines_workspace_update on forge_work_takeoff_lines
  for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
create policy forge_work_takeoff_lines_workspace_delete on forge_work_takeoff_lines
  for delete to authenticated using (has_workspace_access(owner_id));

-- No updated_at trigger: this codebase sets updated_at = now() explicitly
-- in each write path (see e.g. forge_work_packages' own functions), not
-- via a generic trigger function — the application service below follows
-- that same convention.
