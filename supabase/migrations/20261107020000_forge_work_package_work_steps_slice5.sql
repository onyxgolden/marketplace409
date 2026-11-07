-- FORGE Work Management — Work Package Planner, slice 5: planner-authored
-- work steps (forge-ai-drop
-- results/chatgpt/work-package-planner-slice5-scope-2026-11-07.md).
-- Builds on slices 1–4; depends on slice 1 (packages, drawings,
-- takeoff lines), slice 3 (permit annotations + the drawing-delete
-- RPC replaced below) and slice 4 (forge_work_craft_normalize_key,
-- reused for the step craft key). Slice 2 progress is untouched: no
-- step foreign key on progress entries, no progress mutation.
--
-- A work step is the planner-authored ordered work breakdown. Steps
-- are created BEFORE drawings exist; later controlled drawings refine
-- them through a many-to-many link (planning context only — a link
-- never edits a drawing row, never verifies drawing text, never
-- adopts quantities). The schedule in this slice is the deterministic
-- manual sequence of active steps (1..N per package), not a dated CPM
-- baseline, not a Gantt, not a dependency graph: no planned dates,
-- no status workflow, no percent complete are stored anywhere here.
--
-- DOCUMENTED DEFERRALS (scope §4, acceptance 8 — explicit, not
-- silent):
--   1. Assignment attribution: slice-4 assignments do NOT gain a
--      work_step_id in this slice. Extending the slice-4 create/update
--      RPCs would mean DROP + CREATE of two twice-fix-rounded
--      functions with new signatures, for one optional nullable
--      column. The steps panel shows package/date read-only
--      assignment context instead, and never fabricates per-step
--      attribution. A later slice may add the column + RPC extension
--      as its own reviewed change.
--   2. Takeoff links: no forge_work_step_takeoff_links table. Takeoff
--      lines carry no package id and are directly deletable by
--      authenticated (DELETE policy, no RPC, no audit), so a mapping
--      would either block legitimate line deletion (RESTRICT) or drop
--      history silently (CASCADE). The panel shows package-level
--      progress context only. A later slice may add the mapping once
--      an audited line-delete path exists.
--
-- Drawing-delete coordination (scope §3): the slice-3 RPC
-- forge_work_permit_annotation_delete_drawing is REPLACED below with
-- an identical body plus step-link detachment, so permit cleanup AND
-- step-link cleanup happen in the SAME drawing-delete transaction
-- and no competing delete path exists. CREATE OR REPLACE preserves
-- the slice-3 grants; the revoke/grant block below re-issues them
-- explicitly. The replaced function raises no new user-facing error
-- codes — the step-link loops only touch rows the guards already
-- proved exist.
--
-- Migration discipline (Nov 4 lesson, slices 1–4 post-apply
-- findings): Supabase default privileges grant ALL on newly created
-- public tables to anon/authenticated/service_role, so a selective
-- GRANT alone proves nothing. Every privilege this migration does
-- NOT intend is explicitly REVOKED below (steps, revisions, links,
-- link revisions, order rows: SELECT only for authenticated; anon
-- and service_role: nothing; direct writes by any application role:
-- denied — the RPCs are the only write path). The post-apply
-- effective-ACL receipt is still mandatory before the migration gate
-- counts complete — SQL text alone is never proof.
--
-- Production apply needs Jason's separate word, same as every migration.

create table if not exists forge_work_steps (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  title text not null
    check (char_length(btrim(title)) >= 1 and char_length(title) <= 160)
    check (title ~ '^[A-Za-z0-9][A-Za-z0-9 .&''/(),:;+-]*$')
    check (title !~ '[[:cntrl:]]'),
  description text
    check (description is null or char_length(description) <= 4000)
    check (description is null or description !~ '[[:cntrl:]]')
    check (description is null or description !~ '<[a-zA-Z/][^>]*>'),
  sequence_no integer not null check (sequence_no >= 1),
  craft_key text
    check (craft_key is null or char_length(craft_key) between 1 and 80),
  craft_label text
    check (craft_label is null or char_length(craft_label) between 1 and 80)
    check (craft_label is null or craft_label ~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$'),
  planned_duration_days integer
    check (planned_duration_days is null or planned_duration_days between 1 and 366),
  planned_person_hours numeric(12, 2)
    check (planned_person_hours is null
      or (planned_person_hours > 0 and planned_person_hours <= 1000000
          and planned_person_hours = round(planned_person_hours, 2))),
  source_note text
    check (source_note is null or char_length(source_note) <= 1000),
  supersedes_step_id text,
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  -- Backs the composite foreign keys from the step-drawing links and
  -- the supersession pointer (a superset of the primary key, so it is
  -- implied — the unique key exists only to back those FKs).
  unique (owner_id, work_package_id, id),
  foreign key (owner_id, work_package_id)
    references forge_work_packages (owner_id, id) on delete restrict,
  foreign key (owner_id, work_package_id, supersedes_step_id)
    references forge_work_steps (owner_id, work_package_id, id) on delete restrict,
  check (supersedes_step_id is null or supersedes_step_id <> id),
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2)
);

-- At most one ACTIVE step per sequence number in a package. Retired
-- steps keep their last sequence snapshot but fall out of the index,
-- so a retired step never blocks a fresh step taking its old number.
create unique index if not exists uq_forge_work_steps_active_sequence
  on forge_work_steps (owner_id, work_package_id, sequence_no)
  where retired_at is null;
create index if not exists idx_forge_work_steps_owner_package_sequence
  on forge_work_steps (owner_id, work_package_id, retired_at, sequence_no, id);

create table if not exists forge_work_step_revisions (
  owner_id text not null,
  id text not null,
  step_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('create', 'update', 'reorder', 'retire', 'historical_correction')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, step_id, version),
  foreign key (owner_id, step_id)
    references forge_work_steps (owner_id, id) on delete restrict
);

create index if not exists idx_forge_work_step_revisions_owner_step_version
  on forge_work_step_revisions (owner_id, step_id, version);

-- One optimistic-concurrency token per package for the step order.
-- The reorder RPC locks this row, checks the caller's expected
-- generation, renumbers, and bumps it — so two concurrent reorders
-- cannot both succeed. Create/retire bump it too: they change the
-- active set, which invalidates any in-flight reorder permutation.
-- The row is deliberately NOT the package row's version (slice 1's
-- package version is bumped by trigger on every package update, so
-- reusing it would false-conflict reorders against unrelated
-- package edits).
create table if not exists forge_work_step_order (
  owner_id text not null,
  work_package_id text not null,
  generation integer not null default 0 check (generation >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, work_package_id),
  foreign key (owner_id, work_package_id)
    references forge_work_packages (owner_id, id) on delete restrict
);

