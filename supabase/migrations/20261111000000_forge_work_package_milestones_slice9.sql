-- =============================================================================
-- Work Package Planner — Slice 9: Milestones tab
-- =============================================================================
-- FILE ONLY. DO NOT APPLY without Jason's separate word. A production
-- migration apply needs his explicit authorization; this file ships the
-- change, nothing more.
--
-- Scope: results/claude/work-package-planner-milestones-scope-2026-11-09.md
-- (drop 867e0043) + commands/claude/work-package-planner-milestones-slice9-
-- build-2026-11-10.md. Grounded in a live ODBC read of the real source
-- template database (reference/milestones/good_TaMilestones.accdb) — only
-- the reusable template/reference structure is carried forward here, no
-- job-identifying data.
--
-- What this slice adds:
--   * forge_work_milestone_templates — one row per milestone definition
--     (master or functional sub-item) within a named template. A
--     workspace can hold more than one named template (the source proves
--     a real client used a two-tier complexity model alongside the
--     standard three-tier model, so templates are not interchangeable
--     fixed content).
--   * forge_work_milestone_template_complexity_offsets — child table,
--     ROWS per tier per template milestone, not fixed columns, because a
--     template must support an arbitrary number of tiers with arbitrary
--     names (the two-tier-client finding above).
--   * forge_work_milestone_template_revisions — standard audit shape. An
--     offset add/change/remove is recorded as part of its PARENT
--     template milestone's revision (old_values/new_values jsonb carries
--     the whole tier set), so there is no separate offset-revisions
--     table.
--   * forge_work_milestones — the per-event instance, one row per
--     package per milestone, SNAPSHOTTED at instantiation time (not
--     live-linked to the template) — editing the template afterward
--     never silently changes an already-instantiated event's rows,
--     matching slice 6's baseline-immutability discipline.
--   * forge_work_milestone_revisions — standard audit shape.
--   * forge_work_milestones_snapshot — SECURITY INVOKER, STABLE read RPC.
--     ONE statement returns every active template (with its offset
--     rows) plus the package's instantiated milestones with `late`
--     computed on read (never stored) — serves both the live UI view
--     and the PDF export from the same read, so neither can drift from
--     the other.
--   * Write RPCs (SECURITY DEFINER, actor from auth.uid(), never a
--     caller-supplied value): milestone_template_create/_update/_retire,
--     milestone_complexity_offset_set, milestones_instantiate (refuses
--     WPP9_ALREADY_INSTANTIATED if non-retired instance rows already
--     exist for the package — re-instantiating from a different
--     template is a distinct, explicit, rare action: retire the
--     existing set first), milestone_update/_retire. Every write on an
--     instance refuses terminal packages (cancelled, verified_closed) —
--     a closed package is read-only for this slice, no corrections
--     carve-out. Template writes are workspace-scoped, not
--     package-scoped, so they carry no terminal-package check.
--
-- Timing: planned_date = anchor_date - months_from_anchor(selected_tier)
-- at instantiation, using the template milestone's duration_unit
-- (months/weeks/days) to interpret months_from_anchor as a calendar
-- interval. A positive offset places the milestone BEFORE the anchor
-- (the usual case — planning happens ahead of the outage); a negative
-- offset places it AFTER (the real backbone's closeout milestone is
-- negative-offset, since closeout happens once the turnaround is
-- underway/finishing). Every
-- master milestone being instantiated under the chosen tier must have a
-- matching offset row for that tier, or the instantiate RPC refuses with
-- WPP9_OFFSET_MISSING rather than silently skip a milestone.
--
-- Late flag: NEVER stored. late = (actual_date is null and
-- current_date > planned_date + 7) or (actual_date is not null and
-- actual_date > planned_date + 7) — computed in the snapshot RPC only,
-- same "derived, never hand-set" discipline forge_work_packages.
-- percent_complete already uses elsewhere in this schema.
--
-- Seed data: the verified 14-row master backbone (industry-standard
-- turnaround-management terminology, no job-identifying data) ships as
-- the default "Standard" template for every existing workspace that has
-- at least one work package, with its months-from-anchor-by-tier table
-- (High/Medium/Low) and the real responsibility/department/duration_unit
-- fields from the source. Stage-gate defaults: milestones 3, 6, 10, 14
-- (the ones whose description names a TR-N review in the real backbone).
-- =============================================================================

