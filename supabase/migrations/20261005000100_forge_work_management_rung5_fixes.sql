-- FORGE Work Management — Rung 5 fixes (re-review blockers, 2026-10-05).
--
-- 1. Direct-write bypass of current-revision protection: the atomic RPC
--    serialized its own writers, but a direct INSERT/UPDATE could still
--    leave two current versions in one family. Enforced declaratively so
--    EVERY write path is covered: at most one non-deleted current version
--    per (owner, family). The RPC's update-then-insert keeps the invariant
--    inside its own transaction, so it is unaffected.
create unique index if not exists uq_forge_work_documents_one_current_version
  on forge_work_document_library (owner_id, family_id)
  where is_current_version and deleted_at is null;

-- 2. Version-number reuse after soft delete: the old uniqueness index was
--    partial (WHERE deleted_at IS NULL), so a soft-deleted version's number
--    could be re-issued. History must keep its numbers: the constraint is
--    now unconditional. Soft-deleted rows reserve their version numbers
--    forever.
drop index if exists uq_forge_work_documents_family_version;
create unique index if not exists uq_forge_work_documents_family_version
  on forge_work_document_library (owner_id, family_id, version_number);

-- 3. The next-version computation must count soft-deleted rows too, or it
--    would re-issue a deleted version's number and hit the unconditional
--    index above. Rewritten against family_id (the generated version-family
--    root) for clarity; the predecessor lookup still refuses deleted
--    predecessors.
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
  -- version numbers are reserved forever (see the unconditional unique
  -- index above), so the next version must come after them.
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

-- 4. Failed-upload cleanup: the API removes the uploaded storage object
--    when the database write fails, but with no storage delete policy that
--    cleanup was denied and orphaned files accumulated. This policy allows
--    deleting ONLY objects no document row references — a referenced file
--    (historical evidence) can never be removed through it, even by its
--    owner. The API's cleanup path only runs after a failed write, and the
--    not-exists check protects the lost-response case where the row was
--    actually created.
drop policy if exists "work_document_objects_orphan_cleanup" on storage.objects;
create policy "work_document_objects_orphan_cleanup" on storage.objects for delete to authenticated
  using (bucket_id = 'work-documents'
    and has_workspace_access((storage.foldername(name))[1])
    and not exists (
      select 1 from forge_work_document_library d
      where d.bucket = 'work-documents'
        and d.object_path = storage.objects.name
    ));