-- Many-to-many planning-context link between a step and a controlled
-- drawing. One step can cite several drawings; one drawing can refine
-- several steps. drawing_id is nulled (never the row deleted) when
-- the parent drawing is deleted; original_drawing_id is immutable,
-- so history still names the drawing.
create table if not exists forge_work_step_drawing_links (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  step_id text not null,
  drawing_id text,
  original_drawing_id text not null,
  refinement_note text
    check (refinement_note is null or char_length(refinement_note) <= 1000),
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, work_package_id, step_id)
    references forge_work_steps (owner_id, work_package_id, id) on delete restrict,
  foreign key (owner_id, work_package_id, drawing_id)
    references forge_work_drawings (owner_id, package_id, id) on delete restrict,
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2)
);

-- At most one ACTIVE link per step/drawing pair. A retired link never
-- blocks re-linking the same pair.
create unique index if not exists uq_forge_work_step_drawing_links_active_pair
  on forge_work_step_drawing_links (owner_id, work_package_id, step_id, drawing_id)
  where retired_at is null and drawing_id is not null;
create index if not exists idx_forge_work_step_drawing_links_owner_step
  on forge_work_step_drawing_links (owner_id, work_package_id, step_id, retired_at);
create index if not exists idx_forge_work_step_drawing_links_owner_drawing
  on forge_work_step_drawing_links (owner_id, drawing_id)
  where drawing_id is not null;

create table if not exists forge_work_step_drawing_link_revisions (
  owner_id text not null,
  id text not null,
  link_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('create', 'retire', 'parent_drawing_deleted')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, link_id, version),
  foreign key (owner_id, link_id)
    references forge_work_step_drawing_links (owner_id, id) on delete restrict
);

create index if not exists idx_forge_work_step_drawing_link_revisions_owner_link_version
  on forge_work_step_drawing_link_revisions (owner_id, link_id, version);

-- RLS, following slices 1–4's has_workspace_access convention. FORCE,
-- like slices 1–4: even the table owner must satisfy a policy, so the
-- only write path that bypasses these policies is the SECURITY DEFINER
-- RPCs below (which enforce the same checks explicitly, plus version
-- guards, inside one transaction).
alter table forge_work_steps enable row level security;
alter table forge_work_steps force row level security;
alter table forge_work_step_revisions enable row level security;
alter table forge_work_step_revisions force row level security;
alter table forge_work_step_order enable row level security;
alter table forge_work_step_order force row level security;
alter table forge_work_step_drawing_links enable row level security;
alter table forge_work_step_drawing_links force row level security;
alter table forge_work_step_drawing_link_revisions enable row level security;
alter table forge_work_step_drawing_link_revisions force row level security;

create policy forge_work_steps_workspace_select on forge_work_steps
  for select to authenticated using (has_workspace_access(owner_id));
-- Deliberately NO insert/update/delete policies: steps are written
-- only by the RPCs below, never by direct client statements.

create policy forge_work_step_revisions_workspace_select on forge_work_step_revisions
  for select to authenticated using (has_workspace_access(owner_id));

create policy forge_work_step_order_workspace_select on forge_work_step_order
  for select to authenticated using (has_workspace_access(owner_id));

create policy forge_work_step_drawing_links_workspace_select on forge_work_step_drawing_links
  for select to authenticated using (has_workspace_access(owner_id));

create policy forge_work_step_drawing_link_revisions_workspace_select on forge_work_step_drawing_link_revisions
  for select to authenticated using (has_workspace_access(owner_id));

-- Grants: SELECT only for the application role; everything else is
-- explicitly revoked (see header — the REVOKEs are load-bearing).
grant select on forge_work_steps to authenticated;
grant select on forge_work_step_revisions to authenticated;
grant select on forge_work_step_order to authenticated;
grant select on forge_work_step_drawing_links to authenticated;
grant select on forge_work_step_drawing_link_revisions to authenticated;
revoke insert, update, delete, truncate, references, trigger on forge_work_steps from authenticated;
revoke insert, update, delete, truncate, references, trigger on forge_work_step_revisions from authenticated;
revoke insert, update, delete, truncate, references, trigger on forge_work_step_order from authenticated;
revoke insert, update, delete, truncate, references, trigger on forge_work_step_drawing_links from authenticated;
revoke insert, update, delete, truncate, references, trigger on forge_work_step_drawing_link_revisions from authenticated;
revoke all on forge_work_steps from anon;
revoke all on forge_work_step_revisions from anon;
revoke all on forge_work_step_order from anon;
revoke all on forge_work_step_drawing_links from anon;
revoke all on forge_work_step_drawing_link_revisions from anon;
revoke all on forge_work_steps from service_role;
revoke all on forge_work_step_revisions from service_role;
revoke all on forge_work_step_order from service_role;
revoke all on forge_work_step_drawing_links from service_role;
revoke all on forge_work_step_drawing_link_revisions from service_role;