create table if not exists public.forge_work_milestone_templates (
  owner_id text not null,
  id text not null,
  template_name text not null check (char_length(btrim(template_name)) between 1 and 120),
  milestone_number numeric not null check (milestone_number > 0),
  is_master boolean not null default true,
  parent_milestone_number numeric,
  description text not null
    check (char_length(btrim(description)) between 1 and 400)
    check (description !~ '[[:cntrl:]]'),
  responsibility_role text
    check (responsibility_role is null or char_length(responsibility_role) between 1 and 120)
    check (responsibility_role is null or responsibility_role !~ '[[:cntrl:]]'),
  department text
    check (department is null or char_length(department) between 1 and 120)
    check (department is null or department !~ '[[:cntrl:]]'),
  duration_unit text not null default 'months' check (duration_unit in ('months', 'weeks', 'days')),
  notes text check (notes is null or char_length(notes) <= 2000),
  stewardship_flag boolean not null default false,
  is_stage_gate boolean not null default false,
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2),
  check (is_master or parent_milestone_number is not null)
);

-- One active definition per (template, milestone number) — a retired
-- row never blocks re-adding the same number under a fresh definition.
create unique index if not exists uq_forge_work_milestone_templates_active_number
  on public.forge_work_milestone_templates (owner_id, template_name, milestone_number)
  where retired_at is null;
create index if not exists idx_forge_work_milestone_templates_owner_name
  on public.forge_work_milestone_templates (owner_id, template_name, retired_at);

create table if not exists public.forge_work_milestone_template_revisions (
  owner_id text not null,
  id text not null,
  template_milestone_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('create', 'update', 'retire')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, template_milestone_id, version),
  foreign key (owner_id, template_milestone_id)
    references public.forge_work_milestone_templates (owner_id, id)
    on delete restrict
);

create index if not exists idx_forge_work_milestone_template_revisions_owner_milestone_version
  on public.forge_work_milestone_template_revisions (owner_id, template_milestone_id, version);

create table if not exists public.forge_work_milestone_template_complexity_offsets (
  owner_id text not null,
  id text not null,
  template_milestone_id text not null,
  complexity_tier text not null check (char_length(btrim(complexity_tier)) between 1 and 80),
  months_from_anchor numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, template_milestone_id, complexity_tier),
  foreign key (owner_id, template_milestone_id)
    references public.forge_work_milestone_templates (owner_id, id)
    on delete restrict
);

create index if not exists idx_forge_work_milestone_offsets_owner_milestone
  on public.forge_work_milestone_template_complexity_offsets (owner_id, template_milestone_id);

create table if not exists public.forge_work_milestones (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  source_template_milestone_id text,
  milestone_number numeric not null check (milestone_number > 0),
  is_master boolean not null default true,
  description text not null
    check (char_length(btrim(description)) between 1 and 400)
    check (description !~ '[[:cntrl:]]'),
  responsibility_role text
    check (responsibility_role is null or char_length(responsibility_role) between 1 and 120),
  department text
    check (department is null or char_length(department) between 1 and 120),
  is_stage_gate boolean not null default false,
  complexity_tier_selected text not null check (char_length(btrim(complexity_tier_selected)) between 1 and 80),
  anchor_date date not null,
  planned_date date not null,
  actual_date date,
  percent_complete numeric not null default 0 check (percent_complete >= 0 and percent_complete <= 100),
  comments text check (comments is null or char_length(comments) <= 2000),
  justification text check (justification is null or char_length(justification) <= 2000),
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, work_package_id)
    references public.forge_work_packages (owner_id, id) on delete restrict,
  foreign key (owner_id, source_template_milestone_id)
    references public.forge_work_milestone_templates (owner_id, id) on delete restrict,
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2)
);

create index if not exists idx_forge_work_milestones_owner_package
  on public.forge_work_milestones (owner_id, work_package_id, retired_at, milestone_number);

create table if not exists public.forge_work_milestone_revisions (
  owner_id text not null,
  id text not null,
  milestone_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('create', 'update', 'status_change', 'retire')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, milestone_id, version),
  foreign key (owner_id, milestone_id)
    references public.forge_work_milestones (owner_id, id)
    on delete restrict
);

create index if not exists idx_forge_work_milestone_revisions_owner_milestone_version
  on public.forge_work_milestone_revisions (owner_id, milestone_id, version);

-- ---------------------------------------------------------------------------
-- Row-level security: owner-scoped SELECT only, forced on every role.
-- Writes go through the SECURITY DEFINER RPCs below; no direct app-client
-- mutations. Mirrors slices 3-8: the SELECT policy is the only policy.
-- ---------------------------------------------------------------------------

alter table public.forge_work_milestone_templates enable row level security;
alter table public.forge_work_milestone_templates force row level security;
alter table public.forge_work_milestone_template_revisions enable row level security;
alter table public.forge_work_milestone_template_revisions force row level security;
alter table public.forge_work_milestone_template_complexity_offsets enable row level security;
alter table public.forge_work_milestone_template_complexity_offsets force row level security;
alter table public.forge_work_milestones enable row level security;
alter table public.forge_work_milestones force row level security;
alter table public.forge_work_milestone_revisions enable row level security;
alter table public.forge_work_milestone_revisions force row level security;

