-- FORGE Capture Rung 5 — opt-in capture library ("Save to FORGE").
--
-- Migration approved by Jason 2026-09-22. This is the rung's only DB touch:
-- one table (capture_library) + one metadata-only audit table + one private
-- storage bucket. No share links, no public access, no background sync.
--
-- Local-first is unchanged: captures stay local unless the user explicitly
-- presses "Save to FORGE" in the desktop app.

-- 1. The library table. The row id is the client-generated capture UUID
--    (ChatGPT idempotency design): a retry with the same id returns the
--    existing artifact instead of creating a duplicate.
create table if not exists capture_library (
    id uuid primary key,
    owner_id text not null,
    title text,
    kind text not null check (kind in ('screenshot', 'recording')),
    mime_type text,
    byte_size integer,
    width integer,
    height integer,
    storage_path text not null,
    captured_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_capture_library_owner_created
    on capture_library(owner_id, created_at desc);

alter table capture_library enable row level security;
alter table capture_library force row level security;

create policy "capture_library_owner_select"
    on capture_library
    for select
    to authenticated
    using (owner_id = auth.uid()::text);

create policy "capture_library_owner_insert"
    on capture_library
    for insert
    to authenticated
    with check (owner_id = auth.uid()::text);

create policy "capture_library_owner_update"
    on capture_library
    for update
    to authenticated
    using (owner_id = auth.uid()::text)
    with check (owner_id = auth.uid()::text);

create policy "capture_library_owner_delete"
    on capture_library
    for delete
    to authenticated
    using (owner_id = auth.uid()::text);

grant select, insert, update, delete on capture_library to authenticated;

-- 2. Private storage bucket. Server-enforced 25 MB cap for both screenshots
--    and recordings (mirrored in the upload route). Never public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('capture-library', 'capture-library', false, 26214400,
    array['image/png', 'image/jpeg', 'video/webm'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

-- Storage object paths are server-derived: <owner_id>/capture/<capture_uuid>.<ext>,
-- so the first folder segment is always the owner's auth uid.
create policy "capture_library_objects_owner_select" on storage.objects for select to authenticated
    using(bucket_id='capture-library' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "capture_library_objects_owner_insert" on storage.objects for insert to authenticated
    with check(bucket_id='capture-library' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "capture_library_objects_owner_delete" on storage.objects for delete to authenticated
    using(bucket_id='capture-library' and (storage.foldername(name))[1]=auth.uid()::text);

-- 3. Metadata-only audit trail: upload and delete events only (no share
--    links / share events in this rung). Detail carries actor, object id,
--    timestamp, and action — never captured content, pixels, OCR, or
--    filenames of captured content.
--
-- Deliberate divergence from the rental_document_audit_log precedent: NO
-- foreign key to capture_library. A delete event must survive the deletion
-- of the row it describes; a cascading FK would erase the audit trail at
-- exactly the moment it matters.
create table if not exists capture_library_audit_log (
    id text primary key default ('capture_audit_' || gen_random_uuid()::text),
    owner_id text not null,
    capture_id uuid not null,
    action text not null check (action in ('uploaded', 'deleted')),
    actor_id text not null,
    detail jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_capture_library_audit_log_owner_capture
    on capture_library_audit_log(owner_id, capture_id, created_at desc);

alter table capture_library_audit_log enable row level security;
alter table capture_library_audit_log force row level security;

create policy "capture_library_audit_log_owner_select" on capture_library_audit_log for select to authenticated
    using(owner_id = auth.uid()::text);
create policy "capture_library_audit_log_owner_insert" on capture_library_audit_log for insert to authenticated
    with check(owner_id = auth.uid()::text);

grant select, insert on capture_library_audit_log to authenticated;
