create table if not exists decision_outcomes (
    owner_id text not null,

    decision_id text not null,

    primary key (owner_id, decision_id),

    status text,

    evaluation jsonb,

    outcome jsonb,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);

create index if not exists idx_decision_outcomes_owner
    on decision_outcomes(owner_id);

create index if not exists idx_decision_outcomes_status
    on decision_outcomes(status);

alter table decision_outcomes enable row level security;

alter table decision_outcomes force row level security;

create policy "decision_outcomes_owner_select"
on decision_outcomes
for select
to authenticated
using (
    owner_id = auth.uid()::text
);

create policy "decision_outcomes_owner_insert"
on decision_outcomes
for insert
to authenticated
with check (
    owner_id = auth.uid()::text
);

create policy "decision_outcomes_owner_update"
on decision_outcomes
for update
to authenticated
using (
    owner_id = auth.uid()::text
)
with check (
    owner_id = auth.uid()::text
);

create policy "decision_outcomes_owner_delete"
on decision_outcomes
for delete
to authenticated
using (
    owner_id = auth.uid()::text
);
