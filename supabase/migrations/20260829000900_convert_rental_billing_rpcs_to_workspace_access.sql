-- Shared FORGE workspace membership -- Checkpoint 3 (RPC half), group covering billing/payments/autopay.
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

create or replace function public.generate_monthly_rent_charge(p_owner_id text, p_schedule_id text, p_period text)
 returns rent_charges
 language plpgsql
 set search_path to 'public'
as $function$
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
$function$;


create or replace function public.void_rental_rent_charge(p_owner_id text, p_charge_id text, p_reason text)
 returns rent_charges
 language plpgsql
 set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    required_charge_id text := nullif(btrim(p_charge_id), '');
    required_reason text := nullif(btrim(p_reason), '');
    voided rent_charges%rowtype;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;

    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Rent charge owner does not match authenticated owner.' using errcode = '42501';
    end if;

    if required_charge_id is null or required_reason is null then
        raise exception 'Rent charge id and a void reason are required.' using errcode = '22023';
    end if;

    update rent_charges
       set status = 'void',
           voided_at = now(),
           notes = concat_ws(' ', nullif(btrim(notes), ''), 'Voided: ' || required_reason),
           updated_at = now()
     where owner_id = p_owner_id
       and id = required_charge_id
       and paid_amount_cents = 0
       and status <> 'void'
       -- No payment for this charge may be in an active, pending, or otherwise unreversed state.
       -- 'refunded', 'failed', and 'cancelled' payments carry no outstanding money and never block
       -- voiding; every other status (including in-flight ones that haven't yet touched
       -- paid_amount_cents) does.
       and not exists (
         select 1 from rental_payments rp
          where rp.owner_id = p_owner_id
            and rp.charge_id = required_charge_id
            and rp.status not in ('refunded', 'failed', 'cancelled')
       )
     returning * into voided;

    return voided;
end;
$function$;


