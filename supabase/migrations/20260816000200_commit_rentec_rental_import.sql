-- Commits a resolved (already reviewed, non-blocked) set of Rentec import
-- candidate rows into the real rental identity tables, atomically. This is
-- the write step the existing rentec-api-preview pipeline has never had —
-- see rentec-import-manifest.preview.js's resolveRentecImportCandidatesForCommit,
-- the only intended caller's data source.
--
-- Idempotent by design: every insert targets the partial unique index on
-- (owner_id, source_system, source_record_id) added in
-- 20260816000100_add_rental_import_source_tracking.sql, with ON CONFLICT
-- DO NOTHING — re-running this with the same candidates is always safe
-- and never overwrites a row that already exists (whether from a prior
-- import or from manual entry that happens to share the same identity).
--
-- Callers are responsible for only ever passing fully-resolved candidates
-- (no manifest blockers) and for scoping p_units/p_tenants/p_leases to a
-- single approved property — this function does not itself enforce
-- "one property at a time," it just writes exactly what it's given, and
-- relies on the underlying table CHECK/NOT NULL constraints as a hard
-- backstop: any invalid row aborts the whole call, nothing partially
-- writes, because the entire function body is one transaction.
create or replace function commit_rentec_rental_import(
    p_owner_id text,
    p_units jsonb default '[]'::jsonb,
    p_tenants jsonb default '[]'::jsonb,
    p_leases jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_units_created integer := 0;
    v_tenants_created integer := 0;
    v_leases_created integer := 0;
    v_lease_tenants_created integer := 0;
begin
    if p_owner_id is null or btrim(p_owner_id) = '' then
        raise exception 'An owner id is required.';
    end if;
    if p_owner_id <> auth.uid()::text then
        raise exception 'Rentec import commits must be scoped to the authenticated owner.';
    end if;
    if jsonb_array_length(p_units) > 25 or jsonb_array_length(p_tenants) > 25 or jsonb_array_length(p_leases) > 25 then
        raise exception 'Rentec import commits are limited to 25 rows per table for a single pilot commit.';
    end if;

    with inserted as (
        insert into rental_units (owner_id, id, property_id, label, status, source_system, source_record_id)
        select p_owner_id, x->>'id', x->>'property_id', x->>'label', x->>'status', x->>'source_system', x->>'source_record_id'
        from jsonb_array_elements(p_units) as x
        on conflict (owner_id, source_system, source_record_id)
            where source_system is not null and source_record_id is not null
            do nothing
        returning 1
    )
    select count(*) into v_units_created from inserted;

    with inserted as (
        insert into rental_tenants (owner_id, id, display_name, email, phone, status, source_system, source_record_id)
        select p_owner_id, x->>'id', x->>'display_name', x->>'email', nullif(x->>'phone', ''), x->>'status', x->>'source_system', x->>'source_record_id'
        from jsonb_array_elements(p_tenants) as x
        on conflict (owner_id, source_system, source_record_id)
            where source_system is not null and source_record_id is not null
            do nothing
        returning 1
    )
    select count(*) into v_tenants_created from inserted;

    -- rental_leases has no tenant_id column — that relationship lives in
    -- rental_lease_tenants below, even though the candidate JSON carries
    -- tenant_id for convenience. Leases always commit as 'draft'
    -- regardless of what the candidate says, matching the manifest's own
    -- stated guarantee that imported leases cannot activate billing,
    -- portals, or autopay.
    with inserted as (
        insert into rental_leases (
            owner_id, id, property_id, unit_id, status, start_date, end_date,
            monthly_rent_cents, currency_code, rent_due_day, source_system, source_record_id
        )
        select
            p_owner_id, x->>'id', x->>'property_id', x->>'unit_id', 'draft',
            (x->>'start_date')::date, nullif(x->>'end_date', '')::date,
            (x->>'monthly_rent_cents')::bigint, x->>'currency_code',
            (x->>'rent_due_day')::smallint, x->>'source_system', x->>'source_record_id'
        from jsonb_array_elements(p_leases) as x
        on conflict (owner_id, source_system, source_record_id)
            where source_system is not null and source_record_id is not null
            do nothing
        returning 1
    )
    select count(*) into v_leases_created from inserted;

    -- Lease/tenant membership derived from the same lease candidates'
    -- tenant_id field, tagged with the lease's own source identity since
    -- one Rentec lease maps to exactly one membership row today.
    with inserted as (
        insert into rental_lease_tenants (owner_id, lease_id, tenant_id, source_system, source_record_id)
        select p_owner_id, x->>'id', x->>'tenant_id', x->>'source_system', x->>'source_record_id'
        from jsonb_array_elements(p_leases) as x
        where x->>'tenant_id' is not null
        on conflict (owner_id, source_system, source_record_id)
            where source_system is not null and source_record_id is not null
            do nothing
        returning 1
    )
    select count(*) into v_lease_tenants_created from inserted;

    return jsonb_build_object(
        'unitsCreated', v_units_created,
        'tenantsCreated', v_tenants_created,
        'leasesCreated', v_leases_created,
        'leaseTenantsCreated', v_lease_tenants_created
    );
end;
$$;

revoke all on function commit_rentec_rental_import(text, jsonb, jsonb, jsonb) from public;
revoke all on function commit_rentec_rental_import(text, jsonb, jsonb, jsonb) from anon;
grant execute on function commit_rentec_rental_import(text, jsonb, jsonb, jsonb) to authenticated;
