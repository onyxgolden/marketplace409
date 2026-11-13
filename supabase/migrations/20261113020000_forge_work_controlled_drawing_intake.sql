-- FORGE Work Management — Slice-7 PDF test blockers: controlled PDF
-- drawing intake (PR: slice7-pdf-blockers).
--
-- What this migration does, and why:
--
-- 1. `forge_work_drawings.line_number` — the controlled intake records
--    the process line a drawing depicts (e.g. 2"-PL-101). The column is
--    nullable: existing drawings predate intake and keep working.
--
-- 2. `forge_work_drawings.intake_source` + a relaxed parentage CHECK.
--    Slice-6 (takeoff) forces every non-P&ID drawing to name a P&ID
--    parent (`p_id_drawing_id IS NOT NULL`), which is correct for
--    takeoff rollup — but a package with no P&ID at all (WP-0008 /
--    WP-0009 today) could then never receive its first controlled
--    isometric, which is exactly the test this slice unblocks. The
--    relaxed CHECK permits a null parent ONLY when
--    intake_source = 'controlled_pdf', i.e. only for a drawing envelope
--    created by the verified controlled-PDF intake RPC below. The
--    takeoff createDrawing path still requires a P&ID parent in its
--    own domain validation and never sets intake_source, so the
--    takeoff invariant is unchanged for every other writer. A
--    parentless controlled drawing has no takeoff rollup target until
--    a P&ID is linked (the intake accepts an optional P&ID parent, and
--    only fills a null parent — it never re-parents). Existing rows all
--    satisfy the new CHECK (they passed the old one), so the swap is
--    safe on live data.
--
-- 3. `forge_wp_drawing_artifacts` — one row per stored controlled
--    byte object. The row IS the idempotent audit receipt: request_id,
--    bucket + object_path, content SHA-256 + length, purpose, the
--    revision it was issued as (null while staged for IFC), actor and
--    time. No parallel drawing/revision model: revisions stay the
--    canonical `forge_wp_drawing_revisions` rows, reviews/redlines stay
--    the slice-7 tables, and the IFC release stays the existing RPC.
--    `purpose` is 'ifa_issued' (bytes issued as an IFA revision),
--    'ifc_candidate' (bytes staged, pending the atomic release) or
--    'ifc_issued' (bytes attached to a completed IFC release).
--
-- 4. `controlled-drawings` storage bucket (private, PDF-only, 25 MB)
--    with the same owner-scoped policies as `work-documents`, plus an
--    orphan-cleanup delete policy: only objects no artifact row
--    references can ever be removed, so issued history is append-only.
--
-- 5. RPC `forge_wp_drawing_controlled_intake` — resolve-or-create the
--    drawing envelope by exact (owner, package, drawing number) with a
--    type check, attach one immutable IFA revision per revision code,
--    record the artifact. Request-id replay is bound to the operation
--    and full semantic target (purpose ifa_issued, package, drawing
--    number/type/revision code, digest) — fix round 1; the unique
--    constraints are the final arbiter, and the concurrent-duplicate
--    fallback applies the same binding.
--
-- 6. RPC `forge_wp_drawing_ifc_stage` — stage a DIFFERENT
--    drafter-issued PDF as an IFC candidate. Staged bytes stay pending
--    (no revision is created) until the release RPC attaches them.
--    Staging rejects bytes identical to the latest issued revision, so
--    an IFA artifact can never be staged as its own IFC. Request-id
--    replay is bound to the operation and target (purpose
--    ifc_candidate, package, exact drawing, digest) — fix round 1.
--
-- 7. `forge_wp_drawing_ifc_release` gains an optional
--    p_staged_artifact_id — and, fix round 1, REQUIRES it. The
--    staged bytes are authoritative (document_ref + SHA-256 come from
--    the artifact row, never from caller-typed text) and the artifact
--    is attached to the new IFC revision. A null staged artifact id
--    is rejected (WPP7_STAGED_ARTIFACT_REQUIRED), so the typed
--    release path is closed: no IFC revision can be issued from a
--    fabricated hash/reference. p_document_ref / p_content_sha256
--    stay in the signature only for call-shape compatibility and are
--    never read. An IFC issue whose digest equals the reviewed IFA
--    revision's digest is rejected (an IFA artifact can never be
--    relabelled as its own IFC). The old 8-argument signature is
--    dropped and recreated with the new defaulted parameter; grants
--    are re-applied after the drop.
--
-- 8. `forge_wp_drawing_retire` (same signature) also retires the
--    drawing's artifact rows, so a retired drawing's staged candidates
--    can never be released. Retired bytes stay on file as history.
--
-- Roles: intake and staging gate on has_workspace_access (owner /
-- co-owner) only. No DB-level per-capability check exists for slice-7
-- RPCs in production today (forge_has_app_capability lives only in the
-- unapplied Auth PR 1 migration, and no drawing_ifc.issue capability
-- key exists), so non-owner members default-deny. The application
-- layer enforces the same gate before calling these RPCs.
--
-- File-only through review/merge. Apply needs Jason's separate word.

-- ---------------------------------------------------------------------------
-- Drawing envelope: line number + intake source; relaxed parentage CHECK
-- ---------------------------------------------------------------------------

alter table public.forge_work_drawings
  add column if not exists line_number text,
  add column if not exists intake_source text;

alter table public.forge_work_drawings
  drop constraint if exists forge_work_drawings_line_number_check;
alter table public.forge_work_drawings
  add constraint forge_work_drawings_line_number_check
  check (line_number is null or (btrim(line_number) <> '' and char_length(line_number) <= 120));

