create table if not exists reservation_inventory_imports (
  owner_id text not null,
  id text not null,
  plan_digest text not null check (btrim(plan_digest) <> ''),
  row_count integer not null check (row_count > 0),
  result jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (owner_id, id)
);

alter table reservation_inventory_imports enable row level security;
alter table reservation_inventory_imports force row level security;
create policy "reservation_inventory_imports_workspace_read" on reservation_inventory_imports
  for select to authenticated using (has_workspace_access(owner_id));
grant select on reservation_inventory_imports to authenticated;

create or replace function import_reservation_inventory_bulk(
  p_owner_id text,
  p_import_id text,
  p_plan_digest text,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_existing reservation_inventory_imports;
  v_row jsonb;
  v_count integer;
  v_index integer := 0;
  v_result jsonb;
begin
  if v_actor is null or not has_workspace_access(p_owner_id) then
    raise exception 'Workspace access is required.';
  end if;
  if btrim(coalesce(p_import_id, '')) = '' or btrim(coalesce(p_plan_digest, '')) = '' then
    raise exception 'Import identity and plan digest are required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id || ':' || p_import_id, 0));
  select * into v_existing from reservation_inventory_imports
    where owner_id = p_owner_id and id = p_import_id;
  if found then
    if v_existing.plan_digest <> p_plan_digest then
      raise exception 'Import identity was already used with a different plan.';
    end if;
    return v_existing.result;
  end if;

  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Import rows must be a JSON array.'; end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 500 then raise exception 'Import must contain between 1 and 500 rows.'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) row
    group by lower(btrim(row->>'propertyId')), lower(btrim(row->>'unitLabel'))
    having count(*) > 1
  ) then raise exception 'Import contains duplicate property and unit names.'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) row
    join rental_units unit on unit.owner_id = p_owner_id
      and unit.status <> 'inactive'
      and lower(btrim(unit.property_id)) = lower(btrim(row->>'propertyId'))
      and lower(btrim(unit.label)) = lower(btrim(row->>'unitLabel'))
  ) then raise exception 'A property/unit in this import already exists.'; end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    if btrim(coalesce(v_row->>'unitId','')) = ''
      or btrim(coalesce(v_row->>'propertyId','')) = ''
      or btrim(coalesce(v_row->>'unitLabel','')) = ''
      or btrim(coalesce(v_row->>'publicName','')) = ''
      or (v_row->>'inventoryType') not in ('rv_site','cabin','furnished_home','vacation_unit','glamping_site','tent_site','parking_space','storage_space','other')
      or (v_row->>'bookingStatus') not in ('draft','active','paused','inactive')
      or coalesce((v_row->>'nightlyRateCents')::bigint, 0) < 1
    then raise exception 'Import row % is invalid.', v_index; end if;

    insert into rental_units(owner_id,id,property_id,label,status,created_at,updated_at,notes)
    values(p_owner_id,v_row->>'unitId',v_row->>'propertyId',v_row->>'unitLabel','available',now(),now(),'Created by reservation inventory bulk import ' || p_import_id);

    insert into reservation_inventory_settings(
      owner_id,unit_id,inventory_type,booking_status,public_name,public_description,timezone,
      maximum_guests,minimum_nights,maximum_nights,turnover_buffer_hours,amenities,
      cleaning_fee_cents,security_deposit_cents,lodging_tax_basis_points,created_by,updated_by
    ) values (
      p_owner_id,v_row->>'unitId',v_row->>'inventoryType',v_row->>'bookingStatus',v_row->>'publicName',
      nullif(v_row->>'publicDescription',''),v_row->>'timezone',(v_row->>'maximumGuests')::integer,
      (v_row->>'minimumNights')::integer,nullif(v_row->>'maximumNights','')::integer,
      (v_row->>'turnoverBufferHours')::integer,
      array(select jsonb_array_elements_text(coalesce(v_row->'amenities','[]'::jsonb))),
      (v_row->>'cleaningFeeCents')::bigint,(v_row->>'securityDepositCents')::bigint,
      (v_row->>'lodgingTaxBasisPoints')::integer,v_actor,v_actor
    );

    insert into reservation_rate_plans(
      owner_id,id,unit_id,label,cadence,amount_cents,currency_code,effective_start_date,status,created_by
    ) values (
      p_owner_id,v_row->>'ratePlanId',v_row->>'unitId','Base nightly rate','nightly',
      (v_row->>'nightlyRateCents')::bigint,'USD',(v_row->>'effectiveStartDate')::date,'active',v_actor
    );
  end loop;

  v_result := jsonb_build_object('importId',p_import_id,'createdUnits',v_count,'createdInventory',v_count,'createdRatePlans',v_count);
  insert into reservation_inventory_imports(owner_id,id,plan_digest,row_count,result,created_by)
  values(p_owner_id,p_import_id,p_plan_digest,v_count,v_result,v_actor);
  return v_result;
end $$;

revoke all on function import_reservation_inventory_bulk(text,text,text,jsonb) from public;
grant execute on function import_reservation_inventory_bulk(text,text,text,jsonb) to authenticated;