-- Trusted transactional write path. Each RPC enforces, in order:
-- workspace access (via has_workspace_access, which reads the caller's
-- auth.uid() — SECURITY DEFINER changes only permission checks, never
-- the caller's identity), package existence/status and same-package
-- parentage, field validation, the terminal-package rule, and the
-- optimistic version guard — then performs the mutation AND the
-- revision insert in this one transaction, so a failed revision
-- insert rolls the mutation back. The audit actor is derived inside
-- each RPC from auth.uid() — there is deliberately NO caller-supplied
-- actor parameter, so no caller can forge another actor's audit
-- history by invoking the RPC directly (slice 2's P1 lesson).
-- search_path is emptied and every reference is schema-qualified, so
-- a caller cannot redirect resolution; row_security is off so the RPC
-- is not gated by the FORCE RLS policies it is deliberately bypassing
-- (its own checks above are the gate instead).
--
-- Sequence discipline: the active steps of a package are numbered
-- 1..N contiguously. Renumbering goes through the shared internal
-- helper forge_work_step_apply_order, which parks every active step
-- at sequence_no + 1,000,000 (distinct values keep the partial
-- unique index satisfied) and then assigns final positions, bumping
-- the version and appending a 'reorder' revision for every step whose
-- position actually changed. A step created by insertion keeps
-- version 1 and gets no 'reorder' revision — its 'create' revision
-- (written after renumbering, from the re-read row) carries the
-- final position.

-- Internal: ensure the package's order row exists and lock it. The
-- caller reads the generation for the optimistic check and bumps it
-- after changing the active set or order. Not callable by the
-- application role (no EXECUTE grant below).
create or replace function public.forge_work_step_order_row(
  p_owner_id text,
  p_package_id text
)
returns public.forge_work_step_order
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_row public.forge_work_step_order%rowtype;
begin
  insert into public.forge_work_step_order (owner_id, work_package_id, generation)
    values (p_owner_id, p_package_id, 0)
    on conflict (owner_id, work_package_id) do nothing;
  select * into v_row from public.forge_work_step_order
    where owner_id = p_owner_id and work_package_id = p_package_id for update;
  return v_row;
end;
$$;

-- Internal: renumber the active steps of a package to exactly the
-- caller's order. Validates the array is the current active set (same
-- ids, no dupes, no extras); the exempt step (a step being created by
-- insertion) is moved to its final position without a version bump or
-- a 'reorder' revision — its 'create' revision covers it. Not
-- callable by the application role.
create or replace function public.forge_work_step_apply_order(
  p_owner_id text,
  p_package_id text,
  p_ordered_ids text[],
  p_exempt_step_id text,
  p_actor text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_current_sorted text[];
  v_given_sorted text[];
  v_step public.forge_work_steps%rowtype;
  v_old_seq integer;
  v_old_version integer;
  i integer;
begin
  select array_agg(id order by id) into v_current_sorted
    from public.forge_work_steps
    where owner_id = p_owner_id and work_package_id = p_package_id and retired_at is null;
  select array_agg(x order by x) into v_given_sorted
    from unnest(p_ordered_ids) as x;
  if v_current_sorted is distinct from v_given_sorted then
    raise exception 'WPP5_INVALID_ORDER';
  end if;

  -- Phase 1: park every active step far above the final range.
  update public.forge_work_steps
    set sequence_no = sequence_no + 1000000
    where owner_id = p_owner_id and work_package_id = p_package_id and retired_at is null;

  -- Phase 2: assign final positions in the caller's order.
  for i in 1 .. array_length(p_ordered_ids, 1) loop
    select * into v_step from public.forge_work_steps
      where owner_id = p_owner_id and id = p_ordered_ids[i] for update;
    v_old_seq := v_step.sequence_no - 1000000;
    v_old_version := v_step.version;
    if v_old_seq <> i then
      if p_exempt_step_id is null or v_step.id <> p_exempt_step_id then
        update public.forge_work_steps
          set sequence_no = i,
              version = version + 1,
              updated_by = p_actor,
              updated_at = now()
          where owner_id = p_owner_id and id = v_step.id
          returning * into v_step;
        insert into public.forge_work_step_revisions
          (owner_id, id, step_id, version, actor_id, action,
           old_values, new_values, reason, recorded_at)
        values
          (p_owner_id, 'forge_wpsr_' || gen_random_uuid(), v_step.id, v_step.version, p_actor, 'reorder',
           jsonb_build_object(
             'title', v_step.title,
             'sequence_no', v_old_seq,
             'version', v_old_version),
           jsonb_build_object(
             'title', v_step.title,
             'sequence_no', v_step.sequence_no,
             'version', v_step.version),
           p_reason, now());
      else
        update public.forge_work_steps
          set sequence_no = i
          where owner_id = p_owner_id and id = v_step.id;
      end if;
    else
      update public.forge_work_steps
        set sequence_no = i
        where owner_id = p_owner_id and id = v_step.id;
    end if;
  end loop;
end;
$$;

create or replace function public.forge_work_step_create(
  p_owner_id text,
  p_package_id text,
  p_title text,
  p_description text,
  p_craft_label text,
  p_planned_duration_days integer,
  p_planned_person_hours numeric,
  p_source_note text,
  p_supersedes_step_id text,
  p_insert_at integer,
  p_reason text
)
returns public.forge_work_steps
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_pkg_status text;
  v_order public.forge_work_step_order%rowtype;
  v_actor text;
  v_step public.forge_work_steps%rowtype;
  v_pred public.forge_work_steps%rowtype;
  v_title text;
  v_description text;
  v_craft_key text;
  v_craft_label text;
  v_source_note text;
  v_active_count integer;
  v_seq integer;
  v_order_ids text[];
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP5_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP5_INVALID_ACTOR';
  end if;
  select status into v_pkg_status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id;
  if not found then
    raise exception 'WPP5_PACKAGE_NOT_FOUND';
  end if;
  if v_pkg_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP5_PACKAGE_TERMINAL';
  end if;

  v_title := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  if char_length(v_title) < 1 or char_length(v_title) > 160
     or v_title !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/(),:;+-]*$' then
    raise exception 'WPP5_INVALID_TITLE';
  end if;
  if p_description is not null then
    v_description := btrim(p_description);
    if char_length(v_description) > 4000
       or v_description ~ '[[:cntrl:]]'
       or v_description ~ '<[a-zA-Z/][^>]*>' then
      raise exception 'WPP5_INVALID_DESCRIPTION';
    end if;
  else
    v_description := null;
  end if;
  if p_craft_label is not null then
    v_craft_label := btrim(regexp_replace(p_craft_label, '\s+', ' ', 'g'));
    if char_length(v_craft_label) < 1 or char_length(v_craft_label) > 80
       or v_craft_label !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$' then
      raise exception 'WPP5_INVALID_CRAFT';
    end if;
    v_craft_key := public.forge_work_craft_normalize_key(v_craft_label);
  else
    v_craft_label := null;
    v_craft_key := null;
  end if;
  if p_planned_duration_days is not null
     and (p_planned_duration_days < 1 or p_planned_duration_days > 366) then
    raise exception 'WPP5_INVALID_DURATION';
  end if;
  if p_planned_person_hours is not null
     and (p_planned_person_hours <= 0 or p_planned_person_hours > 1000000
          or p_planned_person_hours <> round(p_planned_person_hours, 2)) then
    raise exception 'WPP5_INVALID_HOURS';
  end if;
  if p_source_note is not null then
    v_source_note := btrim(p_source_note);
    if char_length(v_source_note) > 1000 or v_source_note ~ '[[:cntrl:]]' then
      raise exception 'WPP5_INVALID_NOTE';
    end if;
  else
    v_source_note := null;
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP5_REASON_TOO_LONG';
  end if;
  -- A superseded predecessor must already exist, live in this same
  -- owner/package, and be retired. Retired steps are immutable, so
  -- no supersession cycle can ever form: a cycle would need a retired
  -- step to gain a new pointer, which the update RPC refuses.
  if p_supersedes_step_id is not null then
    select * into v_pred from public.forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id
        and id = p_supersedes_step_id;
    if not found or v_pred.retired_at is null then
      raise exception 'WPP5_INVALID_SUPERSEDES';
    end if;
  end if;

  -- Row lock on the order token: concurrent creates serialize here.
  v_order := public.forge_work_step_order_row(p_owner_id, p_package_id);
  select count(*) into v_active_count from public.forge_work_steps
    where owner_id = p_owner_id and work_package_id = p_package_id and retired_at is null;
  if p_insert_at is null then
    v_seq := v_active_count + 1;
  elsif p_insert_at < 1 or p_insert_at > v_active_count + 1 then
    raise exception 'WPP5_INVALID_POSITION';
  else
    v_seq := p_insert_at;
  end if;

  insert into public.forge_work_steps
    (owner_id, id, work_package_id, title, description, sequence_no,
     craft_key, craft_label, planned_duration_days, planned_person_hours,
     source_note, supersedes_step_id, version, retired_at, retired_by,
     created_by, updated_by, created_at, updated_at)
  values
    (p_owner_id, 'forge_wps_' || gen_random_uuid(), p_package_id, v_title, v_description,
     v_active_count + 1, v_craft_key, v_craft_label,
     p_planned_duration_days, p_planned_person_hours,
     v_source_note, p_supersedes_step_id, 1, null, null,
     v_actor, v_actor, now(), now())
  returning * into v_step;

  if p_insert_at is not null then
    -- Splice the new step into the desired position; the shared
    -- renumber helper shifts the steps below it (each with a
    -- 'reorder' revision) and moves the new step without a version
    -- bump — its 'create' revision below carries the final position.
    select array_agg(id order by sequence_no) into v_order_ids
      from public.forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id and retired_at is null;
    -- Splice the new step into the desired position. The array's
    -- last element IS the new step (it was appended at the end), so
    -- the tail slice stops one short of the end or the step would
    -- appear twice and the order check would reject it.
    v_order_ids := v_order_ids[1 : v_seq - 1] || v_step.id || v_order_ids[v_seq : array_length(v_order_ids, 1) - 1];
    perform public.forge_work_step_apply_order(
      p_owner_id, p_package_id, v_order_ids, v_step.id, v_actor, p_reason);
  end if;

  update public.forge_work_step_order
    set generation = generation + 1, updated_at = now()
    where owner_id = p_owner_id and work_package_id = p_package_id;

  -- Re-read: an insertion above moved the step to its final position.
  select * into v_step from public.forge_work_steps
    where owner_id = p_owner_id and id = v_step.id;

  insert into public.forge_work_step_revisions
    (owner_id, id, step_id, version, actor_id, action,
     old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wpsr_' || gen_random_uuid(), v_step.id, 1, v_actor, 'create',
     null,
     jsonb_build_object(
       'title', v_step.title,
       'description', v_step.description,
       'sequence_no', v_step.sequence_no,
       'craft_key', v_step.craft_key,
       'craft_label', v_step.craft_label,
       'planned_duration_days', v_step.planned_duration_days,
       'planned_person_hours', v_step.planned_person_hours,
       'source_note', v_step.source_note,
       'supersedes_step_id', v_step.supersedes_step_id,
       'retired_at', v_step.retired_at,
       'version', v_step.version),
     p_reason, now());

  return v_step;
end;
$$;

create or replace function public.forge_work_step_update(
  p_owner_id text,
  p_step_id text,
  p_expected_version integer,
  p_title text,
  p_description text,
  p_craft_label text,
  p_planned_duration_days integer,
  p_planned_person_hours numeric,
  p_source_note text,
  p_set_description boolean,
  p_set_craft_label boolean,
  p_set_duration_days boolean,
  p_set_person_hours boolean,
  p_set_source_note boolean,
  p_historical_correction boolean,
  p_reason text
)
returns public.forge_work_steps
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_pkg_status text;
  v_old public.forge_work_steps%rowtype;
  v_step public.forge_work_steps%rowtype;
  v_actor text;
  v_new_title text;
  v_new_description text;
  v_new_craft_key text;
  v_new_craft_label text;
  v_new_duration_days integer;
  v_new_person_hours numeric;
  v_new_source_note text;
  v_action text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP5_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP5_INVALID_ACTOR';
  end if;
  -- Row lock: concurrent edits serialize here, so the second one sees
  -- the bumped version and fails the guard below instead of silently
  -- overwriting the first edit.
  select * into v_old from public.forge_work_steps
    where owner_id = p_owner_id and id = p_step_id for update;
  if not found then
    raise exception 'WPP5_STEP_NOT_FOUND';
  end if;
  if v_old.retired_at is not null then
    raise exception 'WPP5_RETIRED';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception 'WPP5_VERSION_CONFLICT';
  end if;
  select status into v_pkg_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_old.work_package_id;
  if not found then
    raise exception 'WPP5_PACKAGE_NOT_FOUND';
  end if;
  -- Terminal packages: only an explicit historical correction with a
  -- reason may still edit an existing step.
  if v_pkg_status in ('cancelled', 'verified_closed') then
    if coalesce(p_historical_correction, false) is not true
       or p_reason is null or btrim(p_reason) = '' then
      raise exception 'WPP5_PACKAGE_TERMINAL';
    end if;
  end if;

  -- Resolve the new values first (NULL = preserve, except the five
  -- set-flag fields, where an explicit NULL means clear — the slice-3
  -- P1 lesson: a bare NULL cannot tell "omitted" from "cleared").
  -- The title is required: it can change, never clear.
  if p_title is not null then
    v_new_title := btrim(regexp_replace(p_title, '\s+', ' ', 'g'));
    if char_length(v_new_title) < 1 or char_length(v_new_title) > 160
       or v_new_title !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/(),:;+-]*$' then
      raise exception 'WPP5_INVALID_TITLE';
    end if;
  else
    v_new_title := v_old.title;
  end if;
  if coalesce(p_set_description, false) then
    if p_description is null then
      v_new_description := null;
    else
      v_new_description := btrim(p_description);
      if char_length(v_new_description) > 4000
         or v_new_description ~ '[[:cntrl:]]'
         or v_new_description ~ '<[a-zA-Z/][^>]*>' then
        raise exception 'WPP5_INVALID_DESCRIPTION';
      end if;
    end if;
  else
    v_new_description := v_old.description;
  end if;
  if coalesce(p_set_craft_label, false) then
    if p_craft_label is null then
      v_new_craft_label := null;
      v_new_craft_key := null;
    else
      v_new_craft_label := btrim(regexp_replace(p_craft_label, '\s+', ' ', 'g'));
      if char_length(v_new_craft_label) < 1 or char_length(v_new_craft_label) > 80
         or v_new_craft_label !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$' then
        raise exception 'WPP5_INVALID_CRAFT';
      end if;
      v_new_craft_key := public.forge_work_craft_normalize_key(v_new_craft_label);
    end if;
  else
    v_new_craft_label := v_old.craft_label;
    v_new_craft_key := v_old.craft_key;
  end if;
  if coalesce(p_set_duration_days, false) then
    v_new_duration_days := p_planned_duration_days;
    if v_new_duration_days is not null
       and (v_new_duration_days < 1 or v_new_duration_days > 366) then
      raise exception 'WPP5_INVALID_DURATION';
    end if;
  else
    v_new_duration_days := v_old.planned_duration_days;
  end if;
  if coalesce(p_set_person_hours, false) then
    v_new_person_hours := p_planned_person_hours;
    if v_new_person_hours is not null
       and (v_new_person_hours <= 0 or v_new_person_hours > 1000000
            or v_new_person_hours <> round(v_new_person_hours, 2)) then
      raise exception 'WPP5_INVALID_HOURS';
    end if;
  else
    v_new_person_hours := v_old.planned_person_hours;
  end if;
  if coalesce(p_set_source_note, false) then
    if p_source_note is null then
      v_new_source_note := null;
    else
      v_new_source_note := btrim(p_source_note);
      if char_length(v_new_source_note) > 1000 or v_new_source_note ~ '[[:cntrl:]]' then
        raise exception 'WPP5_INVALID_NOTE';
      end if;
    end if;
  else
    v_new_source_note := v_old.source_note;
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP5_REASON_TOO_LONG';
  end if;

  v_action := case when coalesce(p_historical_correction, false) then 'historical_correction'
                   else 'update' end;

  update public.forge_work_steps
    set title = v_new_title,
        description = v_new_description,
        craft_key = v_new_craft_key,
        craft_label = v_new_craft_label,
        planned_duration_days = v_new_duration_days,
        planned_person_hours = v_new_person_hours,
        source_note = v_new_source_note,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_step_id
    returning * into v_step;

  insert into public.forge_work_step_revisions
    (owner_id, id, step_id, version, actor_id, action,
     old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wpsr_' || gen_random_uuid(), v_step.id, v_step.version, v_actor, v_action,
     jsonb_build_object(
       'title', v_old.title,
       'description', v_old.description,
       'sequence_no', v_old.sequence_no,
       'craft_key', v_old.craft_key,
       'craft_label', v_old.craft_label,
       'planned_duration_days', v_old.planned_duration_days,
       'planned_person_hours', v_old.planned_person_hours,
       'source_note', v_old.source_note,
       'supersedes_step_id', v_old.supersedes_step_id,
       'retired_at', v_old.retired_at,
       'version', v_old.version),
     jsonb_build_object(
       'title', v_step.title,
       'description', v_step.description,
       'sequence_no', v_step.sequence_no,
       'craft_key', v_step.craft_key,
       'craft_label', v_step.craft_label,
       'planned_duration_days', v_step.planned_duration_days,
       'planned_person_hours', v_step.planned_person_hours,
       'source_note', v_step.source_note,
       'supersedes_step_id', v_step.supersedes_step_id,
       'retired_at', v_step.retired_at,
       'version', v_step.version),
     p_reason, now());

  return v_step;
