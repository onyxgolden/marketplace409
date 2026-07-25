create table if not exists connection_execution_history (
    id text primary key,

    owner_id text not null,

    connection_id text not null
        references connections(id)
        on delete cascade,

    operation_type text not null,

    status text not null,

    provider text,

    started_at timestamptz not null,

    completed_at timestamptz,

    metrics jsonb not null default '{}'::jsonb,

    error_details jsonb,

    created_at timestamptz not null
);

create index if not exists
    idx_connection_execution_history_owner
on connection_execution_history(owner_id);

create index if not exists
    idx_connection_execution_history_owner_connection
on connection_execution_history(
    owner_id,
    connection_id
);

create index if not exists
    idx_connection_execution_history_owner_created
on connection_execution_history(
    owner_id,
    created_at desc
);

alter table connection_execution_history
    enable row level security;

alter table connection_execution_history
    force row level security;

create policy
"connection_execution_history_owner_select"
on connection_execution_history
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy
"connection_execution_history_owner_insert"
on connection_execution_history
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy
"connection_execution_history_owner_update"
on connection_execution_history
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy
"connection_execution_history_owner_delete"
on connection_execution_history
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);
