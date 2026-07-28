create table if not exists credential_vault (
    owner_id text not null,

    vault_reference text not null,

    secret text not null,

    created_at timestamptz not null,

    updated_at timestamptz not null,

    primary key (
        owner_id,
        vault_reference
    )
);

create index if not exists
    idx_credential_vault_owner
on credential_vault(owner_id);

alter table credential_vault enable row level security;

alter table credential_vault force row level security;

create policy "credential_vault_owner_select"
on credential_vault
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy "credential_vault_owner_insert"
on credential_vault
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy "credential_vault_owner_update"
on credential_vault
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy "credential_vault_owner_delete"
on credential_vault
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);
