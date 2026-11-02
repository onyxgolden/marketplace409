-- Pet-fee schedule field (Barnhill lesson: the $50/mo pet fee folded invisibly
-- into the monthly total, was lost at entry, and surfaced only later).
--
-- Model decision (kept deliberately narrow): amount_cents stays the TOTAL monthly
-- obligation — backward compatible, and the generator needs no amount change
-- (a prorated total already includes the fee). pet_fee_cents is the portion of
-- that total attributable to pets, used for display breakdown only
-- ("Rent $X + Pet fee $Y = $Z/mo", rent derived as total - fee). There is NO
-- separate monthly pet-fee charge and NO pet-fee column on rental_leases: the
-- fee lives only on the schedule, and the lease row keeps carrying the total.
--
-- NOT APPLIED — authored for the owner's explicit approval before touching
-- production. The code in this PR reads pet_fee_cents defensively (missing
-- column / null reads as 0), so the app keeps working until this lands.

alter table rent_schedules
  add column if not exists pet_fee_cents bigint not null default 0
    check (pet_fee_cents >= 0);

-- A pet fee larger than the total it is part of is a data error, not a
-- display edge case — refuse it at the database, not just in the form.
-- (PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, so the guard is a DO block.)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rent_schedules_pet_fee_le_amount_check') then
    alter table rent_schedules
      add constraint rent_schedules_pet_fee_le_amount_check check (pet_fee_cents <= amount_cents);
  end if;
end $$;

-- update_lease_terms gains p_pet_fee_cents. Same drop-first pattern as the
-- begin-charges change (PR #418): a signature change cannot use CREATE OR
-- REPLACE without leaving the old overload behind. The new parameter defaults
-- to NULL meaning "keep the current value" (the begin-charges pattern), so
-- pre-existing 8-arg callers keep resolving and never clobber a fee, while
-- the terms action passes the edited value. Auth model unchanged: SECURITY
-- INVOKER, all auth decisions in the API route, p_owner_id in every WHERE
-- clause. The fee follows the same future-charges-only rule as rent:
-- already-generated charges keep their original terms and are never rewritten
-- by this operation.
drop function if exists update_lease_terms(text, text, bigint, integer, date, date, integer, date);

create or replace function update_lease_terms(
  p_owner_id text,
  p_lease_id text,
  p_monthly_rent_cents bigint,
  p_due_day integer,
  p_start_date date,
  p_end_date date,
  p_early_pay_days integer,
  p_begin_charges_date date,
  p_pet_fee_cents bigint default null
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
  if p_pet_fee_cents is not null and p_pet_fee_cents < 0 then
    raise exception 'pet fee must be a nonnegative whole-cent amount' using errcode = 'P0001';
  end if;
  if p_pet_fee_cents is not null and p_pet_fee_cents > p_monthly_rent_cents then
    raise exception 'pet fee cannot exceed the monthly total' using errcode = 'P0001';
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
         pet_fee_cents = coalesce(p_pet_fee_cents, pet_fee_cents),
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
    from (select id, lease_id, amount_cents, pet_fee_cents, due_day, effective_start_date,
                 effective_end_date, early_pay_days
            from rent_schedules where owner_id = p_owner_id and lease_id = p_lease_id) s;
  return jsonb_build_object('lease', v_lease_json, 'schedule', v_schedule_json);
end;
$$;

revoke all on function update_lease_terms(text, text, bigint, integer, date, date, integer, date, bigint) from public;
grant execute on function update_lease_terms(text, text, bigint, integer, date, date, integer, date, bigint) to authenticated;
