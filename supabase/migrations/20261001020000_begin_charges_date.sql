-- Rentec parity R10: move-in date vs "begin charges on" date.
--
-- Rentec treats these as separate fields; getting them wrong creates a bogus
-- past-due balance from day one (e.g. tenant moves in Aug 28, FORGE generates
-- a full August charge due Aug 1). rental_leases gains begin_charges_date —
-- "Day charges start" in Brandy's words — distinct from start_date
-- ("Day they move in"). Charge generation never produces a charge whose due
-- date precedes it, in both generation paths:
--   - the JS cron (generate-charges route) via generateRentCharge(), and
--   - the manual generate-charge path via generate_monthly_rent_charge().
--
-- Backfill decision: begin_charges_date = start_date for every existing
-- lease. This is the documented sensible default (begin-charges = move-in),
-- and it is the safe direction: the new gate can only ever SUPPRESS future
-- charge generation, never create a charge, so no bogus past-due balance can
-- appear for Eric, Brandy, or anyone else. Already-generated charges are
-- deliberately left untouched — no void sweep (rewriting the books behind
-- Brandy would be worse than the footgun this prevents). For leases whose
-- start month is already past (all current production leases), the cron only
-- ever generates the current/next month, so behavior is unchanged.
--
-- Writers updated so the NOT NULL column can never break an insert path:
--   - save_rental_lease: persists begin_charges_date, defaulting to
--     start_date when the caller omits it (mirrors the domain default);
--   - commit_rentec_rental_import: imported leases commit as drafts with
--     begin_charges_date = start_date (drafts cannot bill anyway);
--   - update_lease_terms (PR #418): gains p_begin_charges_date; null keeps
--     the lease's current value so pre-R10 callers never clobber it.
--
-- NOT APPLIED — ships with the R10 PR; Jason applies production migrations.

-- 1. Column + backfill. Two steps (not a single ADD COLUMN ... NOT NULL)
-- so the backfill runs before the constraint lands.
alter table rental_leases add column begin_charges_date date;

update rental_leases
   set begin_charges_date = start_date
 where begin_charges_date is null;

alter table rental_leases alter column begin_charges_date set not null;

-- 2. save_rental_lease persists begin_charges_date (defaults to start_date).
-- Same signature and auth model as 20260829000800 (SECURITY INVOKER default,
-- has_workspace_access); only the column list changes.
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
        begin_charges_date,
        monthly_rent_cents, currency_code, rent_due_day, document_evidence_id,
        activated_at, ended_at, created_at, updated_at, notes
    ) values (
        p_owner_id, required_lease_id, resolved_property_id, required_unit_id,
        p_lease ->> 'status', (p_lease ->> 'start_date')::date,
        nullif(p_lease ->> 'end_date', '')::date,
        coalesce(nullif(p_lease ->> 'begin_charges_date', '')::date, (p_lease ->> 'start_date')::date),
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
        begin_charges_date = excluded.begin_charges_date,
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

-- 3. commit_rentec_rental_import: imported leases commit as drafts with
-- begin_charges_date = start_date (drafts cannot bill, so the dates only
-- matter once Brandy edits them). Body unchanged from 20260816000200 apart
-- from the lease insert column list; grants from 20260912020000 are
-- preserved by CREATE OR REPLACE.
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
            begin_charges_date,
            monthly_rent_cents, currency_code, rent_due_day, source_system, source_record_id
        )
        select
            p_owner_id, x->>'id', x->>'property_id', x->>'unit_id', 'draft',
            (x->>'start_date')::date, nullif(x->>'end_date', '')::date,
            (x->>'start_date')::date,
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

