create table if not exists credential_references (
    id text primary key,

    owner_id text not null,

    provider text not null,

    external_credential_id text not null,

    vault_reference text not null,

    status text not null,

    last_validated_at timestamptz,

    expires_at timestamptz,

    created_at timestamptz not null,

    updated_at timestamptz not null
);

create unique index if not exists
    idx_credential_references_owner_provider_external
on credential_references (
    owner_id,
    provider,
    external_credential_id
);

create index if not exists
    idx_credential_references_owner
on credential_references(owner_id);

alter table credential_references enable row level security;

alter table credential_references force row level security;

create policy "credential_references_owner_select"
on credential_references
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy "credential_references_owner_insert"
on credential_references
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy "credential_references_owner_update"
on credential_references
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy "credential_references_owner_delete"
on credential_references
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);

create table if not exists connections (
    id text primary key,

    owner_id text not null,

    name text not null,

    type text not null,

    status text not null,

    provider text not null,

    credential_reference_id text
        references credential_references(id)
        on delete restrict,

    last_imported_at timestamptz,

    created_at timestamptz not null,

    updated_at timestamptz not null
);

create unique index if not exists
    idx_connections_owner_provider_id
on connections (
    owner_id,
    provider,
    id
);

create index if not exists
    idx_connections_owner
on connections(owner_id);

create index if not exists
    idx_connections_credential_reference
on connections(credential_reference_id);

alter table connections enable row level security;

alter table connections force row level security;

create policy "connections_owner_select"
on connections
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy "connections_owner_insert"
on connections
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy "connections_owner_update"
on connections
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy "connections_owner_delete"
on connections
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);

create table if not exists institution_references (
    id text primary key,

    owner_id text not null,

    connection_id text not null
        references connections(id)
        on delete cascade,

    name text not null,

    type text not null,

    provider text not null,

    external_institution_id text,

    website_url text,

    logo_url text,

    created_at timestamptz not null,

    updated_at timestamptz not null
);

create unique index if not exists
    idx_institution_references_owner_connection
on institution_references (
    owner_id,
    connection_id,
    id
);

create index if not exists
    idx_institution_references_owner
on institution_references(owner_id);

create index if not exists
    idx_institution_references_connection
on institution_references(connection_id);

alter table institution_references enable row level security;

alter table institution_references force row level security;

create policy "institution_references_owner_select"
on institution_references
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy "institution_references_owner_insert"
on institution_references
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy "institution_references_owner_update"
on institution_references
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy "institution_references_owner_delete"
on institution_references
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);
