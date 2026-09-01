-- Shared FORGE workspace membership -- Checkpoint 3 (RPC half), group covering identity/leases.
-- Converts the owner-equality guard in each function from `p_owner_id <> auth.uid()::text` (or the
-- `authenticated_owner_id` local-variable equivalent) to `not has_workspace_access(p_owner_id)`, so
-- an active co-owner can call these exactly as the primary owner can. create or replace function
-- does not reset previously granted privileges, so the original migrations' revoke/grant statements
-- (where present) remain in effect -- nothing to repeat here.
--
-- Every function body below is otherwise byte-for-byte identical to its current live definition
-- (captured via pg_get_functiondef against the linked Production database) except for the single
-- guard substitution -- generated, not hand-transcribed, specifically to avoid introducing a subtle
-- error into business logic this large. Where a function also uses its authenticated actor id for
-- audit-trail purposes (e.g. `recorded_by`, `approved_by`, `forge_cutover_activated_by`), that usage
-- is deliberately left untouched -- it should keep recording the real acting user, not the resolved
-- workspace owner (requirement: record the acting user separately from the canonical owner).

create or replace function public.activate_rental_lease_schedule(p_owner_id text, p_schedule_id text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    schedule rent_schedules%rowtype;
    lease rental_leases%rowtype;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
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
$function$;


create or replace function public.apply_rental_lease_change(p_owner_id text, p_change_id text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare c rental_lease_changes%rowtype;l rental_leases%rowtype;s rent_schedules%rowtype;new_schedule_id text;amount bigint;due_day smallint;
begin if not has_workspace_access(p_owner_id) then raise exception 'Authenticated owner does not match lease owner.';end if;select * into c from rental_lease_changes where owner_id=p_owner_id and id=p_change_id for update;if not found or c.status<>'approved' then raise exception 'Approved lease change was not found.';end if;select * into l from rental_leases where owner_id=p_owner_id and id=c.lease_id for update;select * into s from rent_schedules where owner_id=p_owner_id and lease_id=l.id and status='active' order by effective_start_date desc limit 1 for update;
if c.change_type in('renewal','amendment') then amount:=coalesce((c.new_terms->>'monthlyRentCents')::bigint,l.monthly_rent_cents);due_day:=coalesce((c.new_terms->>'rentDueDay')::smallint,l.rent_due_day);if s.id is not null then update rent_schedules set status='ended',effective_end_date=c.effective_date-1,updated_at=now() where owner_id=p_owner_id and id=s.id;end if;new_schedule_id:='rent_schedule_'||gen_random_uuid()::text;insert into rent_schedules(owner_id,id,lease_id,status,amount_cents,currency_code,due_day,effective_start_date,effective_end_date)values(p_owner_id,new_schedule_id,l.id,'active',amount,l.currency_code,due_day,c.effective_date,nullif(c.new_terms->>'endDate','')::date);update rental_leases set end_date=coalesce(nullif(c.new_terms->>'endDate','')::date,end_date),monthly_rent_cents=amount,rent_due_day=due_day,updated_at=now() where owner_id=p_owner_id and id=l.id;
else amount:=(c.new_terms->>'amountCents')::bigint;if amount<=0 then raise exception 'Approved proration requires a positive amount.';end if;if s.id is null then raise exception 'An active schedule is required for proration.';end if;insert into rent_charges(owner_id,id,lease_id,schedule_id,period,due_date,amount_cents,paid_amount_cents,currency_code,status,source_key,notes,charge_type)values(p_owner_id,'rent_charge_proration_'||c.id,l.id,s.id,to_char(c.effective_date,'YYYY-MM'),c.effective_date,amount,0,l.currency_code,case when c.effective_date>current_date then 'scheduled' else 'due' end,'proration:'||c.id,c.reason,'proration');end if;
update rental_lease_changes set status='applied',applied_at=now() where owner_id=p_owner_id and id=c.id;return jsonb_build_object('changeId',c.id,'status','applied','scheduleId',new_schedule_id);end;$function$;


create or replace function public.save_rental_lease(p_owner_id text, p_lease jsonb, p_tenants jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    required_lease_id text := nullif(btrim(p_lease ->> 'id'), '');
    required_unit_id text := nullif(btrim(p_lease ->> 'unit_id'), '');
    resolved_property_id text;
    tenant_count integer;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;

    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Rental lease owner does not match authenticated owner.' using errcode = '42501';
    end if;

    if required_lease_id is null or required_unit_id is null then
        raise exception 'Rental lease id and unit id are required.' using errcode = '22023';
    end if;

    select property_id into resolved_property_id
      from rental_units
     where owner_id = p_owner_id and id = required_unit_id;
    if resolved_property_id is null then
        raise exception 'Rental lease unit was not found for this owner.' using errcode = '23503';
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
        p_owner_id, required_lease_id, resolved_property_id, required_unit_id,
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
$function$;


create or replace function public.save_rental_lease_preparation_version(p_owner_id text, p_lease_id text, p_title text, p_terms jsonb, p_change_summary text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare p rental_lease_preparations%rowtype;next_version integer;
begin if not has_workspace_access(p_owner_id) then raise exception 'Authenticated owner does not match lease owner.';end if;if jsonb_typeof(p_terms)<>'object' then raise exception 'Lease preparation terms must be an object.';end if;
select * into p from rental_lease_preparations where owner_id=p_owner_id and lease_id=p_lease_id for update;
if not found then insert into rental_lease_preparations(owner_id,id,lease_id,title)values(p_owner_id,'rental_lease_preparation_'||gen_random_uuid()::text,p_lease_id,p_title)returning * into p;end if;
next_version:=p.current_version+1;insert into rental_lease_preparation_versions(owner_id,preparation_id,version_number,terms,change_summary,created_by)values(p_owner_id,p.id,next_version,p_terms,p_change_summary,auth.uid()::text);
update rental_lease_preparations set title=p_title,status='draft',current_version=next_version,approved_version=null,approved_at=null,updated_at=now() where owner_id=p_owner_id and id=p.id;
return jsonb_build_object('preparationId',p.id,'leaseId',p_lease_id,'versionNumber',next_version,'status','draft');end;$function$;


create or replace function public.approve_rental_lease_preparation_version(p_owner_id text, p_preparation_id text, p_version_number integer)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
begin if not has_workspace_access(p_owner_id) then raise exception 'Authenticated owner does not match lease owner.';end if;
if not exists(select 1 from rental_lease_preparation_versions where owner_id=p_owner_id and preparation_id=p_preparation_id and version_number=p_version_number)then raise exception 'Lease preparation version was not found.';end if;
update rental_lease_preparations set status='approved',approved_version=p_version_number,approved_at=now(),updated_at=now() where owner_id=p_owner_id and id=p_preparation_id;
if not found then raise exception 'Lease preparation was not found.';end if;return jsonb_build_object('preparationId',p_preparation_id,'versionNumber',p_version_number,'status','approved');end;$function$;