end;
$$;

create or replace function public.forge_work_step_reorder(
  p_owner_id text,
  p_package_id text,
  p_step_ids text[],
  p_expected_generation integer,
  p_reason text
)
returns setof public.forge_work_steps
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_pkg_status text;
  v_order public.forge_work_step_order%rowtype;
  v_actor text;
  v_bad boolean;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP5_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP5_INVALID_ACTOR';
  end if;
  select status into v_pkg_status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id;
  if not found then
    raise exception 'WPP5_PACKAGE_NOT_FOUND';
  end if;
  if v_pkg_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP5_PACKAGE_TERMINAL';
  end if;
  if p_step_ids is null or array_length(p_step_ids, 1) is null then
    raise exception 'WPP5_INVALID_ORDER';
  end if;
  select exists (select 1 from unnest(p_step_ids) as x where x is null or btrim(x) = '')
    into v_bad;
  if v_bad then
    raise exception 'WPP5_INVALID_ORDER';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP5_REASON_TOO_LONG';
  end if;

  -- Row lock on the order token: a concurrent reorder serializes
  -- here and fails the generation guard below instead of silently
  -- overwriting the first reorder.
  v_order := public.forge_work_step_order_row(p_owner_id, p_package_id);
  if p_expected_generation is null or v_order.generation <> p_expected_generation then
    raise exception 'WPP5_VERSION_CONFLICT';
  end if;

  perform public.forge_work_step_apply_order(
    p_owner_id, p_package_id, p_step_ids, null, v_actor, p_reason);

  update public.forge_work_step_order
    set generation = generation + 1, updated_at = now()
    where owner_id = p_owner_id and work_package_id = p_package_id;

  return query
    select * from public.forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id and retired_at is null
      order by sequence_no asc, id asc;
