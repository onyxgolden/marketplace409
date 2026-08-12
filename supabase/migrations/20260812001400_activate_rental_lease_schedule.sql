create or replace function activate_rental_lease_schedule(
    p_owner_id text,
    p_schedule_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    authenticated_owner_id text := auth.uid()::text;
    schedule rent_schedules%rowtype;
    lease rental_leases%rowtype;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> authenticated_owner_id then
        raise exception 'Rental activation owner does not match authenticated owner.' using errcode = '42501';
    end if;

    select * into schedule from rent_schedules
     where owner_id = p_owner_id and id = p_schedule_id for update;
    if not found then raise exception 'Rent schedule was not found.' using errcode = 'P0002'; end if;

    select * into lease from rental_leases
     where owner_id = p_owner_id and id = schedule.lease_id for update;
    if not found then raise exception 'Rental lease was not found.' using errcode = 'P0002'; end if;
    if lease.status not in ('draft', 'active') then
        raise exception 'Only a draft or active lease can be activated.' using errcode = '22023';
    end if;
    if schedule.status not in ('draft', 'active') then
        raise exception 'Only a draft or active rent schedule can be activated.' using errcode = '22023';
    end if;

    update rental_leases set status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now()
     where owner_id = p_owner_id and id = lease.id;
    update rent_schedules set status = 'active', updated_at = now()
     where owner_id = p_owner_id and id = schedule.id;

    return jsonb_build_object('leaseId', lease.id, 'scheduleId', schedule.id, 'status', 'active');
end;
$$;

revoke all on function activate_rental_lease_schedule(text, text) from public;
grant execute on function activate_rental_lease_schedule(text, text) to authenticated;