alter table public.forge_work_drawings
  drop constraint if exists forge_work_drawings_intake_source_check;
alter table public.forge_work_drawings
  add constraint forge_work_drawings_intake_source_check
  check (intake_source is null or intake_source = 'controlled_pdf');

-- The old parentage CHECK (verified in production as
-- forge_work_drawings_check) is replaced by the same rule plus the
-- controlled-intake exception: a non-P&ID drawing may have a null P&ID
-- parent only when it was created by the verified controlled-PDF
-- intake. The comparison is IS NOT DISTINCT FROM, not plain =: a
-- CHECK passes when its expression is NULL, and intake_source is NULL
-- on every pre-intake row, so a plain = would let a parentless
-- non-P&ID drawing with no intake source slip through (caught by the
-- migration test). Every row that satisfied the old CHECK satisfies
-- the new one.
alter table public.forge_work_drawings
  drop constraint if exists forge_work_drawings_check;
alter table public.forge_work_drawings
  add constraint forge_work_drawings_check
  check (
    (drawing_type = 'p_id' and p_id_drawing_id is null)
    or (drawing_type <> 'p_id' and (p_id_drawing_id is not null or intake_source is not distinct from 'controlled_pdf'))
  );

-- ---------------------------------------------------------------------------
-- Controlled-drawing artifacts: one row per stored byte object.
-- The row is the idempotent audit receipt for its intake/stage.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_wp_drawing_artifacts (
  owner_id text not null,
  id text not null,
  package_id text not null,
  drawing_id text not null,
  revision_id text,
  purpose text not null check (purpose in ('ifa_issued', 'ifc_candidate', 'ifc_issued')),
  bucket text not null default 'controlled-drawings' check (bucket = 'controlled-drawings'),
  object_path text not null check (btrim(object_path) <> '' and char_length(object_path) <= 1000),
  original_filename text check (original_filename is null or (btrim(original_filename) <> '' and char_length(original_filename) <= 255)),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-fA-F]{64}$'),
  content_length bigint not null check (content_length > 0 and content_length <= 26214400),
  request_id text check (request_id is null or (btrim(request_id) <> '' and char_length(request_id) <= 128)),
  created_by text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by text,
  primary key (owner_id, id),
  unique (bucket, object_path),
  foreign key (owner_id, package_id, drawing_id)
    references public.forge_work_drawings (owner_id, package_id, id)
    on delete restrict,
  foreign key (owner_id, package_id, drawing_id, revision_id)
    references public.forge_wp_drawing_revisions (owner_id, package_id, drawing_id, id)
    on delete restrict,
  check (split_part(object_path, '/', 1) = owner_id),
  check (retired_at is null or retired_by is not null)
);

-- Request-id replay: one finalized receipt per request id per workspace.
create unique index if not exists forge_wp_drawing_artifacts_request_uq
  on public.forge_wp_drawing_artifacts (owner_id, request_id)
  where request_id is not null;

create index if not exists forge_wp_drawing_artifacts_drawing_idx
  on public.forge_wp_drawing_artifacts (owner_id, package_id, drawing_id, created_at desc, id);

create index if not exists forge_wp_drawing_artifacts_active_candidate_idx
  on public.forge_wp_drawing_artifacts (owner_id, drawing_id, purpose)
  where retired_at is null;

-- ---------------------------------------------------------------------------
-- Row-level security: owner-scoped SELECT only, forced on every role.
-- Writes go through the SECURITY DEFINER RPCs below; no direct
-- app-client mutations (mirrors slices 3–7).
-- ---------------------------------------------------------------------------

alter table public.forge_wp_drawing_artifacts enable row level security;
alter table public.forge_wp_drawing_artifacts force row level security;

drop policy if exists forge_wp_drawing_artifacts_select on public.forge_wp_drawing_artifacts;
create policy forge_wp_drawing_artifacts_select
  on public.forge_wp_drawing_artifacts for select to authenticated
  using (has_workspace_access(owner_id));

