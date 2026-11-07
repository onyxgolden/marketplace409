-- FORGE Work Management — Work Package Planner, slice 4: day/shift
-- craft assignments (forge-ai-drop
-- results/chatgpt/work-package-planner-slice4-scope-2026-11-07.md).
-- Builds on slices 1–3; depends only on merged slice 1 (packages)
-- and slice 2 (progress) tables for parentage — slice 3's permit
-- annotation tables are NOT referenced, so this migration applies
-- independently of slice 3's review/migration status.
--
-- An assignment is a PLAN, not proof anyone worked: one package, one
-- local work_date, one craft, one shift, with a crew size and hours
-- per person. planned_person_hours is DERIVED (crew_size x
-- hours_per_person), never stored. There is deliberately NO foreign
-- key from slice-2 progress entries to assignments (planned vs
-- actual are separate ledgers; a day-level match is a read-only
-- contextual join, never an attribution). No manpower curve, no
-- work-steps table, no notifications live here.
--
-- Craft vocabulary judgment call (scope §2): no authoritative craft
-- dictionary exists in the codebase, and the scope forbids a global
-- hardcoded restriction that excludes legitimate trades — so there is
-- NO enum CHECK on craft. Craft is a server-validated label (1–80
-- chars, letters/digits/spaces/hyphens/common punctuation) normalized
-- server-side to a stable key (trim, lowercase, collapse whitespace,
-- spaces become hyphens) by the trusted RPCs. "Welder" and "welder"
-- are the same craft for uniqueness; the stored label keeps the
-- first-entered casing for display. A datalist of common crafts in
-- the UI is a suggestion only, never a restriction.
--
-- Dates are site-local calendar dates. The operating-day assumption
-- is America/Chicago (the scope's documented fallback; no package
-- timezone setting exists, and none is invented here). "Past" for
-- the historical-correction rule is work_date < the current date in
-- America/Chicago, computed inside the RPCs — never inferred from a
-- client-supplied "today". Future dates are PLANNING dates and are
-- never refused (unlike slice 2 progress, which records actuals).
--
-- Terminal-package rule (scope §3): a cancelled/verified_closed
-- package takes no NEW assignments. Existing assignments may only be
-- corrected or retired as historical corrections (explicit intent +
-- reason), and a reassignment may never move work to a future date —
-- a closed package cannot gain future work.
--
-- Migration discipline (Nov 4 lesson, slices 1–3 post-apply
-- findings): Supabase default privileges grant ALL on newly created
-- public tables to anon/authenticated/service_role, so a selective
-- GRANT alone proves nothing. Every privilege this migration does
-- NOT intend is explicitly REVOKED below (assignments and revisions:
-- SELECT only for authenticated; anon and service_role: nothing;
-- direct writes by any application role: denied — the RPCs are the
-- only write path). The post-apply effective-ACL receipt is still
-- mandatory before the migration gate counts complete — SQL text
-- alone is never proof.
--
-- Production apply needs Jason's separate word, same as every migration.

-- Server-side normalization helpers. Immutable, so the RPCs (and any
-- future CHECK) compute exactly the key the domain layer computes in
-- JS; the two implementations are asserted equal in the migration
-- tests. Labels keep first-entered casing; keys are lowercase.
create or replace function public.forge_work_craft_normalize_label(p_label text)
returns text language sql immutable as $$
  select lower(regexp_replace(btrim(p_label), '\s+', ' ', 'g'));
$$;

create or replace function public.forge_work_craft_normalize_key(p_label text)
returns text language sql immutable as $$
  select replace(public.forge_work_craft_normalize_label(p_label), ' ', '-');
$$;

