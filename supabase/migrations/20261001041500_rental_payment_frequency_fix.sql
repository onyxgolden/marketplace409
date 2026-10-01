-- Rentec parity R13 follow-up: fix the two NO-GO findings on PR #518.
--
-- Finding 1: 20261001040000 rewrote generate_monthly_rent_charge() from an
-- older simplified body, dropping already-reviewed behavior: workspace/co-owner
-- authorization via has_workspace_access, the SECURITY DEFINER execution model,
-- the atomic FIFO tenant-credit auto-apply path, and the ON CONFLICT
-- row-return with the status <> 'void' selection semantics. It also predated
-- R10's begin-charges gate and the period/start parity rule. This migration
-- re-creates the function from the newest reviewed body (R10 #515:
-- begin-charges gate + canonical period/start parity) with frequency support
-- as a strictly ADDITIVE change:
--   monthly: identical behavior to the pre-R13 generator (same validation,
--     same due-date math, same eligibility, same credit handling);
--   weekly/bi-weekly: full-date (YYYY-MM-DD) periods validated against the
--     schedule cadence, per-occurrence largest-remainder amounts.
-- The timestamp sorts after R10's migrations (20261001020000,
-- 20261001030000), so in application order this is the last writer of the
-- function and the final body carries every reviewed behavior.
--
-- Finding 2: tenant change-payment-frequency updated rent_schedules first
-- and sent the owner notification afterward as a separate RPC. If the
-- notification failed, the request returned an error although the frequency
-- change had already committed. change_rental_payment_frequency() below
-- performs the schedule update AND the owner notification insert in ONE
-- transaction: either both commit or neither does, so a notification failure
-- can never misreport an already-committed schedule mutation.
--
-- NOT APPLIED -- ships with the R13 PR; Jason applies production migrations.

-- Part 1: generate_monthly_rent_charge, corrected.
--
-- Everything below the R13 block is the newest reviewed body verbatim
-- (auth model, parity eligibility, R10 begin-charges gate, idempotent
-- fresh-insert detection, FIFO credit auto-apply, void handling, grants).
-- The R13 frequency branch is additive: the monthly path is untouched.
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
    required_amount bigint;
    current_status text;
    inserted_id text;
    lease_begin_charges_date date;
    v_frequency text;
    v_anchor date;
    v_step integer;
    v_periods_per_year integer;
    v_occurrence bigint;
    v_annual bigint;
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

    select * into schedule from rent_schedules
     where owner_id = p_owner_id and id = p_schedule_id for update;
    if not found then raise exception 'Rent schedule was not found.' using errcode = 'P0002'; end if;
    if schedule.status <> 'active' then return null; end if;

    -- R13 (additive): the schedule's payment frequency decides the period
    -- shape. Monthly keeps its exact prior behavior; weekly and bi-weekly
    -- periods are full due dates validated against the cadence.
    v_frequency := coalesce(schedule.payment_frequency, 'monthly');
    v_anchor := coalesce(schedule.payment_anchor_date, schedule.effective_start_date);

    if v_frequency = 'monthly' then
        if required_period is null or required_period !~ '^[0-9]{4}-[0-9]{2}$' then
            raise exception 'Rent charge period must use YYYY-MM format.' using errcode = '22023';
        end if;
        required_due_date := (required_period || '-' || lpad(schedule.due_day::text, 2, '0'))::date;
        required_amount := schedule.amount_cents;
        -- Parity with the canonical JS generator (generateRentCharge): period
        -- eligibility is decided by the period's last possible day
        -- (YYYY-MM-28), not the period's due date. A late-month move-in keeps
        -- its move-in month eligible even when the due day precedes move-in;
        -- the begin-charges gate below then decides whether that month's
        -- charge is actually generated.
        required_period_end := (required_period || '-28')::date;
        if required_period_end < schedule.effective_start_date
           or (schedule.effective_end_date is not null and required_due_date > schedule.effective_end_date)
        then return null; end if;
    else
        if required_period is null or required_period !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
            raise exception 'Rent charge period must use YYYY-MM-DD format for weekly and bi-weekly schedules.' using errcode = '22023';
        end if;
        required_due_date := required_period::date;
        v_step := case v_frequency when 'weekly' then 7 else 14 end;
        v_periods_per_year := case v_frequency when 'weekly' then 52 else 26 end;
        v_occurrence := (required_due_date - v_anchor) / v_step;
        -- Not on the cadence (or before the anchor): not a real occurrence.
        if (required_due_date - v_anchor) % v_step <> 0 or v_occurrence < 0 then return null; end if;
        -- Sub-monthly periods are single dates: the due date itself must be
        -- on/after the schedule's effective start date (parity with the JS
        -- generator's effectiveOverlap rule for non-monthly frequencies).
        if required_due_date < schedule.effective_start_date
           or (schedule.effective_end_date is not null and required_due_date > schedule.effective_end_date)
        then return null; end if;
        -- Largest-remainder split of the annual rent into whole cents: any N
        -- consecutive periods sum to exactly the annual total -- no drift,
        -- no lost cents.
        v_annual := schedule.amount_cents * 12;
        required_amount := round(v_annual * (v_occurrence + 1)::numeric / v_periods_per_year)
                         - round(v_annual * v_occurrence::numeric / v_periods_per_year);
        if required_amount <= 0 then
            raise exception 'Rent charge amount must be positive.' using errcode = '22023';
        end if;
    end if;

    -- Rentec-parity R10: no charge whose due date precedes the lease's
    -- begin-charges date ("begin charges on"). A null date (defensive --
    -- the column is NOT NULL after the R10 backfill) means no gate,
    -- preserving pre-R10 behavior rather than blocking generation.
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
        p_owner_id, 'rent_charge_' || schedule.id || '_' || regexp_replace(required_period, '-', '', 'g'),
        schedule.lease_id, schedule.id, required_period, required_due_date, required_amount,
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