drop policy if exists forge_work_milestone_templates_select on public.forge_work_milestone_templates;
create policy forge_work_milestone_templates_select
  on public.forge_work_milestone_templates for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_milestone_template_revisions_select on public.forge_work_milestone_template_revisions;
create policy forge_work_milestone_template_revisions_select
  on public.forge_work_milestone_template_revisions for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_milestone_offsets_select on public.forge_work_milestone_template_complexity_offsets;
create policy forge_work_milestone_offsets_select
  on public.forge_work_milestone_template_complexity_offsets for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_milestones_select on public.forge_work_milestones;
create policy forge_work_milestones_select
  on public.forge_work_milestones for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_milestone_revisions_select on public.forge_work_milestone_revisions;
create policy forge_work_milestone_revisions_select
  on public.forge_work_milestone_revisions for select to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- Grants: SELECT-only for authenticated; nothing for anon or service_role.
-- Supabase default privileges re-grant ALL on new public tables and
-- EXECUTE on new functions to the app roles, so every grant is stated
-- explicitly here (and verified after the apply with an ACL/RLS receipt).
-- ---------------------------------------------------------------------------

revoke all on table public.forge_work_milestone_templates from public, anon, service_role, authenticated;
grant select on table public.forge_work_milestone_templates to authenticated;
revoke all on table public.forge_work_milestone_template_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_work_milestone_template_revisions to authenticated;
revoke all on table public.forge_work_milestone_template_complexity_offsets from public, anon, service_role, authenticated;
grant select on table public.forge_work_milestone_template_complexity_offsets to authenticated;
revoke all on table public.forge_work_milestones from public, anon, service_role, authenticated;
grant select on table public.forge_work_milestones to authenticated;
revoke all on table public.forge_work_milestone_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_work_milestone_revisions to authenticated;

-- ---------------------------------------------------------------------------
-- Seed data: the verified 14-row master backbone as the default
-- "Standard" template, for every existing owner_id that already has at
-- least one work package. Months-from-anchor by tier (High/Medium/Low),
-- generic turnaround-management terminology, no job-identifying data.
-- Stage-gate defaults: milestones 3 (TR-1), 6 (TR-2), 10 (TR-3), 14 (TR-4).
-- ---------------------------------------------------------------------------

do $seed$
declare
  v_owner text;
  v_row record;
  v_template_id text;
  v_backbone jsonb := '[
    {"n":1,"d":"Long Range T/A Planning","role":"Planner","dept":"Planning","unit":"months","gate":false,"high":36,"med":24,"low":14},
    {"n":2,"d":"Strategic T/A Planning","role":"Planner","dept":"Planning","unit":"months","gate":false,"high":29,"med":23,"low":12},
    {"n":3,"d":"T/A Alignment Review (TR-1) & Basis Endorsement (Stewardship #1)","role":"Planner","dept":"Planning","unit":"months","gate":true,"high":27,"med":22,"low":11},
    {"n":4,"d":"Preliminary Worklist Developed","role":"Planner","dept":"Planning","unit":"months","gate":false,"high":22,"med":17,"low":10},
    {"n":5,"d":"Preliminary Worklist Estimate","role":"Planner","dept":"Planning","unit":"months","gate":false,"high":20,"med":15,"low":10},
    {"n":6,"d":"T/A Preparation Review (TR-2)","role":"Planner","dept":"Planning","unit":"months","gate":true,"high":18,"med":14,"low":7},
    {"n":7,"d":"Worklist / Class V Approval","role":"Planner","dept":"Planning","unit":"months","gate":false,"high":17,"med":13,"low":5},
    {"n":8,"d":"Intermediate T/A Progress","role":"Planner","dept":"Planning","unit":"months","gate":false,"high":14,"med":12,"low":4},
    {"n":9,"d":"Eng/Insp/Proc Packages Issued","role":"Engineering","dept":"Engineering","unit":"months","gate":false,"high":10,"med":8,"low":3},
    {"n":10,"d":"T/A Readiness Review (TR-3)","role":"Planner","dept":"Planning","unit":"months","gate":true,"high":6,"med":6,"low":2},
    {"n":11,"d":"Planning Complete","role":"Planner","dept":"Planning","unit":"months","gate":false,"high":3,"med":3,"low":1},
    {"n":12,"d":"Control Estimate / Schedule Approved","role":"Planner","dept":"Planning","unit":"months","gate":false,"high":2,"med":2,"low":1},
    {"n":13,"d":"Execution / Preparation Finalized","role":"Planner","dept":"Planning","unit":"weeks","gate":false,"high":2,"med":2,"low":2},
    {"n":14,"d":"T/A Closeout (TR-4)","role":"Planner","dept":"Planning","unit":"months","gate":true,"high":-3,"med":-3,"low":-1}
  ]'::jsonb;
