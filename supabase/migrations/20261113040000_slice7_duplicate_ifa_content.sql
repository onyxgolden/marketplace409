-- Slice-7 review-gating fix: reject a same-SHA IFA re-upload as a
-- duplicate revision (409 WPP7_DUPLICATE_CONTENT).
--
-- Amends ONLY forge_wp_drawing_controlled_intake (CREATE OR REPLACE
-- preserves the function's existing grants). The duplicate-content
-- check sits after the request-id replay checks and after the
-- package/drawing serialization locks, and before the revision/
-- artifact inserts: a new request id uploading bytes identical to a
-- non-retired IFA revision on the same drawing is rejected with a
-- plain-language 409, while a same-request-id retry still replays the
-- original receipt. A reused revision code is reported first
-- (WPP7_DUPLICATE_REVISION) — the existing pinned precedence when
-- an upload is both a duplicate code and duplicate content. The
-- service removes the just-uploaded storage object on any RPC
-- failure, so a rejected duplicate leaves no orphaned file and no
-- new revision or artifact row.
--
-- No new tables, columns, or grants. Apply on its own word after
-- merge (apply-on-GO does not cover this migration until reviewed).

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

  -- Fix round 2: re-check the receipt AFTER the package lock. The
  -- pre-lock lookup above can miss a receipt committed by a concurrent
  -- duplicate that was still in flight: both callers pass the first
  -- lookup, serialize on this lock, and the winner commits before the
  -- loser acquires it. Without this recheck the loser resolves the
  -- winner's drawing and hits the revision unique constraint
  -- (WPP7_DUPLICATE_REVISION) instead of replaying the winner's
  -- receipt. Same binding as the primary replay branch above; the
  -- later artifact-insert unique_violation fallback stays as defense
  -- in depth.
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

  -- Slice-7 review-gating fix (20261113040000): identical bytes are
  -- not a new IFA revision. Precedence: a reused revision CODE is
  -- reported first (WPP7_DUPLICATE_REVISION) — the code is the more
  -- specific diagnosis, and the existing suite pins that precedence
  -- when an upload is both a duplicate code and duplicate content.
  -- The drawing row is locked (FOR UPDATE above), so no concurrent
  -- insert can interleave between this pre-check and the insert
  -- below; the insert's unique-violation block stays as the backstop.
  if exists (
    select 1 from public.forge_wp_drawing_revisions
    where owner_id = p_owner_id and drawing_id = v_drawing_id
      and revision_code = btrim(p_revision_code)
  ) then
    raise exception 'WPP7_DUPLICATE_REVISION';
  end if;

  -- A non-retired IFA revision on this drawing with the same SHA-256
  -- means the uploaded PDF is identical to an issued revision;
  -- recording another revision envelope would create false revision
  -- history. Reject before inserting (409 WPP7_DUPLICATE_CONTENT).
  -- Runs after the request-id replay checks (a same-request retry
  -- still replays) and after the package + drawing locks, so two
  -- concurrent identical uploads serialize here and exactly one
  -- wins. Retired revisions do not block: their bytes may
  -- legitimately be re-issued as a new revision. Only IFA revisions
  -- count — the same bytes as an IFC revision do not block an IFA
  -- upload.
  if exists (
    select 1 from public.forge_wp_drawing_revisions
    where owner_id = p_owner_id and drawing_id = v_drawing_id
      and issued_as = 'IFA' and retired_at is null
      and lower(content_sha256) = lower(p_content_sha256)
  ) then
    raise exception 'WPP7_DUPLICATE_CONTENT';
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

  -- The artifact row is the idempotent audit receipt. A concurrent
  -- duplicate is normally replayed by the post-package-lock recheck
  -- above; the request-id unique index here is defense in depth for
  -- the final insert, and its fallback below replays the winner's
  -- receipt with the same binding.
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