create or replace function public.record_offline_rental_payment(p_owner_id text, p_charge_id text, p_payment_method text, p_amount_cents bigint, p_received_at timestamp with time zone, p_receipt_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare v_charge rent_charges%rowtype; v_payment_id text; v_new_paid bigint; v_status text;
begin
  if not has_workspace_access(p_owner_id) then raise exception 'Authenticated owner id is required.'; end if;
  if p_payment_method not in ('cash','cashiers_check') then raise exception 'Unsupported offline payment method.'; end if;
  if p_amount_cents <= 0 then raise exception 'Offline payment amount must be positive.'; end if;
  if p_received_at is null or p_received_at > now() + interval '5 minutes' then raise exception 'A valid received date is required.'; end if;
  select * into v_charge from rent_charges where owner_id = p_owner_id and id = p_charge_id for update;
  if not found or v_charge.status in ('paid','void') then raise exception 'Rent charge is not payable.'; end if;
  if p_amount_cents > v_charge.amount_cents - v_charge.paid_amount_cents then raise exception 'Payment exceeds the remaining rent balance.'; end if;
  v_payment_id := 'rental_payment_' || gen_random_uuid()::text;
  v_new_paid := v_charge.paid_amount_cents + p_amount_cents;
  v_status := case when v_new_paid = v_charge.amount_cents then 'paid' else 'partially_paid' end;
  insert into rental_payments (owner_id,id,charge_id,lease_id,tenant_id,provider,amount_cents,refunded_amount_cents,
    currency_code,status,idempotency_key,payment_method,received_at,recorded_by,receipt_reference,notes,created_at,updated_at,succeeded_at)
  select p_owner_id,v_payment_id,v_charge.id,v_charge.lease_id,lt.tenant_id,'offline',p_amount_cents,0,
    v_charge.currency_code,'succeeded','offline:' || v_payment_id,p_payment_method,p_received_at,auth.uid()::text,
    nullif(trim(p_receipt_reference),''),nullif(trim(p_notes),''),now(),now(),p_received_at
  from rental_lease_tenants lt where lt.owner_id = p_owner_id and lt.lease_id = v_charge.lease_id
  order by lt.tenant_id limit 1;
  if not found then raise exception 'Lease tenant was not found.'; end if;
  update rent_charges set paid_amount_cents = v_new_paid, status = v_status, updated_at = now()
    where owner_id = p_owner_id and id = v_charge.id;
  return jsonb_build_object('id',v_payment_id,'chargeId',v_charge.id,'amountCents',p_amount_cents,
    'paymentMethod',p_payment_method,'status','succeeded','receivedAt',p_received_at);
end;
$function$;


create or replace function public.activate_forge_billing_collection(p_owner_id text, p_schedule_id text, p_cutover_date date, p_reconciliation_summary jsonb DEFAULT '{}'::jsonb)
 returns rent_schedules
 language plpgsql
 set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    schedule rent_schedules%rowtype;
    previous_mode text;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Rent schedule owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if p_cutover_date is null then
        raise exception 'A reviewed FORGE cutover date is required.' using errcode = '22023';
    end if;

    select * into schedule from rent_schedules where owner_id = p_owner_id and id = p_schedule_id for update;
    if not found then raise exception 'Rent schedule was not found.' using errcode = 'P0002'; end if;
    if schedule.collection_mode = 'forge' and schedule.forge_cutover_date = p_cutover_date then
        -- Idempotent no-op: identical retry of an already-completed activation.
        insert into rent_schedule_collection_cutover_audit
          (owner_id, schedule_id, lease_id, from_collection_mode, to_collection_mode, cutover_date, reconciliation_summary, performed_by)
        values (p_owner_id, schedule.id, schedule.lease_id, 'forge', 'forge', p_cutover_date, coalesce(p_reconciliation_summary, '{}'::jsonb) || jsonb_build_object('noop', true), authenticated_owner_id);
        return schedule;
    end if;
    if schedule.collection_mode = 'forge' then
        raise exception 'This schedule is already FORGE-collectible under a different cutover date; correct it explicitly rather than re-activating.' using errcode = '22023';
    end if;

    previous_mode := schedule.collection_mode;
    update rent_schedules
       set collection_mode = 'forge',
           forge_cutover_date = p_cutover_date,
           forge_cutover_activated_at = now(),
           forge_cutover_activated_by = authenticated_owner_id,
           updated_at = now()
     where owner_id = p_owner_id and id = schedule.id
     returning * into schedule;

    insert into rent_schedule_collection_cutover_audit
      (owner_id, schedule_id, lease_id, from_collection_mode, to_collection_mode, cutover_date, reconciliation_summary, performed_by)
    values (p_owner_id, schedule.id, schedule.lease_id, previous_mode, 'forge', p_cutover_date, coalesce(p_reconciliation_summary, '{}'::jsonb), authenticated_owner_id);

    return schedule;
end;
$function$;


create or replace function public.set_rental_billing_enabled(p_owner_id text, p_enabled boolean)
 returns rental_billing_settings
 language plpgsql
 set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    previous_enabled boolean;
    result rental_billing_settings;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Rental billing settings owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if p_enabled is null then
        raise exception 'An explicit billing_enabled value is required.' using errcode = '22023';
    end if;

    select coalesce(billing_enabled, false) into previous_enabled
      from rental_billing_settings where owner_id = p_owner_id;
    previous_enabled := coalesce(previous_enabled, false);

    insert into rental_billing_settings (owner_id, billing_enabled, updated_at, updated_by)
    values (p_owner_id, p_enabled, now(), authenticated_owner_id)
    on conflict (owner_id) do update
      set billing_enabled = excluded.billing_enabled, updated_at = now(), updated_by = excluded.updated_by
    returning * into result;

    insert into rental_billing_settings_audit (owner_id, from_enabled, to_enabled, performed_by)
    values (p_owner_id, previous_enabled, p_enabled, authenticated_owner_id);

    return result;
end;
$function$;


create or replace function public.commit_rentec_rental_import(p_owner_id text, p_units jsonb DEFAULT '[]'::jsonb, p_tenants jsonb DEFAULT '[]'::jsonb, p_leases jsonb DEFAULT '[]'::jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    v_units_created integer := 0;
    v_tenants_created integer := 0;
    v_leases_created integer := 0;
    v_lease_tenants_created integer := 0;
begin
    if p_owner_id is null or btrim(p_owner_id) = '' then
        raise exception 'An owner id is required.';
    end if;
    if not has_workspace_access(p_owner_id) then
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
            monthly_rent_cents, currency_code, rent_due_day, source_system, source_record_id
        )
        select
            p_owner_id, x->>'id', x->>'property_id', x->>'unit_id', 'draft',
            (x->>'start_date')::date, nullif(x->>'end_date', '')::date,
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
$function$;


create or replace function public.approve_rentec_payment_import(p_owner_id text, p_lease_id text, p_charge_id text, p_rentec_transaction_id text, p_amount_cents bigint, p_transaction_date date, p_category_name text, p_rentec_renter_id text, p_rentec_property_id text, p_import_batch_id text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    v_charge rent_charges%rowtype;
    v_schedule rent_schedules%rowtype;
    v_tenant_id text;
    v_payment_id text;
    v_new_paid bigint;
    v_new_status text;
    v_existing rentec_transaction_imports%rowtype;
    v_import_id text;
    v_reason text;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Rentec payment import owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if p_rentec_transaction_id is null or btrim(p_rentec_transaction_id) = '' then
        raise exception 'A stable Rentec transaction id is required.' using errcode = '22023';
    end if;
    if p_amount_cents is null or p_amount_cents <= 0 then
        raise exception 'A positive transaction amount is required.' using errcode = '22023';
    end if;
    if p_import_batch_id is null or btrim(p_import_batch_id) = '' then
        raise exception 'An import batch id is required.' using errcode = '22023';
    end if;
    if p_lease_id is null or btrim(p_lease_id) = '' or p_charge_id is null or btrim(p_charge_id) = '' then
        raise exception 'A matched lease and charge are required.' using errcode = '22023';
    end if;

    -- Idempotent: a transaction already applied is a no-op, not an error — a retried approval
    -- (double-clicked button, resumed batch) can never double-pay the same charge.
    select * into v_existing from rentec_transaction_imports
      where owner_id = p_owner_id and rentec_transaction_id = p_rentec_transaction_id and status = 'applied'
      limit 1;
    if found then
        return jsonb_build_object('status', 'already_applied', 'importId', v_existing.id,
          'paymentId', v_existing.payment_id, 'chargeId', v_existing.charge_id);
    end if;

    v_import_id := 'rentec_txn_import_' || gen_random_uuid()::text;

    select * into v_charge from rent_charges
      where owner_id = p_owner_id and id = p_charge_id and lease_id = p_lease_id for update;
    if not found or v_charge.status = 'void' then
        v_reason := 'The matched rent charge no longer exists, belongs to a different lease, or has been voided.';
    else
        select s.* into v_schedule from rent_schedules s
          where s.owner_id = p_owner_id and s.lease_id = p_lease_id
          order by s.effective_start_date desc limit 1;
        if not found or v_schedule.collection_mode <> 'external' then
            v_reason := 'This lease is no longer externally managed; Rentec import no longer applies.';
        elsif p_amount_cents > v_charge.amount_cents - v_charge.paid_amount_cents then
            v_reason := 'Transaction amount exceeds the charge''s current remaining balance.';
        end if;
    end if;

    if v_reason is not null then
        insert into rentec_transaction_imports (id, owner_id, rentec_transaction_id, lease_id, charge_id,
          amount_cents, transaction_date, category_name, rentec_renter_id, rentec_property_id,
          import_batch_id, status, rejection_reason, approved_by)
        values (v_import_id, p_owner_id, p_rentec_transaction_id, p_lease_id, p_charge_id,
          p_amount_cents, p_transaction_date, p_category_name, p_rentec_renter_id, p_rentec_property_id,
          p_import_batch_id, 'rejected', v_reason, authenticated_owner_id);
        return jsonb_build_object('status', 'rejected', 'importId', v_import_id, 'reason', v_reason);
    end if;

    select lt.tenant_id into v_tenant_id from rental_lease_tenants lt
      where lt.owner_id = p_owner_id and lt.lease_id = p_lease_id order by lt.tenant_id limit 1;
    if v_tenant_id is null then
        raise exception 'Lease tenant was not found.' using errcode = 'P0002';
    end if;

    v_payment_id := 'rental_payment_' || gen_random_uuid()::text;
    v_new_paid := v_charge.paid_amount_cents + p_amount_cents;
    v_new_status := case when v_new_paid = v_charge.amount_cents then 'paid' else 'partially_paid' end;

    -- Nested block: the initial already_applied check (above) is not atomic with this write, so a
    -- truly concurrent second approval of the very same Rentec transaction can still reach this
    -- point after the first has committed. The unique partial index is the real guarantee against
    -- double-paying — but without this nested EXCEPTION handler, hitting it here would raise an
    -- unhandled error after the payment/charge writes below already ran, aborting the ENTIRE
    -- function call (a full rollback of this call's own writes, so the balance is never actually
    -- double-counted) but surfacing an ugly constraint-violation message instead of the graceful
    -- idempotent response every OTHER retry path returns. Catching it here converts that race into
    -- the same clean 'already_applied' result, backed by the winning call's own row.
    begin
        -- provider='rentec_external' is distinct from both 'stripe' and 'offline' so an imported
        -- Rentec payment is never conflated with a live Stripe charge or a manually recorded
        -- cash/check payment. No Stripe fields (provider_customer_id, a Stripe-shaped
        -- provider_payment_id, provider_mode) are ever populated here.
        insert into rental_payments (owner_id, id, charge_id, lease_id, tenant_id, provider, provider_payment_id,
          amount_cents, refunded_amount_cents, currency_code, status, idempotency_key, received_at, recorded_by,
          notes, created_at, updated_at, succeeded_at)
        values (p_owner_id, v_payment_id, v_charge.id, p_lease_id, v_tenant_id, 'rentec_external', p_rentec_transaction_id,
          p_amount_cents, 0, v_charge.currency_code, 'succeeded', 'rentec:' || p_rentec_transaction_id,
          coalesce(p_transaction_date::timestamptz, now()), authenticated_owner_id,
          nullif(btrim(coalesce(p_category_name, '')), ''), now(), now(), coalesce(p_transaction_date::timestamptz, now()));

        update rent_charges set paid_amount_cents = v_new_paid, status = v_new_status, updated_at = now()
          where owner_id = p_owner_id and id = v_charge.id;

        insert into rentec_transaction_imports (id, owner_id, rentec_transaction_id, lease_id, charge_id, payment_id,
          amount_cents, transaction_date, category_name, rentec_renter_id, rentec_property_id,
          import_batch_id, status, approved_by)
        values (v_import_id, p_owner_id, p_rentec_transaction_id, p_lease_id, v_charge.id, v_payment_id,
          p_amount_cents, p_transaction_date, p_category_name, p_rentec_renter_id, p_rentec_property_id,
          p_import_batch_id, 'applied', authenticated_owner_id);
    exception
        when unique_violation then
            select * into v_existing from rentec_transaction_imports
              where owner_id = p_owner_id and rentec_transaction_id = p_rentec_transaction_id and status = 'applied'
              limit 1;
            return jsonb_build_object('status', 'already_applied', 'importId', v_existing.id,
              'paymentId', v_existing.payment_id, 'chargeId', v_existing.charge_id);
    end;

    return jsonb_build_object('status', 'applied', 'importId', v_import_id, 'paymentId', v_payment_id,
      'chargeId', v_charge.id, 'newChargeStatus', v_new_status);
end;
$function$;


create or replace function public.queue_rental_balance_reminder(p_owner_id text, p_charge_id text, p_scheduled_for timestamp with time zone, p_notification_type text, p_max_attempts smallint)
 returns rental_notification_outbox
 language plpgsql
 set search_path to 'public'
as $function$
declare c rent_charges;t rental_tenants;result rental_notification_outbox;v_key text;
begin
 if not has_workspace_access(p_owner_id) then raise exception 'Owner identity mismatch.';end if;
 if p_notification_type not in('rent_reminder','balance_overdue') or p_max_attempts not between 1 and 5 then raise exception 'Reminder controls are invalid.';end if;
 select * into c from rent_charges where owner_id=p_owner_id and id=p_charge_id and status in('scheduled','due','partially_paid','overdue');
 if c.id is null then raise exception 'Open charge was not found.';end if;
 select tenant.* into t from rental_lease_tenants m join rental_tenants tenant on tenant.owner_id=m.owner_id and tenant.id=m.tenant_id where m.owner_id=p_owner_id and m.lease_id=c.lease_id order by tenant.created_at limit 1;
 if t.id is null then raise exception 'Tenant recipient was not found.';end if;
 v_key:='charge:'||c.id||':'||p_notification_type||':'||extract(epoch from date_trunc('minute',p_scheduled_for))::text;
 insert into rental_notification_outbox(owner_id,id,tenant_id,lease_id,event_key,notification_type,recipient,subject,body_text,scheduled_for,max_attempts)
 values(p_owner_id,'rental_notification_'||gen_random_uuid()::text,t.id,c.lease_id,v_key,p_notification_type,t.email,case when p_notification_type='balance_overdue' then 'FORGE rental balance is overdue' else 'FORGE upcoming rent reminder' end,'Your current rental balance is $'||to_char((c.amount_cents-c.paid_amount_cents)/100.0,'FM999999990.00')||' and is due '||c.due_date||'. Review your tenant portal for payment details.',p_scheduled_for,p_max_attempts) returning * into result;
 return result;
end $function$;
