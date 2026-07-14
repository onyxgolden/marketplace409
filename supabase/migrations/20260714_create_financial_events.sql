create table if not exists financial_events (
    id text primary key default gen_random_uuid()::text,

    owner_id text not null,

    organization_id text,

    property_id text,

    financial_account_id text,

    event_date date not null,

    description text not null,

    amount numeric not null,

    transaction_kind text not null,

    normalized_category text not null,

    tax_deductible boolean not null default false,

    affects_noi boolean not null default false,

    capitalized boolean not null default false,

    source_system text not null,

    source_record_id text,

    metadata jsonb not null default '{}'::jsonb,

    status text not null default 'active'
        check (status in ('active', 'inactive', 'deleted')),

    is_deleted boolean not null default false,

    deleted_at timestamptz,

    created_by text,

    updated_by text,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    constraint financial_events_deleted_state_check
        check (
            (is_deleted = false and deleted_at is null)
            or
            (is_deleted = true and deleted_at is not null)
        )
);

create index if not exists idx_financial_events_owner
    on financial_events(owner_id);

create index if not exists idx_financial_events_organization
    on financial_events(organization_id);

create index if not exists idx_financial_events_property
    on financial_events(property_id);

create index if not exists idx_financial_events_financial_account
    on financial_events(financial_account_id);

create index if not exists idx_financial_events_owner_event_date
    on financial_events(owner_id, event_date desc);

create index if not exists idx_financial_events_category
    on financial_events(normalized_category);

create index if not exists idx_financial_events_source
    on financial_events(source_system, source_record_id);

create index if not exists idx_financial_events_status
    on financial_events(status);

create unique index if not exists idx_financial_events_owner_source_record
    on financial_events(owner_id, source_system, source_record_id)
    where source_record_id is not null;

alter table financial_events enable row level security;

alter table financial_events force row level security;

create policy "financial_events_owner_select"
on financial_events
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy "financial_events_owner_insert"
on financial_events
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy "financial_events_owner_update"
on financial_events
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy "financial_events_owner_delete"
on financial_events
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);