revoke all on table public.forge_wp_drawing_artifacts from public, anon, service_role, authenticated;
grant select on table public.forge_wp_drawing_artifacts to authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket: controlled-drawings (private, PDF-only, 25 MB).
-- Object paths are <owner_id>/<package_id>/<request_id>/<sha256>.pdf,
-- so the first path segment is always the workspace owner.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('controlled-drawings', 'controlled-drawings', false, 26214400,
  array['application/pdf'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "controlled_drawing_objects_workspace_select" on storage.objects;
create policy "controlled_drawing_objects_workspace_select" on storage.objects for select to authenticated
  using (bucket_id = 'controlled-drawings' and has_workspace_access((storage.foldername(name))[1]));

drop policy if exists "controlled_drawing_objects_workspace_insert" on storage.objects;
create policy "controlled_drawing_objects_workspace_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'controlled-drawings' and has_workspace_access((storage.foldername(name))[1]));

-- Failed-upload cleanup: the API removes the uploaded storage object
-- when the database write fails, but with no storage delete policy that
-- cleanup is denied and orphaned files accumulate. This policy allows
-- deleting ONLY objects no artifact row references — an issued file
-- (historical evidence) can never be removed through it, even by its
-- owner. The API's cleanup path only runs after a failed write, and the
-- not-exists check protects the lost-response case where the row was
-- actually created.
drop policy if exists "controlled_drawing_objects_orphan_cleanup" on storage.objects;
create policy "controlled_drawing_objects_orphan_cleanup" on storage.objects for delete to authenticated
  using (bucket_id = 'controlled-drawings'
    and has_workspace_access((storage.foldername(name))[1])
    and not exists (
      select 1 from forge_wp_drawing_artifacts a
      where a.bucket = 'controlled-drawings'
        and a.object_path = storage.objects.name
    ));

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_controlled_intake
-- Upload one verified controlled PDF as an immutable IFA revision.
-- Resolves the drawing envelope by exact (owner, package, drawing
-- number) with a type check, or creates it (parentless only via this
-- RPC, marked intake_source = 'controlled_pdf'). One immutable
-- revision per revision code under the existing unique constraint.
-- The stored bytes are addressed by the route as
-- <owner_id>/<package_id>/<request_id>/<sha256>.pdf; this RPC verifies
-- the path prefix and records the artifact row, which is the
-- idempotent audit receipt. A retry with the same request id and the
-- same digest returns the original receipt; a different digest under
-- the same request id conflicts (WPP7_IDEMPOTENCY_CONFLICT).
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_controlled_intake(
  p_owner_id text,
  p_package_id text,
  p_drawing_number text,
  p_drawing_type text,
  p_revision_code text,
  p_object_path text,
  p_content_sha256 text,
  p_content_length bigint,
  p_request_id text,
  p_line_number text default null,
  p_issued_at timestamptz default null,
  p_issuer_ref text default null,
  p_title text default null,
  p_p_id_drawing_id text default null,
  p_original_filename text default null
)
returns setof public.forge_wp_drawing_artifacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_status text;
  v_drawing public.forge_work_drawings%rowtype;
  v_existing public.forge_wp_drawing_artifacts%rowtype;
  v_pid public.forge_work_drawings%rowtype;
  v_replay_drawing public.forge_work_drawings%rowtype;
  v_replay_revision public.forge_wp_drawing_revisions%rowtype;
  v_drawing_id text;
  v_revision_id text;
  v_artifact_id text;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_drawing_number is null or btrim(p_drawing_number) = '' or char_length(p_drawing_number) > 120 then
    raise exception 'WPP7_INVALID_DRAWING_NUMBER';
  end if;
  if p_drawing_type is null or p_drawing_type not in ('p_id', 'cut_sheet', 'isometric') then
    raise exception 'WPP7_INVALID_DRAWING_TYPE';
  end if;
  if p_line_number is not null and (btrim(p_line_number) = '' or char_length(p_line_number) > 120) then
    raise exception 'WPP7_INVALID_LINE_NUMBER';
  end if;
  if p_revision_code is null or btrim(p_revision_code) = ''
     or char_length(p_revision_code) > 40
     or p_revision_code !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]*$' then
    raise exception 'WPP7_INVALID_REVISION_CODE';
  end if;
  if p_object_path is null or btrim(p_object_path) = '' or char_length(p_object_path) > 1000
     or split_part(p_object_path, '/', 1) <> p_owner_id
     or split_part(p_object_path, '/', 2) <> p_package_id
     or lower(p_object_path) not like '%.pdf' then
    raise exception 'WPP7_INVALID_OBJECT_PATH';
  end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'WPP7_INVALID_SHA256';
  end if;
  if p_content_length is null or p_content_length <= 0 or p_content_length > 26214400 then
    raise exception 'WPP7_INVALID_CONTENT_LENGTH';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' or char_length(p_request_id) > 128 then
    raise exception 'WPP7_INVALID_REQUEST_ID';
  end if;
  if p_issuer_ref is not null and char_length(p_issuer_ref) > 200 then
    raise exception 'WPP7_INVALID_ISSUER_REF';
  end if;
  if p_title is not null and char_length(p_title) > 200 then
    raise exception 'WPP7_INVALID_TITLE';
  end if;
  if p_original_filename is not null and (btrim(p_original_filename) = '' or char_length(p_original_filename) > 255) then
    raise exception 'WPP7_INVALID_FILENAME';
  end if;
  if p_drawing_type = 'p_id' and p_p_id_drawing_id is not null then
    raise exception 'WPP7_PID_ON_PID';
  end if;

  -- Idempotency replay first: a request id binds ONE operation to ONE
  -- semantic target. The receipt is only a replay when it names this
  -- operation (purpose ifa_issued), this package, this drawing
  -- (number/type/revision code) and this digest; a same-id, same-
  -- digest call for a different package, drawing, revision or
  -- operation is refused (WPP7_IDEMPOTENCY_CONFLICT), never replayed
  -- as the first operation's artifact. A receipt whose drawing or
  -- revision cannot be loaded fails closed the same way.
  select * into v_existing
  from public.forge_wp_drawing_artifacts
  where owner_id = p_owner_id and request_id = p_request_id;
  if found then
    if lower(v_existing.content_sha256) <> lower(p_content_sha256)
       or v_existing.object_path <> p_object_path
       or v_existing.purpose <> 'ifa_issued'
       or v_existing.package_id <> p_package_id then
      raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
    end if;
    select * into v_replay_drawing
    from public.forge_work_drawings
    where owner_id = p_owner_id and id = v_existing.drawing_id;
    if not found then
      raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
    end if;
    select * into v_replay_revision
    from public.forge_wp_drawing_revisions
    where owner_id = p_owner_id and id = v_existing.revision_id;
    if not found then
      raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
    end if;
    if v_replay_drawing.drawing_number <> btrim(p_drawing_number)
       or v_replay_drawing.drawing_type <> p_drawing_type
       or v_replay_revision.revision_code <> btrim(p_revision_code)
       or (v_replay_drawing.line_number is not null and p_line_number is not null
           and btrim(v_replay_drawing.line_number) <> btrim(p_line_number)) then
      raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
    end if;
    return query
      select * from public.forge_wp_drawing_artifacts
      where owner_id = p_owner_id and id = v_existing.id;
    return;
  end if;

  -- Lock the package row: a concurrent package cancellation (whose
  -- trigger retires ACTIVE releases) serializes against this intake
  -- instead of racing it.
  select status into v_status
  from public.forge_work_packages
  where owner_id = p_owner_id and id = p_package_id
  for update;
  if not found then
    raise exception 'WPP7_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP7_PACKAGE_TERMINAL';
  end if;

  -- An explicitly linked P&ID parent must be a p_id drawing in the same
  -- package. (Takeoff's WPP1-002 rule, enforced here for the intake's
  -- optional parent as well.)
  if p_p_id_drawing_id is not null then
    select * into v_pid
    from public.forge_work_drawings
    where owner_id = p_owner_id and package_id = p_package_id and id = p_p_id_drawing_id;
    if not found then
      raise exception 'WPP7_PID_NOT_FOUND';
    end if;
    if v_pid.drawing_type <> 'p_id' then
      raise exception 'WPP7_PID_NOT_PID';
    end if;
    if v_pid.retired_at is not null then
      raise exception 'WPP7_PID_RETIRED';
    end if;
  end if;

  -- Resolve the drawing envelope by exact (owner, package, drawing
  -- number). The number is unique per package regardless of type, so a
  -- different type already owning the number is a mismatch, not a new
  -- drawing.
  select * into v_drawing
  from public.forge_work_drawings
  where owner_id = p_owner_id and package_id = p_package_id
    and drawing_number = btrim(p_drawing_number)
  for update;
  if found then
    if v_drawing.drawing_type <> p_drawing_type then
      raise exception 'WPP7_DRAWING_TYPE_MISMATCH';
    end if;
    if v_drawing.retired_at is not null then
      raise exception 'WPP7_DRAWING_RETIRED';
    end if;
    v_drawing_id := v_drawing.id;
    -- A line number is per drawing. Fill a missing one; never silently
    -- change one that is already recorded.
    if p_line_number is not null and v_drawing.line_number is null then
      update public.forge_work_drawings
      set line_number = btrim(p_line_number), updated_at = now()
      where owner_id = p_owner_id and id = v_drawing_id;
    elsif p_line_number is not null and v_drawing.line_number is not null
      and btrim(v_drawing.line_number) <> btrim(p_line_number) then
      raise exception 'WPP7_LINE_MISMATCH';
    end if;
    -- Link a P&ID parent only when the drawing has none yet; never
    -- re-parent an already-linked drawing.
    if p_p_id_drawing_id is not null and v_drawing.p_id_drawing_id is null then
      update public.forge_work_drawings
      set p_id_drawing_id = p_p_id_drawing_id, updated_at = now()
      where owner_id = p_owner_id and id = v_drawing_id;
    elsif p_p_id_drawing_id is not null and v_drawing.p_id_drawing_id is not null
      and v_drawing.p_id_drawing_id <> p_p_id_drawing_id then
      raise exception 'WPP7_PID_MISMATCH';
    end if;
  else
    v_drawing_id := 'forge_wdwg_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.forge_work_drawings (
      owner_id, id, package_id, drawing_number, drawing_type, title,
      line_number, intake_source, p_id_drawing_id, created_by
    ) values (
      p_owner_id, v_drawing_id, p_package_id, btrim(p_drawing_number),
      p_drawing_type, nullif(btrim(coalesce(p_title, '')), ''),
      nullif(btrim(coalesce(p_line_number, '')), ''),
      'controlled_pdf', p_p_id_drawing_id, v_actor_id
    );
  end if;

  -- One immutable IFA revision per revision code under the existing
  -- unique constraint. The document_ref is the verifiable storage
  -- pointer (bucket:path), never a user-typed string.
  v_revision_id := 'forge_wpdrv_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.forge_wp_drawing_revisions (
      owner_id, id, package_id, drawing_id, revision_code,
      document_ref, content_sha256, issued_as, issued_at, created_by
    ) values (
      p_owner_id, v_revision_id, p_package_id, v_drawing_id,
      btrim(p_revision_code), 'controlled-drawings:' || p_object_path,
      lower(p_content_sha256), 'IFA', coalesce(p_issued_at, now()), v_actor_id
    );
  exception when unique_violation then
    raise exception 'WPP7_DUPLICATE_REVISION';
  end;

  -- The artifact row is the idempotent audit receipt. The request-id
  -- unique index is the final arbiter for a concurrent duplicate
  -- finalize: the loser replays the winner's receipt below.
  v_artifact_id := 'forge_wpda_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.forge_wp_drawing_artifacts (
      owner_id, id, package_id, drawing_id, revision_id, purpose,
      bucket, object_path, original_filename, content_sha256,
      content_length, request_id, created_by
    ) values (
      p_owner_id, v_artifact_id, p_package_id, v_drawing_id, v_revision_id,
      'ifa_issued', 'controlled-drawings', p_object_path,
      nullif(btrim(coalesce(p_original_filename, '')), ''),
      lower(p_content_sha256), p_content_length, btrim(p_request_id), v_actor_id
    );
  exception when unique_violation then
    select * into v_existing
    from public.forge_wp_drawing_artifacts
    where owner_id = p_owner_id and request_id = p_request_id;
    -- Same binding as the primary replay branch above: the winner's
    -- receipt is only replayed when it names this operation, package,
    -- drawing and revision with this digest. (The object path embeds
    -- owner/package/request/sha, so the path check already binds the
    -- package; the purpose and drawing/revision checks close the
    -- cross-operation and cross-drawing reuse the path cannot see.)
    if found and lower(v_existing.content_sha256) = lower(p_content_sha256)
       and v_existing.object_path = p_object_path
       and v_existing.purpose = 'ifa_issued'
       and v_existing.package_id = p_package_id then
      select * into v_replay_drawing
      from public.forge_work_drawings
      where owner_id = p_owner_id and id = v_existing.drawing_id;
      if found then
        select * into v_replay_revision
        from public.forge_wp_drawing_revisions
        where owner_id = p_owner_id and id = v_existing.revision_id;
        if found
           and v_replay_drawing.drawing_number = btrim(p_drawing_number)
           and v_replay_drawing.drawing_type = p_drawing_type
           and v_replay_revision.revision_code = btrim(p_revision_code)
           and (v_replay_drawing.line_number is null or p_line_number is null
                or btrim(v_replay_drawing.line_number) = btrim(p_line_number)) then
          return query
            select * from public.forge_wp_drawing_artifacts
            where owner_id = p_owner_id and id = v_existing.id;
          return;
        end if;
      end if;
    end if;
    raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
  end;

  return query
    select * from public.forge_wp_drawing_artifacts
    where owner_id = p_owner_id and id = v_artifact_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_ifc_stage
