-- FORGE Work Management — Rung 5 revision guard (re-review finding, 2026-10-05).
--
-- Finding (exact head 979ead35): the UPDATE RLS policy lets any authenticated
-- workspace member update any column, so direct writes bypass the version
-- RPC's revision discipline. Reproduced against 979ead35:
--   (1) clearing the only current revision (is_current_version true->false
--       with no soft delete), leaving a family with zero current versions;
--   (2) rewriting a historical version's object_path, which makes the
--       orphan-cleanup storage policy treat the real file as unreferenced
--       and therefore deletable.
-- The partial unique index only forbids TWO current versions; it cannot
-- forbid zero, and nothing stops a file reference from being rewritten.
--
-- Fix: a BEFORE UPDATE trigger enforces the revision invariants on EVERY
-- write path, declaratively. Two legitimate writers exist:
--   - the version-creation RPC, which demotes the old current revision
--     (is_current_version true->false, no soft delete) inside its own
--     transaction. It sets a transaction-local flag the trigger honors.
--   - the API's soft delete, which sets deleted_at and is_current_version=false
--     in a single statement. The trigger allows exactly that shape.
-- Everything else touching a revision column is rejected. Plain metadata
-- (name, kind, description, original_filename, template_source_id,
-- updated_at) stays directly editable; uploaded_by is already pinned by the
-- actor-stamp trigger.

create or replace function forge_work_guard_document_revision()
returns trigger language plpgsql as $$
begin
  -- The version-creation RPC performs its disciplined demote under this
  -- transaction-local flag (set via set_config(..., true): vanishes at
  -- commit/rollback, safe under PgBouncer transaction pooling).
  if current_setting('forge_work_documents.version_rpc', true) = 'on' then
    return NEW;
  end if;

  -- Revision identity is immutable: rows are history, never rewritten.
  if NEW.object_path is distinct from OLD.object_path then
    raise exception 'forge_work_document_library: object_path is immutable outside the version RPC';
  end if;
  if NEW.version_number is distinct from OLD.version_number then
    raise exception 'forge_work_document_library: version_number is immutable outside the version RPC';
  end if;
  if NEW.version_of_document_id is distinct from OLD.version_of_document_id then
    raise exception 'forge_work_document_library: version_of_document_id is immutable outside the version RPC';
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

  -- is_current_version: the only direct transition allowed is true->false
  -- as part of a soft delete (deleted_at set in the same statement).
  -- Supersede (true->false without soft delete) and promotion
  -- (false->true) happen only inside the version RPC.
  if OLD.is_current_version and not NEW.is_current_version then
    if not (OLD.deleted_at is null and NEW.deleted_at is not null) then
      raise exception 'forge_work_document_library: only the version RPC may supersede the current revision (direct writes must soft-delete instead)';
    end if;
  elsif NEW.is_current_version and not OLD.is_current_version then
    raise exception 'forge_work_document_library: only the version RPC may promote a revision to current';
  end if;

  return NEW;
end;
$$;

drop trigger if exists forge_work_document_library_guard_revision_trg on forge_work_document_library;
create trigger forge_work_document_library_guard_revision_trg
  before update on forge_work_document_library
  for each row execute function forge_work_guard_document_revision();

-- The version-creation RPC demotes the old current revision inside its own
-- transaction; mark the transaction so the guard trigger lets it through.
-- (Full body carried forward from 20261005000100; only the flag line is new.)
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

  -- Disciplined writer: the revision guard trigger honors this flag for the
  -- demote below. Transaction-local: gone at commit/rollback.
  perform set_config('forge_work_documents.version_rpc', 'on', true);

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
