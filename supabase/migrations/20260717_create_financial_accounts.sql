create table if not exists financial_accounts (
    id text primary key,

    owner_id text not null,

    connection_id text not null,

    provider text not null,

    provider_account_id text not null,

    institution_id text not null,

    name text not null,

    official_name text,

    mask text,

    type text not null
        check (
            type in (
                'depository',
                'credit',
                'loan',
                'investment',
                'other'
            )
        ),

    subtype text,

    currency_code text not null,

    active boolean not null default true,

    created_at timestamptz not null,

    updated_at timestamptz not null
);

create unique index if not exists
    idx_financial_accounts_owner_provider_account
on financial_accounts (
    owner_id,
    provider,
    provider_account_id
);

create index if not exists
    idx_financial_accounts_owner
on financial_accounts(owner_id);

create index if not exists
    idx_financial_accounts_connection
on financial_accounts(connection_id);

create index if not exists
    idx_financial_accounts_owner_type
on financial_accounts(owner_id, type);

alter table financial_accounts enable row level security;

alter table financial_accounts force row level security;

create policy "financial_accounts_owner_select"
on financial_accounts
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy "financial_accounts_owner_insert"
on financial_accounts
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy "financial_accounts_owner_update"
on financial_accounts
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy "financial_accounts_owner_delete"
on financial_accounts
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);
