-- Atomic lease-term update (review fix: the lease and rent-schedule writes must not
-- be separable).
--
-- The update-lease-terms API operation used to write rent_schedules and
-- rental_leases as two sequential requests. If the second write failed, reports
-- (which read the lease row) and charge generation (which reads the schedule
-- row) could disagree. This function performs both updates inside a single
-- transaction: any failure rolls back both rows, so they can never drift.
--
-- Auth model: SECURITY INVOKER (like create_expense_with_tenant_charge) — the
-- caller's row-level-security policies still apply. The API route keeps every
-- auth decision (owner-scoped lease lookup, read-only member gate,
-- cancelled-lease rejection) BEFORE calling; the function only performs the
-- atomic write. p_owner_id is applied in every WHERE clause as defense in
-- depth so a caller can never cross into another owner's rows.
--
-- The schedule-existence check lives INSIDE this transaction (locked SELECT):
-- the route does no separate pre-check, so no race can slip a delete between
-- the check and the write. A missing schedule raises a distinct exception the
-- route maps to the same 409 it returned before.
--
-- NOT APPLIED — authored for the owner's explicit approval before touching production.

create or replace function update_lease_terms(
  p_owner_id text,
  p_lease_id text,
  p_monthly_rent_cents bigint,
  p_due_day integer,
  p_start_date date,
  p_end_date date,
  p_early_pay_days integer
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
         updated_at = now()
   where owner_id = p_owner_id and id = p_lease_id;
  if not found then
    raise exception 'lease not found' using errcode = 'P0001';
  end if;

  -- Both updates share one transaction: either both commit or both roll back.
  select to_jsonb(l) into v_lease_json
    from (select id, status, monthly_rent_cents, rent_due_day, start_date, end_date
            from rental_leases where owner_id = p_owner_id and id = p_lease_id) l;
  select to_jsonb(s) into v_schedule_json
    from (select id, lease_id, amount_cents, due_day, effective_start_date,
                 effective_end_date, early_pay_days
            from rent_schedules where owner_id = p_owner_id and lease_id = p_lease_id) s;
  return jsonb_build_object('lease', v_lease_json, 'schedule', v_schedule_json);
end;
$$;

revoke all on function update_lease_terms(text, text, bigint, integer, date, date, integer) from public;
grant execute on function update_lease_terms(text, text, bigint, integer, date, date, integer) to authenticated;
