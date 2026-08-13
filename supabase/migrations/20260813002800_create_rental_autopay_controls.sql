create table if not exists rental_autopay_enrollments (
  owner_id text not null,
  id text not null,
  lease_id text not null,
  tenant_id text not null,
  status text not null default 'setup_required' check (status in ('setup_required','active','paused','cancelled')),
  payment_method_type text not null check (payment_method_type in ('card','us_bank_account')),
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_payment_method_id text,
  provider_mandate_id text,
  charge_day smallint not null check (charge_day between 1 and 28),
  retry_limit smallint not null default 0 check (retry_limit between 0 and 3),
  reminder_days_before smallint not null default 3 check (reminder_days_before between 0 and 14),
  consent_text text not null,
  consented_at timestamptz not null,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, lease_id) references rental_leases(owner_id, id) on delete restrict,
  foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id) on delete restrict
);
create unique index if not exists rental_autopay_one_current_enrollment
  on rental_autopay_enrollments(owner_id, lease_id, tenant_id)
  where status in ('setup_required','active','paused');
alter table rental_autopay_enrollments enable row level security;
alter table rental_autopay_enrollments force row level security;
create policy rental_autopay_owner_all on rental_autopay_enrollments for all to authenticated
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);
create policy rental_autopay_tenant_read on rental_autopay_enrollments for select to authenticated
  using (exists(select 1 from rental_tenants t where t.owner_id=rental_autopay_enrollments.owner_id and t.id=rental_autopay_enrollments.tenant_id and t.auth_user_id=auth.uid()));

create or replace function request_rental_autopay_enrollment(p_lease_id text,p_payment_method_type text,p_charge_day smallint,p_reminder_days_before smallint,p_consent_text text)
returns rental_autopay_enrollments language plpgsql security invoker set search_path=public as $$
declare t rental_tenants; result rental_autopay_enrollments;
begin
  select tenant.* into t from rental_tenants tenant join rental_lease_tenants m on m.owner_id=tenant.owner_id and m.tenant_id=tenant.id
  where tenant.auth_user_id=auth.uid() and m.lease_id=p_lease_id limit 1;
  if t.id is null then raise exception 'Active tenant lease access is required.'; end if;
  if p_payment_method_type not in ('card','us_bank_account') then raise exception 'Unsupported autopay payment method.'; end if;
  if p_charge_day not between 1 and 28 or p_reminder_days_before not between 0 and 14 then raise exception 'Autopay timing is invalid.'; end if;
  if length(btrim(coalesce(p_consent_text,''))) < 40 then raise exception 'Explicit autopay consent is required.'; end if;
  insert into rental_autopay_enrollments(owner_id,id,lease_id,tenant_id,status,payment_method_type,charge_day,reminder_days_before,consent_text,consented_at)
  values(t.owner_id,'rental_autopay_'||gen_random_uuid()::text,p_lease_id,t.id,'setup_required',p_payment_method_type,p_charge_day,p_reminder_days_before,btrim(p_consent_text),now()) returning * into result;
  return result;
end $$;
grant execute on function request_rental_autopay_enrollment(text,text,smallint,smallint,text) to authenticated;

create or replace function cancel_rental_autopay_enrollment(p_enrollment_id text,p_reason text)
returns rental_autopay_enrollments language plpgsql security invoker set search_path=public as $$
declare result rental_autopay_enrollments;
begin
  update rental_autopay_enrollments e set status='cancelled',cancelled_at=now(),cancellation_reason=nullif(btrim(p_reason),''),updated_at=now()
  where e.id=p_enrollment_id and e.status in ('setup_required','active','paused') and exists(select 1 from rental_tenants t where t.owner_id=e.owner_id and t.id=e.tenant_id and t.auth_user_id=auth.uid()) returning * into result;
  if result.id is null then raise exception 'Current tenant autopay enrollment was not found.'; end if;
  return result;
end $$;
grant execute on function cancel_rental_autopay_enrollment(text,text) to authenticated;
