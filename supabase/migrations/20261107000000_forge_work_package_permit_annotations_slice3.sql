-- FORGE Work Management — Work Package Planner, slice 3: permit LINK
-- annotations on packages and drawings (forge-ai-drop
-- results/chatgpt/work-package-planner-slice3-scope-2026-11-07.md).
-- Builds on slice 1 (20261104000000) and slice 2 (20261105000000):
-- slice 1's tables must already exist — this migration applies after
-- them, never standalone.
--
-- A permit annotation is a LINK, not a permit record: a label plus an
-- HTTPS URL, with an optional permit reference and note. There is no
-- permit entity, lifecycle, status, date, or approval anywhere in this
-- slice. An annotation targets exactly one owner-scoped parent — a
-- work package or one drawing in that package — and can never be
-- retargeted. Controlled drawings (P&IDs, IFC isometrics, cut sheets)
-- stay non-editable: annotating never mutates a drawing row; the only
-- drawing mutation in this slice is the delete path below, which
-- retires attached annotations in the same transaction.
--
-- Removal is SOFT: retired_at/retired_by plus an immutable revision
-- row per action (create/update/retire/parent_drawing_deleted) in the
-- same transaction as the change. There is no hard delete of
-- annotations, no restore, and no retarget in this slice. A package
-- delete with any annotations or revisions is RESTRICTED — a package
-- archival/deletion workflow that handles history is separate work.
--
-- Migration discipline (Nov 4 lesson, slice 1 post-apply finding):
-- Supabase default privileges grant ALL on newly created public tables
-- to anon/authenticated/service_role, so a selective GRANT alone proves
-- nothing. Every privilege this migration does NOT intend is explicitly
-- REVOKED below (annotations: SELECT only for authenticated; revisions:
-- SELECT only for authenticated; anon and service_role: nothing on
-- either table). The post-apply effective-ACL receipt is still
-- mandatory before the migration gate counts complete — SQL text alone
-- is never proof.
--
-- Production apply needs Jason's separate word, same as every migration.

create table if not exists forge_work_permit_annotations (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  target_kind text not null check (target_kind in ('package', 'drawing')),
  drawing_id text,
  original_drawing_id text,
  label text not null
    check (char_length(btrim(label)) >= 1 and char_length(label) <= 160),
  url text not null
    check (char_length(url) <= 2048 and url like 'https://%' and url !~ '[[:space:][:cntrl:]]'),
  permit_reference text
    check (permit_reference is null or char_length(permit_reference) <= 120),
  note text
    check (note is null or char_length(note) <= 1000),
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
  foreign key (owner_id, work_package_id, drawing_id)
    references forge_work_drawings (owner_id, package_id, id) on delete restrict,
  -- Target/provenance discipline: a package target never carries a
  -- drawing; a drawing target keeps its original drawing id forever,
  -- and while active its live drawing id must equal that original.
  -- Retiring on parent-drawing delete nulls the live drawing id (the
  -- drawing row is gone) but keeps original_drawing_id, so history
  -- still says which drawing the link was attached to.
  check (
    (target_kind = 'package' and drawing_id is null and original_drawing_id is null)
    or (target_kind = 'drawing' and original_drawing_id is not null
        and ((retired_at is null and drawing_id = original_drawing_id)
             or (retired_at is not null and (drawing_id is null or drawing_id = original_drawing_id))))
  ),
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2)
);

create index if not exists idx_forge_work_permit_annotations_owner_package_kind
  on forge_work_permit_annotations (owner_id, work_package_id, target_kind, created_at desc);
create index if not exists idx_forge_work_permit_annotations_owner_drawing_active
  on forge_work_permit_annotations (owner_id, work_package_id, drawing_id)
  where retired_at is null;

create table if not exists forge_work_permit_annotation_revisions (
  owner_id text not null,
  id text not null,
  annotation_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in ('create', 'update', 'retire', 'parent_drawing_deleted')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 2000),
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, annotation_id, version),
  foreign key (owner_id, annotation_id)
    references forge_work_permit_annotations (owner_id, id) on delete restrict
);

create index if not exists idx_forge_work_permit_annotation_revisions_owner_annotation_version
  on forge_work_permit_annotation_revisions (owner_id, annotation_id, version);

-- RLS, following slice 1's has_workspace_access convention. FORCE, like
-- slices 1 and 2: even the table owner must satisfy a policy, so the
-- only write path that bypasses these policies is the SECURITY DEFINER
-- RPC below (which enforces the same checks explicitly, plus version
-- guards, inside one transaction).
alter table forge_work_permit_annotations enable row level security;
alter table forge_work_permit_annotations force row level security;
alter table forge_work_permit_annotation_revisions enable row level security;
alter table forge_work_permit_annotation_revisions force row level security;

