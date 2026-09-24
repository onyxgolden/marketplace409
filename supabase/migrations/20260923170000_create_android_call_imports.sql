-- Call Shield Slice A — android_call_imports staging table.
--
-- Imported phone call-log records land here FIRST, never directly as case
-- timeline events (per architecture review). The user reviews each staged
-- import and explicitly confirms which case it belongs to; only then does
-- the web app append a call event to call_shield_case_events.
--
-- Dedupe: dedupe_hash = sha256(normalized_phone || '|' || started_at_iso ||
-- '|' || duration_seconds || '|' || call_type), unique per owner, so repeat
-- imports of the same call-log window are idempotent. The raw phone_number
-- is kept (owner-only RLS) because the user must see which number called to
-- confirm the case association; the hash alone cannot drive that UI.
-- android_call_id is the opaque CallLog row id: useful for debugging, not
-- trusted as a stable cross-device identity.

create table if not exists android_call_imports (
    id uuid primary key,
    owner_id text not null,
    device_id text not null,
    android_call_id text,
    phone_number text not null,
    normalized_phone text not null,
    dedupe_hash text not null,
    started_at timestamptz not null,
    duration_seconds integer not null check (duration_seconds >= 0),
    call_type text not null check (call_type in (
        'incoming', 'outgoing', 'missed', 'rejected', 'blocked', 'other')),
    caller_name text,
    imported_at timestamptz not null default now(),
    matched_case_id uuid references call_shield_cases(id) on delete set null,
    dismissed boolean not null default false,
    unique (owner_id, dedupe_hash)
);

create index if not exists idx_android_call_imports_owner_started
    on android_call_imports(owner_id, started_at desc);
create index if not exists idx_android_call_imports_owner_case
    on android_call_imports(owner_id, matched_case_id)
    where matched_case_id is not null;

alter table android_call_imports enable row level security;
alter table android_call_imports force row level security;

-- Staging is owner-mutable (review workflow needs update/delete); the
-- append-only invariant lives on call_shield_case_events, not here.
create policy "android_call_imports_owner_select" on android_call_imports
    for select to authenticated
    using (owner_id = auth.uid()::text);
create policy "android_call_imports_owner_insert" on android_call_imports
    for insert to authenticated
    with check (owner_id = auth.uid()::text);
create policy "android_call_imports_owner_update" on android_call_imports
    for update to authenticated
    using (owner_id = auth.uid()::text)
    with check (owner_id = auth.uid()::text);
create policy "android_call_imports_owner_delete" on android_call_imports
    for delete to authenticated
    using (owner_id = auth.uid()::text);

grant select, insert, update, delete on android_call_imports to authenticated;