create table if not exists forge_work_craft_assignments (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  work_date date not null,
  craft_key text not null check (char_length(craft_key) between 1 and 80),
  craft_label text not null
    check (char_length(craft_label) between 1 and 80)
    check (craft_label ~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$'),
  crew_key text not null default '' check (char_length(crew_key) <= 100),
  crew_label text
    check (crew_label is null or char_length(crew_label) between 1 and 100)
    check (crew_label is null or crew_label ~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$'),
  shift_kind text not null check (shift_kind in ('day', 'night', 'other')),
  shift_label text
    check (shift_label is null or char_length(shift_label) between 1 and 60)
    check (shift_label is null or shift_label ~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$'),
  shift_key text not null check (shift_key = 'day' or shift_key = 'night' or shift_key like 'other:%'),
  crew_size integer not null check (crew_size between 1 and 500),
  hours_per_person numeric(5, 2) not null check (hours_per_person > 0 and hours_per_person <= 24),
  note text check (note is null or char_length(note) <= 1000),
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, work_package_id)
    references forge_work_packages (owner_id, id) on delete restrict,
  -- DAY/NIGHT carry no free-text label; OTHER requires one, and the
  -- key must agree with the kind. Crew: unlabeled crews use the
  -- canonical empty key, never a NULL uniqueness loophole.
  check ((shift_kind in ('day', 'night') and shift_label is null and shift_key = shift_kind)
      or (shift_kind = 'other' and shift_label is not null and shift_key like 'other:%')),
  check ((crew_label is null and crew_key = '')
      or (crew_label is not null and crew_key <> '')),
  check (retired_at is null or retired_by is not null)
);

-- At most one ACTIVE assignment per identity. Retired rows fall out
-- of the index, so a retired assignment never blocks a fresh one for
-- the same day/craft/shift/crew.
create unique index if not exists uq_forge_work_craft_assignments_active_identity
  on forge_work_craft_assignments (owner_id, work_package_id, work_date, craft_key, shift_key, crew_key)
  where retired_at is null;
create index if not exists idx_forge_work_craft_assignments_owner_package_date
  on forge_work_craft_assignments (owner_id, work_package_id, work_date);

create table if not exists forge_work_craft_assignment_revisions (
  owner_id text not null,
  id text not null,
  assignment_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('create', 'update', 'reassign', 'retire', 'historical_correction')),
  historical_correction boolean not null default false,
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 1000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, assignment_id, version),
  foreign key (owner_id, assignment_id)
    references forge_work_craft_assignments (owner_id, id) on delete restrict
);

create index if not exists idx_forge_work_craft_assignment_revisions_owner_assignment_version
  on forge_work_craft_assignment_revisions (owner_id, assignment_id, version);

-- RLS, following slices 1–3's has_workspace_access convention. FORCE,
-- like slices 1–3: even the table owner must satisfy a policy, so the
-- only write path that bypasses these policies is the SECURITY DEFINER
-- RPC below (which enforces the same checks explicitly, plus version
-- guards, inside one transaction).
alter table forge_work_craft_assignments enable row level security;
alter table forge_work_craft_assignments force row level security;
alter table forge_work_craft_assignment_revisions enable row level security;
alter table forge_work_craft_assignment_revisions force row level security;

create policy forge_work_craft_assignments_workspace_select on forge_work_craft_assignments
  for select to authenticated using (has_workspace_access(owner_id));
-- Deliberately NO insert/update/delete policies: assignments are
-- written only by the RPCs below, never by direct client statements.

create policy forge_work_craft_assignment_revisions_workspace_select on forge_work_craft_assignment_revisions
  for select to authenticated using (has_workspace_access(owner_id));
-- Deliberately NO insert/update/delete policies: revisions are written
-- only by the RPCs below, never by direct client statements.

-- Grants: SELECT only for the application role; everything else is
-- explicitly revoked (see header — the REVOKEs are load-bearing).
grant select on forge_work_craft_assignments to authenticated;
grant select on forge_work_craft_assignment_revisions to authenticated;
revoke insert, update, delete, truncate, references, trigger on forge_work_craft_assignments from authenticated;
revoke insert, update, delete, truncate, references, trigger on forge_work_craft_assignment_revisions from authenticated;
revoke all on forge_work_craft_assignments from anon;
revoke all on forge_work_craft_assignment_revisions from anon;
revoke all on forge_work_craft_assignments from service_role;
revoke all on forge_work_craft_assignment_revisions from service_role;

