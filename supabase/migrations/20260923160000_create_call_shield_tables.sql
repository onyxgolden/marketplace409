-- Call Shield S2 — persistence for the TCPA/DNC evidence module.
--
-- New tables only; no data changes. The S1 domain layer
-- (src/domains/callShield/) is pure and storage-agnostic; these tables are
-- its persistence shape:
--   call_shield_cases        case header (id/owner/reporting name/notes)
--   call_shield_case_events  append-only event timeline (domain source of truth)
--   call_shield_evidence     chain-of-custody descriptors for stored files
--   call_shield_case_access  FUTURE sharing design only — no sharing UI, no
--                            grantee policies in Phase 1 (per architecture review)
-- Phase 1 access is owner-only throughout. Evidence files live in the private
-- 'call-shield-evidence' storage bucket; paths are server-derived as
-- <owner_id>/evidence/<evidence_uuid>.<ext> so the first folder segment is
-- always the owner's auth uid.

-- 1. Case header.
create table if not exists call_shield_cases (
    id uuid primary key,
    owner_id text not null,
    reported_business_name text not null,
    notes text,
    recording_notice_acknowledged_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_call_shield_cases_owner_created
    on call_shield_cases(owner_id, created_at desc);

alter table call_shield_cases enable row level security;
alter table call_shield_cases force row level security;

create policy "call_shield_cases_owner_select" on call_shield_cases
    for select to authenticated
    using (owner_id = auth.uid()::text);
create policy "call_shield_cases_owner_insert" on call_shield_cases
    for insert to authenticated
    with check (owner_id = auth.uid()::text);
create policy "call_shield_cases_owner_update" on call_shield_cases
    for update to authenticated
    using (owner_id = auth.uid()::text)
    with check (owner_id = auth.uid()::text);
create policy "call_shield_cases_owner_delete" on call_shield_cases
    for delete to authenticated
    using (owner_id = auth.uid()::text);

grant select, insert, update, delete on call_shield_cases to authenticated;

-- 2. Append-only event timeline. Deliberately NO update/delete policies:
-- events are immutable; corrections are new events (see domain applyEvents).
create table if not exists call_shield_case_events (
    id uuid primary key,
    owner_id text not null,
    case_id uuid not null references call_shield_cases(id) on delete cascade,
    seq bigint not null,
    type text not null,
    payload jsonb not null default '{}'::jsonb,
    recorded_at timestamptz not null default now(),
    unique (case_id, seq)
);

create index if not exists idx_call_shield_case_events_case_seq
    on call_shield_case_events(case_id, seq);

alter table call_shield_case_events enable row level security;
alter table call_shield_case_events force row level security;

create policy "call_shield_case_events_owner_select" on call_shield_case_events
    for select to authenticated
    using (owner_id = auth.uid()::text);
create policy "call_shield_case_events_owner_insert" on call_shield_case_events
    for insert to authenticated
    with check (owner_id = auth.uid()::text);

grant select, insert on call_shield_case_events to authenticated;

-- 3. Evidence descriptors (chain of custody). NO update policy: custody rows
-- are write-once; tamper is detected by verifyManifest, not by editing rows.
-- Delete is owner-allowed (the user may destroy their own evidence).
-- Kind and MIME check lists mirror the S1 domain allowlist exactly.
create table if not exists call_shield_evidence (
    id uuid primary key,
    owner_id text not null,
    case_id uuid not null references call_shield_cases(id) on delete cascade,
    call_id uuid,
    kind text not null check (kind in (
        'audio_recording', 'call_log_screenshot', 'voicemail',
        'text_message', 'document', 'other')),
    file_name text not null,
    mime_type text not null check (mime_type in (
        'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/aac',
        'audio/ogg', 'audio/webm', 'audio/amr', 'audio/3gpp',
        'image/jpeg', 'image/png', 'image/webp', 'image/heic',
        'application/pdf', 'text/plain')),
    byte_size bigint not null check (byte_size > 0),
    sha256 text not null check (sha256 ~ '^[0-9a-fA-F]{64}$'),
    storage_path text not null,
    captured_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists idx_call_shield_evidence_case_created
    on call_shield_evidence(case_id, created_at);

alter table call_shield_evidence enable row level security;
alter table call_shield_evidence force row level security;

create policy "call_shield_evidence_owner_select" on call_shield_evidence
    for select to authenticated
    using (owner_id = auth.uid()::text);
create policy "call_shield_evidence_owner_insert" on call_shield_evidence
    for insert to authenticated
    with check (owner_id = auth.uid()::text);
create policy "call_shield_evidence_owner_delete" on call_shield_evidence
    for delete to authenticated
    using (owner_id = auth.uid()::text);

grant select, insert, delete on call_shield_evidence to authenticated;

-- 4. Future case-sharing access table — DESIGN ONLY. No sharing UI, no
-- attorney accounts, and no grantee-side policies in Phase 1 (per the S1
-- architecture review). Rows are owner-managed so the schema is ready when
-- sharing is explicitly approved later; the unique index keeps one active
-- grant per (case, grantee).
create table if not exists call_shield_case_access (
    id uuid primary key,
    owner_id text not null,
    case_id uuid not null references call_shield_cases(id) on delete cascade,
    grantee_type text not null check (grantee_type in ('user', 'attorney')),
    grantee_id text not null,
    permission text not null check (permission in ('viewer', 'exporter')),
    granted_at timestamptz not null default now(),
    revoked_at timestamptz
);

create unique index if not exists idx_call_shield_case_access_active_grant
    on call_shield_case_access(case_id, grantee_type, grantee_id)
    where revoked_at is null;

alter table call_shield_case_access enable row level security;
alter table call_shield_case_access force row level security;

create policy "call_shield_case_access_owner_select" on call_shield_case_access
    for select to authenticated
    using (owner_id = auth.uid()::text);
create policy "call_shield_case_access_owner_insert" on call_shield_case_access
    for insert to authenticated
    with check (owner_id = auth.uid()::text);
create policy "call_shield_case_access_owner_update" on call_shield_case_access
    for update to authenticated
    using (owner_id = auth.uid()::text)
    with check (owner_id = auth.uid()::text);

grant select, insert, update on call_shield_case_access to authenticated;

-- 5. Private evidence bucket. Never public. 50 MB per-file cap covers long
-- call recordings; the MIME allowlist mirrors the S1 domain list.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('call-shield-evidence', 'call-shield-evidence', false, 52428800,
    array['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/aac',
          'audio/ogg', 'audio/webm', 'audio/amr', 'audio/3gpp',
          'image/jpeg', 'image/png', 'image/webp', 'image/heic',
          'application/pdf', 'text/plain'])
on conflict (id) do update set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "call_shield_evidence_objects_owner_select" on storage.objects
    for select to authenticated
    using (bucket_id = 'call-shield-evidence'
        and (storage.foldername(name))[1] = auth.uid()::text);
create policy "call_shield_evidence_objects_owner_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'call-shield-evidence'
        and (storage.foldername(name))[1] = auth.uid()::text);
create policy "call_shield_evidence_objects_owner_delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'call-shield-evidence'
        and (storage.foldername(name))[1] = auth.uid()::text);
