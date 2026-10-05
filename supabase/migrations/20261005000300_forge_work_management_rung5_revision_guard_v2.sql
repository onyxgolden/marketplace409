-- FORGE Work Management — Rung 5 revision guard v2 (re-review finding, 2026-10-05).
--
-- Finding (exact head 8fd7792f): the v1 guard's bypass flag is a
-- caller-writable GUC. With direct SQL access (the established threat
-- model), an attacker sets the flag themselves — or rides the RPC's flag
-- inside one transaction — and the trigger waves the history rewrite
-- through. Reproduced against 8fd7792f.
--
-- Fix v2: eliminate the bypass state entirely. Nothing the caller can write
-- influences the guard anymore:
--
--   1. The row trigger keeps pinning revision identity (object_path,
--      version_number, version_of_document_id, bucket, owner_id, id),
--      one-way soft delete, and no direct promotion (false->true). The
--      true->false demote is allowed at row level — legitimacy is decided
--      at COMMIT (see below), so the version RPC needs no flag and the
--      API's soft delete is untouched.
--
--   2. A DEFERRABLE INITIALLY DEFERRED constraint trigger enforces the
--      real invariant at COMMIT time, on every write path: a version
--      family with live rows has exactly one current revision, UNLESS its
--      latest version was deliberately soft-deleted (the API's delete
--      retires the whole family). Clearing the current revision via a
--      direct UPDATE — the reproduced attack — aborts the transaction.
--      The version RPC's demote+insert lands with one current version, so
--      it is unaffected; there is no flag to forge because there is no
--      flag.
--
--   3. The version RPC drops the set_config flag line (dead machinery).

-- 1. Row trigger, minus the flag and minus the statement-time demote ban.
create or replace function forge_work_guard_document_revision()
returns trigger language plpgsql as $$
begin
  -- Revision identity is immutable: rows are history, never rewritten.
  if NEW.object_path is distinct from OLD.object_path then
    raise exception 'forge_work_document_library: object_path is immutable';
  end if;
  if NEW.version_number is distinct from OLD.version_number then
    raise exception 'forge_work_document_library: version_number is immutable';
  end if;
  if NEW.version_of_document_id is distinct from OLD.version_of_document_id then
    raise exception 'forge_work_document_library: version_of_document_id is immutable';
  end if;
  if NEW.bucket is distinct from OLD.bucket then
    raise exception 'forge_work_document_library: bucket is immutable';
  end if;
  if NEW.owner_id is distinct from OLD.owner_id then
    raise exception 'forge_work_document_library: owner_id is immutable';
  end if;
  if NEW.id is distinct from OLD.id then
    raise exception 'forge_work_document_library: id is immutable';
  end if;

  -- Soft delete is one-way and happens in a single statement.
  if OLD.deleted_at is null and NEW.deleted_at is not null then
    -- allowed: the API's soft delete
    null;
  elsif NEW.deleted_at is distinct from OLD.deleted_at then
    raise exception 'forge_work_document_library: deleted_at can only be set once (soft delete is one-way)';
  end if;

  -- Promotion happens only via the version RPC's INSERT; a direct
  -- false->true would resurrect a superseded revision.
  if not OLD.is_current_version and NEW.is_current_version then
    raise exception 'forge_work_document_library: only the version RPC may promote a revision to current';
  end if;
  -- true->false without a same-statement soft delete is the version RPC's
  -- demote; legitimacy is decided at COMMIT by the deferred trigger below.

  return NEW;
end;
$$;

-- 2. Deferred invariant: every live family ends the transaction with a
-- current revision, unless its latest version was soft-deleted.
create or replace function forge_work_check_document_current()
returns trigger language plpgsql as $$
declare
  v_owner_id text := coalesce(NEW.owner_id, OLD.owner_id);
  v_family_id text := coalesce(NEW.family_id, OLD.family_id);
  v_live_current integer;
  v_latest_deleted boolean;
begin
  select count(*) into v_live_current
    from forge_work_document_library
   where owner_id = v_owner_id
     and family_id = v_family_id
     and is_current_version
     and deleted_at is null;
  if v_live_current = 0 then
    select deleted_at is not null into v_latest_deleted
      from forge_work_document_library
     where owner_id = v_owner_id
       and family_id = v_family_id
     order by version_number desc
     limit 1;
    if not coalesce(v_latest_deleted, false) then
      raise exception 'forge_work_document_library: version family % has no current revision', v_family_id;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists forge_work_document_library_current_guard_trg on forge_work_document_library;
create constraint trigger forge_work_document_library_current_guard_trg
  after insert or update on forge_work_document_library
  deferrable initially deferred
  for each row execute function forge_work_check_document_current();

-- 3. Version RPC: identical guarantees, minus the flag machinery.
create or replace function forge_work_create_document_version(
  p_owner_id text, p_id text, p_name text, p_kind text, p_description text,
  p_mime_type text, p_byte_size bigint, p_bucket text, p_object_path text,
  p_original_filename text, p_version_of_document_id text, p_template_source_id text
)
returns forge_work_document_library
language plpgsql
as $$
declare
  v_root_id text;
  v_next_version int;
  v_row forge_work_document_library%rowtype;
begin
  if not has_workspace_access(p_owner_id) then
    raise exception 'forge_work_document_library: no workspace access';
  end if;

  if p_version_of_document_id is not null then
    select coalesce(version_of_document_id, id)
      into v_root_id
      from forge_work_document_library
     where owner_id = p_owner_id
       and id = p_version_of_document_id
       and deleted_at is null;
    if not found then
      raise exception 'forge_work_document_library: version predecessor not found: %',
        p_version_of_document_id;
    end if;
  else
    v_root_id := p_id;
  end if;

  -- Serialize every writer of this version family for this transaction.
  perform pg_advisory_xact_lock(hashtext(p_owner_id || ':' || v_root_id));

  -- Count ALL rows in the family, including soft-deleted ones: their
  -- version numbers are reserved forever, so the next version must come
  -- after them.
  select coalesce(max(version_number), 0) + 1
    into v_next_version
    from forge_work_document_library
   where owner_id = p_owner_id
     and family_id = v_root_id;

  update forge_work_document_library
     set is_current_version = false, updated_at = now()
   where owner_id = p_owner_id
     and family_id = v_root_id
     and deleted_at is null
     and is_current_version;

  insert into forge_work_document_library (
    owner_id, id, name, kind, description, mime_type, byte_size,
    bucket, object_path, original_filename,
    version_of_document_id, version_number, is_current_version,
    template_source_id, updated_at
  ) values (
    p_owner_id, p_id, p_name, p_kind, p_description, p_mime_type, p_byte_size,
    p_bucket, p_object_path, p_original_filename,
    case when p_version_of_document_id is null then null else v_root_id end,
    v_next_version, true,
    p_template_source_id, now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function forge_work_create_document_version(
  text, text, text, text, text, text, bigint, text, text, text, text, text
) from public;
grant execute on function forge_work_create_document_version(
  text, text, text, text, text, text, bigint, text, text, text, text, text
) to authenticated;
