-- FORGE Work Management — Rung 5: Drawings / documents.
--
-- The planner's own document library (table 49, forge_work_document_library):
-- our own per-client file repository, NOT the rental document library.
-- Three base kinds (template / filled form / reference) with kind as free
-- text so each client defines their own kinds. Revision control: a new
-- upload supersedes the old version (is_current_version flip); a filled
-- copy records which template it was made from (template_source_id).
-- Drawings live in the Designer domain and are only LINKED (Rung 2
-- supported_by_drawing) — never copied here.
--
-- Isolation follows the shared-workspace model: owner_id is the effective
-- workspace owner and RLS uses has_workspace_access(owner_id).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-documents', 'work-documents', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'text/plain',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword'
  ])
on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create table if not exists forge_work_document_library (
  owner_id text not null,
  id text not null,
  name text not null check (btrim(name) <> ''),
  -- Free text on purpose: the three base kinds (template / filled_form /
  -- reference) are UI suggestions; each client defines their own kinds.
  kind text not null default 'reference' check (btrim(kind) <> ''),
  description text,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 26214400),
  bucket text not null default 'work-documents' check (bucket = 'work-documents'),
  object_path text not null,
  original_filename text not null check (btrim(original_filename) <> ''),
  -- Revision control: version_of_document_id points at the previous version
  -- (null for the first); only one row per family is current.
  version_of_document_id text,
  version_number integer not null default 1 check (version_number >= 1),
  is_current_version boolean not null default true,
  -- Which library template this filled copy was made from (null unless a
  -- filled form produced from a template).
  template_source_id text,
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (bucket, object_path),
  check (split_part(object_path, '/', 1) = owner_id)
);

create index if not exists idx_forge_work_documents_owner_kind
  on forge_work_document_library (owner_id, kind, created_at desc);
create index if not exists idx_forge_work_documents_owner_current
  on forge_work_document_library (owner_id, is_current_version, created_at desc);

-- Soft delete: rows are never removed, so version history survives.
-- family_id: the version family's root id, for the anti-race constraint.
alter table forge_work_document_library
  add column if not exists deleted_at timestamptz,
  add column if not exists family_id text
    generated always as (coalesce(version_of_document_id, id)) stored;

-- Revision race guard: two concurrent uploads of the same next version
-- conflict instead of silently producing duplicate version numbers.
create unique index if not exists uq_forge_work_documents_family_version
  on forge_work_document_library (owner_id, family_id, version_number)
  where deleted_at is null;

create index if not exists idx_forge_work_documents_owner_deleted
  on forge_work_document_library (owner_id, deleted_at)
  where deleted_at is null;

alter table forge_work_document_library enable row level security;
alter table forge_work_document_library force row level security;

drop policy if exists forge_work_document_library_workspace_all on forge_work_document_library;
-- No delete policy: rows are append-only history, "deletion" is the API's
-- soft delete. Split by command so a future for-all can never sneak back.
create policy forge_work_document_library_workspace_select on forge_work_document_library
  for select to authenticated using (has_workspace_access(owner_id));
create policy forge_work_document_library_workspace_insert on forge_work_document_library
  for insert to authenticated with check (has_workspace_access(owner_id));
create policy forge_work_document_library_workspace_update on forge_work_document_library
  for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

-- Storage object policies: the first path segment is the workspace owner_id.
drop policy if exists "work_document_objects_workspace_select" on storage.objects;
create policy "work_document_objects_workspace_select" on storage.objects for select to authenticated
  using (bucket_id = 'work-documents' and has_workspace_access((storage.foldername(name))[1]));

drop policy if exists "work_document_objects_workspace_insert" on storage.objects;
create policy "work_document_objects_workspace_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'work-documents' and has_workspace_access((storage.foldername(name))[1]));

drop policy if exists "work_document_objects_workspace_delete" on storage.objects;
-- No storage delete policy is created: files are append-only history.

-- Attribution is the authenticated caller, always present and never
-- payload-supplied: the trigger overwrites uploaded_by from auth.uid()
-- and fails closed without one; updates preserve creation identity.
create or replace function forge_work_stamp_document_actor()
returns trigger language plpgsql as $$
declare
  v_actor text;
begin
  v_actor := nullif(auth.uid()::text, '');
  if v_actor is null then
    raise exception 'forge_work_document_library: missing authenticated identity';
  end if;
  if TG_OP = 'INSERT' then
    NEW.uploaded_by := v_actor;
  else
    NEW.uploaded_by := OLD.uploaded_by;
  end if;
  return NEW;
end;
$$;

drop trigger if exists forge_work_document_library_stamp_actor_trg on forge_work_document_library;
create trigger forge_work_document_library_stamp_actor_trg
  before insert or update on forge_work_document_library
  for each row execute function forge_work_stamp_document_actor();

-- Rows are append-only history: no direct hard deletes. "Deletion" is the
-- API's soft delete (deleted_at); the storage delete policy is dropped too.
-- (The select/insert/update policies are defined with the table above.)
drop policy if exists forge_work_document_library_workspace_all on forge_work_document_library;

drop policy if exists "work_document_objects_workspace_delete" on storage.objects;

-- Atomic version creation: advisory-lock the family, then compute the next
-- version, supersede the old current, and insert — all in one transaction.
-- The old two-write application flow could leave zero current versions when
-- uploads overlapped; serialized here, that interleaving is impossible.
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

  select coalesce(max(version_number), 0) + 1
    into v_next_version
    from forge_work_document_library
   where owner_id = p_owner_id
     and (id = v_root_id or version_of_document_id = v_root_id)
     and deleted_at is null;

  update forge_work_document_library
     set is_current_version = false, updated_at = now()
   where owner_id = p_owner_id
     and (id = v_root_id or version_of_document_id = v_root_id)
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