begin
  for v_owner in select distinct owner_id from public.forge_work_packages loop
    if exists (
      select 1 from public.forge_work_milestone_templates
      where owner_id = v_owner and template_name = 'Standard' and retired_at is null
    ) then
      continue;
    end if;

    for v_row in select * from jsonb_to_recordset(v_backbone) as x(
      n numeric, d text, role text, dept text, unit text, gate boolean,
      high numeric, med numeric, low numeric
    ) loop
      v_template_id := 'forge_wmt_' || replace(gen_random_uuid()::text, '-', '');

      insert into public.forge_work_milestone_templates
        (owner_id, id, template_name, milestone_number, is_master, description,
         responsibility_role, department, duration_unit, is_stage_gate,
         version, created_by, updated_by)
      values
        (v_owner, v_template_id, 'Standard', v_row.n, true, v_row.d,
         v_row.role, v_row.dept, v_row.unit, v_row.gate,
         1, 'system:migration:20261111000000', 'system:migration:20261111000000');

      insert into public.forge_work_milestone_template_revisions
        (owner_id, id, template_milestone_id, version, actor_id, action, old_values, new_values, reason)
      values
        (v_owner, 'forge_wmtr_' || replace(gen_random_uuid()::text, '-', ''), v_template_id, 1,
         'system:migration:20261111000000', 'create', null,
         jsonb_build_object('description', v_row.d, 'milestone_number', v_row.n, 'version', 1),
         'Seeded Standard template (slice 9 carry-over)');

      insert into public.forge_work_milestone_template_complexity_offsets
        (owner_id, id, template_milestone_id, complexity_tier, months_from_anchor)
      values
        (v_owner, 'forge_wmo_' || replace(gen_random_uuid()::text, '-', ''), v_template_id, 'High', v_row.high),
        (v_owner, 'forge_wmo_' || replace(gen_random_uuid()::text, '-', ''), v_template_id, 'Medium', v_row.med),
        (v_owner, 'forge_wmo_' || replace(gen_random_uuid()::text, '-', ''), v_template_id, 'Low', v_row.low);
    end loop;
  end loop;
end;
$seed$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_milestones_snapshot
-- One statement: every active template for the workspace (with its
-- offset rows nested) plus the package's instantiated milestones, each
-- with `late` computed on read. SECURITY INVOKER so the caller's RLS
-- applies to every table read; STABLE because it only reads.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_milestones_snapshot(
  p_owner_id text,
  p_package_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;

  select jsonb_build_object(
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'templateName', t.template_name,
        'milestoneNumber', t.milestone_number,
        'isMaster', t.is_master,
        'parentMilestoneNumber', t.parent_milestone_number,
        'description', t.description,
        'responsibilityRole', t.responsibility_role,
        'department', t.department,
        'durationUnit', t.duration_unit,
        'notes', t.notes,
        'stewardshipFlag', t.stewardship_flag,
        'isStageGate', t.is_stage_gate,
        'version', t.version,
        'offsets', coalesce((
          select jsonb_agg(jsonb_build_object(
            'complexityTier', o.complexity_tier,
            'monthsFromAnchor', o.months_from_anchor
          ) order by o.complexity_tier)
          from public.forge_work_milestone_template_complexity_offsets o
          where o.owner_id = t.owner_id and o.template_milestone_id = t.id
        ), '[]'::jsonb)
      ) order by t.template_name, t.milestone_number)
      from public.forge_work_milestone_templates t
      where t.owner_id = p_owner_id and t.retired_at is null
    ), '[]'::jsonb),
    'instances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'sourceTemplateMilestoneId', m.source_template_milestone_id,
        'milestoneNumber', m.milestone_number,
        'isMaster', m.is_master,
        'description', m.description,
        'responsibilityRole', m.responsibility_role,
        'department', m.department,
        'isStageGate', m.is_stage_gate,
        'complexityTierSelected', m.complexity_tier_selected,
        'anchorDate', m.anchor_date,
        'plannedDate', m.planned_date,
        'actualDate', m.actual_date,
        'percentComplete', m.percent_complete,
        'late', (
          (m.actual_date is null and current_date > (m.planned_date + 7))
          or (m.actual_date is not null and m.actual_date > (m.planned_date + 7))
        ),
        'comments', m.comments,
        'justification', m.justification,
        'version', m.version
      ) order by m.milestone_number)
      from public.forge_work_milestones m
      where m.owner_id = p_owner_id and m.work_package_id = p_package_id and m.retired_at is null
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_milestone_template_create
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_milestone_template_create(
  p_owner_id text,
  p_template_name text,
  p_milestone_number numeric,
  p_is_master boolean,
  p_parent_milestone_number numeric,
  p_description text,
  p_responsibility_role text,
  p_department text,
  p_duration_unit text,
  p_notes text,
  p_stewardship_flag boolean,
  p_is_stage_gate boolean,
  p_reason text
)
returns public.forge_work_milestone_templates
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_reason text;
  v_template public.forge_work_milestone_templates%rowtype;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  if p_template_name is null or btrim(p_template_name) = '' then
    raise exception 'WPP9_INVALID_TEMPLATE_NAME';
  end if;
  if p_milestone_number is null or p_milestone_number <= 0 then
    raise exception 'WPP9_INVALID_MILESTONE_NUMBER';
  end if;
  if p_description is null or btrim(p_description) = '' then
    raise exception 'WPP9_INVALID_DESCRIPTION';
  end if;
  if coalesce(p_duration_unit, 'months') not in ('months', 'weeks', 'days') then
    raise exception 'WPP9_INVALID_DURATION_UNIT';
  end if;
  if not coalesce(p_is_master, true) and p_parent_milestone_number is null then
    raise exception 'WPP9_PARENT_REQUIRED';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_REQUIRED';
  end if;

  insert into public.forge_work_milestone_templates
    (owner_id, id, template_name, milestone_number, is_master, parent_milestone_number,
     description, responsibility_role, department, duration_unit, notes,
     stewardship_flag, is_stage_gate, version, created_by, updated_by)
  values
    (p_owner_id, 'forge_wmt_' || replace(gen_random_uuid()::text, '-', ''),
     btrim(p_template_name), p_milestone_number, coalesce(p_is_master, true),
     p_parent_milestone_number, btrim(p_description), p_responsibility_role,
     p_department, coalesce(p_duration_unit, 'months'), p_notes,
     coalesce(p_stewardship_flag, false), coalesce(p_is_stage_gate, false),
     1, v_actor, v_actor)
  returning * into v_template;

  insert into public.forge_work_milestone_template_revisions
    (owner_id, id, template_milestone_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id, 'forge_wmtr_' || replace(gen_random_uuid()::text, '-', ''), v_template.id, 1,
     v_actor, 'create', null,
     jsonb_build_object(
       'templateName', v_template.template_name, 'milestoneNumber', v_template.milestone_number,
       'description', v_template.description, 'version', 1),
     v_reason);

  return v_template;
