-- FORGE Work Management — Work Package Planner, slice 2: daily installed-
-- quantity progress against takeoff lines, with computed cumulative
-- totals (forge-ai-drop results/chatgpt/work-package-planner-slice2-scope-
-- 2026-11-04.md). Builds on slice 1 (20261104000000): slice 1's tables
-- must already exist — this migration applies after it, never standalone.
--
-- Progress is an independent ledger of quantities, NOT an edit to the
-- controlled drawing or the takeoff baseline: progress operations never
-- UPDATE/DELETE forge_work_drawings, and there is deliberately NO
-- DELETE grant or policy on progress entries either — a wrong entry is
-- corrected or voided, never hard-deleted, and every change leaves an
-- immutable revision row.
--
-- Same-package discipline (slice 1's WPP1-002 lesson, carried forward):
-- takeoff lines gain a backfilled package_id so entries can reference a
-- line inside exactly one package at the database level:
--   entries (owner_id, work_package_id, takeoff_line_id)
--     -> takeoff_lines (owner_id, package_id, id)
-- and lines gain (owner_id, package_id, drawing_id) -> drawings
-- (owner_id, package_id, id), so a line's package can never drift from
-- its drawing's package. Cross-package or cross-owner references fail
-- at the foreign key AND at the application/RPC boundary.
--
-- Migration discipline (Nov 4 lesson, slice 1 post-apply finding):
-- Supabase default privileges grant ALL on newly created public tables
-- to anon/authenticated/service_role, so a selective GRANT alone proves
-- nothing. Every privilege this migration does NOT intend is explicitly
-- REVOKED below (entries: no DELETE; revisions: SELECT only for the
-- application roles; anon: nothing). The post-apply effective-ACL
-- receipt is still mandatory before the migration gate counts complete
-- — SQL text alone is never proof.
--
-- Production apply needs Jason's separate word, same as every migration.

-- Slice-1 takeoff lines gain their package, backfilled from the parent
-- drawing. Every line already has a drawing (slice-1 FK enforced), so
-- the backfill always finds a package.
alter table forge_work_takeoff_lines add column if not exists package_id text;
update forge_work_takeoff_lines l
  set package_id = d.package_id
  from forge_work_drawings d
  where l.owner_id = d.owner_id
    and l.drawing_id = d.id
    and l.package_id is null;
alter table forge_work_takeoff_lines alter column package_id set not null;
alter table forge_work_takeoff_lines
  add constraint forge_work_takeoff_lines_owner_package_id_key
  unique (owner_id, package_id, id);
alter table forge_work_takeoff_lines
  add constraint forge_work_takeoff_lines_owner_package_drawing_fk
  foreign key (owner_id, package_id, drawing_id)
  references forge_work_drawings (owner_id, package_id, id);

create table if not exists forge_work_progress_entries (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  takeoff_line_id text not null,
  work_date date not null,
  installed_quantity numeric(18, 4) not null check (installed_quantity >= 0),
  note text check (note is null or char_length(note) <= 2000),
  version integer not null default 1 check (version >= 1),
  voided_at timestamptz,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, work_package_id)
    references forge_work_packages (owner_id, id) on delete restrict,
  foreign key (owner_id, work_package_id, takeoff_line_id)
    references forge_work_takeoff_lines (owner_id, package_id, id) on delete restrict,
  check (voided_at is null or version >= 2)
);

create index if not exists idx_forge_work_progress_entries_owner_package_date
  on forge_work_progress_entries (owner_id, work_package_id, work_date);
create index if not exists idx_forge_work_progress_entries_owner_line_date
  on forge_work_progress_entries (owner_id, takeoff_line_id, work_date);

create table if not exists forge_work_progress_revisions (
  owner_id text not null,
  id text not null,
  entry_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('create', 'update', 'void')),
  old_quantity numeric(18, 4),
  new_quantity numeric(18, 4),
  old_work_date date,
  new_work_date date,
  reason text check (reason is null or char_length(reason) <= 2000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, entry_id, version),
  foreign key (owner_id, entry_id)
    references forge_work_progress_entries (owner_id, id) on delete restrict
);

create index if not exists idx_forge_work_progress_revisions_owner_entry_version
  on forge_work_progress_revisions (owner_id, entry_id, version);

-- RLS, following slice 1's has_workspace_access convention. FORCE, like
-- slice 1: even the table owner must satisfy a policy, so the only
-- write path that bypasses these policies is the SECURITY DEFINER RPC
-- below (which enforces the same checks explicitly, plus version
-- guards, inside one transaction).
alter table forge_work_progress_entries enable row level security;
alter table forge_work_progress_entries force row level security;
alter table forge_work_progress_revisions enable row level security;
alter table forge_work_progress_revisions force row level security;

