create table if not exists rent_schedules (
    owner_id text not null, id text not null, lease_id text not null,
    status text not null check (status in ('draft', 'active', 'paused', 'ended')),
    amount_cents bigint not null check (amount_cents > 0),
    currency_code text not null check (currency_code = upper(currency_code) and char_length(currency_code) = 3),
    due_day smallint not null check (due_day between 1 and 28),
    effective_start_date date not null, effective_end_date date,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    foreign key (owner_id, lease_id) references rental_leases(owner_id, id) on delete restrict,
    check (effective_end_date is null or effective_end_date >= effective_start_date)
);

create table if not exists rent_charges (
    owner_id text not null, id text not null, lease_id text not null, schedule_id text not null,
    period text not null check (period ~ '^\\d{4}-\\d{2}$'), due_date date not null,
    amount_cents bigint not null check (amount_cents > 0),
    paid_amount_cents bigint not null default 0 check (paid_amount_cents >= 0 and paid_amount_cents <= amount_cents),
    currency_code text not null check (currency_code = upper(currency_code) and char_length(currency_code) = 3),
    status text not null check (status in ('scheduled', 'due', 'partially_paid', 'paid', 'overdue', 'void')),
    source_key text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    voided_at timestamptz, notes text,
    primary key (owner_id, id), unique (owner_id, source_key),
    foreign key (owner_id, lease_id) references rental_leases(owner_id, id) on delete restrict,
    foreign key (owner_id, schedule_id) references rent_schedules(owner_id, id) on delete restrict,
    check (status <> 'paid' or paid_amount_cents = amount_cents),
    check (status <> 'void' or voided_at is not null)
);

create index if not exists idx_rent_schedules_owner_lease on rent_schedules(owner_id, lease_id);
create index if not exists idx_rent_charges_owner_lease_due on rent_charges(owner_id, lease_id, due_date desc);

alter table rent_schedules enable row level security;
alter table rent_schedules force row level security;
alter table rent_charges enable row level security;
alter table rent_charges force row level security;

create policy "rent_schedules_owner_all" on rent_schedules for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "rent_schedules_tenant_select" on rent_schedules for select to authenticated
using (rental_actor_has_lease_access(owner_id, lease_id));
create policy "rent_charges_owner_all" on rent_charges for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "rent_charges_tenant_select" on rent_charges for select to authenticated
using (rental_actor_has_lease_access(owner_id, lease_id));