exception
  when unique_violation then
    raise exception 'WPP9_MILESTONE_NUMBER_TAKEN';
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_milestone_template_update
-- Full-replace-with-version-guard, same discipline as slice 8's
-- control_estimate_set: the caller always supplies the complete field
-- set, not a partial patch.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_milestone_template_update(
  p_owner_id text,
  p_template_milestone_id text,
  p_expected_version integer,
  p_description text,
  p_responsibility_role text,
  p_department text,
  p_duration_unit text,
  p_notes text,
  p_stewardship_flag boolean,
  p_is_stage_gate boolean,
  p_reason text
)
returns public.forge_work_milestone_templates
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_reason text;
  v_template public.forge_work_milestone_templates%rowtype;
  v_old jsonb;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  if p_description is null or btrim(p_description) = '' then
    raise exception 'WPP9_INVALID_DESCRIPTION';
  end if;
  if coalesce(p_duration_unit, 'months') not in ('months', 'weeks', 'days') then
    raise exception 'WPP9_INVALID_DURATION_UNIT';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_REQUIRED';
  end if;

  select * into v_template from public.forge_work_milestone_templates
    where owner_id = p_owner_id and id = p_template_milestone_id and retired_at is null
    for update;
  if not found then
    raise exception 'WPP9_TEMPLATE_NOT_FOUND';
  end if;
  if p_expected_version is null or p_expected_version <> v_template.version then
    raise exception 'WPP9_VERSION_CONFLICT';
  end if;

  v_old := jsonb_build_object(
    'description', v_template.description, 'responsibilityRole', v_template.responsibility_role,
    'department', v_template.department, 'durationUnit', v_template.duration_unit,
    'notes', v_template.notes, 'stewardshipFlag', v_template.stewardship_flag,
    'isStageGate', v_template.is_stage_gate, 'version', v_template.version);

  update public.forge_work_milestone_templates
    set description = btrim(p_description),
        responsibility_role = p_responsibility_role,
        department = p_department,
        duration_unit = coalesce(p_duration_unit, 'months'),
        notes = p_notes,
        stewardship_flag = coalesce(p_stewardship_flag, false),
        is_stage_gate = coalesce(p_is_stage_gate, false),
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_template_milestone_id
    returning * into v_template;

  insert into public.forge_work_milestone_template_revisions
    (owner_id, id, template_milestone_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id, 'forge_wmtr_' || replace(gen_random_uuid()::text, '-', ''), v_template.id, v_template.version,
     v_actor, 'update', v_old,
     jsonb_build_object(
       'description', v_template.description, 'responsibilityRole', v_template.responsibility_role,
       'department', v_template.department, 'durationUnit', v_template.duration_unit,
       'notes', v_template.notes, 'stewardshipFlag', v_template.stewardship_flag,
       'isStageGate', v_template.is_stage_gate, 'version', v_template.version),
     v_reason);

  return v_template;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_milestone_template_retire
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_milestone_template_retire(
  p_owner_id text,
  p_template_milestone_id text,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_milestone_templates
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_reason text;
  v_template public.forge_work_milestone_templates%rowtype;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_REQUIRED';
  end if;

  select * into v_template from public.forge_work_milestone_templates
    where owner_id = p_owner_id and id = p_template_milestone_id
    for update;
  if not found then
    raise exception 'WPP9_TEMPLATE_NOT_FOUND';
  end if;
  if v_template.retired_at is not null then
    raise exception 'WPP9_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_template.version then
    raise exception 'WPP9_VERSION_CONFLICT';
  end if;

  update public.forge_work_milestone_templates
    set retired_at = now(), retired_by = v_actor, version = version + 1,
        updated_by = v_actor, updated_at = now()
    where owner_id = p_owner_id and id = p_template_milestone_id
    returning * into v_template;

  insert into public.forge_work_milestone_template_revisions
    (owner_id, id, template_milestone_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id, 'forge_wmtr_' || replace(gen_random_uuid()::text, '-', ''), v_template.id, v_template.version,
     v_actor, 'retire',
     jsonb_build_object('version', v_template.version - 1),
     jsonb_build_object('version', v_template.version, 'retiredAt', v_template.retired_at),
     v_reason);

  return v_template;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_milestone_complexity_offset_set
-- Add, change, or remove (p_months_from_anchor null) one tier offset on
-- a template milestone. Recorded as part of the PARENT template
-- milestone's own revision (old/new carry the FULL tier set), with the
-- parent's version bumped — there is no separate offsets-revisions
-- table, per the brief.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_milestone_complexity_offset_set(
  p_owner_id text,
  p_template_milestone_id text,
  p_expected_version integer,
  p_complexity_tier text,
  p_months_from_anchor numeric,
  p_reason text
)
returns public.forge_work_milestone_templates
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_reason text;
  v_template public.forge_work_milestone_templates%rowtype;
  v_old_tiers jsonb;
  v_new_tiers jsonb;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  if p_complexity_tier is null or btrim(p_complexity_tier) = '' then
    raise exception 'WPP9_INVALID_TIER';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_REQUIRED';
  end if;

  select * into v_template from public.forge_work_milestone_templates
    where owner_id = p_owner_id and id = p_template_milestone_id and retired_at is null
    for update;
  if not found then
    raise exception 'WPP9_TEMPLATE_NOT_FOUND';
  end if;
  if p_expected_version is null or p_expected_version <> v_template.version then
    raise exception 'WPP9_VERSION_CONFLICT';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('complexityTier', complexity_tier, 'monthsFromAnchor', months_from_anchor)), '[]'::jsonb)
    into v_old_tiers
    from public.forge_work_milestone_template_complexity_offsets
    where owner_id = p_owner_id and template_milestone_id = p_template_milestone_id;

  if p_months_from_anchor is null then
    delete from public.forge_work_milestone_template_complexity_offsets
      where owner_id = p_owner_id and template_milestone_id = p_template_milestone_id
        and complexity_tier = btrim(p_complexity_tier);
  else
    insert into public.forge_work_milestone_template_complexity_offsets
      (owner_id, id, template_milestone_id, complexity_tier, months_from_anchor)
    values
      (p_owner_id, 'forge_wmo_' || replace(gen_random_uuid()::text, '-', ''), p_template_milestone_id,
       btrim(p_complexity_tier), p_months_from_anchor)
    on conflict (owner_id, template_milestone_id, complexity_tier)
    do update set months_from_anchor = excluded.months_from_anchor, updated_at = now();
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('complexityTier', complexity_tier, 'monthsFromAnchor', months_from_anchor)), '[]'::jsonb)
    into v_new_tiers
    from public.forge_work_milestone_template_complexity_offsets
    where owner_id = p_owner_id and template_milestone_id = p_template_milestone_id;

  update public.forge_work_milestone_templates
    set version = version + 1, updated_by = v_actor, updated_at = now()
    where owner_id = p_owner_id and id = p_template_milestone_id
    returning * into v_template;

  insert into public.forge_work_milestone_template_revisions
    (owner_id, id, template_milestone_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id, 'forge_wmtr_' || replace(gen_random_uuid()::text, '-', ''), v_template.id, v_template.version,
     v_actor, 'update',
     jsonb_build_object('offsets', v_old_tiers, 'version', v_template.version - 1),
     jsonb_build_object('offsets', v_new_tiers, 'version', v_template.version),
     v_reason);

  return v_template;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_milestones_instantiate