create policy forge_work_progress_entries_workspace_select on forge_work_progress_entries
  for select to authenticated using (has_workspace_access(owner_id));
create policy forge_work_progress_entries_workspace_insert on forge_work_progress_entries
  for insert to authenticated with check (has_workspace_access(owner_id));
create policy forge_work_progress_entries_workspace_update on forge_work_progress_entries
  for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
-- Deliberately NO delete policy: entries are voided, never deleted.

create policy forge_work_progress_revisions_workspace_select on forge_work_progress_revisions
  for select to authenticated using (has_workspace_access(owner_id));
-- Deliberately NO insert/update/delete policies: revisions are written
-- only by the RPCs below, never by direct client statements.

-- Grants: the intended privilege shape. The explicit REVOKEs after
-- them are load-bearing (see header): without them, Supabase default
-- privileges would leave DELETE/TRUNCATE on entries and full write on
-- revisions in the effective ACL despite the selective grants.
grant select, insert, update on forge_work_progress_entries to authenticated;
grant select on forge_work_progress_revisions to authenticated;
revoke delete, truncate, references, trigger on forge_work_progress_entries from authenticated;
revoke insert, update, delete, truncate, references, trigger on forge_work_progress_revisions from authenticated;
revoke all on forge_work_progress_entries from anon;
revoke all on forge_work_progress_revisions from anon;

