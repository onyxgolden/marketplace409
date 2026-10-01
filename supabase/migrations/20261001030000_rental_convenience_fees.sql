-- Rentec parity R12: card convenience fees (pass-through to the tenant,
-- booked as reimbursement, never income).
--
-- 1. Workspace-level card convenience fee on rental_billing_settings (the
--    existing owner-level settings pattern): card_convenience_fee_bps, integer
--    basis points (295 = 2.95%), NOT NULL DEFAULT 0 = OFF. A workspace that
--    never configures a fee charges no fee, ever -- enabling billing must
--    never newly charge a tenant.
-- 2. rental_payments carries the fee evidence: convenience_fee_cents (part of
--    amount_cents), convenience_fee_bps (rate applied), fee_agreed_at (the
--    tenant's explicit agreement timestamp), fee_card_brand (set at settlement).
-- 3. rental_autopay_enrollments carries the card-autopay fee consent snapshot:
--    fee_consent_bps + fee_consented_at. Card autopay charges the fee only at
--    the consented rate; ACH autopay never carries a fee.
-- 4. Audit trail for fee changes, mirroring rental_payment_policy_audit.
-- 5. The financial_events trigger splits a succeeded payment: rent portion as
--    income/rental_income, fee portion as a SEPARATE row with
--    transaction_kind='reimbursement' and normalized_category=
--    'convenience_fee_reimbursement', affects_noi=false. Income/NOI builders
--    only count transaction_kind in ('income','expense'), so the reimbursement
--    row can never inflate rent revenue, NOI, or owner statements.
-- 6. request_rental_autopay_enrollment gains an optional p_fee_consent_bps
--    param (card enrollments only; ignored for bank enrollments).
--
-- Per-brand rates (AmEx 3.5%) are deliberately NOT implemented: Stripe's
-- Payment Element does not expose the card brand pre-confirm (its change
-- event carries only value.type), and the brand is PCI-scoped until the
-- charge exists (charge.payment_method_details.card.brand). The fee must be
-- fixed before the tenant confirms, so one configured rate applies to every
-- card brand; the workspace sets it to cover its mix.
--
-- NOT APPLIED -- ships with the R12 PR; Jason applies production migrations.

-- 1. Workspace fee setting (default OFF).
alter table rental_billing_settings
  add column if not exists card_convenience_fee_bps integer not null default 0;
alter table rental_billing_settings
  drop constraint if exists rental_billing_settings_card_fee_bps_check;
alter table rental_billing_settings
  add constraint rental_billing_settings_card_fee_bps_check check (
    card_convenience_fee_bps >= 0 and card_convenience_fee_bps <= 10000
  );

-- 2. Fee evidence on the payment row.
alter table rental_payments
  add column if not exists convenience_fee_cents integer not null default 0;
alter table rental_payments
  add column if not exists convenience_fee_bps integer;
alter table rental_payments
  add column if not exists fee_agreed_at timestamptz;
alter table rental_payments
  add column if not exists fee_card_brand text;
alter table rental_payments
  drop constraint if exists rental_payments_convenience_fee_cents_check;
alter table rental_payments
  add constraint rental_payments_convenience_fee_cents_check check (
    convenience_fee_cents >= 0 and convenience_fee_cents <= amount_cents
  );
alter table rental_payments
  drop constraint if exists rental_payments_convenience_fee_bps_check;
alter table rental_payments
  add constraint rental_payments_convenience_fee_bps_check check (
    convenience_fee_bps is null
    or (convenience_fee_bps >= 0 and convenience_fee_bps <= 10000)
  );

-- 3. Card-autopay fee consent snapshot on the enrollment.
alter table rental_autopay_enrollments
  add column if not exists fee_consent_bps integer;
alter table rental_autopay_enrollments
  add column if not exists fee_consented_at timestamptz;
alter table rental_autopay_enrollments
  drop constraint if exists rental_autopay_enrollments_fee_consent_bps_check;
alter table rental_autopay_enrollments
  add constraint rental_autopay_enrollments_fee_consent_bps_check check (
    fee_consent_bps is null
    or (fee_consent_bps >= 0 and fee_consent_bps <= 10000)
  );

-- 4. Audit: every workspace fee change is recorded (who, when, what).
create table if not exists rental_convenience_fee_audit (
    id text primary key default ('rental_convenience_fee_audit_' || gen_random_uuid()::text),
    owner_id text not null,
    change jsonb not null,
    performed_by text not null,
    performed_at timestamptz not null default now()
);
create index if not exists idx_convenience_fee_audit_owner
  on rental_convenience_fee_audit (owner_id, performed_at);
alter table rental_convenience_fee_audit enable row level security;
alter table rental_convenience_fee_audit force row level security;
drop policy if exists "convenience_fee_audit_owner_select" on rental_convenience_fee_audit;
create policy "convenience_fee_audit_owner_select" on rental_convenience_fee_audit
  for select to authenticated using (has_workspace_access(owner_id));

-- Audited, owner-scoped write for the workspace card fee -- mirrors
-- set_rental_payment_policy: explicit value, workspace-access check, every
-- change recorded. Out-of-range values are rejected before any write.
create or replace function public.set_rental_card_convenience_fee(p_owner_id text, p_fee_bps integer)
returns rental_billing_settings
language plpgsql
set search_path to 'public'
as $function$
declare
    authenticated_owner_id text := auth.uid()::text;
    previous jsonb;
    result rental_billing_settings;
begin
    if authenticated_owner_id is null then
        raise exception 'Authenticated owner id is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or not has_workspace_access(p_owner_id) then
        raise exception 'Convenience fee owner does not match authenticated owner.' using errcode = '42501';
    end if;
    if p_fee_bps is null or p_fee_bps < 0 or p_fee_bps > 10000 then
        raise exception 'Convenience fee must be between 0 and 10000 basis points.' using errcode = '22023';
    end if;

    select to_jsonb(r) into previous
      from rental_billing_settings r where r.owner_id = p_owner_id;

    insert into rental_billing_settings (owner_id, card_convenience_fee_bps, updated_at)
    values (p_owner_id, p_fee_bps, now())
    on conflict (owner_id) do update
      set card_convenience_fee_bps = excluded.card_convenience_fee_bps,
          updated_at = excluded.updated_at;

    select * into result from rental_billing_settings where owner_id = p_owner_id;

    insert into rental_convenience_fee_audit (owner_id, change, performed_by)
    values (p_owner_id,
            jsonb_build_object('previous', coalesce(previous -> 'card_convenience_fee_bps', 'null'::jsonb),
                               'new', p_fee_bps),
            authenticated_owner_id);

    return result;
end;
$function$;
revoke all on function public.set_rental_card_convenience_fee(text, integer) from public, anon;
grant execute on function public.set_rental_card_convenience_fee(text, integer) to authenticated;

-- 5. Ledger split: rent posts as income; the convenience fee posts as a
-- SEPARATE reimbursement row that income/NOI builders exclude (they only
-- count transaction_kind in ('income','expense')). The Stripe processing cost
-- itself lives in rental_settlements.fee_amount_cents -- the reimbursement
-- row nets against it so the owner is made whole, never double-paid.
-- Pre-fee rows have convenience_fee_cents = 0 and behave exactly as before.
create or replace function post_succeeded_rental_payment_to_financial_event()
returns trigger language plpgsql security definer set search_path=public set row_security=off as $$
declare
  v_property_id text;
  v_event_date date;
  v_fee_cents integer;
  v_rent_cents integer;
begin
  if new.status<>'succeeded' then return new; end if;
  if tg_op='UPDATE' and old.status='succeeded' then return new; end if;
  select property_id into v_property_id from rental_leases where owner_id=new.owner_id and id=new.lease_id;
  v_event_date:=coalesce(new.received_at,new.succeeded_at,new.created_at)::date;
  v_fee_cents:=coalesce(new.convenience_fee_cents,0);
  v_rent_cents:=new.amount_cents - v_fee_cents;
  insert into financial_events(owner_id,property_id,event_date,description,amount,transaction_kind,normalized_category,
    tax_deductible,affects_noi,capitalized,source_system,source_record_id,metadata,created_by,updated_by)
  values(new.owner_id,v_property_id,v_event_date,'Rent payment received',v_rent_cents/100.0,'income','rental_income',
    false,true,false,'forge_rental_payment',new.id,jsonb_build_object('payment_id',new.id,'charge_id',new.charge_id,
      'lease_id',new.lease_id,'tenant_id',new.tenant_id,'provider',new.provider,'currency_code',new.currency_code,
      'convenience_fee_cents',v_fee_cents),new.owner_id,new.owner_id)
  on conflict(owner_id,source_system,source_record_id) do nothing;
  if v_fee_cents > 0 then
    insert into financial_events(owner_id,property_id,event_date,description,amount,transaction_kind,normalized_category,
      tax_deductible,affects_noi,capitalized,source_system,source_record_id,metadata,created_by,updated_by)
    values(new.owner_id,v_property_id,v_event_date,'Card convenience fee reimbursement',v_fee_cents/100.0,'reimbursement',
      'convenience_fee_reimbursement',false,false,false,'forge_rental_convenience_fee',new.id,
      jsonb_build_object('payment_id',new.id,'charge_id',new.charge_id,'lease_id',new.lease_id,'tenant_id',new.tenant_id,
        'provider',new.provider,'currency_code',new.currency_code,'convenience_fee_bps',new.convenience_fee_bps,
        'fee_agreed_at',new.fee_agreed_at,'fee_card_brand',new.fee_card_brand),new.owner_id,new.owner_id)
    on conflict(owner_id,source_system,source_record_id) do nothing;
  end if;
  return new;
end;$$;

-- 6. Autopay enrollment: optional card-fee consent snapshot. Only honored for
-- card enrollments; a bank enrollment always stores NULL (ACH never carries
-- a fee). The sweep charges the fee at the CONSENTED rate capped at the
-- current workspace rate: an owner raise never enlarges an autopay fee, an
-- owner lowering or disabling the fee lowers/removes it too. The tenant can
-- never be charged more than they agreed to.
create or replace function request_rental_autopay_enrollment(
  p_lease_id text,
  p_payment_method_type text,
  p_charge_day smallint,
  p_reminder_days_before smallint,
  p_consent_text text,
  p_provider_mode text,
  p_fee_consent_bps integer default null
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
  v_fee_consent_bps integer := null;
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

  -- Fee consent only exists for card autopay; a bank enrollment never carries
  -- a fee, so any supplied value is discarded there (fail closed).
  if p_payment_method_type = 'card' and p_fee_consent_bps is not null then
    if p_fee_consent_bps < 0 or p_fee_consent_bps > 10000 then
      raise exception 'Convenience fee consent must be between 0 and 10000 basis points.' using errcode = '22023';
    end if;
    v_fee_consent_bps := p_fee_consent_bps;
  end if;

  insert into rental_autopay_enrollments (
    owner_id, id, lease_id, tenant_id, status, payment_method_type, charge_day,
    reminder_days_before, consent_text, consented_at, provider_mode,
    fee_consent_bps, fee_consented_at
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
    p_provider_mode,
    v_fee_consent_bps,
    case when v_fee_consent_bps is not null and v_fee_consent_bps > 0 then now() else null end
  ) returning * into result;

  return result;
end;
$$;
revoke all on function request_rental_autopay_enrollment(text, text, smallint, smallint, text, text, integer)
  from public, anon;
grant execute on function request_rental_autopay_enrollment(text, text, smallint, smallint, text, text, integer)
  to authenticated;
