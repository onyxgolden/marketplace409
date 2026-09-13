-- Tenant autopay enrollment/cancellation are authenticated RPCs, but their previous SECURITY
-- INVOKER definitions attempted to write landlord-owned rows through an owner-only RLS policy.
-- A tenant could pass the RPC's identity checks and still always receive an RLS denial.
--
-- Keep direct table RLS unchanged and closed to tenant writes.  These narrowly-scoped functions
-- perform the write as their owner only after deriving every owner/tenant/lease identifier from
-- auth.uid() and authoritative active-lease rows.  Callers cannot supply an owner or tenant id.

create or replace function request_rental_autopay_enrollment(
  p_lease_id text,
  p_payment_method_type text,
  p_charge_day smallint,
  p_reminder_days_before smallint,
  p_consent_text text,
  p_provider_mode text
)
returns rental_autopay_enrollments
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  authenticated_user_id uuid := auth.uid();
  tenant_record rental_tenants%rowtype;
  schedule_record rent_schedules%rowtype;
  result rental_autopay_enrollments%rowtype;
begin
  if authenticated_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_provider_mode is null or p_provider_mode not in ('test', 'live') then
    raise exception 'A valid provider mode is required.' using errcode = '22023';
  end if;

  select tenant.* into tenant_record
    from rental_tenants tenant
    join rental_lease_tenants membership
      on membership.owner_id = tenant.owner_id
     and membership.tenant_id = tenant.id
    join rental_leases lease
      on lease.owner_id = membership.owner_id
     and lease.id = membership.lease_id
   where tenant.auth_user_id = authenticated_user_id
     and tenant.status = 'active'
     and membership.lease_id = p_lease_id
     and lease.status = 'active'
   limit 1;

  if tenant_record.id is null then
    raise exception 'Active tenant lease access is required.' using errcode = '42501';
  end if;

  select * into schedule_record
    from rent_schedules
   where owner_id = tenant_record.owner_id
     and lease_id = p_lease_id
     and status = 'active'
   order by effective_start_date desc
   limit 1;

  if schedule_record.id is null
     or schedule_record.collection_mode <> 'forge'
     or schedule_record.forge_cutover_date is null
     or schedule_record.forge_cutover_date > current_date then
    raise exception 'This lease is not currently collected through FORGE.';
  end if;

  if not coalesce((
    select billing_enabled
      from rental_billing_settings
     where owner_id = tenant_record.owner_id
  ), false) then
    raise exception 'Rental online billing is currently paused for this owner.';
  end if;

  if p_payment_method_type not in ('card', 'us_bank_account') then
    raise exception 'Unsupported autopay payment method.';
  end if;
  if p_charge_day not between 1 and 28
     or p_reminder_days_before not between 0 and 14 then
    raise exception 'Autopay timing is invalid.';
  end if;
  if length(btrim(coalesce(p_consent_text, ''))) < 40 then
    raise exception 'Explicit autopay consent is required.';
  end if;

  insert into rental_autopay_enrollments (
    owner_id, id, lease_id, tenant_id, status, payment_method_type, charge_day,
    reminder_days_before, consent_text, consented_at, provider_mode
  ) values (
    tenant_record.owner_id,
    'rental_autopay_' || gen_random_uuid()::text,
    p_lease_id,
    tenant_record.id,
    'setup_required',
    p_payment_method_type,
    p_charge_day,
    p_reminder_days_before,
    btrim(p_consent_text),
    now(),
    p_provider_mode
  ) returning * into result;

  return result;
end;
$$;

create or replace function cancel_rental_autopay_enrollment(
  p_enrollment_id text,
  p_reason text
)
returns rental_autopay_enrollments
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  authenticated_user_id uuid := auth.uid();
  result rental_autopay_enrollments%rowtype;
begin
  if authenticated_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  update rental_autopay_enrollments enrollment
     set status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = nullif(btrim(p_reason), ''),
         updated_at = now()
   where enrollment.id = p_enrollment_id
     and enrollment.status in ('setup_required', 'active', 'paused')
     and exists (
       select 1
         from rental_tenants tenant
        where tenant.owner_id = enrollment.owner_id
          and tenant.id = enrollment.tenant_id
          and tenant.auth_user_id = authenticated_user_id
     )
  returning * into result;

  if result.id is null then
    raise exception 'Current tenant autopay enrollment was not found.' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

-- Retire the pre-provider-mode entry point. Keeping the object (with no caller grants) avoids a
-- destructive DROP while ensuring PostgREST cannot use the stale implementation.
revoke all on function request_rental_autopay_enrollment(text, text, smallint, smallint, text)
  from public, anon, authenticated;
revoke all on function request_rental_autopay_enrollment(text, text, smallint, smallint, text, text)
  from public, anon;
grant execute on function request_rental_autopay_enrollment(text, text, smallint, smallint, text, text)
  to authenticated;

revoke all on function cancel_rental_autopay_enrollment(text, text)
  from public, anon;
grant execute on function cancel_rental_autopay_enrollment(text, text)
  to authenticated;