-- Bulk-creates one forge_work_milestones row per active template
-- milestone matching p_template_name, computing each planned_date from
-- the chosen tier's offset. Refuses WPP9_ALREADY_INSTANTIATED if the
-- package already holds non-retired instance rows.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_milestones_instantiate(
  p_owner_id text,
  p_package_id text,
  p_template_name text,
  p_anchor_date date,
  p_complexity_tier text
)
returns setof public.forge_work_milestones
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_tmpl record;
  v_offset numeric;
  v_interval interval;
  v_milestone public.forge_work_milestones%rowtype;
  v_count integer := 0;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id for update;
  if not found then
    raise exception 'WPP9_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP9_PACKAGE_TERMINAL';
  end if;
  if p_anchor_date is null then
    raise exception 'WPP9_ANCHOR_REQUIRED';
  end if;
  if p_complexity_tier is null or btrim(p_complexity_tier) = '' then
    raise exception 'WPP9_INVALID_TIER';
  end if;
  if exists (
    select 1 from public.forge_work_milestones
    where owner_id = p_owner_id and work_package_id = p_package_id and retired_at is null
  ) then
    raise exception 'WPP9_ALREADY_INSTANTIATED';
  end if;

  for v_tmpl in
    select t.id, t.milestone_number, t.is_master, t.description, t.responsibility_role,
           t.department, t.is_stage_gate, t.duration_unit
    from public.forge_work_milestone_templates t
    where t.owner_id = p_owner_id and t.template_name = btrim(p_template_name) and t.retired_at is null
    order by t.milestone_number
  loop
    select months_from_anchor into v_offset
      from public.forge_work_milestone_template_complexity_offsets
      where owner_id = p_owner_id and template_milestone_id = v_tmpl.id
        and complexity_tier = btrim(p_complexity_tier);
    if v_offset is null then
      raise exception 'WPP9_OFFSET_MISSING';
    end if;

    v_interval := case v_tmpl.duration_unit
      when 'weeks' then (v_offset * interval '1 week')
      when 'days' then (v_offset * interval '1 day')
      else (v_offset * interval '1 month')
    end;

    insert into public.forge_work_milestones
      (owner_id, id, work_package_id, source_template_milestone_id, milestone_number, is_master,
       description, responsibility_role, department, is_stage_gate, complexity_tier_selected,
       anchor_date, planned_date, version, created_by, updated_by)
    values
      (p_owner_id, 'forge_wm_' || replace(gen_random_uuid()::text, '-', ''), p_package_id, v_tmpl.id,
       v_tmpl.milestone_number, v_tmpl.is_master, v_tmpl.description, v_tmpl.responsibility_role,
       v_tmpl.department, v_tmpl.is_stage_gate, btrim(p_complexity_tier),
       p_anchor_date, (p_anchor_date - v_interval)::date, 1, v_actor, v_actor)
    returning * into v_milestone;

    insert into public.forge_work_milestone_revisions
      (owner_id, id, milestone_id, version, actor_id, action, old_values, new_values, reason)
    values
      (p_owner_id, 'forge_wmr_' || replace(gen_random_uuid()::text, '-', ''), v_milestone.id, 1,
       v_actor, 'create', null,
       jsonb_build_object('milestoneNumber', v_milestone.milestone_number, 'plannedDate', v_milestone.planned_date, 'version', 1),
       'Instantiated from template ' || btrim(p_template_name) || ' (' || btrim(p_complexity_tier) || ')');

    v_count := v_count + 1;
    return next v_milestone;
  end loop;

  if v_count = 0 then
    raise exception 'WPP9_TEMPLATE_NOT_FOUND';
  end if;
  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_milestone_update