-- Stage a drafter-issued PDF as an IFC candidate. No revision is
-- created here: staged bytes stay pending until the atomic IFC release
-- attaches them. The staged bytes must differ from the latest issued
-- revision's bytes, so an IFA artifact can never be staged as its own
-- IFC. Same request-id + digest replay as the intake.
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_ifc_stage(
  p_owner_id text,
  p_package_id text,
  p_drawing_id text,
  p_object_path text,
  p_content_sha256 text,
  p_content_length bigint,
  p_request_id text,
  p_original_filename text default null
)
returns setof public.forge_wp_drawing_artifacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_status text;
  v_drawing public.forge_work_drawings%rowtype;
  v_existing public.forge_wp_drawing_artifacts%rowtype;
  v_latest_sha text;
  v_artifact_id text;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_object_path is null or btrim(p_object_path) = '' or char_length(p_object_path) > 1000
     or split_part(p_object_path, '/', 1) <> p_owner_id
     or split_part(p_object_path, '/', 2) <> p_package_id
     or lower(p_object_path) not like '%.pdf' then
    raise exception 'WPP7_INVALID_OBJECT_PATH';
  end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'WPP7_INVALID_SHA256';
  end if;
  if p_content_length is null or p_content_length <= 0 or p_content_length > 26214400 then
    raise exception 'WPP7_INVALID_CONTENT_LENGTH';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' or char_length(p_request_id) > 128 then
    raise exception 'WPP7_INVALID_REQUEST_ID';
  end if;
  if p_original_filename is not null and (btrim(p_original_filename) = '' or char_length(p_original_filename) > 255) then
    raise exception 'WPP7_INVALID_FILENAME';
  end if;

  -- Idempotency replay first: a request id binds ONE operation to ONE
  -- semantic target. The receipt is only a replay when it names this
  -- operation (purpose ifc_candidate), this package and this exact
  -- drawing, with this digest; a same-id, same-digest call for a
  -- different package, drawing or operation is refused
  -- (WPP7_IDEMPOTENCY_CONFLICT), never replayed as the first
  -- operation's artifact.
  select * into v_existing
  from public.forge_wp_drawing_artifacts
  where owner_id = p_owner_id and request_id = p_request_id;
  if found then
    if lower(v_existing.content_sha256) <> lower(p_content_sha256)
       or v_existing.object_path <> p_object_path
       or v_existing.purpose <> 'ifc_candidate'
       or v_existing.package_id <> p_package_id
       or v_existing.drawing_id <> p_drawing_id then
      raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
    end if;
    return query
      select * from public.forge_wp_drawing_artifacts
      where owner_id = p_owner_id and id = v_existing.id;
    return;
  end if;

  select status into v_status
  from public.forge_work_packages
  where owner_id = p_owner_id and id = p_package_id
  for update;
  if not found then
    raise exception 'WPP7_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP7_PACKAGE_TERMINAL';
  end if;

  select * into v_drawing
  from public.forge_work_drawings
  where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id
  for update;
  if not found then
    raise exception 'WPP7_DRAWING_NOT_FOUND';
  end if;
  if v_drawing.retired_at is not null then
    raise exception 'WPP7_DRAWING_RETIRED';
  end if;

  -- The staged bytes must be a DIFFERENT drafter-issued PDF from the
  -- latest issued revision. (The release re-checks this against the
  -- reviewed revision; staging early keeps a same-bytes mistake from
  -- ever reaching the release form.)
  select content_sha256 into v_latest_sha
  from public.forge_wp_drawing_revisions
  where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null
  order by issued_at desc, id desc
  limit 1;
  if v_latest_sha is not null and lower(v_latest_sha) = lower(p_content_sha256) then
    raise exception 'WPP7_IFC_SAME_AS_IFA';
  end if;

  -- Same bytes already staged for this drawing is the same candidate:
  -- return it instead of stacking a duplicate row. (The request id is
  -- not recorded on the returned row; a retry of the same request
  -- replays through this same content check.)
  select * into v_existing
  from public.forge_wp_drawing_artifacts
  where owner_id = p_owner_id and drawing_id = p_drawing_id
    and purpose = 'ifc_candidate' and retired_at is null
    and lower(content_sha256) = lower(p_content_sha256);
  if found then
    return query
      select * from public.forge_wp_drawing_artifacts
      where owner_id = p_owner_id and id = v_existing.id;
    return;
  end if;

  v_artifact_id := 'forge_wpda_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.forge_wp_drawing_artifacts (
      owner_id, id, package_id, drawing_id, revision_id, purpose,
      bucket, object_path, original_filename, content_sha256,
      content_length, request_id, created_by
    ) values (
      p_owner_id, v_artifact_id, p_package_id, p_drawing_id, null,
      'ifc_candidate', 'controlled-drawings', p_object_path,
      nullif(btrim(coalesce(p_original_filename, '')), ''),
      lower(p_content_sha256), p_content_length, btrim(p_request_id), v_actor_id
    );
  exception when unique_violation then
    select * into v_existing
    from public.forge_wp_drawing_artifacts
    where owner_id = p_owner_id and request_id = p_request_id;
    -- Same binding as the primary replay branch above.
    if found and lower(v_existing.content_sha256) = lower(p_content_sha256)
       and v_existing.object_path = p_object_path
       and v_existing.purpose = 'ifc_candidate'
       and v_existing.package_id = p_package_id
       and v_existing.drawing_id = p_drawing_id then
      return query
        select * from public.forge_wp_drawing_artifacts
        where owner_id = p_owner_id and id = v_existing.id;
      return;
    end if;
    raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
  end;

  return query
    select * from public.forge_wp_drawing_artifacts
    where owner_id = p_owner_id and id = v_artifact_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_ifc_release (recreated with staged-artifact
-- support)
-- The old 8-argument signature is dropped and recreated with an
-- optional 9th parameter, p_staged_artifact_id. PostgreSQL treats the
-- new signature as a distinct function, so the drop is required; the
-- grants below are re-applied after the recreate. All other behavior
-- is unchanged from slice 7 except:
--   * a staged artifact is MANDATORY (fix round 1): a null staged
--     artifact id is rejected, the document reference + SHA-256 come
--     only from the artifact row, and the artifact is attached to
--     the new IFC revision (purpose -> 'ifc_issued'). The typed
--     documentRef/contentSha256 parameters are never read;
--   * an IFC issue whose digest equals the reviewed IFA revision's
--     digest is rejected (WPP7_IFC_SAME_AS_IFA) — an IFA artifact can
--     never be relabelled as its own IFC.
-- ---------------------------------------------------------------------------

