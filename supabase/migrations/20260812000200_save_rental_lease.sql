create or replace function save_rental_lease(
    p_owner_id text,
    p_lease jsonb,
    p_tenants jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    authenticated_owner_id text := auth.uid()::text;
    required_lease_id text := nullif(btrim(p_lease ->> 'id'), '');
    required_unit_id text := nullif(btrim(p_lease ->> 'unit_id'), '');
    tenant_count integer;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;

    if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> authenticated_owner_id then
        raise exception 'Rental lease owner does not match authenticated owner.' using errcode = '42501';
    end if;

    if required_lease_id is null or required_unit_id is null then
        raise exception 'Rental lease id and unit id are required.' using errcode = '22023';
    end if;

    if p_tenants is null or jsonb_typeof(p_tenants) <> 'array' or jsonb_array_length(p_tenants) = 0 then
        raise exception 'Rental lease requires at least one tenant.' using errcode = '22023';
    end if;

    select count(distinct membership.tenant_id)
      into tenant_count
      from jsonb_to_recordset(p_tenants) as membership(tenant_id text)
      join rental_tenants tenant
        on tenant.owner_id = p_owner_id
       and tenant.id = membership.tenant_id;

    if tenant_count <> jsonb_array_length(p_tenants) then
        raise exception 'Every rental lease tenant must belong to the authenticated owner.' using errcode = '23503';
    end if;

    insert into rental_leases (
        owner_id, id, property_id, unit_id, status, start_date, end_date,
        monthly_rent_cents, currency_code, rent_due_day, document_evidence_id,
        activated_at, ended_at, created_at, updated_at, notes
    ) values (
        p_owner_id, required_lease_id, p_lease ->> 'property_id', required_unit_id,
        p_lease ->> 'status', (p_lease ->> 'start_date')::date,
        nullif(p_lease ->> 'end_date', '')::date,
        (p_lease ->> 'monthly_rent_cents')::bigint, p_lease ->> 'currency_code',
        (p_lease ->> 'rent_due_day')::smallint, p_lease ->> 'document_evidence_id',
        nullif(p_lease ->> 'activated_at', '')::timestamptz,
        nullif(p_lease ->> 'ended_at', '')::timestamptz,
        (p_lease ->> 'created_at')::timestamptz,
        (p_lease ->> 'updated_at')::timestamptz, p_lease ->> 'notes'
    )
    on conflict (owner_id, id) do update set
        property_id = excluded.property_id,
        unit_id = excluded.unit_id,
        status = excluded.status,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        monthly_rent_cents = excluded.monthly_rent_cents,
        currency_code = excluded.currency_code,
        rent_due_day = excluded.rent_due_day,
        document_evidence_id = excluded.document_evidence_id,
        activated_at = excluded.activated_at,
        ended_at = excluded.ended_at,
        updated_at = excluded.updated_at,
        notes = excluded.notes;

    delete from rental_lease_tenants
     where owner_id = p_owner_id and lease_id = required_lease_id;

    insert into rental_lease_tenants (owner_id, lease_id, tenant_id)
    select p_owner_id, required_lease_id, membership.tenant_id
      from jsonb_to_recordset(p_tenants) as membership(tenant_id text);

    return jsonb_build_object('lease_id', required_lease_id, 'tenant_count', tenant_count);
end;
$$;

revoke all on function save_rental_lease(text, jsonb, jsonb) from public;
grant execute on function save_rental_lease(text, jsonb, jsonb) to authenticated;