-- Part 2: tenant change-payment-frequency, atomic.
--
-- Replaces the portal route's old two-step flow (UPDATE rent_schedules via
-- the webhook client, then a separate send_rental_conversation_tenant_message
-- RPC). The schedule mutation and the owner notification insert now happen in
-- ONE transaction: either both commit or neither does, so a notification
-- failure can never leave the tenant believing the change failed while the
-- billing cadence actually changed and the owner was never notified.
--
-- Auth model mirrors send_rental_conversation_tenant_message (SECURITY
-- DEFINER, tenant derived from auth.uid() -- never trusted from the client).
create or replace function change_rental_payment_frequency(
    p_lease_id text,
    p_payment_frequency text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_tenant rental_tenants%rowtype;
    v_schedule rent_schedules%rowtype;
    v_settings rental_billing_settings%rowtype;
    v_previous_label text;
    v_new_label text;
    v_body text;
    v_conversation rental_conversations%rowtype;
    v_message rental_conversation_messages%rowtype;
begin
    if auth.uid() is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;
    select * into v_tenant from rental_tenants where auth_user_id = auth.uid();
    if v_tenant.id is null then
        raise exception 'No tenant portal access is linked to this account.' using errcode = '42501';
    end if;
    if p_lease_id is null or btrim(p_lease_id) = '' then
        raise exception 'leaseId is required.' using errcode = '22023';
    end if;
    if p_payment_frequency is null or p_payment_frequency not in ('weekly', 'biweekly', 'monthly') then
        raise exception 'paymentFrequency must be weekly, biweekly, or monthly.' using errcode = '22023';
    end if;
    -- Tenant must be on this lease. Deliberately "not found" (not
    -- "forbidden") so a cross-lease id never leaks.
    if not exists (select 1 from rental_lease_tenants
                    where owner_id = v_tenant.owner_id
                      and tenant_id = v_tenant.id
                      and lease_id = p_lease_id) then
        raise exception 'This lease was not found.' using errcode = 'P0002';
    end if;
    select * into v_settings from rental_billing_settings where owner_id = v_tenant.owner_id;
    if v_settings.tenant_may_change_payment_frequency is false then
        raise exception 'The landlord has disabled payment schedule changes in the portal.' using errcode = '42501';
    end if;
    select * into v_schedule from rent_schedules
     where owner_id = v_tenant.owner_id and lease_id = p_lease_id and status = 'active'
     for update;
    if v_schedule.id is null then
        raise exception 'No active rent schedule was found for this lease.' using errcode = 'P0002';
    end if;
    if coalesce(v_schedule.payment_frequency, 'monthly') = p_payment_frequency then
        return jsonb_build_object('success', true, 'unchanged', true,
            'schedule', row_to_json(v_schedule));
    end if;
    v_previous_label := case coalesce(v_schedule.payment_frequency, 'monthly')
        when 'weekly' then 'weekly'
        when 'biweekly' then 'every two weeks'
        else 'monthly' end;
    v_new_label := case p_payment_frequency
        when 'weekly' then 'weekly'
        when 'biweekly' then 'every two weeks'
        else 'monthly' end;
    -- Anchor resets to the change date (same rule as the owner-side edit),
    -- so the new cadence starts cleanly with no backfilled occurrences.
    update rent_schedules
       set payment_frequency = p_payment_frequency,
           payment_anchor_date = current_date,
           updated_at = now()
     where owner_id = v_tenant.owner_id and id = v_schedule.id
    returning * into v_schedule;
    -- Owner notification in the SAME transaction: an automatic tenant-sent
    -- message in the shared thread, which the owner sees as unread in the
    -- Messages panel. If this insert fails, the schedule update above rolls
    -- back with it.
    v_body := '[Automatic update] ' || coalesce(v_tenant.display_name, 'The tenant')
        || ' changed their payment schedule from ' || v_previous_label || ' to ' || v_new_label
        || '. Future charges follow the new schedule; charges already generated keep their original terms.';
    insert into rental_conversations (owner_id, id, tenant_id, last_message_at, last_message_body,
        last_message_sender_type, tenant_last_read_at)
    values (v_tenant.owner_id, 'rental_conversation_' || gen_random_uuid()::text, v_tenant.id,
        now(), btrim(v_body), 'tenant', now())
    on conflict (owner_id, tenant_id) where work_order_id is null do update set
      last_message_at = excluded.last_message_at, last_message_body = excluded.last_message_body,
      last_message_sender_type = 'tenant', tenant_last_read_at = now()
    returning * into v_conversation;
    insert into rental_conversation_messages (owner_id, id, conversation_id, sender_type, body, created_at)
    values (v_tenant.owner_id, 'rental_conversation_message_' || gen_random_uuid()::text,
        v_conversation.id, 'tenant', btrim(v_body), now())
    returning * into v_message;
    return jsonb_build_object('success', true, 'schedule', row_to_json(v_schedule),
        'notification', jsonb_build_object('conversationId', v_conversation.id,
            'messageId', v_message.id, 'createdAt', v_message.created_at));
end;
$$;

revoke all on function change_rental_payment_frequency(text, text) from public, anon;
grant execute on function change_rental_payment_frequency(text, text) to authenticated;