end;
$$;

create or replace function public.forge_work_step_retire(
  p_owner_id text,
  p_step_id text,
  p_expected_version integer,
  p_reason text,
  p_historical_correction boolean
)
returns public.forge_work_steps
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_old public.forge_work_steps%rowtype;
  v_step public.forge_work_steps%rowtype;
  v_actor text;
  v_action text;
  v_remaining_ids text[];
  v_link public.forge_work_step_drawing_links%rowtype;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP5_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP5_INVALID_ACTOR';
  end if;
  select * into v_old from public.forge_work_steps
    where owner_id = p_owner_id and id = p_step_id for update;
  if not found then
    raise exception 'WPP5_STEP_NOT_FOUND';
  end if;
  if v_old.retired_at is not null then
    raise exception 'WPP5_RETIRED';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception 'WPP5_VERSION_CONFLICT';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'WPP5_REASON_REQUIRED';
  end if;
  if char_length(p_reason) > 1000 then
    raise exception 'WPP5_REASON_TOO_LONG';
  end if;
  -- Retiring can never reactivate work, so no terminal-package
  -- block: a closed package's steps may still be retired with a
  -- reason (slice 4's retire rule, same reasoning).
  v_action := case when coalesce(p_historical_correction, false) then 'historical_correction'
                   else 'retire' end;

  update public.forge_work_steps
    set retired_at = now(),
        retired_by = v_actor,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_step_id
    returning * into v_step;

  insert into public.forge_work_step_revisions
    (owner_id, id, step_id, version, actor_id, action,
     old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wpsr_' || gen_random_uuid(), v_step.id, v_step.version, v_actor, v_action,
     jsonb_build_object(
       'title', v_old.title,
       'description', v_old.description,
       'sequence_no', v_old.sequence_no,
       'craft_key', v_old.craft_key,
       'craft_label', v_old.craft_label,
       'planned_duration_days', v_old.planned_duration_days,
       'planned_person_hours', v_old.planned_person_hours,
       'source_note', v_old.source_note,
       'supersedes_step_id', v_old.supersedes_step_id,
       'retired_at', v_old.retired_at,
       'version', v_old.version),
     jsonb_build_object(
       'title', v_step.title,
       'description', v_step.description,
       'sequence_no', v_step.sequence_no,
       'craft_key', v_step.craft_key,
       'craft_label', v_step.craft_label,
       'planned_duration_days', v_step.planned_duration_days,
       'planned_person_hours', v_step.planned_person_hours,
       'source_note', v_step.source_note,
       'supersedes_step_id', v_step.supersedes_step_id,
       'retired_at', v_step.retired_at,
       'retired_by', v_step.retired_by,
       'version', v_step.version),
     p_reason, now());

  -- Retiring a step closes its active drawing associations with
  -- audited retirement — the controlled drawings themselves are
  -- untouched, and the link history keeps the original drawing ids.
  for v_link in
    select * from public.forge_work_step_drawing_links
      where owner_id = p_owner_id and step_id = p_step_id and retired_at is null
      order by created_at asc
      for update
  loop
    update public.forge_work_step_drawing_links
      set retired_at = now(),
          retired_by = v_actor,
          version = version + 1
      where owner_id = p_owner_id and id = v_link.id
      returning * into v_link;
    insert into public.forge_work_step_drawing_link_revisions
      (owner_id, id, link_id, version, actor_id, action,
       old_values, new_values, reason, recorded_at)
    values
      (p_owner_id, 'forge_wplr_' || gen_random_uuid(), v_link.id, v_link.version, v_actor, 'retire',
       jsonb_build_object(
         'step_id', v_link.step_id,
         'drawing_id', v_link.drawing_id,
         'original_drawing_id', v_link.original_drawing_id,
         'refinement_note', v_link.refinement_note,
         'retired_at', null::timestamptz,
         'version', v_link.version - 1),
       jsonb_build_object(
         'step_id', v_link.step_id,
         'drawing_id', v_link.drawing_id,
         'original_drawing_id', v_link.original_drawing_id,
         'refinement_note', v_link.refinement_note,
         'retired_at', v_link.retired_at,
         'retired_by', v_link.retired_by,
         'version', v_link.version),
       p_reason, now());
  end loop;

  -- Close the gap: the remaining active steps renumber contiguously,
  -- each shifted step with its own 'reorder' revision.
  select array_agg(id order by sequence_no) into v_remaining_ids
    from public.forge_work_steps
    where owner_id = p_owner_id and work_package_id = v_old.work_package_id and retired_at is null;
  if v_remaining_ids is not null then
    perform public.forge_work_step_apply_order(
      p_owner_id, v_old.work_package_id, v_remaining_ids, null, v_actor, p_reason);
  end if;

  perform public.forge_work_step_order_row(p_owner_id, v_old.work_package_id);
  update public.forge_work_step_order
    set generation = generation + 1, updated_at = now()
    where owner_id = p_owner_id and work_package_id = v_old.work_package_id;

  return v_step;
end;
$$;

create or replace function public.forge_work_step_link_drawing_create(
  p_owner_id text,
  p_package_id text,
  p_step_id text,
  p_drawing_id text,
  p_refinement_note text,
  p_reason text
)
returns public.forge_work_step_drawing_links
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_pkg_status text;
  v_step public.forge_work_steps%rowtype;
  v_link public.forge_work_step_drawing_links%rowtype;
  v_actor text;
  v_note text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP5_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP5_INVALID_ACTOR';
  end if;
  select status into v_pkg_status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id;
  if not found then
    raise exception 'WPP5_PACKAGE_NOT_FOUND';
  end if;
  if v_pkg_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP5_PACKAGE_TERMINAL';
  end if;
  select * into v_step from public.forge_work_steps
    where owner_id = p_owner_id and work_package_id = p_package_id and id = p_step_id;
  if not found then
    raise exception 'WPP5_STEP_NOT_FOUND';
  end if;
  if v_step.retired_at is not null then
    raise exception 'WPP5_RETIRED';
  end if;
  if not exists (select 1 from public.forge_work_drawings
                 where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id) then
    raise exception 'WPP5_DRAWING_NOT_FOUND';
  end if;
  if p_refinement_note is not null then
    v_note := btrim(p_refinement_note);
    if char_length(v_note) > 1000 or v_note ~ '[[:cntrl:]]' then
      raise exception 'WPP5_INVALID_NOTE';
    end if;
  else
    v_note := null;
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP5_REASON_TOO_LONG';
  end if;

  begin
    insert into public.forge_work_step_drawing_links
      (owner_id, id, work_package_id, step_id, drawing_id, original_drawing_id,
       refinement_note, version, retired_at, retired_by, created_by, created_at)
    values
      (p_owner_id, 'forge_wpsl_' || gen_random_uuid(), p_package_id, p_step_id,
       p_drawing_id, p_drawing_id, v_note, 1, null, null, v_actor, now())
    returning * into v_link;
  exception when unique_violation then
    raise exception 'WPP5_DUPLICATE';
  end;

  insert into public.forge_work_step_drawing_link_revisions
    (owner_id, id, link_id, version, actor_id, action,
     old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wplr_' || gen_random_uuid(), v_link.id, 1, v_actor, 'create',
     null,
     jsonb_build_object(
       'step_id', v_link.step_id,
       'drawing_id', v_link.drawing_id,
       'original_drawing_id', v_link.original_drawing_id,
       'refinement_note', v_link.refinement_note,
       'retired_at', v_link.retired_at,
       'version', v_link.version),
     p_reason, now());

  return v_link;
end;
$$;

create or replace function public.forge_work_step_link_drawing_retire(
  p_owner_id text,
  p_link_id text,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_step_drawing_links
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_pkg_status text;
  v_old public.forge_work_step_drawing_links%rowtype;
  v_link public.forge_work_step_drawing_links%rowtype;
  v_actor text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP5_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP5_INVALID_ACTOR';
  end if;
  select * into v_old from public.forge_work_step_drawing_links
    where owner_id = p_owner_id and id = p_link_id for update;
  if not found then
    raise exception 'WPP5_LINK_NOT_FOUND';
  end if;
  if v_old.retired_at is not null then
    raise exception 'WPP5_RETIRED';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception 'WPP5_VERSION_CONFLICT';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'WPP5_REASON_REQUIRED';
  end if;
  if char_length(p_reason) > 1000 then
    raise exception 'WPP5_REASON_TOO_LONG';
  end if;
  select status into v_pkg_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_old.work_package_id;
  if not found then
    raise exception 'WPP5_PACKAGE_NOT_FOUND';
  end if;
  if v_pkg_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP5_PACKAGE_TERMINAL';
  end if;

  update public.forge_work_step_drawing_links
    set retired_at = now(),
        retired_by = v_actor,
        version = version + 1
    where owner_id = p_owner_id and id = p_link_id
    returning * into v_link;

  insert into public.forge_work_step_drawing_link_revisions
    (owner_id, id, link_id, version, actor_id, action,
     old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wplr_' || gen_random_uuid(), v_link.id, v_link.version, v_actor, 'retire',
     jsonb_build_object(
       'step_id', v_old.step_id,
       'drawing_id', v_old.drawing_id,
       'original_drawing_id', v_old.original_drawing_id,
       'refinement_note', v_old.refinement_note,
       'retired_at', v_old.retired_at,
       'version', v_old.version),
     jsonb_build_object(
       'step_id', v_link.step_id,
       'drawing_id', v_link.drawing_id,
       'original_drawing_id', v_link.original_drawing_id,
       'refinement_note', v_link.refinement_note,
       'retired_at', v_link.retired_at,
       'retired_by', v_link.retired_by,
       'version', v_link.version),
     p_reason, now());

  return v_link;
end;
$$;

-- Drawing-delete coordination (scope §3): this CREATE OR REPLACE
-- extends slice 3's forge_work_permit_annotation_delete_drawing with
-- step-link detachment, so permit cleanup AND step-link cleanup occur
-- in the SAME drawing-delete transaction. The slice-3 body below is
-- otherwise verbatim — same guards (drawing in this package, no
-- child drawings rolled up, no takeoff lines), same permit loops,
-- same final DELETE. The step-link loops mirror the permit loops:
-- active links are retired with a parent_drawing_deleted link
-- revision each; already-retired links are detached (live drawing id
-- cleared, retirement untouched) with the same revision. The
-- original_drawing_id is kept in both cases, so link history still
-- names the drawing. No new user-facing error codes: the loops only
-- touch rows the guards already proved exist.

create or replace function public.forge_work_permit_annotation_delete_drawing(
  p_owner_id text,
  p_package_id text,
  p_drawing_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_drawing public.forge_work_drawings%rowtype;
  v_actor text;
  v_annotation public.forge_work_permit_annotations%rowtype;
  v_retired_at timestamptz;
  v_retired_by text;
  v_old_version integer;
  v_link public.forge_work_step_drawing_links%rowtype;
  v_link_retired_at timestamptz;
  v_link_retired_by text;
  v_link_old_version integer;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP3_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP3_INVALID_ACTOR';
  end if;
  if not exists (select 1 from public.forge_work_packages
                 where owner_id = p_owner_id and id = p_package_id) then
    raise exception 'WPP3_PACKAGE_NOT_FOUND';
  end if;
  -- Row lock: a concurrent annotation create on this drawing
  -- serializes here, so it either lands before the delete (and is
  -- retired below) or fails against the deleted drawing after it.
  select * into v_drawing from public.forge_work_drawings
    where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id
    for update;
  if not found then
    raise exception 'WPP3_DRAWING_NOT_FOUND';
  end if;
  if exists (select 1 from public.forge_work_drawings
             where owner_id = p_owner_id and p_id_drawing_id = p_drawing_id) then
    raise exception 'WPP3_DRAWING_HAS_CHILDREN';
  end if;
  if exists (select 1 from public.forge_work_takeoff_lines
             where owner_id = p_owner_id and drawing_id = p_drawing_id) then
    raise exception 'WPP3_DRAWING_HAS_LINES';
  end if;

  -- Retire every active annotation on this drawing, with one
  -- parent_drawing_deleted revision each, in this same transaction.
  -- Package-level annotations are untouched. The live drawing id is
  -- nulled (the drawing row is about to be gone); original_drawing_id
  -- is kept, so history still names the drawing.
  for v_annotation in
    select * from public.forge_work_permit_annotations
      where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null
      order by created_at asc
      for update
  loop
    update public.forge_work_permit_annotations
      set retired_at = now(),
          retired_by = v_actor,
          drawing_id = null,
          version = version + 1,
          updated_by = v_actor,
          updated_at = now()
      where owner_id = p_owner_id and id = v_annotation.id
      returning * into v_annotation;

    insert into public.forge_work_permit_annotation_revisions
      (owner_id, id, annotation_id, version, actor_id, action,
       old_values, new_values, reason, recorded_at)
    values
      (p_owner_id, 'forge_wppr_' || gen_random_uuid(), v_annotation.id, v_annotation.version, v_actor,
       'parent_drawing_deleted',
       jsonb_build_object(
         'target_kind', 'drawing',
         'drawing_id', p_drawing_id,
         'original_drawing_id', p_drawing_id,
         'label', v_annotation.label,
         'url', v_annotation.url,
         'permit_reference', v_annotation.permit_reference,
         'note', v_annotation.note,
         'retired_at', null::timestamptz,
         'retired_by', null::text,
         'version', v_annotation.version - 1),
       jsonb_build_object(
         'target_kind', v_annotation.target_kind,
         'drawing_id', v_annotation.drawing_id,
         'original_drawing_id', v_annotation.original_drawing_id,
         'label', v_annotation.label,
         'url', v_annotation.url,
         'permit_reference', v_annotation.permit_reference,
         'note', v_annotation.note,
         'retired_at', v_annotation.retired_at,
         'retired_by', v_annotation.retired_by,
         'version', v_annotation.version),
       'Parent drawing deleted.', now());
  end loop;

  -- Detach annotations already retired before this delete: they
  -- still hold the restrictive FK on the drawing row, so the final
  -- DELETE below would fail on them. Their retirement stands
  -- (retired_at/retired_by unchanged); only the live drawing id is
  -- cleared, and the detachment is recorded with a
  -- parent_drawing_deleted revision, like the active retirements
  -- above. The version bump is required: the revision's version must
  -- stay unique per annotation.
  for v_annotation in
    select * from public.forge_work_permit_annotations
      where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is not null
      order by created_at asc
      for update
  loop
    v_retired_at := v_annotation.retired_at;
    v_retired_by := v_annotation.retired_by;
    v_old_version := v_annotation.version;

    update public.forge_work_permit_annotations
      set drawing_id = null,
          version = version + 1,
          updated_by = v_actor,
          updated_at = now()
      where owner_id = p_owner_id and id = v_annotation.id
      returning * into v_annotation;

    insert into public.forge_work_permit_annotation_revisions
      (owner_id, id, annotation_id, version, actor_id, action,
       old_values, new_values, reason, recorded_at)
    values
      (p_owner_id, 'forge_wppr_' || gen_random_uuid(), v_annotation.id, v_annotation.version, v_actor,
       'parent_drawing_deleted',
       jsonb_build_object(
         'target_kind', 'drawing',
         'drawing_id', p_drawing_id,
         'original_drawing_id', p_drawing_id,
         'label', v_annotation.label,
         'url', v_annotation.url,
         'permit_reference', v_annotation.permit_reference,
         'note', v_annotation.note,
         'retired_at', v_retired_at,
         'retired_by', v_retired_by,
         'version', v_old_version),
       jsonb_build_object(
         'target_kind', v_annotation.target_kind,
         'drawing_id', v_annotation.drawing_id,
         'original_drawing_id', v_annotation.original_drawing_id,
         'label', v_annotation.label,
         'url', v_annotation.url,
         'permit_reference', v_annotation.permit_reference,
         'note', v_annotation.note,
         'retired_at', v_annotation.retired_at,
         'retired_by', v_annotation.retired_by,
         'version', v_annotation.version),
       'Parent drawing deleted.', now());
  end loop;

  -- Slice 5: retire every active step-drawing link on this drawing,
  -- with one parent_drawing_deleted link revision each, in this same
  -- transaction. The live drawing id is nulled; original_drawing_id
  -- is kept, so link history still names the drawing. Links on other
  -- drawings are untouched.
  for v_link in
    select * from public.forge_work_step_drawing_links
      where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null
      order by created_at asc
      for update
  loop
    update public.forge_work_step_drawing_links
      set retired_at = now(),
          retired_by = v_actor,
          drawing_id = null,
          version = version + 1
      where owner_id = p_owner_id and id = v_link.id
      returning * into v_link;

    insert into public.forge_work_step_drawing_link_revisions
      (owner_id, id, link_id, version, actor_id, action,
       old_values, new_values, reason, recorded_at)
    values
      (p_owner_id, 'forge_wplr_' || gen_random_uuid(), v_link.id, v_link.version, v_actor,
       'parent_drawing_deleted',
       jsonb_build_object(
         'step_id', v_link.step_id,
         'drawing_id', p_drawing_id,
         'original_drawing_id', p_drawing_id,
         'refinement_note', v_link.refinement_note,
         'retired_at', null::timestamptz,
         'retired_by', null::text,
         'version', v_link.version - 1),
       jsonb_build_object(
         'step_id', v_link.step_id,
         'drawing_id', v_link.drawing_id,
         'original_drawing_id', v_link.original_drawing_id,
         'refinement_note', v_link.refinement_note,
         'retired_at', v_link.retired_at,
         'retired_by', v_link.retired_by,
         'version', v_link.version),
       'Parent drawing deleted.', now());
  end loop;

  -- Detach step links already retired before this delete: they still
  -- hold the restrictive FK on the drawing row, so the final DELETE
  -- below would fail on them. Their retirement stands; only the live
  -- drawing id is cleared, recorded the same way.
  for v_link in
    select * from public.forge_work_step_drawing_links
      where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is not null
      order by created_at asc
      for update
  loop
    v_link_retired_at := v_link.retired_at;
    v_link_retired_by := v_link.retired_by;
    v_link_old_version := v_link.version;

    update public.forge_work_step_drawing_links
      set drawing_id = null,
          version = version + 1
      where owner_id = p_owner_id and id = v_link.id
      returning * into v_link;

    insert into public.forge_work_step_drawing_link_revisions
      (owner_id, id, link_id, version, actor_id, action,
       old_values, new_values, reason, recorded_at)
    values
      (p_owner_id, 'forge_wplr_' || gen_random_uuid(), v_link.id, v_link.version, v_actor,
       'parent_drawing_deleted',
       jsonb_build_object(
         'step_id', v_link.step_id,
         'drawing_id', p_drawing_id,
         'original_drawing_id', p_drawing_id,
         'refinement_note', v_link.refinement_note,
         'retired_at', v_link_retired_at,
         'retired_by', v_link_retired_by,
         'version', v_link_old_version),
       jsonb_build_object(
         'step_id', v_link.step_id,
         'drawing_id', v_link.drawing_id,
         'original_drawing_id', v_link.original_drawing_id,
         'refinement_note', v_link.refinement_note,
         'retired_at', v_link.retired_at,
         'retired_by', v_link.retired_by,
         'version', v_link.version),
       'Parent drawing deleted.', now());
  end loop;

  delete from public.forge_work_drawings
    where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id;
  return true;
end;
$$;

-- RPC execution: functions are executable by PUBLIC by default, so
-- revoke that first, then grant only to the authenticated application
-- role. The two internal helpers (order row + apply order) are
-- deliberately left without an authenticated EXECUTE grant: they are
-- internal to the RPCs, and direct callers get no new surface. (The
-- SECURITY DEFINER RPCs still call them: the definer's rights apply
-- inside the RPC, so the PUBLIC revoke does not block the trusted
-- write path.) The drawing-delete function keeps its slice-3 grant,
-- re-issued here explicitly.
revoke all on function public.forge_work_step_order_row(text, text) from public;
revoke all on function public.forge_work_step_apply_order(text, text, text[], text, text, text) from public;
revoke all on function public.forge_work_step_create(text, text, text, text, text, integer, numeric, text, text, integer, text) from public;
revoke all on function public.forge_work_step_update(text, text, integer, text, text, text, integer, numeric, text, boolean, boolean, boolean, boolean, boolean, boolean, text) from public;
revoke all on function public.forge_work_step_reorder(text, text, text[], integer, text) from public;
revoke all on function public.forge_work_step_retire(text, text, integer, text, boolean) from public;
revoke all on function public.forge_work_step_link_drawing_create(text, text, text, text, text, text) from public;
revoke all on function public.forge_work_step_link_drawing_retire(text, text, integer, text) from public;
revoke all on function public.forge_work_permit_annotation_delete_drawing(text, text, text) from public;
grant execute on function public.forge_work_step_create(text, text, text, text, text, integer, numeric, text, text, integer, text) to authenticated;
grant execute on function public.forge_work_step_update(text, text, integer, text, text, text, integer, numeric, text, boolean, boolean, boolean, boolean, boolean, boolean, text) to authenticated;
grant execute on function public.forge_work_step_reorder(text, text, text[], integer, text) to authenticated;
grant execute on function public.forge_work_step_retire(text, text, integer, text, boolean) to authenticated;
grant execute on function public.forge_work_step_link_drawing_create(text, text, text, text, text, text) to authenticated;
grant execute on function public.forge_work_step_link_drawing_retire(text, text, integer, text) to authenticated;
grant execute on function public.forge_work_permit_annotation_delete_drawing(text, text, text) to authenticated;

-- No updated_at trigger: this codebase sets updated_at = now() explicitly
-- in each write path (see slice 1's migration header), and the RPCs
-- above follow that same convention.