create policy forge_work_permit_annotations_workspace_select on forge_work_permit_annotations
  for select to authenticated using (has_workspace_access(owner_id));
-- Deliberately NO insert/update/delete policies: annotations are
-- written only by the RPCs below, never by direct client statements.
-- (A SELECT-only grant below makes the absence load-bearing, not
-- merely conventional.)

create policy forge_work_permit_annotation_revisions_workspace_select on forge_work_permit_annotation_revisions
  for select to authenticated using (has_workspace_access(owner_id));
-- Deliberately NO insert/update/delete policies: revisions are written
-- only by the RPCs below, never by direct client statements.

-- Grants: the intended privilege shape. The explicit REVOKEs after
-- them are load-bearing (see header): without them, Supabase default
-- privileges would leave full write on both tables in the effective
-- ACL despite the selective grants. Authenticated reads through RLS;
-- every write goes through an RPC below.
grant select on forge_work_permit_annotations to authenticated;
grant select on forge_work_permit_annotation_revisions to authenticated;
revoke insert, update, delete, truncate, references, trigger on forge_work_permit_annotations from authenticated;
revoke insert, update, delete, truncate, references, trigger on forge_work_permit_annotation_revisions from authenticated;
revoke all on forge_work_permit_annotations from anon;
revoke all on forge_work_permit_annotation_revisions from anon;
revoke all on forge_work_permit_annotations from service_role;
revoke all on forge_work_permit_annotation_revisions from service_role;