-- Trusted transactional write path. Each RPC enforces, in order:
-- workspace access (via has_workspace_access, which reads the caller's
-- auth.uid() — SECURITY DEFINER changes only permission checks, never
-- the caller's identity), package/line/entry existence and same-package
-- parentage, field validation, and the optimistic version guard — then
-- performs the entry mutation AND the revision insert in this one
-- transaction, so a failed revision insert rolls the mutation back.
-- search_path is emptied and every reference is schema-qualified, so a
-- caller cannot redirect resolution; row_security is off so the RPC is
-- not gated by the FORCE RLS policies it is deliberately bypassing
-- (its own checks above are the gate instead).
create or replace function public.forge_work_progress_create(
  p_owner_id text,
  p_package_id text,
  p_line_id text,
  p_work_date date,
  p_quantity numeric,
  p_note text,
  p_actor text
)
returns public.forge_work_progress_entries
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_line public.forge_work_takeoff_lines%rowtype;
  v_drawing public.forge_work_drawings%rowtype;
  v_entry public.forge_work_progress_entries%rowtype;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP2_WORKSPACE_FORBIDDEN';
  end if;
  if not exists (select 1 from public.forge_work_packages
                 where owner_id = p_owner_id and id = p_package_id) then
    raise exception 'WPP2_PACKAGE_NOT_FOUND';
  end if;
  select * into v_line from public.forge_work_takeoff_lines
    where owner_id = p_owner_id and id = p_line_id;
  if not found then
    raise exception 'WPP2_LINE_NOT_FOUND';
  end if;
  select * into v_drawing from public.forge_work_drawings
    where owner_id = p_owner_id and id = v_line.drawing_id;
  if not found or v_drawing.package_id <> p_package_id then
    raise exception 'WPP2_LINE_NOT_IN_PACKAGE';
  end if;
  if p_work_date is null then
    raise exception 'WPP2_INVALID_WORK_DATE';
  end if;
  if p_work_date > CURRENT_DATE then
    raise exception 'WPP2_FUTURE_DATE';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity <> round(p_quantity, 4) then
    raise exception 'WPP2_INVALID_QUANTITY';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'WPP2_NOTE_TOO_LONG';
  end if;
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'WPP2_INVALID_ACTOR';
  end if;

  insert into public.forge_work_progress_entries
    (owner_id, id, work_package_id, takeoff_line_id, work_date,
     installed_quantity, note, version, voided_at,
     created_by, updated_by, created_at, updated_at)
  values
    (p_owner_id, 'forge_wprg_' || gen_random_uuid(), p_package_id, p_line_id, p_work_date,
     p_quantity, p_note, 1, null,
     p_actor, p_actor, now(), now())
  returning * into v_entry;

  insert into public.forge_work_progress_revisions
    (owner_id, id, entry_id, version, actor_id, action,
     old_quantity, new_quantity, old_work_date, new_work_date, reason, recorded_at)
  values
    (p_owner_id, 'forge_wprv_' || gen_random_uuid(), v_entry.id, 1, p_actor, 'create',
     null, p_quantity, null, p_work_date, null, now());

  return v_entry;
end;
$$;

create or replace function public.forge_work_progress_correct(
  p_owner_id text,
  p_entry_id text,
  p_expected_version integer,
  p_quantity numeric,
  p_work_date date,
  p_note text,
  p_reason text,
  p_actor text
)
returns public.forge_work_progress_entries
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_old public.forge_work_progress_entries%rowtype;
  v_entry public.forge_work_progress_entries%rowtype;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP2_WORKSPACE_FORBIDDEN';
  end if;
  -- Row lock: concurrent corrections serialize here, so the second one
  -- sees the bumped version and fails the guard below instead of
  -- silently overwriting the first correction. The pre-update snapshot
  -- is kept for the revision row's old values.
  select * into v_old from public.forge_work_progress_entries
    where owner_id = p_owner_id and id = p_entry_id for update;
  if not found then
    raise exception 'WPP2_ENTRY_NOT_FOUND';
  end if;
  if v_old.voided_at is not null then
    raise exception 'WPP2_VOIDED';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'WPP2_VERSION_CONFLICT';
  end if;
  if p_quantity is not null and (p_quantity < 0 or p_quantity <> round(p_quantity, 4)) then
    raise exception 'WPP2_INVALID_QUANTITY';
  end if;
  if p_work_date is not null and p_work_date > CURRENT_DATE then
    raise exception 'WPP2_FUTURE_DATE';
  end if;
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'WPP2_NOTE_TOO_LONG';
  end if;
  if p_reason is not null and char_length(p_reason) > 2000 then
    raise exception 'WPP2_REASON_TOO_LONG';
  end if;
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'WPP2_INVALID_ACTOR';
  end if;

  update public.forge_work_progress_entries
    set installed_quantity = coalesce(p_quantity, installed_quantity),
        work_date = coalesce(p_work_date, work_date),
        note = coalesce(p_note, note),
        version = version + 1,
        updated_by = p_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_entry_id
    returning * into v_entry;

  insert into public.forge_work_progress_revisions
    (owner_id, id, entry_id, version, actor_id, action,
     old_quantity, new_quantity, old_work_date, new_work_date, reason, recorded_at)
  values
    (p_owner_id, 'forge_wprv_' || gen_random_uuid(), v_entry.id, v_entry.version, p_actor, 'update',
     v_old.installed_quantity, v_entry.installed_quantity,
     v_old.work_date, v_entry.work_date, p_reason, now());

  return v_entry;
end;
$$;

create or replace function public.forge_work_progress_void(
  p_owner_id text,
  p_entry_id text,
  p_expected_version integer,
  p_reason text,
  p_actor text
)
returns public.forge_work_progress_entries
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_old public.forge_work_progress_entries%rowtype;
  v_entry public.forge_work_progress_entries%rowtype;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP2_WORKSPACE_FORBIDDEN';
  end if;
  select * into v_old from public.forge_work_progress_entries
    where owner_id = p_owner_id and id = p_entry_id for update;
  if not found then
    raise exception 'WPP2_ENTRY_NOT_FOUND';
  end if;
  if v_old.voided_at is not null then
    raise exception 'WPP2_VOIDED';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'WPP2_VERSION_CONFLICT';
  end if;
  if p_reason is not null and char_length(p_reason) > 2000 then
    raise exception 'WPP2_REASON_TOO_LONG';
  end if;
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'WPP2_INVALID_ACTOR';
  end if;

  update public.forge_work_progress_entries
    set voided_at = now(),
        version = version + 1,
        updated_by = p_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_entry_id
    returning * into v_entry;

  insert into public.forge_work_progress_revisions
    (owner_id, id, entry_id, version, actor_id, action,
     old_quantity, new_quantity, old_work_date, new_work_date, reason, recorded_at)
  values
    (p_owner_id, 'forge_wprv_' || gen_random_uuid(), v_entry.id, v_entry.version, p_actor, 'void',
     v_old.installed_quantity, v_old.installed_quantity,
     v_old.work_date, v_old.work_date, p_reason, now());

  return v_entry;
end;
$$;

-- RPC execution: functions are executable by PUBLIC by default, so
-- revoke that first, then grant only to the authenticated application
-- role. Service role does not need EXECUTE here (the application path
-- is the authenticated client); direct table access by service role
-- remains a separate, server-side concern.
revoke all on function public.forge_work_progress_create(text, text, text, date, numeric, text, text) from public;
revoke all on function public.forge_work_progress_correct(text, text, integer, numeric, date, text, text, text) from public;
revoke all on function public.forge_work_progress_void(text, text, integer, text, text) from public;
grant execute on function public.forge_work_progress_create(text, text, text, date, numeric, text, text) to authenticated;
grant execute on function public.forge_work_progress_correct(text, text, integer, numeric, date, text, text, text) to authenticated;
grant execute on function public.forge_work_progress_void(text, text, integer, text, text) to authenticated;

-- No updated_at trigger: this codebase sets updated_at = now() explicitly
-- in each write path (see slice 1's migration header), and the RPCs
-- above follow that same convention.