-- Full-replace-with-version-guard. Terminal packages are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_milestone_update(
  p_owner_id text,
  p_milestone_id text,
  p_expected_version integer,
  p_description text,
  p_responsibility_role text,
  p_department text,
  p_planned_date date,
  p_actual_date date,
  p_percent_complete numeric,
  p_comments text,
  p_justification text,
  p_reason text
)
returns public.forge_work_milestones
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_reason text;
  v_milestone public.forge_work_milestones%rowtype;
  v_old jsonb;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  if p_description is null or btrim(p_description) = '' then
    raise exception 'WPP9_INVALID_DESCRIPTION';
  end if;
  if p_planned_date is null then
    raise exception 'WPP9_INVALID_PLANNED_DATE';
  end if;
  if p_percent_complete is null or p_percent_complete < 0 or p_percent_complete > 100 then
    raise exception 'WPP9_INVALID_PERCENT';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_REQUIRED';
  end if;

  select * into v_milestone from public.forge_work_milestones
    where owner_id = p_owner_id and id = p_milestone_id and retired_at is null
    for update;
  if not found then
    raise exception 'WPP9_MILESTONE_NOT_FOUND';
  end if;
  if p_expected_version is null or p_expected_version <> v_milestone.version then
    raise exception 'WPP9_VERSION_CONFLICT';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_milestone.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP9_PACKAGE_TERMINAL';
  end if;

  v_old := jsonb_build_object(
    'description', v_milestone.description, 'responsibilityRole', v_milestone.responsibility_role,
    'department', v_milestone.department, 'plannedDate', v_milestone.planned_date,
    'actualDate', v_milestone.actual_date, 'percentComplete', v_milestone.percent_complete,
    'comments', v_milestone.comments, 'justification', v_milestone.justification,
    'version', v_milestone.version);

  update public.forge_work_milestones
    set description = btrim(p_description),
        responsibility_role = p_responsibility_role,
        department = p_department,
        planned_date = p_planned_date,
        actual_date = p_actual_date,
        percent_complete = p_percent_complete,
        comments = p_comments,
        justification = p_justification,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_milestone_id
    returning * into v_milestone;

  insert into public.forge_work_milestone_revisions
    (owner_id, id, milestone_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id, 'forge_wmr_' || replace(gen_random_uuid()::text, '-', ''), v_milestone.id, v_milestone.version,
     v_actor, 'update', v_old,
     jsonb_build_object(
       'description', v_milestone.description, 'responsibilityRole', v_milestone.responsibility_role,
       'department', v_milestone.department, 'plannedDate', v_milestone.planned_date,
       'actualDate', v_milestone.actual_date, 'percentComplete', v_milestone.percent_complete,
       'comments', v_milestone.comments, 'justification', v_milestone.justification,
       'version', v_milestone.version),
     v_reason);

  return v_milestone;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_milestone_retire
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_milestone_retire(
  p_owner_id text,
  p_milestone_id text,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_milestones
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_reason text;
  v_milestone public.forge_work_milestones%rowtype;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP9_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP9_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPP9_REASON_REQUIRED';
  end if;

  select * into v_milestone from public.forge_work_milestones
    where owner_id = p_owner_id and id = p_milestone_id
    for update;
  if not found then
    raise exception 'WPP9_MILESTONE_NOT_FOUND';
  end if;
  if v_milestone.retired_at is not null then
    raise exception 'WPP9_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_milestone.version then
    raise exception 'WPP9_VERSION_CONFLICT';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_milestone.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP9_PACKAGE_TERMINAL';
  end if;

  update public.forge_work_milestones
    set retired_at = now(), retired_by = v_actor, version = version + 1,
        updated_by = v_actor, updated_at = now()
    where owner_id = p_owner_id and id = p_milestone_id
    returning * into v_milestone;

  insert into public.forge_work_milestone_revisions
    (owner_id, id, milestone_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id, 'forge_wmr_' || replace(gen_random_uuid()::text, '-', ''), v_milestone.id, v_milestone.version,
     v_actor, 'retire',
     jsonb_build_object('version', v_milestone.version - 1),
     jsonb_build_object('version', v_milestone.version, 'retiredAt', v_milestone.retired_at),
     v_reason);

  return v_milestone;
end;
$$;

revoke all on function public.forge_work_milestones_snapshot(text, text) from public;
revoke all on function public.forge_work_milestone_template_create(text, text, numeric, boolean, numeric, text, text, text, text, text, boolean, boolean, text) from public;
revoke all on function public.forge_work_milestone_template_update(text, text, integer, text, text, text, text, text, boolean, boolean, text) from public;
revoke all on function public.forge_work_milestone_template_retire(text, text, integer, text) from public;
revoke all on function public.forge_work_milestone_complexity_offset_set(text, text, integer, text, numeric, text) from public;
revoke all on function public.forge_work_milestones_instantiate(text, text, text, date, text) from public;
revoke all on function public.forge_work_milestone_update(text, text, integer, text, text, text, date, date, numeric, text, text, text) from public;
revoke all on function public.forge_work_milestone_retire(text, text, integer, text) from public;

grant execute on function public.forge_work_milestones_snapshot(text, text) to authenticated;
grant execute on function public.forge_work_milestone_template_create(text, text, numeric, boolean, numeric, text, text, text, text, text, boolean, boolean, text) to authenticated;
grant execute on function public.forge_work_milestone_template_update(text, text, integer, text, text, text, text, text, boolean, boolean, text) to authenticated;
grant execute on function public.forge_work_milestone_template_retire(text, text, integer, text) to authenticated;
grant execute on function public.forge_work_milestone_complexity_offset_set(text, text, integer, text, numeric, text) to authenticated;
grant execute on function public.forge_work_milestones_instantiate(text, text, text, date, text) to authenticated;
grant execute on function public.forge_work_milestone_update(text, text, integer, text, text, text, date, date, numeric, text, text, text) to authenticated;
grant execute on function public.forge_work_milestone_retire(text, text, integer, text) to authenticated;
