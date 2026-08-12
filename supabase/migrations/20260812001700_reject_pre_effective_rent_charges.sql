update rent_charges charge
set status = 'void', voided_at = now(), updated_at = now(),
    notes = concat_ws(' ', nullif(btrim(charge.notes), ''), 'Voided automatically: due date preceded the rent schedule effective date.')
from rent_schedules schedule
where charge.owner_id = schedule.owner_id
  and charge.schedule_id = schedule.id
  and charge.due_date < schedule.effective_start_date
  and charge.paid_amount_cents = 0
  and charge.status not in ('paid', 'void');

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
    current_status text;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> authenticated_owner_id then
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
    on conflict (owner_id, source_key) do nothing;

    select * into generated from rent_charges
     where owner_id = p_owner_id and source_key = required_source_key and status <> 'void';
    return generated;
end;
$$;

revoke all on function generate_monthly_rent_charge(text, text, text) from public;
grant execute on function generate_monthly_rent_charge(text, text, text) to authenticated;