drop function if exists public.forge_wp_drawing_ifc_release(text, text, text, text, text, text, text, text);

create or replace function public.forge_wp_drawing_ifc_release(
  p_owner_id text,
  p_package_id text,
  p_drawing_id text,
  p_review_id text,
  p_ifc_revision_code text,
  p_document_ref text,
  p_content_sha256 text,
  p_reason text default null,
  p_staged_artifact_id text default null
)
returns setof public.forge_wp_drawing_ifc_releases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_status text;
  v_drawing public.forge_work_drawings%rowtype;
  v_review public.forge_wp_drawing_reviews%rowtype;
  v_artifact public.forge_wp_drawing_artifacts%rowtype;
  v_latest_revision_id text;
  v_prior_release public.forge_wp_drawing_ifc_releases%rowtype;
  v_ifc_revision_id text;
  v_release_id text;
  v_document_ref text;
  v_content_sha256 text;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_ifc_revision_code is null or btrim(p_ifc_revision_code) = ''
     or char_length(p_ifc_revision_code) > 40
     or p_ifc_revision_code !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]*$' then
    raise exception 'WPP7_INVALID_REVISION_CODE';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP7_REASON_TOO_LONG';
  end if;

  -- Fix round 1: a verified staged artifact is MANDATORY. The
  -- document reference and digest come ONLY from the staged artifact
  -- row — a null staged artifact id is rejected, so no IFC revision
  -- can be issued from a caller-typed (fabricated) hash or
  -- reference. p_document_ref / p_content_sha256 remain in the
  -- signature only for call-shape compatibility and are never read.
  if p_staged_artifact_id is null or btrim(p_staged_artifact_id) = '' then
    raise exception 'WPP7_STAGED_ARTIFACT_REQUIRED';
  end if;
  select * into v_artifact
  from public.forge_wp_drawing_artifacts
  where owner_id = p_owner_id and id = p_staged_artifact_id
  for update;
  if not found then
    raise exception 'WPP7_ARTIFACT_NOT_FOUND';
  end if;
  if v_artifact.package_id <> p_package_id or v_artifact.drawing_id <> p_drawing_id then
    raise exception 'WPP7_ARTIFACT_MISMATCH';
  end if;
  if v_artifact.purpose <> 'ifc_candidate' then
    raise exception 'WPP7_ARTIFACT_NOT_STAGED';
  end if;
  if v_artifact.retired_at is not null then
    raise exception 'WPP7_ARTIFACT_RETIRED';
  end if;
  v_document_ref := 'controlled-drawings:' || v_artifact.object_path;
  v_content_sha256 := lower(v_artifact.content_sha256);

  -- Lock the package row: a concurrent package cancellation (whose
  -- trigger retires ACTIVE releases) serializes against this release
  -- instead of racing it — whichever commits first, the drawing ends
  -- non-usable in a terminal package.
  select status into v_status
  from public.forge_work_packages
  where owner_id = p_owner_id and id = p_package_id
  for update;
  if not found then
    raise exception 'WPP7_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP7_PACKAGE_TERMINAL';
  end if;

  select * into v_drawing
  from public.forge_work_drawings
  where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id
  for update;
  if not found then
    raise exception 'WPP7_DRAWING_NOT_FOUND';
  end if;
  if v_drawing.retired_at is not null then
    raise exception 'WPP7_DRAWING_RETIRED';
  end if;

  select * into v_review
  from public.forge_wp_drawing_reviews
  where owner_id = p_owner_id and id = p_review_id
  for update;
  if not found then
    raise exception 'WPP7_REVIEW_NOT_FOUND';
  end if;
  if v_review.package_id <> p_package_id or v_review.drawing_id <> p_drawing_id then
    raise exception 'WPP7_REVIEW_MISMATCH';
  end if;
  if v_review.state not in ('APPROVED', 'APPROVED_WITH_REDLINES') then
    raise exception 'WPP7_REVIEW_NOT_APPROVED';
  end if;

  -- The accepted review must still be for the latest issued revision:
  -- a newer drafter revision after approval means the approval no
  -- longer covers the drawing.
  select id into v_latest_revision_id
  from public.forge_wp_drawing_revisions
  where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null
  order by issued_at desc, id desc
  limit 1;
  if v_latest_revision_id is distinct from v_review.drawing_revision_id then
    raise exception 'WPP7_REVIEW_STALE';
  end if;

  -- No open review may exist for the drawing (any revision) at
  -- release time.
  if exists (
    select 1 from public.forge_wp_drawing_reviews
    where owner_id = p_owner_id and drawing_id = p_drawing_id and state = 'OPEN'
  ) then
    raise exception 'WPP7_OPEN_REVIEW_EXISTS';
  end if;

  -- The IFC bytes must be a DIFFERENT drafter-issued PDF from the
  -- reviewed IFA revision. An approval alone never converts the IFA
  -- artifact into an IFC issue, on either the staged or the typed path.
  if v_content_sha256 = (
    select lower(content_sha256)
    from public.forge_wp_drawing_revisions
    where owner_id = p_owner_id and id = v_review.drawing_revision_id
  ) then
    raise exception 'WPP7_IFC_SAME_AS_IFA';
  end if;

  v_ifc_revision_id := 'forge_wpdrv_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.forge_wp_drawing_revisions (
      owner_id, id, package_id, drawing_id, revision_code,
      document_ref, content_sha256, issued_as, created_by
    ) values (
      p_owner_id, v_ifc_revision_id, p_package_id, p_drawing_id,
      btrim(p_ifc_revision_code), v_document_ref, v_content_sha256,
      'IFC', v_actor_id
    );
  exception when unique_violation then
    raise exception 'WPP7_DUPLICATE_REVISION';
  end;

  -- A re-issue retires the previous ACTIVE release (kept on file).
  select * into v_prior_release
  from public.forge_wp_drawing_ifc_releases
  where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null
  for update;
  if found then
    update public.forge_wp_drawing_ifc_releases
    set retired_at = now(),
        retired_by = v_actor_id,
        version = version + 1
    where owner_id = p_owner_id and id = v_prior_release.id;

    insert into public.forge_wp_drawing_review_events (
      owner_id, id, package_id, review_id, drawing_id, actor_id,
      event_type, before_state, after_state, payload_minimal
    ) values (
      p_owner_id,
      'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id, v_prior_release.review_id, p_drawing_id, v_actor_id,
      'IFC_RELEASE_RETIRED', 'ACTIVE', 'RETIRED',
      jsonb_build_object('release_id', v_prior_release.id, 'reason', p_reason)
    );
  end if;

  v_release_id := 'forge_wpdifc_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.forge_wp_drawing_ifc_releases (
    owner_id, id, package_id, drawing_id, ifc_revision_id, review_id, released_by
  ) values (
    p_owner_id, v_release_id, p_package_id, p_drawing_id,
    v_ifc_revision_id, p_review_id, v_actor_id
  );

  -- Attach a staged artifact to the IFC revision it was issued as.
  -- The staged bytes are now issued history and can never be staged
  -- or released a second time.
  if p_staged_artifact_id is not null then
    update public.forge_wp_drawing_artifacts
    set purpose = 'ifc_issued', revision_id = v_ifc_revision_id
    where owner_id = p_owner_id and id = p_staged_artifact_id;
  end if;

  insert into public.forge_wp_drawing_review_events (
    owner_id, id, package_id, review_id, drawing_id, actor_id,
    event_type, before_state, after_state, payload_minimal
  ) values (
    p_owner_id,
    'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
    p_package_id, p_review_id, p_drawing_id, v_actor_id,
    'IFC_RELEASED', v_review.state, 'IFC',
    jsonb_build_object(
      'release_id', v_release_id,
      'ifc_revision_id', v_ifc_revision_id,
      'ifc_revision_code', btrim(p_ifc_revision_code),
      'staged_artifact_id', p_staged_artifact_id,
      'reason', p_reason)
  );

  return query
    select *
    from public.forge_wp_drawing_ifc_releases
    where owner_id = p_owner_id and id = v_release_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_retire (same signature, extended body)