-- Trusted transactional write path. Each RPC enforces, in order:
-- workspace access (via has_workspace_access, which reads the caller's
-- auth.uid() — SECURITY DEFINER changes only permission checks, never
-- the caller's identity), package existence/status and same-package
-- parentage, field validation, the historical-correction rule for
-- past work dates, and the optimistic version guard — then performs
-- the assignment mutation AND the revision insert in this one
-- transaction, so a failed revision insert rolls the mutation back.
-- The audit actor is derived inside each RPC from auth.uid() — there
-- is deliberately NO caller-supplied actor parameter, so no caller can
-- forge another actor's audit history by invoking the RPC directly
-- (slice 2's P1 lesson). search_path is emptied and every reference
-- is schema-qualified, so a caller cannot redirect resolution;
-- row_security is off so the RPC is not gated by the FORCE RLS
-- policies it is deliberately bypassing (its own checks above are
-- the gate instead).
--
-- "Today" is the current date in America/Chicago (the scope's
-- documented operating-day fallback), computed here — never from a
-- client-supplied value. A duplicate active identity raises
-- WPP4_DUPLICATE instead of leaking a raw unique-violation.

create or replace function public.forge_work_craft_assignment_create(
  p_owner_id text,
  p_package_id text,
  p_work_date date,
  p_craft_label text,
  p_crew_label text,
  p_shift_kind text,
  p_shift_label text,
  p_crew_size integer,
  p_hours_per_person numeric,
  p_note text,
  p_historical_correction boolean,
  p_reason text
)
returns public.forge_work_craft_assignments
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_pkg_status text;
  v_today date;
  v_assignment public.forge_work_craft_assignments%rowtype;
  v_actor text;
  v_craft_key text;
  v_craft_label text;
  v_crew_key text;
  v_shift_key text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP4_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP4_INVALID_ACTOR';
  end if;
  select status into v_pkg_status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id;
  if not found then
    raise exception 'WPP4_PACKAGE_NOT_FOUND';
  end if;
  if v_pkg_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP4_PACKAGE_TERMINAL';
  end if;
  if p_work_date is null then
    raise exception 'WPP4_INVALID_WORK_DATE';
  end if;
  v_craft_label := btrim(regexp_replace(coalesce(p_craft_label, ''), '\s+', ' ', 'g'));
  if char_length(v_craft_label) < 1 or char_length(v_craft_label) > 80
     or v_craft_label !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$' then
    raise exception 'WPP4_INVALID_CRAFT';
  end if;
  v_craft_key := public.forge_work_craft_normalize_key(v_craft_label);
  if p_crew_label is not null then
    if char_length(btrim(regexp_replace(p_crew_label, '\s+', ' ', 'g'))) < 1
       or char_length(p_crew_label) > 100
       or btrim(regexp_replace(p_crew_label, '\s+', ' ', 'g')) !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$' then
      raise exception 'WPP4_CREW_LABEL_TOO_LONG';
    end if;
    v_crew_key := public.forge_work_craft_normalize_key(p_crew_label);
  else
    v_crew_key := '';
  end if;
  if p_shift_kind not in ('day', 'night', 'other') then
    raise exception 'WPP4_INVALID_SHIFT';
  end if;
  if p_shift_kind = 'other' then
    if p_shift_label is null
       or char_length(btrim(regexp_replace(p_shift_label, '\s+', ' ', 'g'))) < 1
       or char_length(p_shift_label) > 60
       or btrim(regexp_replace(p_shift_label, '\s+', ' ', 'g')) !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$' then
      raise exception 'WPP4_INVALID_SHIFT';
    end if;
    v_shift_key := 'other:' || public.forge_work_craft_normalize_key(p_shift_label);
  else
    if p_shift_label is not null then
      raise exception 'WPP4_INVALID_SHIFT';
    end if;
    v_shift_key := p_shift_kind;
  end if;
  if p_crew_size is null or p_crew_size < 1 or p_crew_size > 500 then
    raise exception 'WPP4_INVALID_CREW_SIZE';
  end if;
  if p_hours_per_person is null or p_hours_per_person <= 0 or p_hours_per_person > 24
     or p_hours_per_person <> round(p_hours_per_person, 2) then
    raise exception 'WPP4_INVALID_HOURS';
  end if;
  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'WPP4_NOTE_TOO_LONG';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP4_REASON_TOO_LONG';
  end if;
  -- Past work dates need an explicit historical correction with a
  -- reason; the reason is recorded in the revision, and the original
  -- plan is never erased — the revision keeps the old values.
  v_today := (now() at time zone 'America/Chicago')::date;
  if p_work_date < v_today then
    if coalesce(p_historical_correction, false) is not true then
      raise exception 'WPP4_HISTORICAL_CORRECTION_REQUIRED';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'WPP4_REASON_REQUIRED';
    end if;
  end if;

  begin
    insert into public.forge_work_craft_assignments
      (owner_id, id, work_package_id, work_date,
       craft_key, craft_label, crew_key, crew_label,
       shift_kind, shift_label, shift_key,
       crew_size, hours_per_person, note, version, retired_at, retired_by,
       created_by, updated_by, created_at, updated_at)
    values
      (p_owner_id, 'forge_wpca_' || gen_random_uuid(), p_package_id, p_work_date,
       v_craft_key, v_craft_label, v_crew_key,
       case when p_crew_label is null then null
            else btrim(regexp_replace(p_crew_label, '\s+', ' ', 'g')) end,
       p_shift_kind,
       case when p_shift_label is null then null
            else btrim(regexp_replace(p_shift_label, '\s+', ' ', 'g')) end,
       v_shift_key,
       p_crew_size, p_hours_per_person, p_note, 1, null, null,
       v_actor, v_actor, now(), now())
    returning * into v_assignment;
  exception when unique_violation then
    raise exception 'WPP4_DUPLICATE';
  end;

  insert into public.forge_work_craft_assignment_revisions
    (owner_id, id, assignment_id, version, actor_id, action,
     historical_correction, old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wpcr_' || gen_random_uuid(), v_assignment.id, 1, v_actor, 'create',
     coalesce(p_historical_correction, false),
     null,
     jsonb_build_object(
       'work_date', v_assignment.work_date,
       'craft_key', v_assignment.craft_key,
       'craft_label', v_assignment.craft_label,
       'crew_key', v_assignment.crew_key,
       'crew_label', v_assignment.crew_label,
       'shift_kind', v_assignment.shift_kind,
       'shift_label', v_assignment.shift_label,
       'shift_key', v_assignment.shift_key,
       'crew_size', v_assignment.crew_size,
       'hours_per_person', v_assignment.hours_per_person,
       'note', v_assignment.note,
       'retired_at', v_assignment.retired_at,
       'version', v_assignment.version),
     p_reason, now());

  return v_assignment;
end;
$$;

create or replace function public.forge_work_craft_assignment_update(
  p_owner_id text,
  p_assignment_id text,
  p_expected_version integer,
  p_work_date date,
  p_craft_label text,
  p_crew_label text,
  p_shift_kind text,
  p_shift_label text,
  p_crew_size integer,
  p_hours_per_person numeric,
  p_note text,
  p_set_crew_label boolean,
  p_set_shift_label boolean,
  p_set_note boolean,
  p_historical_correction boolean,
  p_reason text
)
returns public.forge_work_craft_assignments
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_pkg_status text;
  v_today date;
  v_old public.forge_work_craft_assignments%rowtype;
  v_assignment public.forge_work_craft_assignments%rowtype;
  v_actor text;
  v_new_work_date date;
  v_new_craft_key text;
  v_new_craft_label text;
  v_new_crew_key text;
  v_new_crew_label text;
  v_new_shift_kind text;
  v_new_shift_label text;
  v_new_shift_key text;
  v_is_reassign boolean;
  v_action text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP4_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP4_INVALID_ACTOR';
  end if;
  -- Row lock: concurrent edits serialize here, so the second one sees
  -- the bumped version and fails the guard below instead of silently
  -- overwriting the first edit.
  select * into v_old from public.forge_work_craft_assignments
    where owner_id = p_owner_id and id = p_assignment_id for update;
  if not found then
    raise exception 'WPP4_ASSIGNMENT_NOT_FOUND';
  end if;
  if v_old.retired_at is not null then
    raise exception 'WPP4_RETIRED';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception 'WPP4_VERSION_CONFLICT';
  end if;
  select status into v_pkg_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_old.work_package_id;
  if not found then
    raise exception 'WPP4_PACKAGE_NOT_FOUND';
  end if;

  -- Resolve the new values first (NULL = preserve, except the three
  -- set-flag fields, where an explicit NULL means clear — the slice-3
  -- P1 lesson: a bare NULL cannot tell "omitted" from "cleared").
  v_new_work_date := coalesce(p_work_date, v_old.work_date);
  if p_craft_label is not null then
    v_new_craft_label := btrim(regexp_replace(p_craft_label, '\s+', ' ', 'g'));
    if char_length(v_new_craft_label) < 1 or char_length(v_new_craft_label) > 80
       or v_new_craft_label !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$' then
      raise exception 'WPP4_INVALID_CRAFT';
    end if;
    v_new_craft_key := public.forge_work_craft_normalize_key(v_new_craft_label);
  else
    v_new_craft_label := v_old.craft_label;
    v_new_craft_key := v_old.craft_key;
  end if;
  if coalesce(p_set_crew_label, false) then
    if p_crew_label is null then
      v_new_crew_label := null;
      v_new_crew_key := '';
    else
      v_new_crew_label := btrim(regexp_replace(p_crew_label, '\s+', ' ', 'g'));
      if char_length(v_new_crew_label) < 1 or char_length(v_new_crew_label) > 100
         or v_new_crew_label !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$' then
        raise exception 'WPP4_CREW_LABEL_TOO_LONG';
      end if;
      v_new_crew_key := public.forge_work_craft_normalize_key(v_new_crew_label);
    end if;
  else
    v_new_crew_label := v_old.crew_label;
    v_new_crew_key := v_old.crew_key;
  end if;
  if p_shift_kind is not null or coalesce(p_set_shift_label, false) then
    v_new_shift_kind := coalesce(p_shift_kind, v_old.shift_kind);
    if v_new_shift_kind not in ('day', 'night', 'other') then
      raise exception 'WPP4_INVALID_SHIFT';
    end if;
    if v_new_shift_kind = 'other' then
      if coalesce(p_set_shift_label, false) then
        v_new_shift_label := case when p_shift_label is null then null
          else btrim(regexp_replace(p_shift_label, '\s+', ' ', 'g')) end;
      else
        v_new_shift_label := v_old.shift_label;
      end if;
      if v_new_shift_label is null
         or char_length(v_new_shift_label) < 1 or char_length(v_new_shift_label) > 60
         or v_new_shift_label !~ '^[A-Za-z0-9][A-Za-z0-9 .&''/-]*$' then
        raise exception 'WPP4_INVALID_SHIFT';
      end if;
      v_new_shift_key := 'other:' || public.forge_work_craft_normalize_key(v_new_shift_label);
    else
      if coalesce(p_set_shift_label, false) and p_shift_label is not null then
        raise exception 'WPP4_INVALID_SHIFT';
      end if;
      v_new_shift_label := null;
      v_new_shift_key := v_new_shift_kind;
    end if;
  else
    v_new_shift_kind := v_old.shift_kind;
    v_new_shift_label := v_old.shift_label;
    v_new_shift_key := v_old.shift_key;
  end if;
  if p_crew_size is not null and (p_crew_size < 1 or p_crew_size > 500) then
    raise exception 'WPP4_INVALID_CREW_SIZE';
  end if;
  if p_hours_per_person is not null
     and (p_hours_per_person <= 0 or p_hours_per_person > 24
          or p_hours_per_person <> round(p_hours_per_person, 2)) then
    raise exception 'WPP4_INVALID_HOURS';
  end if;
  if coalesce(p_set_note, false) then
    if p_note is not null and char_length(p_note) > 1000 then
      raise exception 'WPP4_NOTE_TOO_LONG';
    end if;
  elsif p_note is not null and char_length(p_note) > 1000 then
    raise exception 'WPP4_NOTE_TOO_LONG';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP4_REASON_TOO_LONG';
  end if;

  v_is_reassign := v_new_work_date <> v_old.work_date
    or v_new_craft_key <> v_old.craft_key
    or v_new_crew_key <> v_old.crew_key
    or v_new_shift_key <> v_old.shift_key;

  -- Past-day rule: touching a past date (old or new) needs an explicit
  -- historical correction with a reason. Terminal packages: only
  -- historical corrections, and never back to a future date.
  v_today := (now() at time zone 'America/Chicago')::date;
  if v_old.work_date < v_today or v_new_work_date < v_today then
    if coalesce(p_historical_correction, false) is not true then
      raise exception 'WPP4_HISTORICAL_CORRECTION_REQUIRED';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'WPP4_REASON_REQUIRED';
    end if;
  end if;
  if v_pkg_status in ('cancelled', 'verified_closed') then
    if coalesce(p_historical_correction, false) is not true
       or p_reason is null or btrim(p_reason) = '' then
      raise exception 'WPP4_PACKAGE_TERMINAL';
    end if;
    if v_new_work_date > v_today then
      raise exception 'WPP4_PACKAGE_TERMINAL';
    end if;
  end if;

  v_action := case when coalesce(p_historical_correction, false) then 'historical_correction'
                   when v_is_reassign then 'reassign'
                   else 'update' end;

  begin
    update public.forge_work_craft_assignments
      set work_date = v_new_work_date,
          craft_key = v_new_craft_key,
          craft_label = v_new_craft_label,
          crew_key = v_new_crew_key,
          crew_label = v_new_crew_label,
          shift_kind = v_new_shift_kind,
          shift_label = v_new_shift_label,
          shift_key = v_new_shift_key,
          crew_size = coalesce(p_crew_size, crew_size),
          hours_per_person = coalesce(p_hours_per_person, hours_per_person),
          note = case when coalesce(p_set_note, false) then p_note else note end,
          version = version + 1,
          updated_by = v_actor,
          updated_at = now()
      where owner_id = p_owner_id and id = p_assignment_id
      returning * into v_assignment;
  exception when unique_violation then
    raise exception 'WPP4_DUPLICATE';
  end;

  insert into public.forge_work_craft_assignment_revisions
    (owner_id, id, assignment_id, version, actor_id, action,
     historical_correction, old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wpcr_' || gen_random_uuid(), v_assignment.id, v_assignment.version, v_actor, v_action,
     coalesce(p_historical_correction, false),
     jsonb_build_object(
       'work_date', v_old.work_date,
       'craft_key', v_old.craft_key,
       'craft_label', v_old.craft_label,
       'crew_key', v_old.crew_key,
       'crew_label', v_old.crew_label,
       'shift_kind', v_old.shift_kind,
       'shift_label', v_old.shift_label,
       'shift_key', v_old.shift_key,
       'crew_size', v_old.crew_size,
       'hours_per_person', v_old.hours_per_person,
       'note', v_old.note,
       'retired_at', v_old.retired_at,
       'version', v_old.version),
     jsonb_build_object(
       'work_date', v_assignment.work_date,
       'craft_key', v_assignment.craft_key,
       'craft_label', v_assignment.craft_label,
       'crew_key', v_assignment.crew_key,
       'crew_label', v_assignment.crew_label,
       'shift_kind', v_assignment.shift_kind,
       'shift_label', v_assignment.shift_label,
       'shift_key', v_assignment.shift_key,
       'crew_size', v_assignment.crew_size,
       'hours_per_person', v_assignment.hours_per_person,
       'note', v_assignment.note,
       'retired_at', v_assignment.retired_at,
       'version', v_assignment.version),
     p_reason, now());

  return v_assignment;
end;
$$;

create or replace function public.forge_work_craft_assignment_retire(
  p_owner_id text,
  p_assignment_id text,
  p_expected_version integer,
  p_reason text,
  p_historical_correction boolean
)
returns public.forge_work_craft_assignments
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_today date;
  v_old public.forge_work_craft_assignments%rowtype;
  v_assignment public.forge_work_craft_assignments%rowtype;
  v_actor text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP4_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP4_INVALID_ACTOR';
  end if;
  select * into v_old from public.forge_work_craft_assignments
    where owner_id = p_owner_id and id = p_assignment_id for update;
  if not found then
    raise exception 'WPP4_ASSIGNMENT_NOT_FOUND';
  end if;
  if v_old.retired_at is not null then
    raise exception 'WPP4_RETIRED';
  end if;
  if p_expected_version is null or v_old.version <> p_expected_version then
    raise exception 'WPP4_VERSION_CONFLICT';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'WPP4_REASON_REQUIRED';
  end if;
  if char_length(p_reason) > 1000 then
    raise exception 'WPP4_REASON_TOO_LONG';
  end if;
  -- Retiring a past-day assignment is a historical correction too.
  -- (Retiring can never reactivate work, so no terminal-package
  -- block: a closed package's future assignments may still be
  -- retired with a reason.)
  v_today := (now() at time zone 'America/Chicago')::date;
  if v_old.work_date < v_today and coalesce(p_historical_correction, false) is not true then
    raise exception 'WPP4_HISTORICAL_CORRECTION_REQUIRED';
  end if;

  update public.forge_work_craft_assignments
    set retired_at = now(),
        retired_by = v_actor,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_assignment_id
    returning * into v_assignment;

  insert into public.forge_work_craft_assignment_revisions
    (owner_id, id, assignment_id, version, actor_id, action,
     historical_correction, old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wpcr_' || gen_random_uuid(), v_assignment.id, v_assignment.version, v_actor,
     case when coalesce(p_historical_correction, false) then 'historical_correction' else 'retire' end,
     coalesce(p_historical_correction, false),
     jsonb_build_object(
       'work_date', v_old.work_date,
       'craft_key', v_old.craft_key,
       'craft_label', v_old.craft_label,
       'crew_key', v_old.crew_key,
       'crew_label', v_old.crew_label,
       'shift_kind', v_old.shift_kind,
       'shift_label', v_old.shift_label,
       'shift_key', v_old.shift_key,
       'crew_size', v_old.crew_size,
       'hours_per_person', v_old.hours_per_person,
       'note', v_old.note,
       'retired_at', v_old.retired_at,
       'version', v_old.version),
     jsonb_build_object(
       'work_date', v_assignment.work_date,
       'craft_key', v_assignment.craft_key,
       'craft_label', v_assignment.craft_label,
       'crew_key', v_assignment.crew_key,
       'crew_label', v_assignment.crew_label,
       'shift_kind', v_assignment.shift_kind,
       'shift_label', v_assignment.shift_label,
       'shift_key', v_assignment.shift_key,
       'crew_size', v_assignment.crew_size,
       'hours_per_person', v_assignment.hours_per_person,
       'note', v_assignment.note,
       'retired_at', v_assignment.retired_at,
       'version', v_assignment.version),
     p_reason, now());

  return v_assignment;
end;
$$;

-- RPC execution: functions are executable by PUBLIC by default, so
-- revoke that first, then grant only to the authenticated application
-- role. Service role does not need EXECUTE here (the application path
-- is the authenticated client); direct table access by service role
-- remains a separate, server-side concern. The normalization helpers
-- are deliberately left without an authenticated EXECUTE grant: they
-- are internal to the RPCs, and direct callers get no new surface.
-- (The SECURITY DEFINER RPCs below still call them: the definer's
-- rights apply inside the RPC, so the PUBLIC revoke does not block
-- the trusted write path.)
revoke all on function public.forge_work_craft_normalize_label(text) from public;
revoke all on function public.forge_work_craft_normalize_key(text) from public;
revoke all on function public.forge_work_craft_assignment_create(text, text, date, text, text, text, text, integer, numeric, text, boolean, text) from public;
revoke all on function public.forge_work_craft_assignment_update(text, text, integer, date, text, text, text, text, integer, numeric, text, boolean, boolean, boolean, boolean, text) from public;
revoke all on function public.forge_work_craft_assignment_retire(text, text, integer, text, boolean) from public;
grant execute on function public.forge_work_craft_assignment_create(text, text, date, text, text, text, text, integer, numeric, text, boolean, text) to authenticated;
grant execute on function public.forge_work_craft_assignment_update(text, text, integer, date, text, text, text, text, integer, numeric, text, boolean, boolean, boolean, boolean, text) to authenticated;
grant execute on function public.forge_work_craft_assignment_retire(text, text, integer, text, boolean) to authenticated;

-- No updated_at trigger: this codebase sets updated_at = now() explicitly
-- in each write path (see slice 1's migration header), and the RPCs
-- above follow that same convention.