-- 4. update_lease_terms (PR #418) gains p_begin_charges_date. A signature
-- change cannot use CREATE OR REPLACE (that would leave the 7-arg overload
-- behind), so the old signature is dropped first. p_begin_charges_date =
-- null keeps the lease's current value — pre-R10 callers never clobber it.
-- Auth model unchanged from 20260927130000: SECURITY INVOKER, all auth
-- decisions in the API route, p_owner_id in every WHERE clause.
drop function if exists update_lease_terms(text, text, bigint, integer, date, date, integer);

create or replace function update_lease_terms(
  p_owner_id text,
  p_lease_id text,
  p_monthly_rent_cents bigint,
  p_due_day integer,
  p_start_date date,
  p_end_date date,
  p_early_pay_days integer,
  p_begin_charges_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lease_json jsonb;
  v_schedule_json jsonb;
begin
  -- Defense-in-depth range checks (the API route validates first, with the same bounds).
  if p_monthly_rent_cents is null or p_monthly_rent_cents <= 0 then
    raise exception 'monthly rent must be a positive whole-cent amount' using errcode = 'P0001';
  end if;
  if p_due_day is null or p_due_day < 1 or p_due_day > 28 then
    raise exception 'due day must be between 1 and 28' using errcode = 'P0001';
  end if;
  if p_start_date is null then
    raise exception 'a start date is required' using errcode = 'P0001';
  end if;
  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'the end date cannot be before the start date' using errcode = 'P0001';
  end if;
  if p_early_pay_days is null or p_early_pay_days < 0 or p_early_pay_days > 31 then
    raise exception 'early pay window must be between 0 and 31 days' using errcode = 'P0001';
  end if;

  -- Lock the schedule row first. The in-transaction check is authoritative —
  -- a missing schedule aborts before any write, so no partial state is possible.
  perform 1 from rent_schedules
   where owner_id = p_owner_id and lease_id = p_lease_id
   for update;
  if not found then
    raise exception 'rent schedule not found for lease' using errcode = 'P0001';
  end if;

  update rent_schedules
     set amount_cents = p_monthly_rent_cents,
         due_day = p_due_day,
         effective_start_date = p_start_date,
         effective_end_date = p_end_date,
         early_pay_days = p_early_pay_days,
         updated_at = now()
   where owner_id = p_owner_id and lease_id = p_lease_id;

  update rental_leases
     set monthly_rent_cents = p_monthly_rent_cents,
         rent_due_day = p_due_day,
         start_date = p_start_date,
         end_date = p_end_date,
         begin_charges_date = coalesce(p_begin_charges_date, begin_charges_date),
         updated_at = now()
   where owner_id = p_owner_id and id = p_lease_id;
  if not found then
    raise exception 'lease not found' using errcode = 'P0001';
  end if;

  -- Both updates share one transaction: either both commit or both roll back.
  select to_jsonb(l) into v_lease_json
    from (select id, status, monthly_rent_cents, rent_due_day, start_date, end_date, begin_charges_date
            from rental_leases where owner_id = p_owner_id and id = p_lease_id) l;
  select to_jsonb(s) into v_schedule_json
    from (select id, lease_id, amount_cents, due_day, effective_start_date,
                 effective_end_date, early_pay_days
            from rent_schedules where owner_id = p_owner_id and lease_id = p_lease_id) s;
  return jsonb_build_object('lease', v_lease_json, 'schedule', v_schedule_json);
end;
$$;

revoke all on function update_lease_terms(text, text, bigint, integer, date, date, integer, date) from public;
grant execute on function update_lease_terms(text, text, bigint, integer, date, date, integer, date) to authenticated;

-- 5. generate_monthly_rent_charge: no charge whose due date precedes the
-- lease's begin-charges date. Same signature, auth model (SECURITY DEFINER,
-- has_workspace_access), and credit FIFO auto-apply as 20260925120000 —
-- only the R10 gate is added.
create or replace function generate_monthly_rent_charge(
    p_owner_id text,
    p_schedule_id text,
    p_period text
)
returns rent_charges
language plpgsql
security definer
set search_path = public
as $$
declare
    authenticated_owner_id text := auth.uid()::text;
    schedule rent_schedules%rowtype;
    generated rent_charges%rowtype;
    required_period text := nullif(btrim(p_period), '');
    required_source_key text;
    required_due_date date;
    current_status text;
    inserted_id text;
    lease_begin_charges_date date;
    credit rental_tenant_credits%rowtype;
    charge_remaining bigint;
    apply_cents bigint;
    application_id text;
    new_credit_remaining bigint;
    new_credit_status text;
    new_paid bigint;
    new_charge_status text;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Rent charge owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if required_period is null or required_period !~ '^[0-9]{4}-[0-9]{2}$' then
        raise exception 'Rent charge period must use YYYY-MM format.' using errcode = '22023';
    end if;

    select * into schedule from rent_schedules
     where owner_id = p_owner_id and id = p_schedule_id for update;
    if not found then raise exception 'Rent schedule was not found.' using errcode = 'P0002'; end if;
    if schedule.status <> 'active' then return null; end if;

    required_due_date := (required_period || '-' || lpad(schedule.due_day::text, 2, '0'))::date;
    if required_due_date < schedule.effective_start_date
       or (schedule.effective_end_date is not null and required_due_date > schedule.effective_end_date)
    then return null; end if;

    -- Rentec-parity R10: no charge whose due date precedes the lease's
    -- begin-charges date ("begin charges on"). The R10 backfill sets every
    -- existing lease's begin-charges date to its start date, so this gate
    -- changes nothing for pre-existing leases; it only prevents the bogus
    -- first-month past-due when move-in and charge-start differ. A null
    -- date (defensive — the column is NOT NULL after backfill) means no
    -- gate, preserving pre-R10 behavior rather than blocking generation.
    select begin_charges_date into lease_begin_charges_date from rental_leases
     where owner_id = p_owner_id and id = schedule.lease_id;
    if lease_begin_charges_date is not null and required_due_date < lease_begin_charges_date
    then return null; end if;

    required_source_key := 'rent:' || schedule.id || ':' || required_period;
    current_status := case when required_due_date > current_date then 'scheduled' else 'due' end;

    insert into rent_charges (
        owner_id, id, lease_id, schedule_id, period, due_date, amount_cents,
        paid_amount_cents, currency_code, status, source_key, created_at, updated_at
    ) values (
        p_owner_id, 'rent_charge_' || schedule.id || '_' || replace(required_period, '-', ''),
        schedule.lease_id, schedule.id, required_period, required_due_date, schedule.amount_cents,
        0, schedule.currency_code, current_status, required_source_key, now(), now()
    )
    on conflict (owner_id, source_key) do nothing
    returning id into inserted_id;

    -- Only a freshly created charge consumes credits. A conflict-hit returns the existing
    -- charge untouched — re-running generation must never double-apply.
    if inserted_id is not null then
      select * into generated from rent_charges
        where owner_id = p_owner_id and id = inserted_id for update;
      charge_remaining := generated.amount_cents;
      for credit in
        select * from rental_tenant_credits
          where owner_id = p_owner_id and lease_id = schedule.lease_id and status = 'open'
            and remaining_cents > 0
          order by created_at asc, id asc
          for update
      loop
        exit when charge_remaining <= 0;
        apply_cents := least(credit.remaining_cents, charge_remaining);
        application_id := 'rental_credit_application_' || gen_random_uuid()::text;
        insert into rental_credit_applications (owner_id, id, credit_id, tenant_id, lease_id,
          charge_id, amount_cents, applied_at, applied_by, notes)
        values (p_owner_id, application_id, credit.id, credit.tenant_id, credit.lease_id,
          generated.id, apply_cents, now(), authenticated_owner_id,
          'Auto-applied to generated charge ' || required_period);
        new_credit_remaining := credit.remaining_cents - apply_cents;
        new_credit_status := case when new_credit_remaining = 0 then 'fully_applied' else 'open' end;
        update rental_tenant_credits set remaining_cents = new_credit_remaining,
          status = new_credit_status, updated_at = now()
          where owner_id = p_owner_id and id = credit.id;
        charge_remaining := charge_remaining - apply_cents;
      end loop;
      if charge_remaining < generated.amount_cents then
        new_paid := generated.amount_cents - charge_remaining;
        new_charge_status := case when charge_remaining = 0 then 'paid' else 'partially_paid' end;
        update rent_charges set paid_amount_cents = new_paid, status = new_charge_status, updated_at = now()
          where owner_id = p_owner_id and id = generated.id;
        select * into generated from rent_charges where owner_id = p_owner_id and id = generated.id;
      end if;
      return generated;
    end if;

    select * into generated from rent_charges
     where owner_id = p_owner_id and source_key = required_source_key and status <> 'void';
    return generated;
end;
$$;

revoke all on function generate_monthly_rent_charge(text, text, text) from public;
grant execute on function generate_monthly_rent_charge(text, text, text) to authenticated;