-- Retiring a drawing now also retires its artifact rows, so a retired
-- drawing's staged IFC candidates can never be released. Retired bytes
-- stay on file as immutable history. Everything else is unchanged
-- from slice 7.
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_retire(
  p_owner_id text,
  p_package_id text,
  p_drawing_id text,
  p_reason text
)
returns setof public.forge_work_drawings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_drawing public.forge_work_drawings%rowtype;
  v_review public.forge_wp_drawing_reviews%rowtype;
  v_release public.forge_wp_drawing_ifc_releases%rowtype;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_reason is null or btrim(p_reason) = '' or char_length(p_reason) > 1000 then
    raise exception 'WPP7_REASON_REQUIRED';
  end if;

  if not exists (
    select 1 from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  ) then
    raise exception 'WPP7_PACKAGE_NOT_FOUND';
  end if;

  select * into v_drawing
  from public.forge_work_drawings
  where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id
  for update;
  if not found then
    raise exception 'WPP7_DRAWING_NOT_FOUND';
  end if;
  if v_drawing.retired_at is not null then
    raise exception 'WPP7_DRAWING_RETIRED';
  end if;

  for v_review in
    select * from public.forge_wp_drawing_reviews
    where owner_id = p_owner_id and drawing_id = p_drawing_id and state = 'OPEN'
    order by opened_at asc
    for update
  loop
    update public.forge_wp_drawing_reviews
    set state = 'CANCELLED',
        closed_by = v_actor_id,
        closed_at = now(),
        decision_reason = 'Drawing retired.',
        version = version + 1
    where owner_id = p_owner_id and id = v_review.id;

    insert into public.forge_wp_drawing_review_events (
      owner_id, id, package_id, review_id, drawing_id, actor_id,
      event_type, before_state, after_state, payload_minimal
    ) values (
      p_owner_id,
      'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id, v_review.id, p_drawing_id, v_actor_id,
      'REVIEW_CANCELLED', 'OPEN', 'CANCELLED',
      jsonb_build_object('reason', p_reason)
    );
  end loop;

  select * into v_release
  from public.forge_wp_drawing_ifc_releases
  where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null
  for update;
  if found then
    update public.forge_wp_drawing_ifc_releases
    set retired_at = now(),
        retired_by = v_actor_id,
        version = version + 1
    where owner_id = p_owner_id and id = v_release.id;

    insert into public.forge_wp_drawing_review_events (
      owner_id, id, package_id, review_id, drawing_id, actor_id,
      event_type, before_state, after_state, payload_minimal
    ) values (
      p_owner_id,
      'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id, v_release.review_id, p_drawing_id, v_actor_id,
      'IFC_RELEASE_RETIRED', 'ACTIVE', 'RETIRED',
      jsonb_build_object('release_id', v_release.id, 'reason', p_reason)
    );
  end if;

  -- Slice-7 PDF blockers: retire the drawing's stored artifacts too.
  -- Staged IFC candidates of a retired drawing can never be released
  -- (the release also refuses a retired drawing); issued artifacts
  -- stay on file as immutable history.
  update public.forge_wp_drawing_artifacts
  set retired_at = now(), retired_by = v_actor_id
  where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null;

  update public.forge_work_drawings
  set retired_at = now(),
      retired_by = v_actor_id
  where owner_id = p_owner_id and id = p_drawing_id;

  insert into public.forge_wp_drawing_review_events (
    owner_id, id, package_id, review_id, drawing_id, actor_id,
    event_type, before_state, after_state, payload_minimal
  ) values (
    p_owner_id,
    'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
    p_package_id, null, p_drawing_id, v_actor_id,
    'DRAWING_RETIRED', null, 'RETIRED',
    jsonb_build_object('reason', p_reason)
  );

  return query
    select *
    from public.forge_work_drawings
    where owner_id = p_owner_id and id = p_drawing_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: SELECT-only on the artifacts table; EXECUTE on the new RPCs
