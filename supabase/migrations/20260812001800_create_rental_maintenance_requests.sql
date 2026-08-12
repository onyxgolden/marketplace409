create table if not exists rental_maintenance_requests (
    owner_id text not null,
    id text not null,
    lease_id text not null,
    unit_id text not null,
    tenant_id text not null,
    title text not null check (btrim(title) <> ''),
    description text not null check (btrim(description) <> ''),
    priority text not null check (priority in ('routine', 'soon', 'urgent', 'emergency')),
    status text not null check (status in ('submitted', 'reviewing', 'scheduled', 'in_progress', 'completed', 'cancelled')),
    permission_to_enter boolean not null default false,
    contact_phone text,
    owner_notes text,
    submitted_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz,
    primary key (owner_id, id),
    foreign key (owner_id, lease_id) references rental_leases(owner_id, id) on delete cascade,
    foreign key (owner_id, unit_id) references rental_units(owner_id, id) on delete restrict,
    foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id) on delete restrict
);

create index if not exists idx_rental_maintenance_owner_status
    on rental_maintenance_requests(owner_id, status, submitted_at desc);
create index if not exists idx_rental_maintenance_tenant
    on rental_maintenance_requests(owner_id, tenant_id, submitted_at desc);

alter table rental_maintenance_requests enable row level security;
alter table rental_maintenance_requests force row level security;

create policy "rental_maintenance_owner_all" on rental_maintenance_requests for all to authenticated
using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy "rental_maintenance_tenant_select" on rental_maintenance_requests for select to authenticated
using (rental_actor_has_lease_access(owner_id, lease_id));

create or replace function submit_rental_maintenance_request(
    p_lease_id text,
    p_title text,
    p_description text,
    p_priority text default 'routine',
    p_permission_to_enter boolean default false,
    p_contact_phone text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_owner_id text;
    v_unit_id text;
    v_tenant_id text;
    v_request_id text := 'rental_maintenance_' || gen_random_uuid()::text;
begin
    if auth.uid() is null then raise exception 'Authentication is required.'; end if;
    if btrim(coalesce(p_title, '')) = '' then raise exception 'Maintenance request title is required.'; end if;
    if btrim(coalesce(p_description, '')) = '' then raise exception 'Maintenance request description is required.'; end if;
    if p_priority not in ('routine', 'soon', 'urgent', 'emergency') then raise exception 'Unsupported maintenance priority.'; end if;

    select lease.owner_id, lease.unit_id, membership.tenant_id
      into v_owner_id, v_unit_id, v_tenant_id
      from rental_leases lease
      join rental_lease_tenants membership
        on membership.owner_id = lease.owner_id and membership.lease_id = lease.id
      join rental_tenants tenant
        on tenant.owner_id = membership.owner_id and tenant.id = membership.tenant_id
     where lease.id = p_lease_id
       and lease.status = 'active'
       and tenant.auth_user_id = auth.uid()
     limit 1;

    if v_tenant_id is null then raise exception 'The authenticated tenant does not have access to this active lease.'; end if;

    insert into rental_maintenance_requests (
      owner_id, id, lease_id, unit_id, tenant_id, title, description, priority,
      status, permission_to_enter, contact_phone
    ) values (
      v_owner_id, v_request_id, p_lease_id, v_unit_id, v_tenant_id,
      btrim(p_title), btrim(p_description), p_priority, 'submitted',
      coalesce(p_permission_to_enter, false), nullif(btrim(coalesce(p_contact_phone, '')), '')
    );

    return jsonb_build_object('id', v_request_id, 'status', 'submitted');
end;
$$;

revoke all on function submit_rental_maintenance_request(text, text, text, text, boolean, text) from public;
grant execute on function submit_rental_maintenance_request(text, text, text, text, boolean, text) to authenticated;
