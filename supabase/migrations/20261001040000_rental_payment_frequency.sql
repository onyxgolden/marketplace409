-- Rentec parity R13: payment frequency (weekly / bi-weekly / monthly).
--
-- The natural home is rent_schedules: it already owns the billing cadence
-- (amount_cents, due_day, early_pay_days). A schedule's payment_frequency says
-- how the headline monthly rent is split into charges:
--   monthly  -> one charge per calendar month for amount_cents (unchanged behavior)
--   biweekly -> a charge every 14 days, each 1/26 of the annual rent
--   weekly   -> a charge every 7 days, each 1/52 of the annual rent
--
-- Per-period amounts use the largest-remainder split of the annual rent
-- (monthly rent x 12) into whole cents, so any 26 bi-weekly or 52 weekly
-- periods sum to exactly the annual total -- no drift, no lost cents.
--
-- payment_anchor_date is the first due date of the cadence; occurrences step
-- 7/14 days from it. It defaults to the schedule's effective start date and is
-- reset to the change date whenever the frequency itself changes, so a
-- mid-lease switch never backfills weeks of "missed" charges under the old
-- cadence. A tenant changing frequency in the portal gets the same reset.
--
-- Also broadens the rent_charges period label: monthly charges keep YYYY-MM;
-- sub-monthly charges use their full due date (YYYY-MM-DD) so every occurrence
-- keeps a unique (owner_id, source_key) and the charge cron stays idempotent.
--
-- NOT APPLIED -- authored for the owner's explicit approval before touching production.

-- 1) Frequency + anchor on rent_schedules. IF NOT EXISTS everywhere so this is
-- safe to re-run and merge-order tolerant.
alter table rent_schedules
  add column if not exists payment_frequency text not null default 'monthly';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rent_schedules_payment_frequency_check') then
    alter table rent_schedules add constraint rent_schedules_payment_frequency_check
      check (payment_frequency in ('weekly', 'biweekly', 'monthly'));
  end if;
end
$$;

alter table rent_schedules
  add column if not exists payment_anchor_date date;

update rent_schedules
   set payment_anchor_date = effective_start_date
 where payment_anchor_date is null;

-- 2) Owner gate for portal self-scheduling: when false, tenants see their
-- frequency but cannot change it themselves.
alter table rental_billing_settings
  add column if not exists tenant_may_change_payment_frequency boolean not null default true;

-- 3) Broaden the charge period label: YYYY-MM for monthly, YYYY-MM-DD for
-- weekly/bi-weekly occurrences. Existing rows are all YYYY-MM and keep
-- satisfying the new pattern.
alter table rent_charges drop constraint if exists rent_charges_period_check;
alter table rent_charges add constraint rent_charges_period_check
  check (period ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$');

-- 4) Manual charge generation (the "generate-charge" API operation) learns the
-- same cadence math. Monthly keeps its exact prior behavior; sub-monthly
-- periods arrive as the full due date and must land on the cadence (otherwise
-- the period is not a real occurrence and nothing is generated).
create or replace function generate_monthly_rent_charge(
    p_owner_id text,
    p_schedule_id text,
    p_period text
)
returns rent_charges
language plpgsql
security invoker
set search_path = public
as $$
declare
    authenticated_owner_id text := auth.uid()::text;
    schedule rent_schedules%rowtype;
    generated rent_charges%rowtype;
    required_period text := nullif(btrim(p_period), '');
    required_source_key text;
    required_due_date date;
    required_amount bigint;
    current_status text;
    v_frequency text;
    v_anchor date;
    v_step integer;
    v_periods_per_year integer;
    v_occurrence bigint;
    v_annual bigint;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> authenticated_owner_id then
        raise exception 'Rent charge owner does not match authenticated owner.' using errcode = '42501';
    end if;

    select * into schedule from rent_schedules
     where owner_id = p_owner_id and id = p_schedule_id for update;
    if not found then raise exception 'Rent schedule was not found.' using errcode = 'P0002'; end if;
    if schedule.status <> 'active' then return null; end if;

    v_frequency := coalesce(schedule.payment_frequency, 'monthly');
    v_anchor := coalesce(schedule.payment_anchor_date, schedule.effective_start_date);

    if v_frequency = 'monthly' then
        if required_period is null or required_period !~ '^\d{4}-\d{2}$' then
            raise exception 'Rent charge period must use YYYY-MM format.' using errcode = '22023';
        end if;
        required_due_date := (required_period || '-' || lpad(schedule.due_day::text, 2, '0'))::date;
        required_amount := schedule.amount_cents;
    else
        if required_period is null or required_period !~ '^\d{4}-\d{2}-\d{2}$' then
            raise exception 'Rent charge period must use YYYY-MM-DD format for weekly and bi-weekly schedules.' using errcode = '22023';
        end if;
        required_due_date := required_period::date;
        v_step := case v_frequency when 'weekly' then 7 else 14 end;
        v_periods_per_year := case v_frequency when 'weekly' then 52 else 26 end;
        v_occurrence := (required_due_date - v_anchor) / v_step;
        -- Not on the cadence (or before the anchor): not a real occurrence.
        if (required_due_date - v_anchor) % v_step <> 0 or v_occurrence < 0 then return null; end if;
        -- Largest-remainder split of the annual rent into whole cents: any
        -- N consecutive periods sum to exactly the annual total.
        v_annual := schedule.amount_cents * 12;
        required_amount := round(v_annual * (v_occurrence + 1)::numeric / v_periods_per_year)
                         - round(v_annual * v_occurrence::numeric / v_periods_per_year);
        if required_amount <= 0 then
            raise exception 'Rent charge amount must be positive.' using errcode = '22023';
        end if;
    end if;

    if (date_trunc('month', required_due_date) + interval '1 month - 1 day')::date < schedule.effective_start_date
       or (schedule.effective_end_date is not null and required_due_date > schedule.effective_end_date)
    then return null; end if;

    required_source_key := 'rent:' || schedule.id || ':' || required_period;
    current_status := case when required_due_date > current_date then 'scheduled' else 'due' end;

    insert into rent_charges (
        owner_id, id, lease_id, schedule_id, period, due_date, amount_cents,
        paid_amount_cents, currency_code, status, source_key, created_at, updated_at
    ) values (
        p_owner_id, 'rent_charge_' || schedule.id || '_' || regexp_replace(required_period, '-', '', 'g'),
        schedule.lease_id, schedule.id, required_period, required_due_date, required_amount,
        0, schedule.currency_code, current_status, required_source_key, now(), now()
    )
    on conflict (owner_id, source_key) do nothing;

    select * into generated from rent_charges
     where owner_id = p_owner_id and source_key = required_source_key;
    return generated;
end;
$$;

revoke all on function generate_monthly_rent_charge(text, text, text) from public;
grant execute on function generate_monthly_rent_charge(text, text, text) to authenticated;
