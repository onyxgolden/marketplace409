-- Rentec parity R10 follow-up: period/start eligibility parity between the
-- two charge-generation paths.
--
-- ChatGPT review finding on PR #515: recreating generate_monthly_rent_charge()
-- in 20261001020000 changed the lease-start boundary semantics without saying
-- so. The canonical JS generator (src/domains/rent-charge/rent-charge-generator.ts)
-- skips a period only when periodEnd = YYYY-MM-28 precedes the schedule's
-- effective start date, which keeps the move-in month eligible even when the
-- due day falls before a late-month move-in (moved in Aug 28, due on the 1st:
-- the August period is eligible, and the R10 begin-charges gate then decides
-- whether the August charge is actually generated). The recreated RPC instead
-- returned null whenever the period's DUE DATE preceded the start date, so the
-- two paths disagreed about whether the move-in month's charge was eligible
-- at all — e.g. begin_charges_date = Aug 1 with move-in Aug 28 and due day 1:
-- JS generates the August charge, the old RPC returned null.
--
-- This migration restores the canonical rule in the RPC. Nothing else about
-- the function changes: the R10 begin-charges gate stays AFTER the common
-- period eligibility check, and the reviewed R10 guarantees still hold
-- (backfill suppresses only, null date fails open, no void sweep).
--
-- NOT APPLIED — ships with the R10 PR; Jason applies production migrations.

-- generate_monthly_rent_charge, recreated with the canonical period/start
-- eligibility: a period is eligible when its last possible day (YYYY-MM-28)
-- is not before the schedule's effective start date — matching the JS
-- generateRentCharge rule exactly. Same signature, auth model (SECURITY
-- DEFINER, has_workspace_access), end-date check, begin-charges gate, and
-- credit FIFO auto-apply as 20261001020000 — only the start-date comparison
-- changes (period-end instead of due-date).
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
    required_period_end date;
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
    -- Parity with the canonical JS generator (generateRentCharge): period
    -- eligibility is decided by the period's last possible day
    -- (YYYY-MM-28), not the period's due date. A late-month move-in keeps
    -- its move-in month eligible even when the due day precedes move-in;
    -- the begin-charges gate below then decides whether that month's charge
    -- is actually generated. Comparing the due date to the start date here
    -- (the pre-fix behavior) silently dropped the move-in month's charge
    -- and diverged from the JS cron path.
    required_period_end := (required_period || '-28')::date;
    if required_period_end < schedule.effective_start_date
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