-- URL validation (syntax-only, NO network fetch/DNS/HEAD at save —
-- dead links stay saved and editable). Shared by the create/update
-- RPCs so the rule is enforced at the database boundary, not only in
-- the application service: a direct RPC caller gets the same verdict
-- as the UI. Accepts an absolute HTTPS URL with a nonempty DNS host;
-- rejects credentials in the URL, localhost, loopback, and private IP
-- literals (IPv4 and IPv6). The application service normalizes the
-- URL (host lowercased) before calling; a direct RPC caller stores
-- the valid URL as supplied.
create or replace function public.forge_work_permit_annotation_url_is_valid(p_url text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_host text;
begin
  if p_url is null then return false; end if;
  if char_length(p_url) > 2048 then return false; end if;
  if p_url !~ '^https://[^[:space:][:cntrl:]]+$' then return false; end if;
  -- No credentials: nothing that looks like userinfo before the first
  -- path slash (an '@' in the path itself is fine).
  if substring(p_url from '^https://[^/]*@') is not null then return false; end if;
  -- Bracketed IPv6 literal first; otherwise the plain host up to the
  -- first port/path/query/fragment delimiter.
  v_host := lower(substring(p_url from '^https://\[([^\]]+)\]'));
  if v_host is null then
    v_host := lower(substring(p_url from '^https://([^/:?#]+)'));
  end if;
  if v_host is null or v_host = '' then return false; end if;
  if v_host = 'localhost' or v_host like '%.localhost' then return false; end if;
  if v_host = '::1' or v_host = '::' or v_host like 'fe80:%'
     or v_host like 'fc%' or v_host like 'fd%' then return false; end if;
  if v_host ~ '^127\.' or v_host = '0.0.0.0' or v_host ~ '^10\.'
     or v_host ~ '^192\.168\.' or v_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.' then return false; end if;
  return true;
end;
$$;

-- Trusted transactional write path. Each RPC enforces, in order:
-- workspace access (via has_workspace_access, which reads the caller's
-- auth.uid() — SECURITY DEFINER changes only permission checks, never
-- the caller's identity), package/drawing/annotation existence and
-- same-package parentage, field validation, and the optimistic version
-- guard — then performs the annotation mutation AND the revision
-- insert in this one transaction, so a failed revision insert rolls
-- the mutation back. The audit actor is derived inside each RPC from
-- auth.uid() — there is deliberately NO caller-supplied actor
-- parameter, so no caller can forge another actor's audit history by
-- invoking the RPC directly (slice 2 review finding P1, carried
-- forward). search_path is emptied and every reference is
-- schema-qualified, so a caller cannot redirect resolution;
-- row_security is off so the RPC is not gated by the FORCE RLS
-- policies it is deliberately bypassing (its own checks above are the
-- gate instead).
--
-- Drawing delete is a fifth RPC in this same file, not a change to
-- the old multi-step application delete: it retires every active
-- annotation on the drawing (with a parent_drawing_deleted revision
-- each) and deletes the drawing row in one transaction, so no delete
-- can orphan an annotation. The application service keeps the old
-- direct-delete path only as a fallback for the window before this
-- migration applies (when the RPC — and the annotation table itself —
-- do not exist yet, so no annotation can be orphaned).

create or replace function public.forge_work_permit_annotation_create(
  p_owner_id text,
  p_package_id text,
  p_target_kind text,
  p_drawing_id text,
  p_label text,
  p_url text,
  p_permit_reference text,
  p_note text
)
returns public.forge_work_permit_annotations
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_drawing public.forge_work_drawings%rowtype;
  v_annotation public.forge_work_permit_annotations%rowtype;
  v_actor text;
  v_label text;
  v_url text;
  v_reference text;
  v_note text;
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
  if p_target_kind is null or p_target_kind not in ('package', 'drawing') then
    raise exception 'WPP3_INVALID_TARGET';
  end if;
  if p_target_kind = 'package' and p_drawing_id is not null then
    raise exception 'WPP3_INVALID_TARGET';
  end if;
  if p_target_kind = 'drawing' then
    -- Row lock: a concurrent drawing delete serializes here, so an
    -- annotation can never be created on a drawing mid-delete.
    select * into v_drawing from public.forge_work_drawings
      where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id
      for update;
    if not found then
      raise exception 'WPP3_DRAWING_NOT_FOUND';
    end if;
  end if;
  v_label := btrim(coalesce(p_label, ''));
  if v_label = '' or char_length(v_label) > 160 then
    raise exception 'WPP3_INVALID_LABEL';
  end if;
  v_url := btrim(coalesce(p_url, ''));
  if not public.forge_work_permit_annotation_url_is_valid(v_url) then
    raise exception 'WPP3_INVALID_URL';
  end if;
  v_reference := nullif(btrim(coalesce(p_permit_reference, '')), '');
  if v_reference is not null and char_length(v_reference) > 120 then
    raise exception 'WPP3_REFERENCE_TOO_LONG';
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'WPP3_NOTE_TOO_LONG';
  end if;

  insert into public.forge_work_permit_annotations
    (owner_id, id, work_package_id, target_kind, drawing_id, original_drawing_id,
     label, url, permit_reference, note, version, retired_at, retired_by,
     created_by, updated_by, created_at, updated_at)
  values
    (p_owner_id, 'forge_wppa_' || gen_random_uuid(), p_package_id, p_target_kind,
     case when p_target_kind = 'drawing' then p_drawing_id else null end,
     case when p_target_kind = 'drawing' then p_drawing_id else null end,
     v_label, v_url, v_reference, v_note, 1, null, null,
     v_actor, v_actor, now(), now())
  returning * into v_annotation;

  insert into public.forge_work_permit_annotation_revisions
    (owner_id, id, annotation_id, version, actor_id, action,
     old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wppr_' || gen_random_uuid(), v_annotation.id, 1, v_actor, 'create',
     null,
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
     null, now());

  return v_annotation;
end;
$$;

create or replace function public.forge_work_permit_annotation_update(
  p_owner_id text,
  p_annotation_id text,
  p_expected_version integer,
  p_label text,
  p_url text,
  p_permit_reference text,
  p_note text,
  p_reason text
)
returns public.forge_work_permit_annotations
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_old public.forge_work_permit_annotations%rowtype;
  v_annotation public.forge_work_permit_annotations%rowtype;
  v_actor text;
  v_label text;
  v_url text;
  v_reference text;
  v_note text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP3_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP3_INVALID_ACTOR';
  end if;
  -- Row lock: concurrent updates serialize here, so the second one
  -- sees the bumped version and fails the guard below instead of
  -- silently overwriting the first update. The pre-update snapshot
  -- is kept for the revision row's old values.
  select * into v_old from public.forge_work_permit_annotations
    where owner_id = p_owner_id and id = p_annotation_id for update;
  if not found then
    raise exception 'WPP3_ANNOTATION_NOT_FOUND';
  end if;
  if v_old.retired_at is not null then
    raise exception 'WPP3_RETIRED';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'WPP3_VERSION_CONFLICT';
  end if;
  v_label := case when p_label is null then v_old.label else btrim(p_label) end;
  if v_label = '' or char_length(v_label) > 160 then
    raise exception 'WPP3_INVALID_LABEL';
  end if;
  v_url := case when p_url is null then v_old.url else btrim(p_url) end;
  if not public.forge_work_permit_annotation_url_is_valid(v_url) then
    raise exception 'WPP3_INVALID_URL';
  end if;
  v_reference := case when p_permit_reference is null then v_old.permit_reference
                      else nullif(btrim(p_permit_reference), '') end;
  if v_reference is not null and char_length(v_reference) > 120 then
    raise exception 'WPP3_REFERENCE_TOO_LONG';
  end if;
  v_note := case when p_note is null then v_old.note
                 else nullif(btrim(p_note), '') end;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'WPP3_NOTE_TOO_LONG';
  end if;
  if p_reason is not null and char_length(p_reason) > 2000 then
    raise exception 'WPP3_REASON_TOO_LONG';
  end if;

  update public.forge_work_permit_annotations
    set label = v_label,
        url = v_url,
        permit_reference = v_reference,
        note = v_note,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_annotation_id
    returning * into v_annotation;

  insert into public.forge_work_permit_annotation_revisions
    (owner_id, id, annotation_id, version, actor_id, action,
     old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wppr_' || gen_random_uuid(), v_annotation.id, v_annotation.version, v_actor, 'update',
     jsonb_build_object(
       'target_kind', v_old.target_kind,
       'drawing_id', v_old.drawing_id,
       'original_drawing_id', v_old.original_drawing_id,
       'label', v_old.label,
       'url', v_old.url,
       'permit_reference', v_old.permit_reference,
       'note', v_old.note,
       'retired_at', v_old.retired_at,
       'retired_by', v_old.retired_by,
       'version', v_old.version),
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
     p_reason, now());

  return v_annotation;
end;
$$;

create or replace function public.forge_work_permit_annotation_retire(
  p_owner_id text,
  p_annotation_id text,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_permit_annotations
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_old public.forge_work_permit_annotations%rowtype;
  v_annotation public.forge_work_permit_annotations%rowtype;
  v_actor text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP3_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP3_INVALID_ACTOR';
  end if;
  select * into v_old from public.forge_work_permit_annotations
    where owner_id = p_owner_id and id = p_annotation_id for update;
  if not found then
    raise exception 'WPP3_ANNOTATION_NOT_FOUND';
  end if;
  if v_old.retired_at is not null then
    raise exception 'WPP3_RETIRED';
  end if;
  if v_old.version <> p_expected_version then
    raise exception 'WPP3_VERSION_CONFLICT';
  end if;
  if p_reason is not null and char_length(p_reason) > 2000 then
    raise exception 'WPP3_REASON_TOO_LONG';
  end if;

  update public.forge_work_permit_annotations
    set retired_at = now(),
        retired_by = v_actor,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_annotation_id
    returning * into v_annotation;

  insert into public.forge_work_permit_annotation_revisions
    (owner_id, id, annotation_id, version, actor_id, action,
     old_values, new_values, reason, recorded_at)
  values
    (p_owner_id, 'forge_wppr_' || gen_random_uuid(), v_annotation.id, v_annotation.version, v_actor, 'retire',
     jsonb_build_object(
       'target_kind', v_old.target_kind,
       'drawing_id', v_old.drawing_id,
       'original_drawing_id', v_old.original_drawing_id,
       'label', v_old.label,
       'url', v_old.url,
       'permit_reference', v_old.permit_reference,
       'note', v_old.note,
       'retired_at', v_old.retired_at,
       'retired_by', v_old.retired_by,
       'version', v_old.version),
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
     p_reason, now());

  return v_annotation;
end;
$$;

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

  delete from public.forge_work_drawings
    where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id;
  return true;
end;
$$;

-- RPC execution: functions are executable by PUBLIC by default, so
-- revoke that first, then grant only to the authenticated application
-- role. Service role does not need EXECUTE here (the application path
-- is the authenticated client); direct table access by service role
-- remains a separate, server-side concern.
revoke all on function public.forge_work_permit_annotation_url_is_valid(text) from public;
revoke all on function public.forge_work_permit_annotation_create(text, text, text, text, text, text, text, text) from public;
revoke all on function public.forge_work_permit_annotation_update(text, text, integer, text, text, text, text, text) from public;
revoke all on function public.forge_work_permit_annotation_retire(text, text, integer, text) from public;
revoke all on function public.forge_work_permit_annotation_delete_drawing(text, text, text) from public;
grant execute on function public.forge_work_permit_annotation_url_is_valid(text) to authenticated;
grant execute on function public.forge_work_permit_annotation_create(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.forge_work_permit_annotation_update(text, text, integer, text, text, text, text, text) to authenticated;
grant execute on function public.forge_work_permit_annotation_retire(text, text, integer, text) to authenticated;
grant execute on function public.forge_work_permit_annotation_delete_drawing(text, text, text) to authenticated;

-- No updated_at trigger: this codebase sets updated_at = now() explicitly
-- in each write path (see slice 1's migration header), and the RPCs
-- above follow that same convention.