-- for authenticated only. Mirrors slice 7 exactly: Supabase default
-- privileges re-grant ALL on new public tables and EXECUTE on new
-- functions to the app roles, so the explicit REVOKEs below are
-- load-bearing — a selective GRANT alone does NOT remove an
-- already-effective broad default privilege. The recreated
-- ifc_release (new 9-argument signature) and retire functions get
-- their grants re-applied here after the drop/recreate.
-- ---------------------------------------------------------------------------

revoke all on function public.forge_wp_drawing_controlled_intake(text, text, text, text, text, text, text, bigint, text, text, timestamptz, text, text, text, text) from public;
revoke execute on function public.forge_wp_drawing_controlled_intake(text, text, text, text, text, text, text, bigint, text, text, timestamptz, text, text, text, text) from anon, service_role;
grant execute on function public.forge_wp_drawing_controlled_intake(text, text, text, text, text, text, text, bigint, text, text, timestamptz, text, text, text, text) to authenticated;

revoke all on function public.forge_wp_drawing_ifc_stage(text, text, text, text, text, bigint, text, text) from public;
revoke execute on function public.forge_wp_drawing_ifc_stage(text, text, text, text, text, bigint, text, text) from anon, service_role;
grant execute on function public.forge_wp_drawing_ifc_stage(text, text, text, text, text, bigint, text, text) to authenticated;

revoke all on function public.forge_wp_drawing_ifc_release(text, text, text, text, text, text, text, text, text) from public;
revoke execute on function public.forge_wp_drawing_ifc_release(text, text, text, text, text, text, text, text, text) from anon, service_role;
grant execute on function public.forge_wp_drawing_ifc_release(text, text, text, text, text, text, text, text, text) to authenticated;

revoke all on function public.forge_wp_drawing_retire(text, text, text, text) from public;
revoke execute on function public.forge_wp_drawing_retire(text, text, text, text) from anon, service_role;
grant execute on function public.forge_wp_drawing_retire(text, text, text, text) to authenticated;
