create table if not exists rental_units (
    owner_id text not null,
    id text not null,
    property_id text not null,
    label text not null check (btrim(label) <> ''),
    status text not null check (status in ('preparing', 'available', 'occupied', 'inactive')),
    bedrooms numeric check (bedrooms is null or bedrooms >= 0),
    bathrooms numeric check (bathrooms is null or bathrooms >= 0),
    square_feet numeric check (square_feet is null or square_feet >= 0),
    available_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    notes text,
    primary key (owner_id, id)
);

create table if not exists rental_tenants (
    owner_id text not null,
    id text not null,
    auth_user_id uuid references auth.users(id) on delete set null,
    display_name text not null check (btrim(display_name) <> ''),
    email text not null check (btrim(email) <> ''),
    phone text,
    status text not null check (status in ('invited', 'applicant', 'active', 'former', 'inactive')),
    invited_at timestamptz,
    activated_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (owner_id, id),
    unique (owner_id, email),
    unique (auth_user_id)
);

create table if not exists rental_leases (
    owner_id text not null,
    id text not null,
    property_id text not null,
    unit_id text not null,
    status text not null check (status in ('draft', 'active', 'ended', 'terminated', 'cancelled')),
    start_date date not null,
    end_date date,
    monthly_rent_cents bigint not null check (monthly_rent_cents > 0),
    currency_code text not null check (currency_code = upper(currency_code) and char_length(currency_code) = 3),
    rent_due_day smallint not null check (rent_due_day between 1 and 28),
    document_evidence_id text,
    activated_at timestamptz,
    ended_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    notes text,
    primary key (owner_id, id),
    foreign key (owner_id, unit_id) references rental_units(owner_id, id) on delete restrict,
    check (end_date is null or end_date >= start_date)
);

create table if not exists rental_lease_tenants (
    owner_id text not null,
    lease_id text not null,
    tenant_id text not null,
    created_at timestamptz not null default now(),
    primary key (owner_id, lease_id, tenant_id),
    foreign key (owner_id, lease_id) references rental_leases(owner_id, id) on delete cascade,
    foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id) on delete restrict
);

create index if not exists idx_rental_units_owner_property on rental_units(owner_id, property_id);
create index if not exists idx_rental_tenants_owner_status on rental_tenants(owner_id, status);
create index if not exists idx_rental_leases_owner_unit on rental_leases(owner_id, unit_id, start_date desc);
create index if not exists idx_rental_lease_tenants_owner_tenant on rental_lease_tenants(owner_id, tenant_id);

create or replace function rental_actor_has_lease_access(p_owner_id text, p_lease_id text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
    select exists (
        select 1
        from rental_lease_tenants membership
        join rental_tenants tenant
          on tenant.owner_id = membership.owner_id
         and tenant.id = membership.tenant_id
        where membership.owner_id = p_owner_id
          and membership.lease_id = p_lease_id
          and tenant.auth_user_id = auth.uid()
    );
$$;

create or replace function rental_actor_has_unit_access(p_owner_id text, p_unit_id text)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
    select exists (
        select 1
        from rental_leases lease
        where lease.owner_id = p_owner_id
          and lease.unit_id = p_unit_id
          and lease.status = 'active'
          and rental_actor_has_lease_access(lease.owner_id, lease.id)
    );
$$;

revoke all on function rental_actor_has_lease_access(text, text) from public;
revoke all on function rental_actor_has_unit_access(text, text) from public;
grant execute on function rental_actor_has_lease_access(text, text) to authenticated;
grant execute on function rental_actor_has_unit_access(text, text) to authenticated;

alter table rental_units enable row level security;
alter table rental_units force row level security;
alter table rental_tenants enable row level security;
alter table rental_tenants force row level security;
alter table rental_leases enable row level security;
alter table rental_leases force row level security;
alter table rental_lease_tenants enable row level security;
alter table rental_lease_tenants force row level security;

create policy "rental_units_owner_all" on rental_units for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "rental_units_tenant_select" on rental_units for select to authenticated
using (rental_actor_has_unit_access(owner_id, id));

create policy "rental_tenants_owner_all" on rental_tenants for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "rental_tenants_self_select" on rental_tenants for select to authenticated
using (auth_user_id = auth.uid());

create policy "rental_leases_owner_all" on rental_leases for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "rental_leases_tenant_select" on rental_leases for select to authenticated
using (rental_actor_has_lease_access(owner_id, id));

create policy "rental_lease_tenants_owner_all" on rental_lease_tenants for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "rental_lease_tenants_tenant_select" on rental_lease_tenants for select to authenticated
using (rental_actor_has_lease_access(owner_id, lease_id));
